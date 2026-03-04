from __future__ import annotations

from typing import Dict, Literal, Optional, TypedDict

import requests


AuthType = Literal["none", "bearer", "oauth2_client_credentials"]


class OAuth2ClientCredentials(TypedDict, total=False):
    tokenUrl: str
    clientId: str
    clientSecret: str
    scope: str
    audience: str


class AuthConfig(TypedDict, total=False):
    type: AuthType
    bearerToken: str
    oauth2: OAuth2ClientCredentials


class AuthError(Exception):
    pass


def build_auth_headers(auth: Optional[AuthConfig], *, timeout_s: int = 20) -> Dict[str, str]:
    """
    Returns headers to merge into outbound headers.
    NOTE: never log returned headers in production (contains Authorization).
    """
    if not auth or auth.get("type") in (None, "none"):
        return {}

    t = auth.get("type")
    if t == "bearer":
        token = (auth.get("bearerToken") or "").strip()
        if not token:
            raise AuthError("Bearer token auth selected but bearerToken is empty")
        return {"Authorization": f"Bearer {token}"}

    if t == "oauth2_client_credentials":
        oauth2 = auth.get("oauth2") or {}
        token_url = (oauth2.get("tokenUrl") or "").strip()
        client_id = (oauth2.get("clientId") or "").strip()
        client_secret = (oauth2.get("clientSecret") or "").strip()
        scope = (oauth2.get("scope") or "").strip()
        audience = (oauth2.get("audience") or "").strip()

        if not token_url:
            raise AuthError("OAuth2 tokenUrl is required")
        if not client_id:
            raise AuthError("OAuth2 clientId is required")
        if not client_secret:
            raise AuthError("OAuth2 clientSecret is required")

        data = {"grant_type": "client_credentials"}
        if scope:
            data["scope"] = scope
        if audience:
            data["audience"] = audience

        resp = requests.post(
            token_url,
            data=data,
            auth=(client_id, client_secret),
            timeout=timeout_s,
        )
        if not (200 <= resp.status_code < 300):
            raise AuthError(f"OAuth token request failed: HTTP {resp.status_code}")

        try:
            payload = resp.json()
        except Exception:
            raise AuthError("OAuth token response was not valid JSON")

        token = payload.get("access_token")
        token_type = (payload.get("token_type") or "Bearer").lower()
        if not token:
            raise AuthError("OAuth token response missing access_token")
        if token_type != "bearer":
            raise AuthError(f"Unsupported token_type: {payload.get('token_type')}")

        return {"Authorization": f"Bearer {token}"}

    raise AuthError(f"Unknown auth type: {t}")
