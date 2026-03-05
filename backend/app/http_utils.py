# app/http_utils.py
import base64
from typing import Dict, Optional

from .schemas import AuthConfig

def apply_auth(headers: Dict[str, str], auth: Optional[AuthConfig]) -> Dict[str, str]:
    """
    Applies Authorization header based on auth.type.
    If auth is present and not 'none', this will override headers['Authorization'].
    """
    if not auth or getattr(auth, "type", "none") == "none":
        return headers

    t = getattr(auth, "type", "none")
    if t == "basic":
        username = getattr(auth, "username", "")
        password = getattr(auth, "password", "")
        token = base64.b64encode(f"{username}:{password}".encode("utf-8")).decode("ascii")
        headers["Authorization"] = f"Basic {token}"
        return headers

    if t == "bearer":
        token = getattr(auth, "token", "")
        headers["Authorization"] = f"Bearer {token}"
        return headers

    return headers

def redact_headers(headers: Dict[str, str]) -> Dict[str, str]:
    """
    Use this for logging so Authorization never prints.
    """
    out = dict(headers)
    if "Authorization" in out:
        out["Authorization"] = "***REDACTED***"
    return out
