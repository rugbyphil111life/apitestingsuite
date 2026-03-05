# app/schemas.py
from typing import Literal, Optional, Union, List, Any, Dict
from pydantic import BaseModel, Field, HttpUrl

# ---------- Auth ----------
class AuthNone(BaseModel):
    type: Literal["none"] = "none"

class AuthBasic(BaseModel):
    type: Literal["basic"] = "basic"
    username: str = Field(min_length=1)
    password: str = Field(min_length=1)

class AuthBearer(BaseModel):
    type: Literal["bearer"] = "bearer"
    token: str = Field(min_length=1)

AuthConfig = Union[AuthNone, AuthBasic, AuthBearer]

# ---------- Parse ----------
class ParseRequest(BaseModel):
    payloadText: str
    payloadType: Literal["json", "xml", "csv"]
    auth: Optional[AuthConfig] = None

class ParseResponse(BaseModel):
    fields: List[str]
    nestedFields: Optional[List[str]] = None

# ---------- Runs ----------
class CreateRunRequest(BaseModel):
    targetUrl: str  # you can switch to HttpUrl if you want strict validation
    method: Literal["GET", "POST", "PUT", "PATCH", "DELETE"] = "POST"
    payloadText: Optional[str] = None
    payloadType: Optional[Literal["json", "xml", "csv"]] = None
    protectedFields: Optional[List[str]] = None
    auth: Optional[AuthConfig] = None

class CreateRunResponse(BaseModel):
    id: str

class RunMeta(BaseModel):
    id: str
    createdAt: str
    status: Literal["queued", "running", "done", "error"]

class RunDetail(RunMeta):
    results: Optional[Any] = None
    error: Optional[Any] = None
