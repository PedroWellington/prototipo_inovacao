import time
from collections import defaultdict
from threading import Lock

MAX_FAILURES = 5
WINDOW_SECONDS = 15 * 60

# shortcut: em memória, por processo; zera ao reiniciar e não vale com vários workers. Trocar por Redis/tabela antes de produção.
_failures: dict[tuple[str, str], list[float]] = defaultdict(list)
_lock = Lock()


def _recent(key: tuple[str, str], now: float) -> list[float]:
    attempts = [t for t in _failures[key] if now - t < WINDOW_SECONDS]
    _failures[key] = attempts
    return attempts


def is_blocked(ip: str, email: str) -> bool:
    with _lock:
        return len(_recent((ip, email.lower()), time.monotonic())) >= MAX_FAILURES


def register_failure(ip: str, email: str) -> None:
    with _lock:
        now = time.monotonic()
        _recent((ip, email.lower()), now).append(now)


def reset(ip: str, email: str) -> None:
    with _lock:
        _failures.pop((ip, email.lower()), None)


def clear_all() -> None:  # usado pelos testes
    with _lock:
        _failures.clear()
