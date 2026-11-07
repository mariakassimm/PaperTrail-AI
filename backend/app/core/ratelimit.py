import threading
import time
from collections import deque
from collections.abc import Callable


class SlidingWindowLimiter:
    """In-memory limiter protecting free provider quotas. Single process only."""

    def __init__(self, max_events: int, window_seconds: float = 60.0,
                 clock: Callable[[], float] = time.monotonic) -> None:
        self.max_events, self.window, self._clock = max_events, window_seconds, clock
        self._events: deque[float] = deque()
        self._lock = threading.Lock()

    def allow(self) -> bool:
        now = self._clock()
        with self._lock:
            while self._events and now - self._events[0] >= self.window:
                self._events.popleft()
            if len(self._events) >= self.max_events:
                return False
            self._events.append(now)
            return True
