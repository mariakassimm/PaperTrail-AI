"""Provider abstraction. Providers only turn (system, user) text into text; RAG logic lives elsewhere."""
import logging
import random
import time
from abc import ABC, abstractmethod
from collections.abc import Callable

import httpx

MAX_ERROR_CHARS = 200
logger = logging.getLogger("papertrail.providers")


class ProviderError(Exception):
    """A provider failure whose message is safe to show to the user (never contains secrets)."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


class GenerationProvider(ABC):
    name: str
    model: str

    @property
    def label(self) -> str:
        return f"{self.name} ({self.model})"

    @abstractmethod
    def generate(self, system: str, user: str, max_tokens: int) -> str: ...


def _scrub(text: str, secret: str) -> str:
    return text.replace(secret, "***")[:MAX_ERROR_CHARS] if secret else text[:MAX_ERROR_CHARS]


def describe_network_error(exc: Exception) -> str:
    """Turn a low-level connection failure into advice a person can act on (never includes secrets)."""
    text = f"{type(exc).__name__} {exc}".lower()
    if "certificate" in text or "ssl" in text or "tls" in text:
        return ("Could not make a secure (HTTPS) connection to the AI provider because of a certificate problem. "
                "Antivirus HTTPS scanning, a proxy, a VPN or a wrong computer clock is the usual cause.")
    if "getaddrinfo" in text or "name or service" in text or "11001" in text or "nodename" in text or "resolve" in text:
        return "Could not look up the AI provider's address (a DNS problem). Check your internet connection, VPN or DNS settings."
    if "proxy" in text:
        return "A proxy blocked the connection to the AI provider. Check your proxy settings."
    if "refused" in text or "10061" in text or "forbidden by its access permissions" in text or "10013" in text:
        return "The connection to the AI provider was refused. A firewall or antivirus may be blocking this program."
    if "reset" in text or "10054" in text or "closed" in text or "eof" in text or "disconnected" in text:
        return "The connection to the AI provider was dropped. Try again; if it keeps happening, a VPN, antivirus or unstable Wi-Fi is likely."
    return "Could not reach the AI provider. Check your internet connection."


RETRYABLE_STATUS = frozenset({502, 503, 504})  # overloaded / bad gateway / gateway timeout: usually momentary
MAX_RETRY_WAIT = 5.0  # never make the user wait longer than this for a retry


def _backoff(attempt: int) -> float:
    return min(0.5 * 2 ** (attempt - 1), 4.0) + random.uniform(0, 0.25)


def _retry_after(response: httpx.Response) -> float | None:
    try:
        return float(response.headers["retry-after"])
    except (KeyError, ValueError):
        return None


def post_json(url: str, headers: dict[str, str], payload: dict, timeout: float,
              transport: httpx.BaseTransport | None, secret: str,
              retries: int = 0, sleep: Callable[[float], None] = time.sleep) -> tuple[int, dict]:
    """POST and return (status, parsed JSON body). Network problems become ProviderError.

    Retries (at most `retries`) happen only when a retry is likely to help and cheap:
    - 502/503/504 and dropped connections: after a short backoff.
    - 429 only if the server sent a Retry-After of at most MAX_RETRY_WAIT seconds. Otherwise a free-tier quota
      error is returned immediately: retrying would just burn more quota.
    - Timeouts are NEVER retried: the full wait already happened, and a second one would double it.
    """
    attempt = 0
    while True:
        try:
            with httpx.Client(timeout=timeout, transport=transport) as client:
                response = client.post(url, headers=headers, json=payload)
        except httpx.TimeoutException as exc:
            raise ProviderError("provider_timeout", f"The AI provider did not respond within {timeout:g} seconds.") from exc
        except httpx.HTTPError as exc:
            if attempt < retries:
                attempt += 1
                sleep(_backoff(attempt))
                continue
            # The terminal shows the exact cause (type + scrubbed text), so a vague user message is never a dead end.
            logger.warning("AI provider network error: %s: %s", type(exc).__name__, _scrub(str(exc), secret) or "no details")
            raise ProviderError("provider_unavailable", describe_network_error(exc)) from exc
        wait: float | None = None
        if attempt < retries:
            if response.status_code in RETRYABLE_STATUS:
                wait = _backoff(attempt + 1)
            elif response.status_code == 429:
                hinted = _retry_after(response)
                wait = hinted if hinted is not None and 0 <= hinted <= MAX_RETRY_WAIT else None
        if wait is not None:
            attempt += 1
            sleep(min(wait, MAX_RETRY_WAIT))
            continue
        try:
            body = response.json()
        except ValueError:
            body = {}
        return response.status_code, body if isinstance(body, dict) else {}


def error_text(body: dict, secret: str) -> str:
    err = body.get("error")
    raw = err.get("message", "") if isinstance(err, dict) else (err if isinstance(err, str) else "")
    return _scrub(str(raw), secret)