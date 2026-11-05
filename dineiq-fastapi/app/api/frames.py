from fastapi import HTTPException, Request

MAX_FRAME_BYTES = 2 * 1024 * 1024


async def read_jpeg(request: Request) -> bytes:
    if request.headers.get("content-type", "").split(";", 1)[0].lower() != "image/jpeg":
        raise HTTPException(
            status_code=415, detail="Send a JPEG frame with Content-Type image/jpeg."
        )
    content = bytearray()
    async for chunk in request.stream():
        if len(content) + len(chunk) > MAX_FRAME_BYTES:
            raise HTTPException(status_code=413, detail="Camera frames must be 2 MiB or smaller.")
        content.extend(chunk)
    return bytes(content)
