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
# Bound memory: past this many tracked users, forget the ones whose buckets are full.
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
    ) -> None:
        self._burst = burst
        self._refill = refill_per_second
        self._clock = clock
        self._buckets: dict[str, _Bucket] = {}

    def _refilled(self, bucket: _Bucket, now: float) -> float:
        return min(self._burst, bucket.tokens + (now - bucket.updated) * self._refill)

    def acquire(self, user_id: str) -> int:
        """Spend one token. Return 0 when allowed, else whole seconds until one is free."""
        now = self._clock()
        bucket = self._buckets.get(user_id)
        tokens = self._burst if bucket is None else self._refilled(bucket, now)
        if tokens < 1:
            return math.ceil((1 - tokens) / self._refill)
        self._buckets[user_id] = _Bucket(tokens - 1, now)
        if len(self._buckets) > MAX_TRACKED_USERS:
            self._prune(now)
        return 0

    def _prune(self, now: float) -> None:
        for user_id, bucket in list(self._buckets.items()):
            if self._refilled(bucket, now) >= self._burst:
                del self._buckets[user_id]


limiter = RateLimiter()
