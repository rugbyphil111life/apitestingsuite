from __future__ import annotations

from typing import Any, Dict, Optional
from pydantic import BaseModel, HttpUrl, Field

from backend.app.schemas.auth import AuthConfig


class RunExecuteRequest(BaseModel):
    targetUrl: HttpUrl
    method: str = Field(default="POST")
    headers: Dict[str, str] = Field(default_factory=dict)
    body: Optional[Any] = None

    # NEW:
    auth: Optional[AuthConfig] = None
