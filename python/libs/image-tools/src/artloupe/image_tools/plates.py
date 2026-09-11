"""The plate suite: grayscale, a value map, and value contours — three plates from one pipeline.

FR-301 asks for a grayscale study, value maps, and a structural outline at detail presets. Here
they are one pipeline rather than three tools: the value map posterizes lightness into `levels`
values, and the outline traces the boundaries *between* those values rather than raw gradients.
So the outline carries no texture speckle, and the two always correspond — every contour is an
edge of the value map it was traced from, by construction.

**Lightness is CIELAB L\\***, not luma. L* is close to what a painter means by value: equal steps
look like equal steps. The grayscale plate keeps each pixel's L* and drops its colour, so a
saturated red and a grey of the same value render alike, as they would to a squint.

**Thresholds default to multi-level Otsu** on this photograph's own L* histogram. They fall in
its gaps, so a low-key portrait stays low-key and its face still separates into planes. Equal
L* steps were rejected as the default because a low-key face collapses into the dark value;
equal-area steps because they split a black background into three "values". A caller can pass
explicit thresholds instead, and the value map is then a choice rather than a fit.

**The outline is geometry, not a picture.** Each contour is a polyline in the overlay's
normalized space, and every segment carries a measured `edge_strength`: how strongly lightness
changes across it. A contour marks where value crosses a threshold, which on a soft gradient —
the edge of a form shadow, light on water — is not an edge in the photograph at all. The
measurement is how a consumer tells a found edge from a lost one; dropping soft crossings
instead would break the correspondence above.

**Orientation is the caller's job**, as for every tool here: EXIF must already be applied.
"""

import math
import time
from itertools import pairwise
from typing import Literal

import cv2
import numpy as np
from numpy.typing import NDArray
from pydantic import BaseModel, ConfigDict, Field, FiniteFloat, model_validator

from artloupe.image_tools.perspective import NormalizedPoint
from artloupe.image_tools.versioning import tool_version
from artloupe.schemas.artifact import ArtifactMetadata
from artloupe.schemas.evidence import Checksum

# Bump when the algorithm or any constant below changes what a given input produces.
PLATES_ALGORITHM_VERSION = "1"

MIN_LEVELS = 2
MAX_LEVELS = 7

# FR-301's three detail presets. One parameter drives both plates, which is what keeps a
# coarse outline and a coarse value map describing the same regions.
OutlineDetail = Literal["coarse", "medium", "fine"]
DETAIL_LEVELS: dict[OutlineDetail, int] = {"coarse": 3, "medium": 5, "fine": 7}

# Thresholds are chosen from a histogram of this many bins over L* 0-100, so each resolves to
# about 0.4 L* — well under a visible step.
_HISTOGRAM_BINS = 256

# Edges are measured on L* smoothed this lightly — as a fraction of the long edge, about one
# pixel at the default working size. Enough that JPEG noise does not read as a hard edge; far
# less than the classification smoothing, which would make every edge look soft.
_EDGE_SIGMA = 0.001

# `edge_strength` rises with the logarithm of the gradient: 0 at or below
# `SOFT_EDGE_GRADIENT`, 1 at or above `HARD_EDGE_GRADIENT`, both in L* per 1% of the long edge.
# Logarithmic because softness reads in proportion — a transition twice as wide looks one step
# softer, whatever its width. The anchors are judgements taken from drawn edges between L* 20
# and 80: a hard step measures about 115, the same step blurred over 5% of the long edge about
# 5.5 (strength ≈ 0.37), and a linear ramp across the whole image about 0.7. On the demo
# photographs, segments span roughly 2 to 180.
SOFT_EDGE_GRADIENT = 1.0
HARD_EDGE_GRADIENT = 100.0

LIMITATION_SRGB = (
    "Lightness is computed as if the pixels are sRGB. An embedded colour profile is not visible "
    "to the tool and is not applied."
)
LIMITATION_FITTED = (
    "Thresholds are fitted to this photograph's own lightness histogram, so a value index does "
    "not mean the same lightness from one photograph to the next."
)
LIMITATION_SUPPLIED = (
    "Thresholds were supplied with the request, not fitted to the photograph: where the values "
    "divide is a choice, not a measurement."
)
LIMITATION_EMPTY_VALUE = (
    "The photograph has fewer distinct values than were requested; at least one value covers "
    "none of it."
)
LIMITATION_THRESHOLD_CROSSING = (
    "A contour marks where lightness crosses a threshold, not an edge in the photograph. On a "
    "soft gradient — the edge of a form shadow, light on water — the threshold sets its "
    "position; edge_strength measures how strongly lightness changes across it."
)
LIMITATION_STRENGTH_MIXES = (
    "edge_strength rises with both how abrupt and how large a change in lightness is: a faint "
    "hard edge and a strong soft one can measure alike."
)
LIMITATION_NO_OBJECTS = (
    "Cast shadows and reflections are traced as value shapes, and a reflection joins the object "
    "it reflects when their values match. The outline does not know what an object is."
)
LIMITATION_FRAME = (
    "Contours stop at the frame. A value region that continues beyond the photograph is left "
    "open rather than closed along its edge."
)


def _limitation_small_regions(min_region: float) -> str:
    return (
        f"Value regions smaller than {min_region:.2%} of the image are absorbed into their "
        "nearest neighbour."
    )


class PlateParameters(BaseModel):
    """What the pipeline runs with. Recorded verbatim, after validation, in every plate's FR-305
    metadata — the three share one recipe, which is what makes them correspond."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    # Plates are rendered at most this long on the long edge; smaller images are never upscaled.
    # Contours are normalized, so their coordinates do not depend on it — how closely they follow
    # the photograph does.
    working_long_edge_px: int = Field(default=1024, ge=256, le=4096)
    # Values in the value map, and so the outline's detail. 3 is the three-value study.
    levels: int = Field(default=3, ge=MIN_LEVELS, le=MAX_LEVELS)
    # Explicit L* thresholds, darkest first, one fewer than `levels`. `None` fits them.
    thresholds: tuple[FiniteFloat, ...] | None = None
    # Gaussian smoothing of L* before it is classified, as a fraction of the long edge. It is
    # what keeps grain and texture from becoming value regions.
    smoothing: float = Field(default=0.0025, ge=0.0, le=0.02)
    # Value regions smaller than this fraction of the image are absorbed into a neighbour.
    min_region: float = Field(default=0.0005, ge=0.0, le=0.05)
    # Contours are simplified to within this distance, as a fraction of the long edge.
    simplify: float = Field(default=0.001, ge=0.0, le=0.01)

    @model_validator(mode="after")
    def _thresholds_fit_levels(self) -> "PlateParameters":
        if self.thresholds is None:
            return self
        if len(self.thresholds) != self.levels - 1:
            raise ValueError(
                f"{self.levels} levels need {self.levels - 1} thresholds, "
                f"got {len(self.thresholds)}"
            )
        if not all(0.0 < threshold < 100.0 for threshold in self.thresholds):
            raise ValueError("thresholds are L* values and must lie strictly between 0 and 100")
        if any(upper <= lower for lower, upper in pairwise(self.thresholds)):
            raise ValueError("thresholds must be strictly increasing")
        return self

    @classmethod
    def for_detail(cls, detail: OutlineDetail) -> "PlateParameters":
        return cls(levels=DETAIL_LEVELS[detail])


class GrayscalePlate(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, arbitrary_types_allowed=True)

    # uint8, one channel, at the working size: each pixel is the sRGB grey with its L*.
    image: np.ndarray
    metadata: ArtifactMetadata


class ValuePlate(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, arbitrary_types_allowed=True)

    # uint8, one channel: each value as a flat grey, at L* evenly spaced from 0 to 100.
    image: np.ndarray
    # uint8, one channel: the value index of each pixel, 0 the darkest.
    labels: np.ndarray
    # The L* thresholds the values were divided at, darkest first — fitted or supplied.
    thresholds: tuple[float, ...]
    # The fraction of the image each value covers, darkest first. A measured claim a plan can
    # cite: "87% of this photograph is the dark value."
    shares: tuple[float, ...]
    metadata: ArtifactMetadata


class ValueContour(BaseModel):
    """One boundary in the value map: value `level - 1` on one side, `level` on the other."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    level: int = Field(ge=1, le=MAX_LEVELS - 1)
    # Pixel centres along the lighter side of the boundary, in normalized coordinates.
    points: list[NormalizedPoint] = Field(min_length=2)
    # True when the last point joins the first. A contour that meets the frame is open.
    closed: bool
    # One per segment, in order; a closed contour's last segment joins its last point to its
    # first. The median L* gradient across the boundary along that segment, in L* per 1% of the
    # long edge, and the same scaled to `[0, 1]` — see `SOFT_EDGE_GRADIENT`.
    edge_gradient: list[float]
    edge_strength: list[float]

    @model_validator(mode="after")
    def _one_measurement_per_segment(self) -> "ValueContour":
        segments = len(self.points) if self.closed else len(self.points) - 1
        if not len(self.edge_gradient) == len(self.edge_strength) == segments:
            raise ValueError(f"expected {segments} segment measurements")
        if self.closed and len(self.points) < 3:
            raise ValueError("a closed contour needs at least three points")
        return self


class OutlinePlate(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    contours: list[ValueContour]
    metadata: ArtifactMetadata


class PlateSuite(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    grayscale: GrayscalePlate
    values: ValuePlate
    outline: OutlinePlate


def _as_bgr(image: NDArray[np.uint8]) -> NDArray[np.uint8]:
    if image.dtype != np.uint8:
        raise ValueError(f"expected a uint8 image, got {image.dtype}")
    if image.ndim == 2:
        return cv2.cvtColor(image, cv2.COLOR_GRAY2BGR)
    if image.ndim == 3 and image.shape[2] == 3:
        return image
    raise ValueError(f"expected a grayscale or BGR image, got shape {image.shape}")


def _downscale(bgr: NDArray[np.uint8], long_edge: int) -> NDArray[np.uint8]:
    height, width = bgr.shape[:2]
    scale = long_edge / max(height, width)
    if scale >= 1.0:
        return bgr
    size = (max(1, round(width * scale)), max(1, round(height * scale)))
    return cv2.resize(bgr, size, interpolation=cv2.INTER_AREA)


def _lightness(bgr: NDArray[np.uint8]) -> NDArray[np.float32]:
    lab = cv2.cvtColor(bgr.astype(np.float32) / 255.0, cv2.COLOR_BGR2Lab)
    return np.ascontiguousarray(lab[:, :, 0])


def _grey_for_lightness(lightness: NDArray[np.float32]) -> NDArray[np.uint8]:
    """The sRGB grey with each given L*, whatever the input's shape."""
    lab = np.zeros((1, lightness.size, 3), dtype=np.float32)
    lab[0, :, 0] = lightness.ravel()
    bgr = cv2.cvtColor(lab, cv2.COLOR_Lab2BGR)
    grey = np.clip(np.rint(bgr[0, :, 0] * 255.0), 0, 255).astype(np.uint8)
    return grey.reshape(lightness.shape)


def _smooth(lightness: NDArray[np.float32], sigma: float) -> NDArray[np.float32]:
    if sigma <= 0.0:
        return lightness
    return cv2.GaussianBlur(lightness, (0, 0), sigma)


def _multi_otsu(lightness: NDArray[np.float32], levels: int) -> tuple[float, ...]:
    """Exact multi-level Otsu: the thresholds that maximise between-class variance.

    Dynamic programming over the histogram, so it is exact at every level count rather than a
    search that only scales to three. Ties resolve to the lowest threshold, deterministically.
    """
    hist, edges = np.histogram(lightness, bins=_HISTOGRAM_BINS, range=(0.0, 100.0))
    prob = hist / hist.sum()
    centres = (edges[:-1] + edges[1:]) / 2
    cum_prob = np.concatenate(([0.0], np.cumsum(prob)))
    cum_mass = np.concatenate(([0.0], np.cumsum(prob * centres)))

    # best[k, stop]: the largest sum of mass² / weight over k classes covering bins [0, stop).
    # Maximising it maximises between-class variance, since the overall mean is fixed.
    best = np.full((levels + 1, _HISTOGRAM_BINS + 1), -np.inf)
    back = np.zeros((levels + 1, _HISTOGRAM_BINS + 1), dtype=np.intp)
    best[0, 0] = 0.0
    for klass in range(1, levels + 1):
        for stop in range(klass, _HISTOGRAM_BINS + 1):
            starts = np.arange(klass - 1, stop)
            weight = cum_prob[stop] - cum_prob[starts]
            mass = cum_mass[stop] - cum_mass[starts]
            safe_weight = np.where(weight > 0, weight, 1.0)
            between = np.where(weight > 0, mass * mass / safe_weight, 0.0)
            scores = best[klass - 1, starts] + between
            pick = int(np.argmax(scores))
            best[klass, stop] = scores[pick]
            back[klass, stop] = starts[pick]

    cuts: list[float] = []
    stop = _HISTOGRAM_BINS
    for klass in range(levels, 1, -1):
        stop = int(back[klass, stop])
        cuts.append(float(edges[stop]))
    return tuple(sorted(cuts))


def _absorb_small_regions(labels: NDArray[np.uint8], min_area: int) -> NDArray[np.uint8]:
    """Reassign every region smaller than `min_area` to the nearest pixel outside one."""
    if min_area <= 1:
        return labels
    small = np.zeros(labels.shape, dtype=bool)
    for value in np.unique(labels):
        mask = (labels == value).astype(np.uint8)
        _count, components, stats, _centroids = cv2.connectedComponentsWithStats(
            mask, connectivity=4
        )
        tiny = np.flatnonzero(stats[:, cv2.CC_STAT_AREA] < min_area)
        tiny = tiny[tiny != 0]  # component 0 is everything that is not this value
        if tiny.size:
            small |= np.isin(components, tiny)
    if not small.any() or small.all():
        return labels
    # Pixels to keep are the zeros the distance transform measures from; each small pixel takes
    # the label of the nearest one.
    marked = np.where(small, 255, 0).astype(np.uint8)
    _distance, nearest = cv2.distanceTransformWithLabels(
        marked, cv2.DIST_L2, 5, labelType=cv2.DIST_LABEL_PIXEL
    )
    lookup = np.zeros(int(nearest.max()) + 1, dtype=labels.dtype)
    lookup[nearest[~small]] = labels[~small]
    return lookup[nearest]


def _edge_gradient(lightness: NDArray[np.float32], long_edge: int) -> NDArray[np.float32]:
    """L* gradient magnitude, in L* per 1% of the long edge, so it does not depend on size."""
    smoothed = _smooth(lightness, _EDGE_SIGMA * long_edge)
    # A 3×3 Sobel kernel estimates the derivative scaled by 8.
    along_x = cv2.Sobel(smoothed, cv2.CV_32F, 1, 0, ksize=3) / 8.0
    along_y = cv2.Sobel(smoothed, cv2.CV_32F, 0, 1, ksize=3) / 8.0
    return np.hypot(along_x, along_y) * (long_edge / 100.0)


def _strength(gradient: float) -> float:
    if gradient <= SOFT_EDGE_GRADIENT:
        return 0.0
    span = math.log(HARD_EDGE_GRADIENT / SOFT_EDGE_GRADIENT)
    return min(1.0, math.log(gradient / SOFT_EDGE_GRADIENT) / span)


def _chains(
    boundary: NDArray[np.intc], width: int, height: int
) -> list[tuple[NDArray[np.intc], bool]]:
    """Split a traced boundary where it runs along the frame, which is not a value edge."""
    xs, ys = boundary[:, 0], boundary[:, 1]
    on_frame = (xs == 0) | (xs == width - 1) | (ys == 0) | (ys == height - 1)
    if not on_frame.any():
        return [(boundary, True)]
    # Start on a frame pixel, so every interior run lies whole inside the sequence.
    start = int(np.argmax(on_frame))
    rolled = np.roll(boundary, -start, axis=0)
    interior = ~np.roll(on_frame, -start)
    changes = np.flatnonzero(np.diff(np.concatenate(([0], interior.astype(np.int8), [0]))))
    chains: list[tuple[NDArray[np.intc], bool]] = []
    for run_start, run_stop in zip(changes[0::2], changes[1::2], strict=True):
        # Keep the frame pixel at each end, so the line reaches the edge of the photograph.
        if run_stop < len(rolled):
            chain = rolled[run_start - 1 : run_stop + 1]
        else:
            chain = np.vstack([rolled[run_start - 1 :], rolled[:1]])
        if len(chain) >= 2:
            chains.append((chain, False))
    return chains


def _vertex_indices(chain: NDArray[np.intc], vertices: NDArray[np.intc], closed: bool) -> list[int]:
    """Where each simplified vertex sits along the chain it was simplified from.

    Douglas-Peucker keeps a subset of the chain's own points, in order, so each is found by
    walking forward from the last. A closed chain may be simplified from any starting point.
    """
    keys = [tuple(point) for point in chain.tolist()]
    wanted = [tuple(point) for point in vertices.tolist()]
    count = len(keys)
    cursor = keys.index(wanted[0]) if closed else 0
    indices = [cursor]
    for vertex in wanted[1:]:
        cursor = (cursor + 1) % count
        while keys[cursor] != vertex:
            cursor = (cursor + 1) % count
        indices.append(cursor)
    return indices


def _segment_gradients(
    samples: NDArray[np.float32], indices: list[int], closed: bool
) -> list[float]:
    """The median gradient along the stretch of chain each simplified segment stands for."""
    pairs = list(pairwise(indices))
    if closed:
        pairs.append((indices[-1], indices[0]))
    gradients: list[float] = []
    for first, last in pairs:
        if first <= last:
            span = samples[first : last + 1]
        else:
            span = np.concatenate([samples[first:], samples[: last + 1]])
        gradients.append(float(np.median(span)))
    return gradients


def _trace(
    labels: NDArray[np.uint8],
    levels: int,
    gradient: NDArray[np.float32],
    tolerance_px: float,
) -> list[ValueContour]:
    height, width = labels.shape
    contours: list[ValueContour] = []
    for level in range(1, levels):
        mask = (labels >= level).astype(np.uint8)
        traced, _hierarchy = cv2.findContours(mask, cv2.RETR_LIST, cv2.CHAIN_APPROX_NONE)
        for boundary in traced:
            for chain, closed in _chains(boundary[:, 0, :], width, height):
                simplified = cv2.approxPolyDP(chain.reshape(-1, 1, 2), tolerance_px, closed)
                vertices = simplified[:, 0, :]
                if len(vertices) < (3 if closed else 2):
                    continue
                indices = _vertex_indices(chain, vertices, closed)
                samples = gradient[chain[:, 1], chain[:, 0]]
                gradients = _segment_gradients(samples, indices, closed)
                contours.append(
                    ValueContour(
                        level=level,
                        points=[
                            NormalizedPoint(x=(col + 0.5) / width, y=(row + 0.5) / height)
                            for col, row in vertices.tolist()
                        ],
                        closed=closed,
                        edge_gradient=gradients,
                        edge_strength=[_strength(value) for value in gradients],
                    )
                )
    return contours


def _elapsed_ms(started: float) -> int:
    return round((time.perf_counter() - started) * 1000)


def make_plates(
    image: NDArray[np.uint8],
    *,
    source_checksum: Checksum,
    parameters: PlateParameters | None = None,
) -> PlateSuite:
    """Grayscale, value map and outline, from one pass over the photograph.

    `image` is a uint8 grayscale or BGR array, already in its displayed orientation.
    `source_checksum` is the FR-105 checksum of the upload it was decoded from. Each plate's
    `duration_ms` is the time to produce it from the source, so the three are cumulative.
    """
    started = time.perf_counter()
    params = parameters or PlateParameters()
    bgr = _downscale(_as_bgr(image), params.working_long_edge_px)
    height, width = bgr.shape[:2]
    long_edge = max(height, width)
    version = tool_version(PLATES_ALGORITHM_VERSION)
    recorded = params.model_dump()

    lightness = _lightness(bgr)
    grayscale = GrayscalePlate(
        image=_grey_for_lightness(lightness),
        metadata=ArtifactMetadata(
            tool="grayscale",
            tool_version=version,
            parameters=recorded,
            source_checksum=source_checksum,
            duration_ms=_elapsed_ms(started),
            # A deterministic conversion has no confidence: it ran or it did not.
            confidence=None,
            limitations=[LIMITATION_SRGB],
        ),
    )

    smoothed = _smooth(lightness, params.smoothing * long_edge)
    thresholds = params.thresholds or _multi_otsu(smoothed, params.levels)
    labels = np.digitize(smoothed, thresholds).astype(np.uint8)
    labels = _absorb_small_regions(labels, round(params.min_region * height * width))
    counts = np.bincount(labels.ravel(), minlength=params.levels)
    shares = tuple(float(count) / labels.size for count in counts)
    tones = _grey_for_lightness(np.linspace(0.0, 100.0, params.levels, dtype=np.float32))

    value_limitations = [
        LIMITATION_SRGB,
        LIMITATION_SUPPLIED if params.thresholds else LIMITATION_FITTED,
        _limitation_small_regions(params.min_region),
    ]
    if not all(counts):
        value_limitations.append(LIMITATION_EMPTY_VALUE)
    values = ValuePlate(
        image=tones[labels],
        labels=labels,
        thresholds=tuple(float(threshold) for threshold in thresholds),
        shares=shares,
        metadata=ArtifactMetadata(
            tool="three_value",
            tool_version=version,
            parameters=recorded,
            source_checksum=source_checksum,
            duration_ms=_elapsed_ms(started),
            confidence=None,
            limitations=value_limitations,
        ),
    )

    contours = _trace(
        labels,
        params.levels,
        _edge_gradient(lightness, long_edge),
        params.simplify * long_edge,
    )
    outline = OutlinePlate(
        contours=contours,
        metadata=ArtifactMetadata(
            tool="outline",
            tool_version=version,
            parameters=recorded,
            source_checksum=source_checksum,
            duration_ms=_elapsed_ms(started),
            # The edge measurements are per segment, not a confidence in the artifact.
            confidence=None,
            limitations=[
                *value_limitations,
                LIMITATION_THRESHOLD_CROSSING,
                LIMITATION_STRENGTH_MIXES,
                LIMITATION_NO_OBJECTS,
                LIMITATION_FRAME,
            ],
        ),
    )
    return PlateSuite(grayscale=grayscale, values=values, outline=outline)
