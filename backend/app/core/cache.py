import hashlib
import threading
from collections import OrderedDict


class AnswerCache:
    """Remembers raw AI outputs so an identical request is answered instantly and costs no quota.

    The key is a hash of the *exact* prompt sent (system rules + passages + earlier turns + question), the model
    and the token limit. If a document changes, the retrieved passages change, so the key changes: stale answers
    can never be served for different evidence. In memory only; cleared on restart.
    """

    def __init__(self, max_entries: int) -> None:
        self.max_entries = max_entries
        self._items: OrderedDict[str, str] = OrderedDict()
        self._lock = threading.Lock()

    @staticmethod
    def key(system: str, prompt: str, provider_label: str, max_tokens: int) -> str:
        raw = "\x00".join([system, prompt, provider_label, str(max_tokens)])
        return hashlib.sha256(raw.encode("utf-8")).hexdigest()

    def get(self, key: str) -> str | None:
        if self.max_entries <= 0:
            return None
        with self._lock:
            if key not in self._items:
                return None
            self._items.move_to_end(key)
            return self._items[key]

    def put(self, key: str, value: str) -> None:
        if self.max_entries <= 0:
            return
        with self._lock:
            self._items[key] = value
            self._items.move_to_end(key)
            while len(self._items) > self.max_entries:
                self._items.popitem(last=False)

    def __len__(self) -> int:
        return len(self._items)

    # An empty cache must still count as 'present': callers test `cache is not None`, never `if cache`.
    def __bool__(self) -> bool:
        return True
