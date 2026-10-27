"""
In-memory rate limiting.

A sliding window counter per key. Deliberately simple:

  * It lives in this process only. Restart the server and counters reset.
  * Run two workers and each keeps its own counts, so the real limit doubles.

Both are fine for now and NOT fine in production — see the note at the bottom
of this file. The interface is what matters: when you swap in Redis, only the
body of `hit()` changes.
"""

from __future__ import annotations

import logging
import time
from collections import defaultdict, deque
from dataclasses import dataclass

logger = logging.getLogger("aibh.ratelimit")


@dataclass
class RateVerdict:
    allowed: bool
    remaining: int
    retry_after: int = 0


class SlidingWindowLimiter:
    def __init__(self, limit: int, window_seconds: int, name: str = "limiter"):
        self.limit = limit
        self.window = window_seconds
        self.name = name
        self._hits: dict[str, deque[float]] = defaultdict(deque)

    def hit(self, key: str) -> RateVerdict:
        """Record one request against `key` and say whether it is allowed."""
        now = time.monotonic()
        bucket = self._hits[key]

        # Drop everything that fell out of the window.
        cutoff = now - self.window
        while bucket and bucket[0] < cutoff:
            bucket.popleft()

        if len(bucket) >= self.limit:
            retry_after = int(bucket[0] + self.window - now) + 1
            logger.warning("%s limit hit for key=%s...", self.name, key[:12])
            return RateVerdict(allowed=False, remaining=0, retry_after=max(1, retry_after))

        bucket.append(now)
        return RateVerdict(allowed=True, remaining=self.limit - len(bucket))

    def reset(self, key: str) -> None:
        self._hits.pop(key, None)

    def sweep(self, max_keys: int = 10_000) -> None:
        """
        Drop empty buckets so the dict cannot grow forever.

        Without this, one key per unique visitor accumulates until restart.
        """
        if len(self._hits) < max_keys:
            return
        cutoff = time.monotonic() - self.window
        stale = [k for k, v in self._hits.items() if not v or v[-1] < cutoff]
        for key in stale:
            self._hits.pop(key, None)
        logger.info("%s swept %s stale keys", self.name, len(stale))
