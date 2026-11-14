import hashlib
import secrets

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError

# PasswordHasher usa argon2id por padrão (parâmetros recomendados pela RFC 9106).
_hasher = PasswordHasher()
# Hash fixo para gastar o mesmo tempo quando o e-mail não existe (não revela existência pelo tempo).
_DUMMY_HASH = _hasher.hash("locus-dummy-password")


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password_hash: str | None, password: str) -> bool:
    try:
        return _hasher.verify(password_hash or _DUMMY_HASH, password) and password_hash is not None
    except (VerifyMismatchError, InvalidHashError):
        return False


def new_token() -> str:
    return secrets.token_urlsafe(32)  # 32 bytes aleatórios


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()
