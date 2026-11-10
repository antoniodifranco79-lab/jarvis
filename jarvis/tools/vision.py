from __future__ import annotations

import base64
import io
from typing import Literal

from . import ToolContext
from .base import ToolRegistry, ToolResult

MAX_WIDTH = 1280


def _encode(image) -> str:  # a PIL image -> base64 JPEG, downscaled to keep token cost sane
    if image.width > MAX_WIDTH:
        image = image.resize((MAX_WIDTH, int(image.height * MAX_WIDTH / image.width)))
    buf = io.BytesIO()
    image.convert("RGB").save(buf, format="JPEG", quality=80)
    return base64.b64encode(buf.getvalue()).decode()


def capture_screen() -> str:
    import mss  # optional dependency
    from PIL import Image

    with mss.mss() as sct:
        shot = sct.grab(sct.monitors[1] if len(sct.monitors) > 1 else sct.monitors[0])
        image = Image.frombytes("RGB", shot.size, shot.bgra, "raw", "BGRX")
    return _encode(image)


def capture_camera(index: int = 0) -> str:
    import cv2  # optional dependency
    from PIL import Image

    cam = cv2.VideoCapture(index)
    try:
        for _ in range(5):  # let exposure settle
            ok, frame = cam.read()
        if not ok:
            raise RuntimeError("the camera returned no frame")
    finally:
        cam.release()
    return _encode(Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)))


def register(registry: ToolRegistry, ctx: ToolContext) -> None:
    @registry.tool(timeout=30)
    def look(source: Literal["screen", "camera"] = "screen") -> ToolResult:
        """See through the computer's eyes: capture the screen or the webcam and look at the image.
        Call it for "what do you see", "what's on my screen", "look at this", "is anyone there", "read this error".

        Args:
            source: "screen" for a screenshot of the main display, "camera" for a webcam photo.
        """
        try:
            data = capture_screen() if source == "screen" else capture_camera()
        except ImportError as exc:
            return ToolResult.error(
                f"Vision isn't installed on this machine ({exc.name}). Install with: pip install 'jarvis-ai[vision]'"
            )
        except Exception as exc:  # noqa: BLE001
            return ToolResult.error(f"Could not capture the {source}: {exc}")
        return ToolResult.image(data, "image/jpeg", caption=f"Capture of the {source}.")
