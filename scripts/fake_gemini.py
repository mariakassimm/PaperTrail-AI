"""A local STAND-IN for Google's Gemini generateContent API. It is NOT the real service.

Used for offline demos and for `npm run e2e:ai`, so speed, caching, retry and timeout behaviour can be tested
without a key or network. Usage: python scripts/fake_gemini.py [port]   (default 9933; key must be TESTKEY-123)

Control endpoints (GET):  /__calls  /__delay/<seconds>  /__fail_next/<n>  /__reset
"""
import json
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

KEY = "TESTKEY-123"
state = {"calls": 0, "delay": 0.0, "fail_next": 0}
lock = threading.Lock()


class Handler(BaseHTTPRequestHandler):
    def _send(self, code: int, body: dict) -> None:
        data = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self) -> None:  # noqa: N802 - http.server API
        with lock:
            if self.path.startswith("/__delay/"):
                state["delay"] = float(self.path.rsplit("/", 1)[1])
            elif self.path.startswith("/__fail_next/"):
                state["fail_next"] = int(self.path.rsplit("/", 1)[1])
            elif self.path == "/__reset":
                state.update(calls=0, delay=0.0, fail_next=0)
            snapshot = dict(state)
        self._send(200, snapshot)

    def do_POST(self) -> None:  # noqa: N802
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        if self.headers.get("x-goog-api-key") != KEY:
            return self._send(400, {"error": {"message": "API key not valid. Please pass a valid API key."}})
        with lock:
            state["calls"] += 1
            fail = state["fail_next"] > 0
            state["fail_next"] -= 1 if fail else 0
            delay = state["delay"]
        if fail:
            return self._send(503, {"error": {"message": "The model is overloaded. Please try again later."}})
        time.sleep(delay)
        prompt = body["contents"][0]["parts"][0]["text"]
        text = "OK" if "Say OK" in prompt else "The matching passage answers this question [1]."
        self._send(200, {"candidates": [{"content": {"parts": [{"text": text}]}, "finishReason": "STOP"}]})

    def log_message(self, *args) -> None:  # keep test output quiet
        pass


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 9933
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
