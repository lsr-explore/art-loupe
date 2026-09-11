"""The `tool_version` every image tool records in its FR-305 metadata.

The FR-305 recipe `(source_checksum, tool, tool_version, parameters)` must reproduce exactly,
so the version names every library that can move a tool's output, not only the tool's own
algorithm. OpenCV's output can change between releases, and NumPy supplies the arithmetic
underneath all of it. Each tool bumps its own algorithm version; the library versions are
appended at run time, identically for every tool. A tool that depends on something more — the
face tool's `mediapipe` runtime and its bundled model — names it in `extras`, appended last.
"""

import cv2
import numpy as np


def tool_version(algorithm_version: str, *extras: str) -> str:
    """`<algorithm>+opencv-<version>.numpy-<version>`, then `.<extra>` for each extra."""
    suffix = "".join(f".{extra}" for extra in extras)
    return f"{algorithm_version}+opencv-{cv2.__version__}.numpy-{np.__version__}{suffix}"
