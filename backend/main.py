import os
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from auth import AuthError, build_auth_headers
from db import (
    connect,
    get_results,
    get_run,
    init_db,
    insert_results,
    insert_run,
    list_runs,
)
from runner import (
    DEFAULT_MISSING_REQUIRED_REGEX,
    detect_payload_type,
    extract_paths_csv,
    extract_paths_json,
    extract_paths_xml,
    parse_payload,
    run_omit_one,
    sha256_text,
)

app = FastAPI(title="Field Tester API", version="0.1.0")

# CORS: set ALLOWED_ORIGINS as comma-separated list in Render env
allowed = os.getenv("ALLOWED_ORIGINS", "*")
allow_origins = [o.strip() for o in allowed.split(",")] if allowed != "*" else ["*"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allow_origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

conn = connect()
init_db(conn)


# ----------------------------
# Models
# ----------------------------
class ParseRequest(BaseModel):
    payloadText: str
    payloadType: Optional[str] = None  # json|xml|csv|unknown
    csvSendMode: str = "csv_as_json"  # csv_as_json|raw_csv
    includeContainers: bool = True


class ParseResponse(BaseModel):
    detectedType: str
    paths: List[str]


class OAuth2ClientCredentials(BaseModel):
    tokenUrl: str
    clientId: str
    clientSecret: str
    scope: Optional[str] = None
    audience: Optional[str] = None


class AuthConfig(BaseModel):
    # "none" | "bearer" | "oauth2_client_credentials"
    type: str = "none"
    bearerToken: Optional[str] = None
    oauth2: Optional[OAuth2ClientCredentials] = None


class RunRequest(BaseModel):
    endpointUrl: str
    method: str = Field(default="POST")
    headers: Dict[str, str] = Field(default_factory=dict)

    payloadText: str
    payloadType: Optional[str] = None
    csvSendMode: str = "csv_as_json"
    includeContainers: bool = True

    protectedPaths: List[str] = Field(default_factory=list)
    timeoutSeconds: int = 25
    missingRequiredRegex: str = DEFAULT_MISSING_REQUIRED_REGEX
    contentTypeOverride: Optional[str] = None
    notes: str = ""

    # NEW: auth config (NOT persisted)
    auth: Optional[AuthConfig] = None


class RunCreateResponse(BaseModel):
    runId: int


class RunMeta(BaseModel):
    id: int
    created_at_utc: str
    endpoint: str
    method: str
    payload_type: str
    payload_hash: str
    notes: str


class RunDetail(BaseModel):
    run: Dict[str, Any]
    results: List[Dict[str, Any]]


# ----------------------------
# Helpers
# ----------------------------
def _strip_auth_from_headers(headers: Dict[str, str]) -> Dict[str, str]:
    """
    Prevent accidental persistence of secrets if user puts Authorization in headers box.
    """
    cleaned: Dict[str, str] = {}
    for k, v in (headers or {}).items():
        if k.lower() == "authorization":
            continue
        cleaned[k] = v
    return cleaned


# ----------------------------
# Routes
# ----------------------------
@app.get("/api/health")
def health():
    return {"ok": True}


@app.post("/api/parse", response_model=ParseResponse)
def parse(req: ParseRequest):
    payload_text = req.payloadText or ""
    ptype = req.payloadType or detect_payload_type(payload_text)

    if ptype == "unknown":
        raise HTTPException(
            status_code=400,
            detail="Could not detect payload type (provide valid JSON/XML/CSV).",
        )

    parsed, raw_csv = parse_payload(payload_text, ptype, req.csvSendMode)

    if ptype == "json":
        paths = extract_paths_json(parsed, include_containers=req.includeContainers)
    elif ptype == "xml":
        paths = extract_paths_xml(parsed, include_containers=req.includeContainers)
    elif ptype == "csv":
        paths = extract_paths_csv(parsed, raw_csv, req.csvSendMode)
    else:
        raise HTTPException(status_code=400, detail=f"Unsupported payloadType={ptype}")

    return ParseResponse(detectedType=ptype, paths=paths)


@app.post("/api/runs", response_model=RunCreateResponse)
def create_run(req: RunRequest):
    payload_text = req.payloadText or ""
    ptype = req.payloadType or detect_payload_type(payload_text)

    if ptype == "unknown":
        raise HTTPException(
            status_code=400,
            detail="Could not detect payload type (provide valid JSON/XML/CSV).",
        )

    parsed, raw_csv = parse_payload(payload_text, ptype, req.csvSendMode)

    # discover paths
    if ptype == "json":
        all_paths = extract_paths_json(parsed, include_containers=req.includeContainers)
    elif ptype == "xml":
        all_paths = extract_paths_xml(parsed, include_containers=req.includeContainers)
    elif ptype == "csv":
        all_paths = extract_paths_csv(parsed, raw_csv, req.csvSendMode)
    else:
        raise HTTPException(status_code=400, detail=f"Unsupported payloadType={ptype}")

    protected = set(req.protectedPaths or [])
    targets = [p for p in all_paths if p not in protected]

    # Build auth headers ONCE per run (not per omitted field)
    try:
        auth_headers = build_auth_headers(req.auth.dict() if req.auth else None)
    except AuthError as e:
        raise HTTPException(status_code=400, detail=str(e))

    # Merge outbound headers: user headers + auth headers (auth wins)
    outbound_headers = dict(req.headers or {})
    outbound_headers.update(auth_headers)

    # Persist headers WITHOUT Authorization to avoid storing secrets
    persisted_headers = _strip_auth_from_headers(req.headers or {})

    # store run metadata (auth is not persisted)
    run_id = insert_run(
        conn,
        endpoint=req.endpointUrl.strip(),
        method=req.method.strip().upper(),
        payload_type=ptype,
        payload_hash=sha256_text(payload_text),
        headers=persisted_headers,
        protected_paths=sorted(list(protected)),
        tested_paths=targets,
        include_containers=req.includeContainers,
        missing_required_regex=req.missingRequiredRegex or DEFAULT_MISSING_REQUIRED_REGEX,
        force_content_type=req.contentTypeOverride,
        csv_send_mode=req.csvSendMode if ptype == "csv" else None,
        notes=req.notes or "",
    )

    # execute
    results: List[Dict[str, Any]] = []
    for path in targets:
        try:
            r = run_omit_one(
                endpoint=req.endpointUrl.strip(),
                method=req.method.strip().upper(),
                headers=outbound_headers,
                payload_type=ptype,
                base_obj=parsed,
                raw_csv=raw_csv,
                omit_path=path,
                timeout_s=int(req.timeoutSeconds),
                missing_required_regex=req.missingRequiredRegex
                or DEFAULT_MISSING_REQUIRED_REGEX,
                csv_send_mode=req.csvSendMode,
                force_content_type=req.contentTypeOverride,
            )
        except Exception as e:
            r = {
                "omitted_path": path,
                "removed": False,
                "status_code": 0,
                "classification": "CLIENT_ERROR",
                "why": f"Request exception: {e}",
                "response_snippet": "",
                "elapsed_ms": 0,
            }
        results.append(r)

    insert_results(conn, run_id, results)
    return RunCreateResponse(runId=run_id)


@app.get("/api/runs")
def runs():
    rows = list_runs(conn, limit=200)
    out = []
    for r in rows:
        # r might be dict already (your db.py returns dict rows)
        created = r.get("created_at_utc") or r.get("created_at") or r.get("createdAtUtc") or r.get("createdAt")
        out.append({
            "id": r.get("id"),
            "created_at_utc": created,
            "endpoint": r.get("endpoint"),
            "method": r.get("method"),
            "payload_type": r.get("payload_type") or r.get("payloadType"),
            "payload_hash": r.get("payload_hash") or r.get("payloadHash"),
            "notes": r.get("notes") or "",
        })
    return out


@app.get("/api/runs/{run_id}", response_model=RunDetail)
def run_detail(run_id: int):
    r = get_run(conn, run_id)
    if not r:
        raise HTTPException(status_code=404, detail="Run not found")
    res = get_results(conn, run_id)
    return {"run": r, "results": res}


@app.get("/api/runs/{run_id}/export.json")
def export_json(run_id: int):
    r = get_run(conn, run_id)
    if not r:
        raise HTTPException(status_code=404, detail="Run not found")
    res = get_results(conn, run_id)
    return {"run": r, "results": res}


@app.get("/api/runs/{run_id}/export.csv")
def export_csv(run_id: int):
    import csv
    from io import StringIO

    from fastapi.responses import Response

    r = get_run(conn, run_id)
    if not r:
        raise HTTPException(status_code=404, detail="Run not found")
    res = get_results(conn, run_id)

    buf = StringIO()
    w = csv.DictWriter(
        buf,
        fieldnames=[
            "omitted_path",
            "removed",
            "status_code",
            "classification",
            "why",
            "response_snippet",
            "elapsed_ms",
        ],
    )
    w.writeheader()
    for row in res:
        w.writerow(row)

    return Response(content=buf.getvalue(), media_type="text/csv")
