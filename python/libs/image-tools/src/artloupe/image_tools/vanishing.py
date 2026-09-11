"""Families of segments that converge on a common point, found by sequential RANSAC.

A vanishing point is represented homogeneously as a unit 3-vector `(x, y, w)` in the isotropic
frame, so a point at infinity — a family of parallel lines — is `w = 0` rather than an
overflow. Whether a family is a vanishing point worth reporting is decided by the caller; this
module only finds the families and measures how well each one converges.

**Residual.** A segment supports a point when the line from the segment's midpoint to the point
runs along the segment. The residual is the angle between the two, in radians, in `[0, π/2]`.
It is an angle rather than a distance because a distance to a point three image-widths away is
dominated by how far away the point is, not by how well the segment points at it.
"""

from dataclasses import dataclass

import numpy as np
from numpy.typing import NDArray

from artloupe.image_tools.segments import FloatArray, Segments

# Fewer supporting segments than this is not a family. Two lines always meet somewhere, so two
# segments are no evidence of convergence at all; three is the first over-determined case.
MIN_SUPPORT_SEGMENTS = 3

# Least-squares rounds after RANSAC picks a hypothesis. The hypothesis is the intersection of
# just two segments; refining it over every inlier is what makes the point stable.
_REFINEMENT_ROUNDS = 2

_EPSILON = 1e-12


@dataclass(frozen=True)
class Family:
    """One set of segments converging on one point, with the measurements behind it."""

    # Homogeneous unit vector in the isotropic frame.
    point: FloatArray
    # Indices into the `Segments` the family was found in.
    inliers: NDArray[np.intp]
    # Segments still unclaimed when this family was fitted — the pool its inliers were drawn
    # from, and so the population chance agreement is measured against.
    pool_size: int
    # Length-weighted mean residual of the inliers, in radians.
    mean_residual: float

    def chance_multiple(self, threshold: float) -> float:
        """How many times more segments converge here than chance would put here.

        A segment of random orientation points within `threshold` of any fixed point with
        probability `threshold / (π/2)` — its residual is uniform on `[0, π/2]`. So among
        `pool_size` unrelated segments, about `pool_size × threshold / (π/2)` agree with *any*
        point by coincidence, and RANSAC, which keeps the best of thousands of hypotheses, will
        always find a point that many agree with. Support is only evidence above that floor.
        """
        expected = self.pool_size * threshold / (np.pi / 2)
        return len(self.inliers) / expected


def residuals(points: FloatArray, midpoints: FloatArray, directions: FloatArray) -> FloatArray:
    """Angular residual of every segment against every point: `(points, segments)` radians."""
    towards = points[:, None, :2] - midpoints[None, :, :] * points[:, None, 2:3]
    cross = directions[None, :, 0] * towards[..., 1] - directions[None, :, 1] * towards[..., 0]
    norm = np.hypot(towards[..., 0], towards[..., 1])
    # A point sitting on a segment's midpoint says nothing about its direction; score it as
    # perpendicular so it can never count as support.
    sine = np.where(norm > _EPSILON, np.abs(cross) / np.maximum(norm, _EPSILON), 1.0)
    return np.arcsin(np.clip(sine, 0.0, 1.0))


def _least_squares_point(lines: FloatArray, weights: FloatArray) -> FloatArray:
    """The unit vector minimizing `Σ w (line · p)²` — the smallest eigenvector of `Σ w l lᵀ`."""
    scatter = (lines * weights[:, None]).T @ lines
    _eigenvalues, eigenvectors = np.linalg.eigh(scatter)
    return eigenvectors[:, 0]


def _fit_family(
    segments: Segments,
    pool: NDArray[np.intp],
    *,
    threshold: float,
    hypotheses: int,
    rng: np.random.Generator,
) -> Family | None:
    if pool.size < MIN_SUPPORT_SEGMENTS:
        return None

    lines = segments.lines[pool]
    midpoints = segments.midpoints[pool]
    directions = segments.directions[pool]
    weights = segments.lengths[pool]

    first = rng.integers(0, pool.size, hypotheses)
    second = rng.integers(0, pool.size, hypotheses)
    distinct = first != second
    candidates = np.cross(lines[first[distinct]], lines[second[distinct]])
    norms = np.linalg.norm(candidates, axis=1)
    usable = norms > _EPSILON
    if not usable.any():
        return None
    candidates = candidates[usable] / norms[usable, None]

    # Score by supporting *length*, not count, so one long edge outweighs a scatter of
    # texture fragments that happen to agree.
    inlier_grid = residuals(candidates, midpoints, directions) < threshold
    best = candidates[np.argmax(inlier_grid @ weights)]

    for _round in range(_REFINEMENT_ROUNDS):
        inlier_mask = residuals(best[None], midpoints, directions)[0] < threshold
        if inlier_mask.sum() < MIN_SUPPORT_SEGMENTS:
            break
        best = _least_squares_point(lines[inlier_mask], weights[inlier_mask])

    final = residuals(best[None], midpoints, directions)[0]
    inlier_mask = final < threshold
    if inlier_mask.sum() < MIN_SUPPORT_SEGMENTS:
        return None

    return Family(
        point=best,
        inliers=pool[inlier_mask],
        pool_size=int(pool.size),
        mean_residual=float(np.average(final[inlier_mask], weights=weights[inlier_mask])),
    )


def find_families(
    segments: Segments,
    *,
    threshold: float,
    hypotheses: int,
    max_families: int,
    rng: np.random.Generator,
) -> list[Family]:
    """Find up to `max_families` families, strongest first, each claiming its inliers.

    Sequential: once a family is found its inliers leave the pool, so a segment supports at
    most one point. That is what stops the strongest family being found again as the second.
    """
    families: list[Family] = []
    pool = np.arange(len(segments))
    for _index in range(max_families):
        family = _fit_family(segments, pool, threshold=threshold, hypotheses=hypotheses, rng=rng)
        if family is None:
            break
        families.append(family)
        pool = np.setdiff1d(pool, family.inliers, assume_unique=True)
    return families
