"""
Toy LM Trainer Service
======================
Manages a GPU-backed training queue for character-level LSTM language models.

Resource model:
  • One job runs at a time (asyncio.Semaphore(1)) — protects the 4090.
  • Pending jobs sit in an asyncio.Queue and see their queue position.
  • Training runs in a ThreadPoolExecutor to avoid blocking the event loop.
  • Metrics are pushed from the thread to per-job asyncio.Queue via
    loop.call_soon_threadsafe; SSE endpoints drain those queues.
  • Disconnecting the SSE client does NOT stop training — it continues
    in the background and metrics are saved to DB after each epoch.
"""

from __future__ import annotations

import asyncio
import logging
import math
import os
import re
import threading
import time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Dict, List, Optional
from uuid import UUID

import torch
import torch.nn as nn

logger = logging.getLogger(__name__)

CHECKPOINT_DIR = os.environ.get("TOY_LM_CHECKPOINT_DIR", "/tmp/toy_lm_checkpoints")
MAX_CORPUS_CHARS = 200_000
MAX_SAMPLES = 60_000
MAX_TRAINING_HOURS = 3.0
MAX_WORD_VOCAB = 3000


def normalize_token_mode(mode: Optional[str]) -> str:
    return "char" if mode == "char" else "word"


def infer_vocab_token_mode(vocab: dict, params: Optional[dict] = None) -> str:
    explicit = vocab.get("tokenMode") or (params or {}).get("tokenMode")
    if explicit:
        return normalize_token_mode(explicit)
    if "indexToChar" in vocab or "charToIndex" in vocab:
        return "char"
    return "word"


def build_toy_vocab(corpus: str, token_mode: str = "word") -> dict:
    mode = normalize_token_mode(token_mode)
    if mode == "char":
        chars = sorted(set(corpus))
        char_to_index = {c: i for i, c in enumerate(chars)}
        return {
            "tokenMode": "char",
            "charToIndex": char_to_index,
            "indexToChar": chars,
            "vocabSize": len(chars),
        }

    raw_tokens = tokenize_toy_text(corpus, "word")
    counts = Counter(raw_tokens)
    tokens = ["<unk>"] + [
        token
        for token, _ in counts.most_common(MAX_WORD_VOCAB - 1)
        if token != "<unk>"
    ]
    token_to_index = {token: i for i, token in enumerate(tokens)}
    return {
        "tokenMode": "word",
        "tokenToIndex": token_to_index,
        "indexToToken": tokens,
        "vocabSize": len(tokens),
        "rawTokenCount": len(raw_tokens),
    }


def tokenize_toy_text(text: str, token_mode: str) -> list[str]:
    if normalize_token_mode(token_mode) == "char":
        return list(text)
    return re.findall(r"\w+|[^\w\s]", text, flags=re.UNICODE)


def detokenize_toy_tokens(tokens: list[str], token_mode: str) -> str:
    if normalize_token_mode(token_mode) == "char":
        return "".join(tokens)

    no_space_before = {".", ",", ";", ":", "!", "?", ")", "]", "}", "%", "…"}
    no_space_after = {"(", "[", "{", "¿", "¡"}
    out = ""
    for token in tokens:
        if token == "<unk>":
            token = "?"
        if not out or token in no_space_before or out[-1] in "([{\"'":
            out += token
        elif token in no_space_after:
            out += " " + token
        else:
            out += " " + token
    return out


def vocab_tokens(vocab: dict) -> list[str]:
    return vocab.get("indexToToken") or vocab.get("indexToChar") or []


def vocab_token_to_index(vocab: dict) -> dict:
    return vocab.get("tokenToIndex") or vocab.get("charToIndex") or {}


# ─── PyTorch Model ────────────────────────────────────────────────────────────

class CharLSTM(nn.Module):
    def __init__(self, vocab_size: int, embed_dim: int, hidden_size: int, num_layers: int = 2):
        super().__init__()
        self.hidden_size = hidden_size
        self.num_layers = num_layers
        self.embedding = nn.Embedding(vocab_size, embed_dim, padding_idx=0)
        self.lstm = nn.LSTM(
            embed_dim, hidden_size, num_layers,
            batch_first=True,
            dropout=0.2 if num_layers > 1 else 0.0,
        )
        self.fc = nn.Linear(hidden_size, vocab_size)

    def forward(self, x: torch.Tensor, hidden=None):
        emb = self.embedding(x)
        out, hidden = self.lstm(emb, hidden)
        logits = self.fc(out[:, -1, :])
        return logits, hidden


# ─── Active Job control object ────────────────────────────────────────────────

class ActiveJob:
    """Created when a job starts running. Lives until training completes or stops."""

    def __init__(self, job_id: str, loop: asyncio.AbstractEventLoop):
        self.job_id = job_id
        self.loop = loop
        self.stop_event = threading.Event()
        self.pause_event = threading.Event()
        self._metric_queue: asyncio.Queue = asyncio.Queue(maxsize=2000)
        self.current_epoch: int = 0
        self.checkpoint_path: Optional[str] = None
        self.epoch_metrics: List[dict] = []
        self.was_stopped: bool = False
        self.was_paused: bool = False
        self._done_sent: bool = False

    def push(self, event: dict) -> None:
        """Thread-safe push from training thread → asyncio queue."""
        try:
            self.loop.call_soon_threadsafe(self._metric_queue.put_nowait, event)
        except Exception:
            pass  # Queue full or loop closed — non-fatal

    async def next_event(self, timeout: float = 30.0) -> Optional[dict]:
        try:
            return await asyncio.wait_for(self._metric_queue.get(), timeout=timeout)
        except asyncio.TimeoutError:
            return {"type": "ping"}

    def pause(self):
        # Pausing breaks out of the training loop so the GPU slot is released.
        # Progress is resumable: every completed epoch is checkpointed to disk.
        self.was_paused = True
        self.stop_event.set()

    def resume(self):
        self.pause_event.clear()

    def stop(self):
        self.was_stopped = True
        self.stop_event.set()
        self.pause_event.clear()


# ─── Trainer service singleton ────────────────────────────────────────────────

class ToyLMService:
    """Singleton that owns the GPU semaphore, job queue, and active job dict."""

    _instance: Optional["ToyLMService"] = None

    def __new__(cls) -> "ToyLMService":
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._init()
        return cls._instance

    def _init(self):
        self._semaphore = asyncio.Semaphore(1)
        self._pending: asyncio.Queue = asyncio.Queue()
        self._queue_order: list[str] = []          # ordered pending job IDs
        self._active: Dict[str, ActiveJob] = {}    # currently running/paused jobs
        self._executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="toy-lm")
        self._device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        self._queue_task: Optional[asyncio.Task] = None
        logger.info("ToyLMService initialised — device: %s", self._device)

    # ── Lifecycle ──────────────────────────────────────────────────────────────

    def start_queue_processor(self) -> None:
        """Call once from FastAPI lifespan (in async context)."""
        loop = asyncio.get_event_loop()
        self._queue_task = loop.create_task(self._run_queue())
        logger.info("ToyLM queue processor started")

    # ── Public API ─────────────────────────────────────────────────────────────

    async def enqueue(self, job_id: str) -> int:
        """Add job to pending queue. Returns 1-based position."""
        self._queue_order.append(job_id)
        await self._pending.put(job_id)
        return len(self._queue_order)

    def queue_position(self, job_id: str) -> int:
        """0 = running, >0 = position in queue, -1 = not found."""
        if job_id in self._active:
            return 0
        try:
            return self._queue_order.index(job_id) + 1
        except ValueError:
            return -1

    def get_active(self, job_id: str) -> Optional[ActiveJob]:
        return self._active.get(job_id)

    def pause(self, job_id: str) -> bool:
        job = self._active.get(job_id)
        if job:
            job.pause()
            return True
        return False

    def resume(self, job_id: str) -> bool:
        job = self._active.get(job_id)
        if job:
            job.resume()
            return True
        return False

    def stop(self, job_id: str) -> bool:
        # Remove from queue if still pending
        if job_id in self._queue_order:
            self._queue_order.remove(job_id)
        job = self._active.get(job_id)
        if job:
            job.stop()
            return True
        return False

    # ── Internal queue runner ──────────────────────────────────────────────────

    async def _run_queue(self) -> None:
        """Picks jobs from the queue one at a time, holding the GPU semaphore."""
        from app.core.database import AsyncSessionLocal
        from app.models.toy_lm import ToyLMJob
        from sqlalchemy import select

        # Reconcile jobs left mid-flight by a previous process: after a restart
        # the in-memory queue is empty, so any 'running'/'queued' row is orphaned.
        # Make them resumable rather than stuck.
        async with AsyncSessionLocal() as db:
            orphans = (await db.execute(
                select(ToyLMJob).where(ToyLMJob.status.in_(["running", "queued"]))
            )).scalars().all()
            for row in orphans:
                row.status = "paused" if (row.saved_epoch or 0) > 0 else "stopped"
            if orphans:
                await db.commit()
                logger.info("ToyLM: reconciled %d orphaned job(s) on startup", len(orphans))

        while True:
            job_id = await self._pending.get()
            if job_id in self._queue_order:
                self._queue_order.remove(job_id)

            async with AsyncSessionLocal() as db:
                row = await db.get(ToyLMJob, UUID(job_id))
                if not row or row.status in ("stopped", "completed", "failed"):
                    continue
                # Snapshot everything needed — don't hold the session in the thread
                corpus = (row.corpus_text or "")[:MAX_CORPUS_CHARS]
                params = dict(row.hyperparams_json or {})
                vocab = dict(row.vocab_json or {})
                start_epoch = row.saved_epoch or 0
                ckpt_path = row.checkpoint_path
                row.status = "running"
                row.started_at = datetime.now(timezone.utc)
                await db.commit()

            loop = asyncio.get_event_loop()
            active = ActiveJob(job_id, loop)
            self._active[job_id] = active

            async with self._semaphore:
                try:
                    await loop.run_in_executor(
                        self._executor,
                        self._train,
                        active, corpus, params, vocab, start_epoch, ckpt_path,
                    )
                except Exception as e:
                    logger.exception("Training job %s raised: %s", job_id, e)
                    active.push({"type": "error", "message": str(e)})
                    async with AsyncSessionLocal() as db:
                        row = await db.get(ToyLMJob, UUID(job_id))
                        if row:
                            row.status = "failed"
                            row.error_message = str(e)[:1000]
                            await db.commit()
                    del self._active[job_id]
                    continue

            # Training thread finished — persist results
            async with AsyncSessionLocal() as db:
                row = await db.get(ToyLMJob, UUID(job_id))
                if row:
                    if active.was_stopped:
                        row.status = "stopped"
                    elif active.was_paused:
                        row.status = "paused"
                    else:
                        row.status = "completed"
                    row.saved_epoch = active.current_epoch
                    row.checkpoint_path = active.checkpoint_path
                    row.metrics_json = active.epoch_metrics
                    row.completed_at = datetime.now(timezone.utc)
                    await db.commit()

            del self._active[job_id]

    # ── Training thread (runs in ThreadPoolExecutor) ───────────────────────────

    def _train(
        self,
        job: ActiveJob,
        corpus: str,
        params: dict,
        vocab: dict,
        start_epoch: int,
        checkpoint_path: Optional[str],
    ) -> None:
        device = self._device
        seq_len: int = int(params.get("seqLen", 40))
        batch_size: int = int(params.get("batchSize", 64))
        embed_dim: int = int(params.get("embedDim", 32))
        hidden_size: int = int(params.get("hiddenSize", 128))
        num_layers: int = int(params.get("numLayers", 2))
        lr: float = float(params.get("learningRate", 0.002))
        total_epochs: int = int(params.get("totalEpochs", 20))
        metric_every: int = max(1, int(params.get("metricEvery", 20)))

        token_mode = infer_vocab_token_mode(vocab, params)
        token_to_idx: dict = vocab_token_to_index(vocab)
        index_to_token: list = vocab_tokens(vocab)
        vocab_size: int = len(index_to_token) or 1

        # Tokenise
        units = tokenize_toy_text(corpus, token_mode)
        tokens = [token_to_idx.get(unit, 0) for unit in units]
        n_samples = min(len(tokens) - seq_len, MAX_SAMPLES)
        if n_samples <= 0:
            job.push({"type": "error", "message": "Corpus troppo breve per il seq_len scelto."})
            return

        # Build tensors on CPU first
        X_all = torch.zeros(n_samples, seq_len, dtype=torch.long)
        Y_all = torch.zeros(n_samples, dtype=torch.long)
        for i in range(n_samples):
            X_all[i] = torch.tensor(tokens[i:i + seq_len], dtype=torch.long)
            Y_all[i] = tokens[i + seq_len]

        n_batches = max(1, math.ceil(n_samples / batch_size))

        # Build model
        model = CharLSTM(vocab_size, embed_dim, hidden_size, num_layers).to(device)
        optimizer = torch.optim.Adam(model.parameters(), lr=lr)

        if checkpoint_path and os.path.exists(checkpoint_path):
            try:
                ckpt = torch.load(checkpoint_path, map_location=device)
                model.load_state_dict(ckpt["model"])
                optimizer.load_state_dict(ckpt["optimizer"])
                logger.info("Loaded checkpoint %s", checkpoint_path)
            except Exception as e:
                logger.warning("Failed to load checkpoint: %s", e)

        criterion = nn.CrossEntropyLoss()
        global_step = start_epoch * n_batches
        deadline = time.time() + MAX_TRAINING_HOURS * 3600

        job.push({
            "type": "started",
            "paramCount": sum(p.numel() for p in model.parameters()),
            "nBatches": n_batches,
            "device": str(device),
        })

        for epoch in range(start_epoch, total_epochs):
            if job.stop_event.is_set() or time.time() > deadline:
                break

            perm = torch.randperm(n_samples)
            epoch_loss = 0.0
            valid_batches = 0

            for b in range(n_batches):
                # Pause and stop both set stop_event → break out and release the GPU.
                if job.stop_event.is_set() or time.time() > deadline:
                    break

                idx = perm[b * batch_size:(b + 1) * batch_size]
                if idx.numel() == 0:
                    continue
                xb = X_all[idx].to(device)
                yb = Y_all[idx].to(device)

                optimizer.zero_grad()
                logits, _ = model(xb)
                loss = criterion(logits, yb)
                loss.backward()
                nn.utils.clip_grad_norm_(model.parameters(), 1.0)
                optimizer.step()

                loss_val: float = loss.item()
                epoch_loss += loss_val
                valid_batches += 1
                global_step += 1

                if b % metric_every == 0:
                    job.push({
                        "type": "metric",
                        "globalStep": global_step,
                        "epoch": epoch,
                        "batch": b,
                        "nBatches": n_batches,
                        "loss": round(loss_val, 4),
                        "perplexity": round(math.exp(min(loss_val, 20)), 2),
                    })

            # Interrupted mid-epoch (pause/stop/deadline): discard the partial epoch —
            # the last fully-trained epoch is already checkpointed and persisted.
            if job.stop_event.is_set() or time.time() > deadline:
                break
            if valid_batches == 0:
                break

            avg_loss = epoch_loss / valid_batches
            job.current_epoch = epoch + 1
            epoch_point = {
                "type": "epoch_done",
                "epoch": epoch,
                "globalStep": global_step,
                "avgLoss": round(avg_loss, 4),
                "perplexity": round(math.exp(min(avg_loss, 20)), 2),
            }
            job.epoch_metrics.append(epoch_point)

            # Persist a checkpoint + progress after every epoch so the model can be
            # used for generation while paused, and progress survives a restart.
            job.checkpoint_path = self._write_checkpoint(job, model, optimizer, params, vocab)
            self._persist_progress(job)

            # Notify clients only after the DB reflects the new saved epoch.
            job.push(epoch_point)

            if job.stop_event.is_set():
                break

        # Final checkpoint — captures any partial progress past the last epoch.
        job.checkpoint_path = self._write_checkpoint(job, model, optimizer, params, vocab)

        # Free GPU memory
        del model
        if device.type == "cuda":
            torch.cuda.empty_cache()

        job.push({
            "type": "done",
            "savedEpoch": job.current_epoch,
            "stopped": job.was_stopped,
        })

    # ── Per-epoch persistence (called from the training thread) ────────────────

    def _write_checkpoint(self, job: "ActiveJob", model, optimizer,
                          params: dict, vocab: dict) -> str:
        """Persist model + optimizer state to disk (one file per job, overwritten)."""
        os.makedirs(CHECKPOINT_DIR, exist_ok=True)
        save_path = os.path.join(CHECKPOINT_DIR, f"{job.job_id}.pt")
        torch.save({
            "model": model.state_dict(),
            "optimizer": optimizer.state_dict(),
            "epoch": job.current_epoch,
            "params": params,
            "vocab": vocab,
        }, save_path)
        return save_path

    def _persist_progress(self, job: "ActiveJob") -> None:
        """Persist saved_epoch / checkpoint / metrics to the DB from the training thread."""
        try:
            fut = asyncio.run_coroutine_threadsafe(
                self._save_progress_db(
                    job.job_id, job.current_epoch, job.checkpoint_path, list(job.epoch_metrics),
                ),
                job.loop,
            )
            fut.result(timeout=10)
        except Exception as e:  # noqa: BLE001 — persistence is best-effort
            logger.warning("Failed to persist toy-lm progress for %s: %s", job.job_id, e)

    async def _save_progress_db(self, job_id: str, saved_epoch: int,
                                checkpoint_path: Optional[str], metrics: list) -> None:
        from app.core.database import AsyncSessionLocal
        from app.models.toy_lm import ToyLMJob
        async with AsyncSessionLocal() as db:
            row = await db.get(ToyLMJob, UUID(job_id))
            if row:
                row.saved_epoch = saved_epoch
                row.checkpoint_path = checkpoint_path
                row.metrics_json = metrics
                await db.commit()

    # ── Generation (sync, called from endpoint via run_in_executor) ───────────

    def generate_sync(
        self,
        checkpoint_path: str,
        vocab: dict,
        params: dict,
        seed: str,
        max_tokens: int,
        temperature: float,
    ) -> str:
        device = self._device
        token_mode = infer_vocab_token_mode(vocab, params)
        token_to_idx: dict = vocab_token_to_index(vocab)
        index_to_token: list = vocab_tokens(vocab)
        vocab_size = len(index_to_token) or 1
        seq_len = int(params.get("seqLen", 40))
        embed_dim = int(params.get("embedDim", 32))
        hidden_size = int(params.get("hiddenSize", 128))
        num_layers = int(params.get("numLayers", 2))

        model = CharLSTM(vocab_size, embed_dim, hidden_size, num_layers).to(device)
        ckpt = torch.load(checkpoint_path, map_location=device)
        model.load_state_dict(ckpt["model"])
        model.eval()

        seed_units = tokenize_toy_text(seed, token_mode)
        tokens = [token_to_idx.get(unit, 0) for unit in seed_units]
        generated = list(seed_units)

        with torch.no_grad():
            for _ in range(max_tokens):
                context = tokens[-seq_len:]
                # Pad to seq_len
                if len(context) < seq_len:
                    context = [0] * (seq_len - len(context)) + context
                xb = torch.tensor([context], dtype=torch.long).to(device)
                logits, _ = model(xb)
                # Temperature sampling
                logits = logits.squeeze(0) / max(temperature, 1e-6)
                probs = torch.softmax(logits, dim=-1).cpu()
                next_idx = torch.multinomial(probs, num_samples=1).item()
                next_token = index_to_token[next_idx] if next_idx < len(index_to_token) else "?"
                generated.append(next_token)
                tokens.append(next_idx)

        del model
        if device.type == "cuda":
            torch.cuda.empty_cache()
        return detokenize_toy_tokens(generated, token_mode)

    def embeddings_sync(
        self,
        checkpoint_path: str,
        vocab: dict,
        params: dict,
    ) -> dict:
        """Load the checkpoint embedding matrix for inspection in the UI."""
        token_mode = infer_vocab_token_mode(vocab, params)
        index_to_token: list = vocab_tokens(vocab)
        vocab_size = len(index_to_token) or 1
        embed_dim = int(params.get("embedDim", 32))
        hidden_size = int(params.get("hiddenSize", 128))
        num_layers = int(params.get("numLayers", 2))

        model = CharLSTM(vocab_size, embed_dim, hidden_size, num_layers).to("cpu")
        ckpt = torch.load(checkpoint_path, map_location="cpu")
        model.load_state_dict(ckpt["model"])
        model.eval()

        with torch.no_grad():
            weights = model.embedding.weight.detach().cpu().tolist()

        return {
            "embeddingDim": embed_dim,
            "tokenMode": token_mode,
            "tokens": [
                {
                    "index": i,
                    "token": index_to_token[i] if i < len(index_to_token) else "?",
                    "vector": weights[i],
                }
                for i in range(min(len(index_to_token), len(weights)))
            ],
        }


# ── Module-level singleton ─────────────────────────────────────────────────────

toy_lm_service = ToyLMService()
