"""Drawn scenes for the plate tests, each drawn to a known answer.

Every value is set in L*, the space the plates work in, and converted to the sRGB grey that has
it — so "a band at L* 50" means what the pipeline will measure, not a grey level that happens to
be near it.
"""

import cv2
import numpy as np
from numpy.typing import NDArray

from artloupe.image_tools import ValueContour

HEIGHT = 300
WIDTH = 600

# Three flat bands, darkest on the left, each a third of the width.
BAND_LIGHTNESS = (20.0, 50.0, 80.0)
BAND_WIDTH = WIDTH // 3

DISC_RADIUS = 75

# A 9 × 9 light speck in the dark band: 81 pixels, under the default `min_region` of 90 here.
SPECK_CENTRE = (HEIGHT // 2, BAND_WIDTH // 2)
SPECK_HALF = 4


def grey_for(lightness: float) -> int:
    """The sRGB grey level whose L* is `lightness`."""
    lab = np.array([[[lightness, 0.0, 0.0]]], dtype=np.float32)
    return int(np.clip(np.rint(cv2.cvtColor(lab, cv2.COLOR_Lab2BGR)[0, 0, 0] * 255.0), 0, 255))


def lightness_of(bgr: tuple[int, int, int]) -> float:
    pixel = np.array([[bgr]], dtype=np.float32) / 255.0
    return float(cv2.cvtColor(pixel, cv2.COLOR_BGR2Lab)[0, 0, 0])


def three_bands() -> NDArray[np.uint8]:
    image = np.empty((HEIGHT, WIDTH), dtype=np.uint8)
    for index, lightness in enumerate(BAND_LIGHTNESS):
        image[:, index * BAND_WIDTH : (index + 1) * BAND_WIDTH] = grey_for(lightness)
    return image


def speckled_bands() -> NDArray[np.uint8]:
    image = three_bands()
    row, col = SPECK_CENTRE
    image[row - SPECK_HALF : row + SPECK_HALF + 1, col - SPECK_HALF : col + SPECK_HALF + 1] = (
        grey_for(BAND_LIGHTNESS[2])
    )
    return image


def disc() -> NDArray[np.uint8]:
    """A light disc on a dark ground, clear of the frame, so its contour is closed."""
    image = np.full((HEIGHT, WIDTH), grey_for(20.0), dtype=np.uint8)
    cv2.circle(image, (WIDTH // 2, HEIGHT // 2), DISC_RADIUS, grey_for(80.0), thickness=-1)
    return image


CHECKER_CELL = 10


def checkerboard() -> NDArray[np.uint8]:
    """L* 20 and 80 cells that meet their own value only at corners, so every region is small."""
    rows, cols = np.indices((HEIGHT, WIDTH))
    light = ((rows // CHECKER_CELL) + (cols // CHECKER_CELL)) % 2 == 1
    return np.where(light, grey_for(80.0), grey_for(20.0)).astype(np.uint8)


def step(softness: float = 0.0) -> NDArray[np.uint8]:
    """L* 20 on the left and 80 on the right, blurred by a sigma of `softness` × the width."""
    image = np.full((HEIGHT, WIDTH), grey_for(20.0), dtype=np.uint8)
    image[:, WIDTH // 2 :] = grey_for(80.0)
    if softness > 0.0:
        image = cv2.GaussianBlur(image, (0, 0), softness * WIDTH)
    return image


def ramp() -> NDArray[np.uint8]:
    """L* rising linearly from 20 to 80 across the whole width: a crossing with no edge at all."""
    row = np.array(
        [grey_for(float(value)) for value in np.linspace(20.0, 80.0, WIDTH)], dtype=np.uint8
    )
    return np.tile(row, (HEIGHT, 1))


def colour_and_its_grey() -> NDArray[np.uint8]:
    """Saturated red on the left; on the right, the grey with red's L*."""
    red = (0, 0, 255)
    image = np.empty((HEIGHT, WIDTH, 3), dtype=np.uint8)
    image[:, : WIDTH // 2] = red
    image[:, WIDTH // 2 :] = grey_for(lightness_of(red))
    return image


def off_boundary_points(labels: NDArray[np.uint8], contour: ValueContour) -> list[tuple[int, int]]:
    """Contour points that do not sit on an edge of `labels` at the contour's level.

    A point is on the edge when its own pixel is on the lighter side and some neighbour — or the
    frame, which counts as outside — is not. Empty means the outline traces the value map.
    """
    height, width = labels.shape
    lighter = labels >= contour.level
    padded = np.pad(lighter, 1, constant_values=False)
    misses: list[tuple[int, int]] = []
    for point in contour.points:
        col = round(point.x * width - 0.5)
        row = round(point.y * height - 0.5)
        window = padded[row : row + 3, col : col + 3]
        if not lighter[row, col] or window.all():
            misses.append((col, row))
    return misses
