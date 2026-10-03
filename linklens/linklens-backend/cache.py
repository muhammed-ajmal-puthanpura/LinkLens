# cache.py — TTL-based in-memory cache

import time
from threading import Lock

class TTLCache:
    def __init__(self, default_ttl: int = 3600):
        self._store = {}
        self._ttl = default_ttl
        self._lock = Lock()

    def get(self, key: str):
        with self._lock:
            if key in self._store:
                value, expiry = self._store[key]
                if time.time() < expiry:
                    return value
                del self._store[key]
        return None

    def set(self, key: str, value, ttl: int = None):
        with self._lock:
            self._store[key] = (value, time.time() + (ttl or self._ttl))

    def cleanup(self):
        """Remove expired entries."""
        now = time.time()
        with self._lock:
            expired = [k for k, (_, exp) in self._store.items() if now >= exp]
            for k in expired:
                del self._store[k]

# Global cache instance (1-hour TTL)
cache = TTLCache(default_ttl=3600)