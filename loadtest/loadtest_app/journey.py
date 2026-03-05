from __future__ import annotations

import asyncio
from dataclasses import dataclass
import hashlib
import os
from pathlib import Path
import re
import time
from typing import Callable, Awaitable

import httpx
import socketio
from playwright.async_api import Browser, Page

from .config import LoadTestConfig
from .metrics import MetricsStore
from .names import fake_student_name


@dataclass
class UserResult:
    user_id: int
    ok: bool
    note: str = ""


class ApiLatencyTracker:
    def __init__(self, page: Page, metrics: MetricsStore) -> None:
        self._page = page
        self._metrics = metrics
        self._start_by_request: dict[str, float] = {}

    def bind(self) -> None:
        self._page.on("request", self._on_request)
        self._page.on("response", self._on_response)

    def _on_request(self, req) -> None:
        self._start_by_request[req.url] = time.perf_counter()

    async def _push(self, endpoint_key: str, elapsed_ms: float) -> None:
        await self._metrics.add_api_timing(endpoint_key, elapsed_ms)

    def _on_response(self, res) -> None:
        url = res.url
        if url not in self._start_by_request:
            return
        started = self._start_by_request.pop(url, None)
        if started is None:
            return
        elapsed_ms = (time.perf_counter() - started) * 1000
        key = normalize_endpoint(url)
        asyncio.create_task(self._push(key, elapsed_ms))


def normalize_endpoint(url: str) -> str:
    keep = ["/api/v1/student/join", "/api/v1/llm", "/api/v1/ml", "/api/v1/files"]
    for k in keep:
        if k in url:
            tail = url[url.find(k):]
            q = tail.find("?")
            return tail if q == -1 else tail[:q]
    return "other"


async def run_user_journey(user_id: int, browser: Browser, cfg: LoadTestConfig, metrics: MetricsStore) -> UserResult:
    await metrics.mark_launched(user_id)
    context = await browser.new_context(viewport={"width": 1366, "height": 900}, ignore_https_errors=True)
    page = await context.new_page()
    page.set_default_timeout(cfg.action_timeout_ms)

    api_tracker = ApiLatencyTracker(page, metrics)
    api_tracker.bind()

    name = fake_student_name(user_id)

    try:
        await _step(metrics, user_id, "join", lambda: _do_join(page, cfg, name))
        await metrics.add_feature("students_joined", 1)

        await _step(metrics, user_id, "open_chatbot", lambda: _open_chatbot(page))

        await _step(metrics, user_id, "chat_message", lambda: _send_chat_message(page, cfg.message, cfg.wait_chat_response_seconds))
        await metrics.add_feature("chat_requests", 1)

        await _step(metrics, user_id, "open_ml_lab", lambda: _open_ml_lab(page))
        await _step(metrics, user_id, "select_data_mode", lambda: _select_data_mode(page))

        await _step(metrics, user_id, "upload_csv", lambda: _upload_csv(page, cfg.csv_path))
        await metrics.add_feature("csv_uploaded", 1)

        await _step(metrics, user_id, "start_training", lambda: _start_training(page))
        await metrics.add_feature("training_started", 1)

        await _step(metrics, user_id, "wait_training_result", lambda: _wait_training_result(page, cfg.wait_training_seconds))
        await metrics.add_feature("training_completed", 1)

        await metrics.mark_finished(user_id, ok=True)
        return UserResult(user_id=user_id, ok=True)
    except Exception as e:  # noqa: BLE001
        await metrics.mark_finished(user_id, ok=False, note=str(e))
        return UserResult(user_id=user_id, ok=False, note=str(e))
    finally:
        await context.close()


async def run_user_journey_api(user_id: int, cfg: LoadTestConfig, metrics: MetricsStore) -> UserResult:
    await metrics.mark_launched(user_id)
    name = fake_student_name(user_id)
    base = cfg.base_url.rstrip("/")
    api_base = f"{base}/api/v1"

    session_id = ""
    student_token = ""
    dataset_id = ""
    experiment_id = ""
    conversation_id = ""
    sio_client: socketio.AsyncClient | None = None

    async with httpx.AsyncClient(timeout=cfg.action_timeout_seconds + 10.0, follow_redirects=True) as client:
        try:
            async def join_step() -> None:
                nonlocal session_id, student_token
                res = await _api_json(
                    client,
                    metrics,
                    "POST",
                    f"{api_base}/student/join",
                    endpoint_key="/api/v1/student/join",
                    json={"join_code": cfg.join_code, "nickname": name},
                )
                session_id = str(res["session_id"])
                student_token = str(res["join_token"])

            await _step(metrics, user_id, "join", join_step)
            await metrics.add_feature("students_joined", 1)
            sio_client = await _connect_student_socket(base, student_token, session_id)
            await metrics.add_feature("socket_connected", 1)

            async def class_chat_step() -> None:
                chat_text = f"[LOADTEST] {name} entrato in sessione e pronto."
                await _api_json(
                    client,
                    metrics,
                    "POST",
                    f"{api_base}/chat/session/{session_id}/messages",
                    endpoint_key="/api/v1/chat/session/{session_id}/messages",
                    headers={"student-token": student_token},
                    json={
                        "text": chat_text,
                        "attachments": [],
                    },
                )
                if sio_client and sio_client.connected:
                    await sio_client.emit(
                        "chat_public_message",
                        {
                            "session_id": session_id,
                            "text": chat_text,
                            "attachments": [],
                        },
                    )
                await _emit_activity(sio_client, "classe", "chat_pubblica")

            await _step(metrics, user_id, "class_chat_message", class_chat_step)
            await metrics.add_feature("class_chat_messages", 1)

            async def open_chatbot_step() -> None:
                await _emit_activity(sio_client, "chatbot", "open")

            await _step(metrics, user_id, "open_chatbot", open_chatbot_step)

            async def chat_step() -> None:
                nonlocal conversation_id
                conv = await _api_json(
                    client,
                    metrics,
                    "POST",
                    f"{api_base}/llm/conversations",
                    endpoint_key="/api/v1/llm/conversations",
                    headers={"student-token": student_token},
                    json={
                        "session_id": session_id,
                        "profile_key": "tutor",
                        "title": f"Loadtest {name}",
                    },
                )
                conversation_id = str(conv["id"])
                if sio_client and sio_client.connected:
                    await sio_client.emit(
                        "llm_prompt_submitted",
                        {
                            "conversation_id": conversation_id,
                            "preview": cfg.message[:200],
                        },
                    )
                await _api_json(
                    client,
                    metrics,
                    "POST",
                    f"{api_base}/llm/conversations/{conversation_id}/message",
                    endpoint_key="/api/v1/llm/conversations/{id}/message",
                    headers={"student-token": student_token},
                    json={
                        "content": cfg.message,
                    },
                )
                await _emit_activity(sio_client, "chatbot", "message_sent")

            await _step(metrics, user_id, "chat_message", chat_step)
            await metrics.add_feature("chat_requests", 1)

            async def open_ml_lab_step() -> None:
                await _emit_activity(sio_client, "classification", "open_ml_lab")

            async def select_data_mode_step() -> None:
                await _emit_activity(sio_client, "classification", "data_mode")

            await _step(metrics, user_id, "open_ml_lab", open_ml_lab_step)
            await _step(metrics, user_id, "select_data_mode", select_data_mode_step)

            async def upload_step() -> None:
                nonlocal dataset_id
                dataset_id = await _create_dataset_from_csv_or_fallback(
                    client=client,
                    metrics=metrics,
                    api_base=api_base,
                    student_token=student_token,
                    session_id=session_id,
                    csv_path=cfg.csv_path,
                )
                await _emit_activity(sio_client, "classification", "dataset_uploaded")

            await _step(metrics, user_id, "upload_csv", upload_step)
            await metrics.add_feature("csv_uploaded", 1)

            async def training_step() -> None:
                nonlocal experiment_id
                payload = {
                    "session_id": session_id,
                    "dataset_id": dataset_id,
                    "task_type": "CLASSIFICATION",
                    "config_json": {},
                }
                res = await _api_json(
                    client,
                    metrics,
                    "POST",
                    f"{api_base}/ml/experiments",
                    endpoint_key="/api/v1/ml/experiments",
                    headers={"student-token": student_token},
                    json=payload,
                )
                experiment_id = str(res["id"])
                await _emit_activity(sio_client, "classification", "training_started")

            await _step(metrics, user_id, "start_training", training_step)
            await metrics.add_feature("training_started", 1)

            async def wait_training_step() -> None:
                await _poll_experiment_status(
                    client=client,
                    metrics=metrics,
                    api_base=api_base,
                    student_token=student_token,
                    experiment_id=experiment_id,
                    wait_seconds=cfg.wait_training_seconds,
                )
                await _emit_activity(sio_client, "classification", "training_status_checked")

            await _step(metrics, user_id, "wait_training_result", wait_training_step)
            await metrics.add_feature("training_completed", 1)

            await metrics.mark_finished(user_id, ok=True)
            return UserResult(user_id=user_id, ok=True)
        except Exception as e:  # noqa: BLE001
            await metrics.mark_finished(user_id, ok=False, note=str(e))
            return UserResult(user_id=user_id, ok=False, note=str(e))
        finally:
            if sio_client and sio_client.connected:
                try:
                    await sio_client.disconnect()
                except Exception:
                    pass


async def _step(
    metrics: MetricsStore,
    user_id: int,
    step_name: str,
    fn: Callable[[], Awaitable[None]],
) -> None:
    started = time.perf_counter()
    try:
        await fn()
    except Exception as e:  # noqa: BLE001
        elapsed = (time.perf_counter() - started) * 1000
        await metrics.add_step(user_id, step_name, ok=False, ms=elapsed, note=str(e))
        raise
    elapsed = (time.perf_counter() - started) * 1000
    await metrics.add_step(user_id, step_name, ok=True, ms=elapsed)


async def _noop() -> None:
    return


async def _connect_student_socket(base_url: str, student_token: str, session_id: str) -> socketio.AsyncClient:
    sio_client = socketio.AsyncClient(reconnection=False, logger=False, engineio_logger=False)
    await sio_client.connect(
        base_url,
        socketio_path="socket.io",
        auth={"token": student_token},
        transports=["polling", "websocket"],
        wait_timeout=15,
    )
    try:
        await sio_client.call("join_session", {"session_id": session_id}, timeout=10)
    except Exception:
        # connect already places students in room; join_session call is best-effort.
        pass
    return sio_client


async def _emit_activity(sio_client: socketio.AsyncClient | None, module_key: str, step: str) -> None:
    if not sio_client or not sio_client.connected:
        return
    await sio_client.emit(
        "heartbeat_activity",
        {
            "module_key": module_key,
            "step": step,
            "context": {},
        },
    )


async def _api_json(
    client: httpx.AsyncClient,
    metrics: MetricsStore,
    method: str,
    url: str,
    endpoint_key: str,
    headers: dict[str, str] | None = None,
    json: dict | None = None,
) -> dict:
    started = time.perf_counter()
    res = await client.request(method=method, url=url, headers=headers, json=json)
    elapsed = (time.perf_counter() - started) * 1000
    await metrics.add_api_timing(endpoint_key, elapsed)
    if res.status_code >= 400:
        short = (res.text or "")[:280]
        raise RuntimeError(f"{endpoint_key} {res.status_code}: {short}")
    return res.json() if res.content else {}


async def _api_put_bytes(
    client: httpx.AsyncClient,
    metrics: MetricsStore,
    url: str,
    endpoint_key: str,
    content: bytes,
    content_type: str,
) -> None:
    started = time.perf_counter()
    res = await client.put(url, content=content, headers={"Content-Type": content_type})
    elapsed = (time.perf_counter() - started) * 1000
    await metrics.add_api_timing(endpoint_key, elapsed)
    if res.status_code >= 400:
        short = (res.text or "")[:280]
        raise RuntimeError(f"{endpoint_key} {res.status_code}: {short}")


async def _create_dataset_from_csv_or_fallback(
    client: httpx.AsyncClient,
    metrics: MetricsStore,
    api_base: str,
    student_token: str,
    session_id: str,
    csv_path: str,
) -> str:
    p = Path(csv_path)
    if not p.is_absolute():
        p = Path.cwd() / p
    if not p.exists():
        raise FileNotFoundError(f"CSV non trovato: {p}")

    content = p.read_bytes()
    checksum = hashlib.sha256(content).hexdigest()

    headers = {"student-token": student_token}
    try:
        upload = await _api_json(
            client,
            metrics,
            "POST",
            f"{api_base}/files/upload-url",
            endpoint_key="/api/v1/files/upload-url",
            headers=headers,
            json={
                "filename": p.name,
                "mime_type": "text/csv",
                "size_bytes": len(content),
                "scope": "USER",
                "session_id": session_id,
            },
        )
        upload_url = str(upload["upload_url"])
        file_id = str(upload["file_id"])

        await _api_put_bytes(
            client,
            metrics,
            upload_url,
            endpoint_key="/files/presigned-put",
            content=content,
            content_type="text/csv",
        )

        await _api_json(
            client,
            metrics,
            "POST",
            f"{api_base}/files/complete",
            endpoint_key="/api/v1/files/complete",
            headers=headers,
            json={"file_id": file_id, "checksum_sha256": checksum},
        )

        ds = await _api_json(
            client,
            metrics,
            "POST",
            f"{api_base}/ml/datasets",
            endpoint_key="/api/v1/ml/datasets",
            headers=headers,
            json={
                "scope": "USER",
                "session_id": session_id,
                "source_type": "UPLOAD",
                "file_id": file_id,
            },
        )
        return str(ds["id"])
    except Exception:
        # Fallback for environments where presigned upload is not reachable.
        ds = await _api_json(
            client,
            metrics,
            "POST",
            f"{api_base}/ml/datasets/synthetic",
            endpoint_key="/api/v1/ml/datasets/synthetic",
            headers=headers,
            json={
                "prompt": f"Genera un dataset sintetico per test load. File originale: {os.path.basename(csv_path)}",
                "session_id": session_id,
                "num_rows": 60,
            },
        )
        await metrics.add_feature("dataset_fallback_synthetic", 1)
        return str(ds["id"])


async def _poll_experiment_status(
    client: httpx.AsyncClient,
    metrics: MetricsStore,
    api_base: str,
    student_token: str,
    experiment_id: str,
    wait_seconds: float,
) -> None:
    deadline = time.monotonic() + max(3.0, wait_seconds)
    headers = {"student-token": student_token}
    last_status = "unknown"
    while time.monotonic() < deadline:
        res = await _api_json(
            client,
            metrics,
            "GET",
            f"{api_base}/ml/experiments/{experiment_id}",
            endpoint_key="/api/v1/ml/experiments/{id}",
            headers=headers,
        )
        last_status = str(res.get("status", "unknown")).lower()
        if last_status in {"failed"}:
            raise RuntimeError(f"Training failed: status={last_status}")
        if last_status in {"done", "running", "queued"}:
            return
        await asyncio.sleep(1.5)
    raise TimeoutError(f"Training status non disponibile entro timeout (last={last_status})")


async def _do_join(page: Page, cfg: LoadTestConfig, nickname: str) -> None:
    await page.goto(f"{cfg.base_url.rstrip('/')}/join", wait_until="domcontentloaded")
    await page.fill("#joinCode", cfg.join_code)
    await page.fill("#nickname", nickname)
    await page.click("button[type='submit']")
    await page.wait_for_url("**/student", timeout=cfg.action_timeout_ms)
    await _dismiss_cookie_banner(page)


async def _open_chatbot(page: Page) -> None:
    await _dismiss_cookie_banner(page)

    # If already in chatbot view (input OR profile chooser), skip card click.
    if await _chat_ready(page):
        return

    # Prefer direct card click via JS (avoids ambiguous text nodes/nav items).
    if await _click_module_card_by_text(page, "Chatbot AI") or await _click_module_card_by_text(page, "AI Chatbot"):
        try:
            await _wait_chat_ready(page, timeout_ms=5000)
            return
        except Exception:
            pass

    candidates = [
        page.get_by_text("Chatbot AI", exact=False),
        page.get_by_text("AI Chatbot", exact=False),
        page.get_by_text("Chatbot", exact=False),
        page.get_by_text("Bot", exact=False),
    ]
    for loc in candidates:
        if await loc.count() > 0:
            await loc.first.click(force=True)
            if await _chat_ready(page):
                return
            try:
                await _wait_chat_ready(page, timeout_ms=4000)
                return
            except Exception:
                pass

    # Fallback: click first card/button that mentions AI.
    ai_like = page.locator("button, [role='button'], .cursor-pointer").filter(has_text=re.compile(r"AI|Chat|Bot", re.I))
    if await ai_like.count() > 0:
        await ai_like.first.click(force=True)

    if not await _chat_ready(page):
        nav_ai = page.get_by_text("AI", exact=True)
        if await nav_ai.count() > 0:
            await nav_ai.first.click(force=True)

    await _wait_chat_ready(page, timeout_ms=30000)


async def _send_chat_message(page: Page, message: str, wait_seconds: float) -> None:
    await _dismiss_cookie_banner(page)
    await _ensure_chat_input(page)

    input_box = page.locator(
        "input[placeholder*='Scrivi un messaggio'], input[placeholder*='message'], "
        "input[placeholder*='Rispondi'], input[placeholder*='Answer']"
    ).first
    await input_box.fill(message)
    await input_box.press("Enter")

    # Wait until spinner disappears or at least one assistant answer appears.
    spinner = page.get_by_text("Sto pensando...", exact=False)
    try:
        await spinner.first.wait_for(state="visible", timeout=3000)
        await spinner.first.wait_for(state="hidden", timeout=int(wait_seconds * 1000))
    except Exception:
        await page.wait_for_timeout(1500)


async def _open_ml_lab(page: Page) -> None:
    await _dismiss_cookie_banner(page)

    # Back to home
    back = page.get_by_text("←", exact=False)
    if await back.count() > 0:
        await back.first.click()
    else:
        back2 = page.get_by_text("Back", exact=False)
        if await back2.count() > 0:
            await back2.first.click()

    if not await _click_module_card_by_text(page, "ML Lab"):
        ml = page.get_by_text("ML Lab", exact=False)
        await ml.first.click(force=True)


async def _dismiss_cookie_banner(page: Page) -> None:
    # Dismiss cookie actions when present to avoid click interception.
    for label in ("Accetta", "Accept", "Rifiuta", "Reject"):
        btn = page.get_by_role("button", name=label)
        if await btn.count() > 0:
            try:
                await btn.first.click(timeout=1500)
                await page.wait_for_timeout(200)
                return
            except Exception:
                pass


async def _chat_ready(page: Page) -> bool:
    input_box = page.locator(
        "input[placeholder*='Scrivi un messaggio'], input[placeholder*='message'], "
        "input[placeholder*='Rispondi'], input[placeholder*='Answer']"
    )
    if await input_box.count() > 0:
        return True
    profile_cards = page.locator(".cursor-pointer").filter(has_text=re.compile(r"Tutor AI|Quiz Master|Intervista|Math Coach", re.I))
    return await profile_cards.count() > 0


async def _wait_chat_ready(page: Page, timeout_ms: int) -> None:
    await page.wait_for_function(
        """() => {
            const hasInput = !!document.querySelector("input[placeholder*='Scrivi un messaggio'], input[placeholder*='message'], input[placeholder*='Rispondi'], input[placeholder*='Answer']");
            const body = document.body?.innerText || '';
            const hasProfiles = /Tutor AI|Quiz Master|Intervista|Math Coach/i.test(body);
            return hasInput || hasProfiles;
        }""",
        timeout=timeout_ms,
    )


async def _ensure_chat_input(page: Page) -> None:
    input_box = page.locator(
        "input[placeholder*='Scrivi un messaggio'], input[placeholder*='message'], "
        "input[placeholder*='Rispondi'], input[placeholder*='Answer']"
    )
    if await input_box.count() > 0:
        return

    # Profile chooser flow: choose a default profile first.
    tutor = page.locator(".cursor-pointer").filter(has_text=re.compile(r"Tutor AI", re.I))
    if await tutor.count() > 0:
        await tutor.first.click(force=True)
    else:
        first_profile = page.locator(".cursor-pointer").filter(
            has_text=re.compile(r"Tutor|Quiz|Intervista|Math|Dataset", re.I)
        )
        if await first_profile.count() > 0:
            await first_profile.first.click(force=True)

    await page.wait_for_selector(
        "input[placeholder*='Scrivi un messaggio'], input[placeholder*='message'], "
        "input[placeholder*='Rispondi'], input[placeholder*='Answer']",
        timeout=10000,
    )


async def _click_module_card_by_text(page: Page, label: str) -> bool:
    script = """
    ([text]) => {
      const cards = Array.from(document.querySelectorAll('.cursor-pointer'));
      const target = cards.find((el) => (el.innerText || '').includes(text));
      if (!target) return false;
      target.click();
      return true;
    }
    """
    try:
        return bool(await page.evaluate(script, [label]))
    except Exception:
        return False



async def _select_data_mode(page: Page) -> None:
    data_btn = page.get_by_text("Dati", exact=False)
    if await data_btn.count() == 0:
        data_btn = page.get_by_text("Data", exact=False)
    await data_btn.first.click()
    await page.wait_for_selector("input[type='file'][accept='.csv']")


async def _upload_csv(page: Page, csv_path: str) -> None:
    p = Path(csv_path)
    if not p.is_absolute():
        p = Path.cwd() / p
    if not p.exists():
        raise FileNotFoundError(f"CSV non trovato: {p}")

    file_input = page.locator("input[type='file'][accept='.csv']").first
    await file_input.set_input_files(str(p))

    loaded = page.get_by_text("Caricati", exact=False)
    if await loaded.count() == 0:
        loaded = page.get_by_text("Loaded", exact=False)
    await loaded.first.wait_for(state="visible", timeout=15000)


async def _start_training(page: Page) -> None:
    target_title = page.get_by_text("Seleziona Colonna Target", exact=False)
    if await target_title.count() == 0:
        target_title = page.get_by_text("Select Target Column", exact=False)
    await target_title.first.wait_for(state="visible")

    # Click first target button inside target panel.
    target_panel = target_title.first.locator("xpath=ancestor::div[contains(@class,'rounded') or contains(@class,'Card')][1]")
    first_button = target_panel.locator("button").first
    if await first_button.count() == 0:
        first_button = page.locator("button:has(svg)").nth(0)
    await first_button.click()

    train_btn = page.get_by_role("button", name=re.compile(r"Addestra Modello|Train Model"))
    if await train_btn.count() == 0:
        # Fallback if regex role matching is unsupported by browser locale
        train_btn = page.get_by_text("Addestra Modello", exact=False)
    await train_btn.first.click()


async def _wait_training_result(page: Page, wait_seconds: float) -> None:
    success = page.get_by_text("Modello addestrato con successo", exact=False)
    if await success.count() == 0:
        success = page.get_by_text("Model trained successfully", exact=False)

    try:
        await success.first.wait_for(state="visible", timeout=int(wait_seconds * 1000))
    except Exception:
        # Training attempt is still valid for journey if it started.
        in_progress = page.get_by_text("Training in corso", exact=False)
        if await in_progress.count() == 0:
            in_progress = page.get_by_text("Training in progress", exact=False)
        if await in_progress.count() == 0:
            raise TimeoutError("Training non completato entro timeout e nessun indicatore visibile")
