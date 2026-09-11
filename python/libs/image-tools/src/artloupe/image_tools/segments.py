"""Line segments, in the frame the vanishing-point geometry is computed in.

**Why not the overlay's normalized space.** The overlay stores `[0, 1]` on each axis, which is
anisotropic whenever the photograph is not square: an angle measured there is not the angle in
the photograph. Convergence is an angular property, so the geometry runs in an *isotropic*
frame — pixels divided by the long edge, origin at the image centre — and converts to the
overlay's space only on the way out, in `ImageFrame.to_normalized`.

Pixel coordinates follow OpenCV's convention: the centre of pixel `(0, 0)` is at `0.0`, so the
image spans `[-0.5, width - 0.5]`. The overlay's `x = 0` is the image's left *edge*, not the
first pixel's centre, and the conversion accounts for that half pixel.
"""

from dataclasses import dataclass

import cv2
import numpy as np
from numpy.typing import NDArray

FloatArray = NDArray[np.float64]


@dataclass(frozen=True)
class ImageFrame:
    """The dimensions a set of segments was measured in."""

    width: int
    height: int

    @property
    def long_edge(self) -> int:
        return max(self.width, self.height)

    @property
    def half_width(self) -> float:
        """Half the image width in the isotropic frame — the image spans `±half_width`."""
        return self.width / (2 * self.long_edge)

    @property
    def half_height(self) -> float:
        return self.height / (2 * self.long_edge)

    def to_isotropic(self, pixels: FloatArray) -> FloatArray:
        centre = np.array([(self.width - 1) / 2, (self.height - 1) / 2])
        return (pixels - centre) / self.long_edge

    def to_normalized(self, x: float, y: float) -> tuple[float, float]:
        """Isotropic frame → the overlay's `[0, 1]` space, origin top-left. Never clamped."""
        return (
            x * self.long_edge / self.width + 0.5,
            y * self.long_edge / self.height + 0.5,
        )


@dataclass(frozen=True)
class Segments:
    """Detected segments as `(n, 2)` endpoint arrays in the isotropic frame."""

    start: FloatArray
    end: FloatArray

    def __len__(self) -> int:
        return len(self.start)

    @property
    def lengths(self) -> FloatArray:
        return np.hypot(*(self.end - self.start).T)

    @property
    def midpoints(self) -> FloatArray:
        return (self.start + self.end) / 2

    @property
    def directions(self) -> FloatArray:
        """Unit direction of each segment. Sign is arbitrary — a segment has no heading."""
        delta = self.end - self.start
        return delta / np.hypot(*delta.T)[:, None]

    @property
    def lines(self) -> FloatArray:
        """Each segment's supporting line in homogeneous form, scaled so `a² + b² = 1`.

        At that scale `line · (x, y, 1)` is the signed perpendicular distance from a point to
        the line, which is what the least-squares refinement minimizes.
        """
        ones = np.ones((len(self), 1))
        raw = np.cross(np.hstack([self.start, ones]), np.hstack([self.end, ones]))
        return raw / np.hypot(raw[:, 0], raw[:, 1])[:, None]


def detect_segments(gray: NDArray[np.uint8], *, min_length: float) -> Segments:
    """Run OpenCV's LSD and keep segments at least `min_length` long, in long-edge units.

    LSD rather than probabilistic Hough: it returns sub-pixel endpoints with no accumulator
    resolution to tune, and it is deterministic, which the FR-305 recipe depends on.
    """
    frame = ImageFrame(width=gray.shape[1], height=gray.shape[0])
    raw, _widths, _precisions, _nfa = cv2.createLineSegmentDetector().detect(gray)
    if raw is None:
        empty = np.empty((0, 2))
        return Segments(start=empty, end=empty)

    pixels = raw.reshape(-1, 4).astype(np.float64)
    start = frame.to_isotropic(pixels[:, 0:2])
    end = frame.to_isotropic(pixels[:, 2:4])
    keep = np.hypot(*(end - start).T) >= min_length
    return Segments(start=start[keep], end=end[keep])
