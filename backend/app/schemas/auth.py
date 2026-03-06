from __future__ import annotations

from typing import Literal, Optional
from pydantic import BaseModel, Field, HttpUrl


AuthType = Literal["none", "basic", "bearer", "oauth2_client_credentials"]


class OAuth2ClientCredentials(BaseModel):
    tokenUrl: HttpUrl
    clientId: str = Field(min_length=1)
    clientSecret: str = Field(min_length=1)
    scope: Optional[str] = None  # space-delimited scopes, if required by server
    audience: Optional[str] = None  # optional, used by some providers (Auth0 etc.)


class AuthConfig(BaseModel):
    type: AuthType = "none"

    # basic
    username: Optional[str] = None
    password: Optional[str] = None

    # bearer
    bearerToken: Optional[str] = None

    # oauth2 client credentials
    oauth2: Optional[OAuth2ClientCredentials] = None
