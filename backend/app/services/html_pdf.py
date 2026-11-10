"""Print the authored HTML with Chromium's screen layout, without a DOCX conversion."""
from __future__ import annotations

import math
import http.client
import ipaddress
import socket
import ssl
import shutil
import threading
from urllib.parse import urlsplit, urljoin

_RENDER_SLOTS = threading.BoundedSemaphore(2)
MAX_ASSET_BYTES = 8 * 1024 * 1024


def public_asset(url: str) -> tuple[bytes, str]:
    """Fetch only public static assets, pinning the validated IP through TLS and redirects."""
    for _ in range(5):
        parts = urlsplit(url)
        if parts.scheme not in {"http", "https"} or not parts.hostname or parts.username or parts.password:
            raise ValueError("Risorsa non pubblica")
        port = parts.port or (443 if parts.scheme == "https" else 80)
        if port not in {80, 443}:
            raise ValueError("Porta non consentita")
        addresses = socket.getaddrinfo(parts.hostname, port, type=socket.SOCK_STREAM)
        ips = [item[4][0] for item in addresses]
        if not ips or any(not ipaddress.ip_address(ip).is_global for ip in ips):
            raise ValueError("Indirizzo non pubblico")
        connection = http.client.HTTPConnection(parts.hostname, port, timeout=8)
        # Connect to the checked IP, never resolve the untrusted name a second time.
        connection.sock = socket.create_connection((ips[0], port), timeout=8)
        try:
            if parts.scheme == "https":
                connection.sock = ssl.create_default_context().wrap_socket(connection.sock, server_hostname=parts.hostname)
            connection.request("GET", (parts.path or "/") + ("?" + parts.query if parts.query else ""),
                               headers={"User-Agent": "Mozilla/5.0 Golinelli-PDF", "Accept-Encoding": "identity"})
            response = connection.getresponse()
            if response.status in {301, 302, 303, 307, 308}:
                url = urljoin(url, response.getheader("Location", ""))
                continue
            if response.status != 200:
                raise ValueError("Risorsa non disponibile")
            mime = response.getheader("Content-Type", "application/octet-stream")
            if not (mime.startswith(("image/", "font/", "text/css")) or mime.split(";")[0] in {
                "application/font-woff", "application/font-sfnt", "application/vnd.ms-fontobject", "application/octet-stream",
            }):
                raise ValueError("Tipo risorsa non consentito")
            data = response.read(MAX_ASSET_BYTES + 1)
            if len(data) > MAX_ASSET_BYTES:
                raise ValueError("Risorsa troppo grande")
            return data, mime
        finally:
            connection.close()
    raise ValueError("Troppi reindirizzamenti")


def html_to_pdf(source: str, width: int = 880, height: int = 900) -> bytes:
    from playwright.sync_api import sync_playwright

    if not source.strip() or len(source) > 2_000_000:
        raise ValueError("HTML vuoto o troppo grande per l'esportazione PDF")
    width = max(320, min(1920, int(width)))
    height = max(240, min(1600, int(height)))
    executable = shutil.which("chromium") or shutil.which("chromium-browser")
    if not executable:
        raise RuntimeError("Il servizio di esportazione PDF non è disponibile")
    if not _RENDER_SLOTS.acquire(timeout=30):
        raise RuntimeError("Esportazione PDF occupata: riprova tra poco")
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(executable_path=executable, args=["--disable-dev-shm-usage"])
            try:
                context = browser.new_context(viewport={"width": width, "height": height}, java_script_enabled=False,
                                              service_workers="block")
                # Every export is a fresh context with no credentials, storage or same-origin access.
                def resource(route):
                    if route.request.resource_type not in {"stylesheet", "font", "image"}:
                        route.abort()
                        return
                    try:
                        data, mime = public_asset(route.request.url)
                        route.fulfill(status=200, body=data, content_type=mime, headers={"Access-Control-Allow-Origin": "*"})
                    except (OSError, ValueError, http.client.HTTPException):
                        route.abort()

                context.route("**/*", resource)
                page = context.new_page()
                page.set_default_timeout(20_000)
                page.emulate_media(media="screen", reduced_motion="reduce")
                page.set_content(source, wait_until="load", timeout=25_000)
                page.evaluate("document.fonts.ready")
                page.evaluate("""async () => {
                    await Promise.all(Array.from(document.images).map(image => image.decode().catch(() => {})));
                }""")
                page.evaluate("""() => {
                    const style = document.createElement('style');
                    style.textContent = `*, *::before, *::after { -webkit-print-color-adjust: exact !important;
                        print-color-adjust: exact !important; animation: none !important; transition: none !important; }`;
                    document.head.append(style);
                }""")
                full_height = page.evaluate("Math.max(document.documentElement.scrollHeight, document.body.scrollHeight)")
                # A continuous brochure keeps the web layout; only exceptionally long documents paginate.
                paper_height = min(18_000, max(height, math.ceil(full_height)))
                return page.pdf(width=f"{width}px", height=f"{paper_height}px", print_background=True,
                                display_header_footer=False, prefer_css_page_size=False,
                                margin={"top": "0", "right": "0", "bottom": "0", "left": "0"})
            finally:
                browser.close()
    finally:
        _RENDER_SLOTS.release()
