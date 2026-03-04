from __future__ import annotations

from typing import Dict, Optional

import requests
from requests import Response

from app.schemas.auth import AuthConfig


class AuthError(Exception):
    pass


def _raise_for_bad_token_response(resp: Response) -> None:
    if 200 <= resp.status_code < 300:
        return
    # Avoid leaking secrets; return sanitized info.
    raise AuthError(f"OAuth token request failed: HTTP {resp.status_code}")


def _fetch_oauth2_client_credentials_token(auth: AuthConfig, timeout_s: int = 20) -> str:
    assert auth.oauth2 is not None

    data = {"grant_type": "client_credentials"}
    if auth.oauth2.scope:
        data["scope"] = auth.oauth2.scope
    # Some providers want audience in body
    if auth.oauth2.audience:
        data["audience"] = auth.oauth2.audience

    resp = requests.post(
        str(auth.oauth2.tokenUrl),
        data=data,
        auth=(auth.oauth2.clientId, auth.oauth2.clientSecret),
        timeout=timeout_s,
    )
    _raise_for_bad_token_response(resp)

    try:
        payload = resp.json()
    except Exception:
        raise AuthError("OAuth token response was not valid JSON")

    token = payload.get("access_token")
    token_type = (payload.get("token_type") or "Bearer").lower()

    if not token:
        raise AuthError("OAuth token response missing access_token")
    if token_type != "bearer":
        # Most APIs accept Bearer; keep it strict for now
        raise AuthError(f"Unsupported token_type: {payload.get('token_type')}")

    return token


def build_auth_headers(auth: Optional[AuthConfig]) -> Dict[str, str]:
    """
    Returns headers to be merged into outbound request headers.
    Never logs tokens/secrets.
    """
    if not auth or auth.type == "none":
        return {}

    if auth.type == "bearer":
        if not auth.bearerToken:
            raise AuthError("Bearer token auth selected but bearerToken is empty")
        return {"Authorization": f"Bearer {auth.bearerToken.strip()}"}

    if auth.type == "oauth2_client_credentials":
        if not auth.oauth2:
            raise AuthError("OAuth2 selected but oauth2 config missing")
        token = _fetch_oauth2_client_credentials_token(auth)
        return {"Authorization": f"Bearer {token}"}

    raise AuthError(f"Unknown auth type: {auth.type}")
