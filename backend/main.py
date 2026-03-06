# app/main.py
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import time
import uuid
from typing import Dict, Any, List

import httpx

from backend.app.schemas.auth import AuthConfig
from backend.app.schemas.runs import RunExecuteRequest
from backend.app.services.http_utils import apply_auth

app = FastAPI()

# CORS - keep permissive for dev; tighten for prod
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory store (drop-in). Replace with your persistence if needed.
RUNS: Dict[str, dict] = {}


def discover_fields_from_json(obj: Any, prefix: str = "") -> List[str]:
    fields: List[str] = []
    if isinstance(obj, dict):
        for k, v in obj.items():
            p = f"{prefix}.{k}" if prefix else k
            fields.append(p)
            fields.extend(discover_fields_from_json(v, p))
    elif isinstance(obj, list):
        for i, item in enumerate(obj):
            p = f"{prefix}[{i}]"
            fields.extend(discover_fields_from_json(item, p))
    return fields


@app.post("/api/parse")
async def parse_endpoint(req: ParseRequest) -> ParseResponse:
    # NOTE: auth is accepted for forward-compat or if you later want parse to call target APIs.
    # This parse implementation only analyzes the payload text.

    pt = req.payloadType
    text = req.payloadText or ""

    if pt == "json":
        import json

        try:
            obj = json.loads(text) if text.strip() else {}
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Invalid JSON: {e}")

        fields = sorted(set(discover_fields_from_json(obj)))
        return ParseResponse(fields=fields)

    if pt == "xml":
        # Minimal XML field discovery: tag paths
        import xml.etree.ElementTree as ET

        try:
            root = ET.fromstring(text)
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Invalid XML: {e}")

        fields: List[str] = []

        def walk(node: ET.Element, prefix: str = ""):
            path = f"{prefix}/{node.tag}" if prefix else node.tag
            fields.append(path)
            for child in list(node):
                walk(child, path)

        walk(root)
        return ParseResponse(fields=sorted(set(fields)))

    if pt == "csv":
        # Minimal CSV field discovery: header row only
        lines = [ln for ln in text.splitlines() if ln.strip() != ""]
        if not lines:
            return ParseResponse(fields=[])

        header = lines[0]
        # very simple split - if you need robust CSV parsing, use csv module
        cols = [c.strip() for c in header.split(",")]
        return ParseResponse(fields=[c for c in cols if c])

    raise HTTPException(status_code=400, detail=f"Unsupported payloadType: {pt}")


@app.get("/api/runs", response_model=List[RunMeta])
async def list_runs():
    # newest first
    items = list(RUNS.values())
    items.sort(key=lambda r: r.createdAt, reverse=True)
    return [RunMeta(id=r.id, createdAt=r.createdAt, status=r.status) for r in items]


@app.get("/api/runs/{run_id}", response_model=RunDetail)
async def get_run(run_id: str):
    r = RUNS.get(run_id)
    if not r:
        raise HTTPException(status_code=404, detail="Run not found")
    return r


@app.post("/api/runs", response_model=CreateRunResponse)
async def create_run(req: CreateRunRequest):
    run_id = str(uuid.uuid4())
    created_at = time.strftime("%Y-%m-%dT%H:%M:%S%z")

    RUNS[run_id] = RunDetail(
        id=run_id,
        createdAt=created_at,
        status="running",
        results=None,
        error=None,
    )

    # Build outbound request
    headers: Dict[str, str] = {}
    headers = apply_auth(headers, req.auth)

    # Body handling
    json_body = None
    data_body = None

    if req.payloadText and req.payloadType == "json":
        import json

        try:
            json_body = json.loads(req.payloadText)
        except Exception as e:
            RUNS[run_id].status = "error"
            RUNS[run_id].error = {"message": f"Invalid JSON payload: {e}"}
            return CreateRunResponse(id=run_id)

    elif req.payloadText and req.payloadType in ("xml", "csv"):
        # send raw text
        data_body = req.payloadText.encode("utf-8")
        if req.payloadType == "xml":
          headers.setdefault("Content-Type", "application/xml")
        if req.payloadType == "csv":
          headers.setdefault("Content-Type", "text/csv")

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.request(
                req.method,
                req.targetUrl,
                headers=headers,
                json=json_body,
                content=data_body,
            )

        # Store minimal response info (expand as needed)
        RUNS[run_id].status = "done"
        RUNS[run_id].results = {
            "http": {
                "status": resp.status_code,
                "headers": dict(resp.headers),
                "bodyPreview": resp.text[:2000] if resp.text else "",
            },
            "protectedFields": req.protectedFields or [],
        }

    except Exception as e:
        RUNS[run_id].status = "error"
        RUNS[run_id].error = {"message": str(e)}

    return CreateRunResponse(id=run_id)
