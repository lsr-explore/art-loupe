"""Per-artist token bucket guarding the shared provider quota.

Every artist's searches spend one Pexels key, so one fast typist could exhaust it for
everyone. Each verified user gets a small burst that refills steadily. The state is
in-memory and per process: each Cloud Run instance counts separately, so this bounds
ordinary over-use rather than a determined caller. A shared limit would need the
database or a dedicated store.
"""

import math
import time
from dataclasses import dataclass

BURST = 10
REFILL_PER_SECOND = 0.5
# Bound memory: past this many tracked users, forget the least recently active. A
# forgotten artist starts again with a full burst, which errs toward allowing searches.
MAX_TRACKED_USERS = 10_000


@dataclass
class _Bucket:
    tokens: float
    updated: float


class RateLimiter:
    def __init__(
        self,
        burst: int = BURST,
        refill_per_second: float = REFILL_PER_SECOND,
        clock=time.monotonic,
        max_tracked: int = MAX_TRACKED_USERS,
    ) -> None:
        self._burst = burst
        self._refill = refill_per_second
        self._clock = clock
        self._max_tracked = max_tracked
        # Insertion order is recency order: each acquire moves its user to the end.
        self._buckets: dict[str, _Bucket] = {}

    def _refilled(self, bucket: _Bucket, now: float) -> float:
        return min(self._burst, bucket.tokens + (now - bucket.updated) * self._refill)

    def acquire(self, user_id: str) -> int:
        """Spend one token. Return 0 when allowed, else whole seconds until one is free."""
        now = self._clock()
        bucket = self._buckets.pop(user_id, None)
        tokens = self._burst if bucket is None else self._refilled(bucket, now)
        if tokens < 1:
            # Re-insert unchanged, so a refused caller still counts as recently active.
            self._buckets[user_id] = bucket
            return math.ceil((1 - tokens) / self._refill)
        self._buckets[user_id] = _Bucket(tokens - 1, now)
        while len(self._buckets) > self._max_tracked:
            del self._buckets[next(iter(self._buckets))]
        return 0


limiter = RateLimiter()
