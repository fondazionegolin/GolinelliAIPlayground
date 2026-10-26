"""Authenticated, seekable media responses (including suffix/open-ended byte ranges)."""
import re
from fastapi.responses import Response


def media_response(data: bytes, mime: str, range_header: str | None = None, headers: dict | None = None) -> Response:
    size = len(data)
    response_headers = {**(headers or {}), "Accept-Ranges": "bytes", "Cache-Control": "private, no-store"}
    if not range_header:
        return Response(data, media_type=mime, headers=response_headers)
    match = re.fullmatch(r"bytes=(\d*)-(\d*)", range_header.strip()) if len(range_header) < 128 else None
    if not match or not size or not any(match.groups()):
        return Response(status_code=416, headers={**response_headers, "Content-Range": f"bytes */{size}"})
    first, last = match.groups()
    if first:
        start, end = int(first), min(int(last), size - 1) if last else size - 1
    else:
        start, end = max(0, size - int(last)), size - 1
    if start > end or start >= size:
        return Response(status_code=416, headers={**response_headers, "Content-Range": f"bytes */{size}"})
    response_headers["Content-Range"] = f"bytes {start}-{end}/{size}"
    return Response(data[start:end + 1], status_code=206, media_type=mime, headers=response_headers)


def media_file_response(path, mime: str, range_header: str | None = None, headers: dict | None = None):
    """Stream disk-backed files in bounded blocks so a large video is never loaded into RAM per seek."""
    from fastapi.responses import StreamingResponse
    size = path.stat().st_size
    response_headers = {**(headers or {}), "Accept-Ranges": "bytes", "Cache-Control": "private, no-store"}
    start, end, status = 0, size - 1, 200
    if range_header:
        match = re.fullmatch(r"bytes=(\d*)-(\d*)", range_header.strip()) if len(range_header) < 128 else None
        if not match or not size or not any(match.groups()):
            return Response(status_code=416, headers={**response_headers, "Content-Range": f"bytes */{size}"})
        first, last = match.groups()
        if first:
            start, end = int(first), min(int(last), size - 1) if last else size - 1
        else:
            start, end = max(0, size - int(last)), size - 1
        if start > end or start >= size:
            return Response(status_code=416, headers={**response_headers, "Content-Range": f"bytes */{size}"})
        status = 206
        response_headers["Content-Range"] = f"bytes {start}-{end}/{size}"
    length = max(0, end - start + 1)
    response_headers["Content-Length"] = str(length)

    def chunks():
        with path.open("rb") as file:
            file.seek(start)
            remaining = length
            while remaining:
                block = file.read(min(256 * 1024, remaining))
                if not block:
                    break
                remaining -= len(block)
                yield block
    return StreamingResponse(chunks(), status_code=status, media_type=mime, headers=response_headers)
