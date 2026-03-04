from __future__ import annotations

from fastapi import APIRouter, HTTPException
import requests

from app.schemas.runs import RunExecuteRequest
from app.services.auth import build_auth_headers, AuthError

router = APIRouter(prefix="/api/runs", tags=["runs"])


@router.post("/execute")
def execute_run(req: RunExecuteRequest):
    """
    Execute a test run against the target API.
    This is where we inject Authorization headers.
    """

    # Merge headers safely: user headers + auth headers (auth wins if conflict)
    try:
        auth_headers = build_auth_headers(req.auth)
    except AuthError as e:
        raise HTTPException(status_code=400, detail=str(e))

    outbound_headers = dict(req.headers or {})
    outbound_headers.update(auth_headers)

    try:
        resp = requests.request(
            method=req.method,
            url=str(req.targetUrl),
            headers=outbound_headers,
            json=req.body,
            timeout=30,
        )
    except requests.RequestException as e:
        raise HTTPException(status_code=502, detail=f"Upstream request failed: {type(e).__name__}")

    # Return a normalized response (don’t leak secrets)
    content_type = resp.headers.get("content-type", "")
    return {
        "status": resp.status_code,
        "contentType": content_type,
        "headers": dict(resp.headers),
        "body": _safe_body(resp, content_type),
    }


def _safe_body(resp: requests.Response, content_type: str):
    # You likely already have logic like this.
    # Keep it defensive and avoid exceptions.
    try:
        if "application/json" in content_type.lower():
            return resp.json()
    except Exception:
        pass
    text = resp.text
    # Don’t return gigantic bodies by default
    if len(text) > 200_000:
        return text[:200_000] + "\n…(truncated)…"
    return text
