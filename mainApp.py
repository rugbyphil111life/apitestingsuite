import json
import re
import time
import hashlib
import sqlite3
from copy import deepcopy
from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from io import StringIO
from typing import Any, Dict, List, Optional, Tuple, Union

import pandas as pd
import requests
import streamlit as st
import xml.etree.ElementTree as ET


# ============================
# Persistence (SQLite) - Minimal
# ============================

DB_PATH = "field_tester.db"


def db_connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


def db_init(conn: sqlite3.Connection) -> None:
    cur = conn.cursor()
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS runs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            created_at_utc TEXT NOT NULL,
            endpoint TEXT NOT NULL,
            method TEXT NOT NULL,
            payload_type TEXT NOT NULL,
            payload_hash TEXT NOT NULL,
            headers_json TEXT NOT NULL,
            protected_paths_json TEXT NOT NULL,
            tested_paths_json TEXT NOT NULL,
            missing_required_regex TEXT NOT NULL,
            force_content_type TEXT,
            csv_send_mode TEXT,
            notes TEXT
        );
        """
    )
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS results (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            run_id INTEGER NOT NULL,
            omitted_path TEXT NOT NULL,
            removed INTEGER NOT NULL,
            status_code INTEGER NOT NULL,
            classification TEXT NOT NULL,
            why TEXT NOT NULL,
            response_snippet TEXT NOT NULL,
            elapsed_ms INTEGER NOT NULL,
            FOREIGN KEY (run_id) REFERENCES runs(id)
        );
        """
    )
    cur.execute("CREATE INDEX IF NOT EXISTS idx_results_run_id ON results(run_id);")
    conn.commit()


def db_insert_run(
    conn: sqlite3.Connection,
    *,
    endpoint: str,
    method: str,
    payload_type: str,
    payload_hash: str,
    headers_json: str,
    protected_paths_json: str,
    tested_paths_json: str,
    missing_required_regex: str,
    force_content_type: Optional[str],
    csv_send_mode: Optional[str],
    notes: str,
) -> int:
    cur = conn.cursor()
    created_at_utc = datetime.now(timezone.utc).isoformat()
    cur.execute(
        """
        INSERT INTO runs (
            created_at_utc, endpoint, method, payload_type, payload_hash,
            headers_json, protected_paths_json, tested_paths_json,
            missing_required_regex, force_content_type, csv_send_mode, notes
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            created_at_utc,
            endpoint,
            method,
            payload_type,
            payload_hash,
            headers_json,
            protected_paths_json,
            tested_paths_json,
            missing_required_regex,
            force_content_type,
            csv_send_mode,
            notes or "",
        ),
    )
    conn.commit()
    return int(cur.lastrowid)


def db_insert_results(conn: sqlite3.Connection, run_id: int, rows: List[Dict[str, Any]]) -> None:
    cur = conn.cursor()
    cur.executemany(
        """
        INSERT INTO results (
            run_id, omitted_path, removed, status_code, classification, why,
            response_snippet, elapsed_ms
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        [
            (
                run_id,
                r["omitted_path"],
                1 if r["removed"] else 0,
                int(r["status_code"]),
                r["classification"],
                r["why"],
                r["response_snippet"],
                int(r["elapsed_ms"]),
            )
            for r in rows
        ],
    )
    conn.commit()


def db_list_runs(conn: sqlite3.Connection, limit: int = 50) -> List[sqlite3.Row]:
    cur = conn.cursor()
    cur.execute(
        """
        SELECT id, created_at_utc, endpoint, method, payload_type, payload_hash
        FROM runs
        ORDER BY id DESC
        LIMIT ?
        """,
        (limit,),
    )
    return list(cur.fetchall())


def db_get_run(conn: sqlite3.Connection, run_id: int) -> Optional[sqlite3.Row]:
    cur = conn.cursor()
    cur.execute("SELECT * FROM runs WHERE id = ?", (run_id,))
    row = cur.fetchone()
    return row


def db_get_results(conn: sqlite3.Connection, run_id: int) -> pd.DataFrame:
    cur = conn.cursor()
    cur.execute(
        """
        SELECT omitted_path, removed, status_code, classification, why, response_snippet, elapsed_ms
        FROM results
        WHERE run_id = ?
        ORDER BY omitted_path ASC
        """,
        (run_id,),
    )
    rows = [dict(r) for r in cur.fetchall()]
    # normalize removed to bool
    for r in rows:
        r["removed"] = bool(r["removed"])
    return pd.DataFrame(rows)


# ----------------------------
# Models / Results
# ----------------------------

@dataclass
class TestResult:
    omitted_path: str
    removed: bool
    status_code: int
    classification: str
    why: str
    response_snippet: str
    elapsed_ms: int


DEFAULT_MISSING_REQUIRED_REGEX = r"(required|missing|must not be null|cannot be null|is null)"


# ----------------------------
# Helpers: detection / parsing
# ----------------------------

def sha256_text(s: str) -> str:
    return hashlib.sha256((s or "").encode("utf-8")).hexdigest()


def detect_payload_type(text: str) -> str:
    s = (text or "").strip()
    if not s:
        return "unknown"

    try:
        obj = json.loads(s)
        if isinstance(obj, (dict, list)):
            return "json"
    except Exception:
        pass

    try:
        ET.fromstring(s)
        return "xml"
    except Exception:
        pass

    if "\n" in s and "," in s:
        return "csv"

    return "unknown"


def parse_json(text: str) -> Union[dict, list]:
    obj = json.loads(text)
    if not isinstance(obj, (dict, list)):
        raise ValueError("JSON payload must be an object or array at the top level")
    return obj


def parse_xml(text: str) -> ET.Element:
    return ET.fromstring(text)


def parse_csv_first_row(text: str) -> Dict[str, Any]:
    df = pd.read_csv(StringIO(text))
    if df.empty:
        raise ValueError("CSV had no rows")
    row = df.iloc[0].to_dict()
    out = {}
    for k, v in row.items():
        if pd.isna(v):
            out[str(k)] = None
        else:
            out[str(k)] = v
    return out


# ----------------------------
# Helpers: path handling (JSON)
# ----------------------------

def parse_path(path: str) -> List[Union[str, int]]:
    parts: List[Union[str, int]] = []
    if not path:
        return parts

    for seg in path.split("."):
        re_part = re.compile(r"([^\[\]]+)|\[(\d+)\]")
        for m in re_part.finditer(seg):
            if m.group(1) is not None:
                parts.append(m.group(1))
            elif m.group(2) is not None:
                parts.append(int(m.group(2)))
    return parts


def delete_by_path_json(obj: Any, path: str) -> bool:
    parts = parse_path(path)
    if not parts:
        return False

    cur = obj
    for i in range(len(parts) - 1):
        key = parts[i]
        if cur is None:
            return False
        try:
            cur = cur[key]
        except Exception:
            return False

    last = parts[-1]
    if isinstance(cur, dict) and isinstance(last, str) and last in cur:
        del cur[last]
        return True
    if isinstance(cur, list) and isinstance(last, int) and 0 <= last < len(cur):
        cur.pop(last)
        return True
    return False


def extract_paths_json(obj: Any, include_containers: bool = True) -> List[str]:
    paths: List[str] = []

    def rec(node: Any, prefix: str):
        if isinstance(node, dict):
            if include_containers and prefix:
                paths.append(prefix)
            for k, v in node.items():
                new_prefix = f"{prefix}.{k}" if prefix else str(k)
                rec(v, new_prefix)
        elif isinstance(node, list):
            if include_containers and prefix:
                paths.append(prefix)
            for i, v in enumerate(node):
                new_prefix = f"{prefix}[{i}]" if prefix else f"[{i}]"
                rec(v, new_prefix)
        else:
            if prefix:
                paths.append(prefix)

    rec(obj, "")
    seen = set()
    out = []
    for p in paths:
        if p not in seen:
            seen.add(p)
            out.append(p)
    return out


# ----------------------------
# Helpers: XML paths / deletion
# ----------------------------

def xml_path_for_element(elem: ET.Element, parent_map: Dict[ET.Element, ET.Element]) -> str:
    parts = []
    cur = elem
    while cur is not None:
        parent = parent_map.get(cur)
        if parent is None:
            parts.append(cur.tag)
            break
        siblings = [c for c in list(parent) if c.tag == cur.tag]
        idx = siblings.index(cur)
        parts.append(f"{cur.tag}[{idx}]")
        cur = parent
    return "/".join(reversed(parts))


def extract_paths_xml(root: ET.Element, include_containers: bool = True, include_attributes: bool = True) -> List[str]:
    parent_map = {c: p for p in root.iter() for c in list(p)}
    paths: List[str] = []

    for elem in root.iter():
        p = xml_path_for_element(elem, parent_map)
        if include_containers:
            paths.append(p)
        if include_attributes and elem.attrib:
            for a in elem.attrib.keys():
                paths.append(f"{p}@{a}")

    seen = set()
    out = []
    for p in paths:
        if p not in seen:
            seen.add(p)
            out.append(p)
    return out


def find_parent_xml(root: ET.Element, target: ET.Element) -> Optional[ET.Element]:
    for parent in root.iter():
        for child in list(parent):
            if child is target:
                return parent
    return None


def find_element_by_path_xml(root: ET.Element, path: str) -> Optional[ET.Element]:
    parts = path.split("/")
    if not parts:
        return None
    if parts[0] != root.tag:
        return None

    cur = root
    for seg in parts[1:]:
        m = re.match(r"^([^\[]+)(?:\[(\d+)\])?$", seg)
        if not m:
            return None
        tag = m.group(1)
        idx = int(m.group(2)) if m.group(2) is not None else 0
        matches = [c for c in list(cur) if c.tag == tag]
        if idx < 0 or idx >= len(matches):
            return None
        cur = matches[idx]
    return cur


def delete_by_path_xml(root: ET.Element, path: str) -> bool:
    if not path:
        return False

    if "@" in path:
        elem_path, attr = path.split("@", 1)
        target = find_element_by_path_xml(root, elem_path)
        if target is None:
            return False
        if attr in target.attrib:
            del target.attrib[attr]
            return True
        return False

    target = find_element_by_path_xml(root, path)
    if target is None or target is root:
        return False

    parent = find_parent_xml(root, target)
    if parent is None:
        return False
    try:
        parent.remove(target)
        return True
    except Exception:
        return False


# ----------------------------
# Request / classification
# ----------------------------

def classify(status: int, body_text: str, missing_required_regex: str) -> Tuple[str, str]:
    ok = 200 <= status < 300
    if ok:
        return "PASS_WITHOUT_FIELD", "2xx success"

    if status == 400 and re.search(missing_required_regex, body_text, re.IGNORECASE):
        return "FAIL_MISSING_REQUIRED", "Looks like missing required field (regex match)"

    return "OTHER_FAIL", "Non-2xx response (not clearly missing-required)"


def snippet(text: str, n: int = 600) -> str:
    text = text or ""
    text = text.replace("\n", " ").replace("\r", " ")
    return text[:n]


def best_effort_why(resp_text: str) -> str:
    s = resp_text or ""
    try:
        obj = json.loads(s)
        if isinstance(obj, dict):
            for k in ("message", "error", "detail", "errors", "title"):
                if k in obj and obj[k]:
                    return str(obj[k])
    except Exception:
        pass
    return snippet(s, 220)


def build_body_and_headers(
    payload_type: str,
    payload_obj: Any,
    headers: Dict[str, str],
    force_content_type: Optional[str],
    send_mode_for_csv: str,
) -> Tuple[Union[str, bytes], Dict[str, str]]:
    headers_out = dict(headers)

    if payload_type == "json":
        body = json.dumps(payload_obj, ensure_ascii=False)
        headers_out["Content-Type"] = force_content_type or headers_out.get("Content-Type", "application/json")
        return body, headers_out

    if payload_type == "xml":
        body = ET.tostring(payload_obj, encoding="utf-8", method="xml")
        headers_out["Content-Type"] = force_content_type or headers_out.get("Content-Type", "application/xml")
        return body, headers_out

    if payload_type == "csv":
        if send_mode_for_csv == "raw_csv":
            body = payload_obj if isinstance(payload_obj, str) else str(payload_obj)
            headers_out["Content-Type"] = force_content_type or headers_out.get("Content-Type", "text/csv")
            return body, headers_out
        body = json.dumps(payload_obj, ensure_ascii=False)
        headers_out["Content-Type"] = force_content_type or headers_out.get("Content-Type", "application/json")
        return body, headers_out

    body = str(payload_obj)
    if force_content_type:
        headers_out["Content-Type"] = force_content_type
    return body, headers_out


def run_one(
    url: str,
    method: str,
    headers: Dict[str, str],
    payload_type: str,
    base_payload_obj: Any,
    base_payload_raw_csv: Optional[str],
    omit_path: str,
    timeout_s: int,
    missing_required_regex: str,
    send_mode_for_csv: str,
    force_content_type: Optional[str],
) -> TestResult:
    removed = False

    if payload_type == "json":
        payload_obj = deepcopy(base_payload_obj)
        removed = delete_by_path_json(payload_obj, omit_path)

    elif payload_type == "xml":
        payload_obj = deepcopy(base_payload_obj)
        removed = delete_by_path_xml(payload_obj, omit_path)

    elif payload_type == "csv":
        if send_mode_for_csv == "raw_csv":
            if not base_payload_raw_csv:
                raise ValueError("No raw CSV text available")
            df = pd.read_csv(StringIO(base_payload_raw_csv))
            if omit_path in df.columns:
                df = df.drop(columns=[omit_path])
                removed = True
            buf = StringIO()
            df.to_csv(buf, index=False)
            payload_obj = buf.getvalue()
        else:
            payload_obj = deepcopy(base_payload_obj)
            if isinstance(payload_obj, dict) and omit_path in payload_obj:
                del payload_obj[omit_path]
                removed = True
    else:
        raise ValueError(f"Unsupported payload_type={payload_type}")

    body, headers_out = build_body_and_headers(
        payload_type=payload_type,
        payload_obj=payload_obj,
        headers=headers,
        force_content_type=force_content_type,
        send_mode_for_csv=send_mode_for_csv,
    )

    start = time.time()
    resp = requests.request(
        method=method,
        url=url,
        headers=headers_out,
        data=body,
        timeout=timeout_s,
    )
    elapsed_ms = int((time.time() - start) * 1000)

    body_text = resp.text or ""
    classification, class_why = classify(resp.status_code, body_text, missing_required_regex)
    why = f"{class_why}. {best_effort_why(body_text)}".strip()

    return TestResult(
        omitted_path=omit_path,
        removed=removed,
        status_code=resp.status_code,
        classification=classification,
        why=why,
        response_snippet=snippet(body_text, 600),
        elapsed_ms=elapsed_ms,
    )


# ============================
# Streamlit UI
# ============================

st.set_page_config(page_title="API Field Omission Tester", layout="wide")
st.title("API Field Omission Tester — Nested Field Omission Runner (Persistent Runs: Minimal)")

# Init DB once per session
conn = db_connect()
db_init(conn)

with st.sidebar:
    st.header("Run History (stored in SQLite)")
    runs = db_list_runs(conn, limit=50)
    run_options = {f'#{r["id"]} | {r["created_at_utc"]} | {r["method"]} {r["endpoint"]} | {r["payload_type"]} | {r["payload_hash"][:10]}…': r["id"] for r in runs}

    selected_run_label = st.selectbox(
        "View previous run",
        options=["(none)"] + list(run_options.keys()),
        index=0,
    )

    if selected_run_label != "(none)":
        run_id = run_options[selected_run_label]
        run_row = db_get_run(conn, run_id)
        if run_row:
            st.caption("Run metadata")
            st.code(
                json.dumps(
                    {
                        "id": run_row["id"],
                        "created_at_utc": run_row["created_at_utc"],
                        "endpoint": run_row["endpoint"],
                        "method": run_row["method"],
                        "payload_type": run_row["payload_type"],
                        "payload_hash": run_row["payload_hash"],
                        "notes": run_row["notes"],
                    },
                    indent=2,
                )
            )
            prev_df = db_get_results(conn, run_id)
            st.caption("Results")
            st.dataframe(prev_df, use_container_width=True, height=260)

            if not prev_df.empty:
                st.download_button(
                    "Download CSV (this run)",
                    prev_df.to_csv(index=False).encode("utf-8"),
                    f"field_test_results_run_{run_id}.csv",
                    "text/csv",
                )
                st.download_button(
                    "Download JSON (this run)",
                    prev_df.to_json(orient="records", indent=2).encode("utf-8"),
                    f"field_test_results_run_{run_id}.json",
                    "application/json",
                )

    st.divider()
    st.header("Request Config")
    url = st.text_input("Endpoint URL", value="https://example.com/api/vendors")
    method = st.selectbox("Method", ["POST", "PUT", "PATCH"], index=0)
    timeout_s = st.number_input("Timeout (seconds)", min_value=1, max_value=180, value=25)

    st.subheader("Headers")
    headers_text = st.text_area(
        "Headers (JSON object)",
        value=json.dumps({"Content-Type": "application/json"}, indent=2),
        height=130,
    )

    st.subheader("Content-Type override (optional)")
    force_content_type = st.text_input("Force Content-Type header", value="").strip() or None

    st.subheader("Missing-required detection")
    missing_required_regex = st.text_input(
        "Regex (case-insensitive)",
        value=DEFAULT_MISSING_REQUIRED_REGEX,
    )

    st.subheader("CSV send mode")
    send_mode_for_csv = st.selectbox(
        "If payload is CSV, send as:",
        ["csv_as_json", "raw_csv"],
        index=0,
        help="csv_as_json converts first data row to a JSON object; raw_csv sends CSV body directly.",
    )

st.write("## 1) Provide base payload (paste or upload)")
payload_input_mode = st.radio("Provide payload via:", ["Paste", "Upload file"], horizontal=True)

payload_text = ""
payload_filename = None

if payload_input_mode == "Paste":
    payload_text = st.text_area(
        "Paste JSON / XML / CSV here",
        height=260,
        value='{\n  "enrollmentID": 644,\n  "accessCode": "MOSSADAMSP",\n  "vnetClientID": "977929180",\n  "supplierName": "ExampleVendor",\n  "addresses": [{"type":"primary","city":"Fake City"}],\n  "contacts": [{"email":"test@example.com"}],\n  "createCaseMode": "ignore_duplicate"\n}',
    )
else:
    up = st.file_uploader("Upload a JSON / XML / CSV file", type=["json", "xml", "csv", "txt"])
    if up is not None:
        payload_filename = up.name
        payload_text = up.read().decode("utf-8", errors="replace")
        st.caption(f"Loaded: {payload_filename}")
        st.code(payload_text[:2000])

payload_type = detect_payload_type(payload_text)
if payload_type == "unknown" or not payload_text.strip():
    st.info("Paste or upload a valid JSON/XML/CSV payload to continue.")
    st.stop()

st.info(f"Detected payload type: **{payload_type.upper()}**")

# Parse headers
try:
    headers = json.loads(headers_text) if headers_text.strip() else {}
    if not isinstance(headers, dict):
        raise ValueError("Headers must be a JSON object")
except Exception as e:
    st.error(f"Invalid headers JSON: {e}")
    st.stop()

# Parse payload into an object and also keep raw for hashing
base_payload_obj: Any = None
base_payload_raw_csv: Optional[str] = None

try:
    if payload_type == "json":
        base_payload_obj = parse_json(payload_text)
    elif payload_type == "xml":
        base_payload_obj = parse_xml(payload_text)
    elif payload_type == "csv":
        base_payload_raw_csv = payload_text
        if send_mode_for_csv == "raw_csv":
            base_payload_obj = payload_text  # raw string
        else:
            base_payload_obj = parse_csv_first_row(payload_text)  # dict
    else:
        raise ValueError("Unsupported payload type")
except Exception as e:
    st.error(f"Failed to parse payload as {payload_type}: {e}")
    st.stop()

st.write("## 2) Discover fields and pick Protected fields")
cA, cB = st.columns([2, 1])

include_containers = cB.checkbox(
    "Include container nodes as omittable",
    value=True,
    help="If on, you can omit entire objects/arrays/elements, not just leaf fields.",
)

search = cB.text_input("Filter fields (contains)", value="").strip().lower()

# Extract paths based on payload type
if payload_type == "json":
    all_paths = extract_paths_json(base_payload_obj, include_containers=include_containers)
elif payload_type == "xml":
    all_paths = extract_paths_xml(base_payload_obj, include_containers=include_containers, include_attributes=True)
elif payload_type == "csv":
    if send_mode_for_csv == "raw_csv":
        df_cols = pd.read_csv(StringIO(base_payload_raw_csv or "")).columns
        all_paths = list(map(str, df_cols))
    else:
        all_paths = list(map(str, base_payload_obj.keys()))
else:
    all_paths = []

paths = [p for p in all_paths if (search in p.lower())] if search else all_paths
cA.write(f"Detected **{len(all_paths)}** field paths. Showing **{len(paths)}** with current filter.")

st.write("### Protected field picker (checked = never omitted)")
protected_from_multiselect = st.multiselect(
    "Quick-select protected fields (optional)",
    options=all_paths,
    default=[],
)

protected_set = set(protected_from_multiselect)

MAX_RENDER = 400
if len(paths) > MAX_RENDER:
    st.warning(f"Too many fields to render as checkboxes ({len(paths)}). Use filter to narrow below {MAX_RENDER}.")
    render_paths = paths[:MAX_RENDER]
else:
    render_paths = paths

with st.expander("Checkbox list", expanded=True):
    for p in render_paths:
        checked = p in protected_set
        new_checked = st.checkbox(p, value=checked, key=f"prot::{p}")
        if new_checked:
            protected_set.add(p)
        else:
            protected_set.discard(p)

protected_list = sorted(protected_set)
targets = [p for p in all_paths if p not in protected_set]

st.write("## 3) Run omit-one-field tests")
c1, c2, c3 = st.columns([1, 1, 1])
c1.metric("Total paths", len(all_paths))
c2.metric("Protected", len(protected_list))
c3.metric("To test (omit)", len(targets))

notes = st.text_input("Run notes (optional)", value="")

run = st.button(
    "Run Omit-One-Field Suite (and save to DB)",
    type="primary",
    disabled=(not targets or not url.strip()),
)

if run:
    results: List[TestResult] = []
    progress = st.progress(0)
    status_box = st.empty()

    for i, path in enumerate(targets, start=1):
        status_box.write(f"Omitting: `{path}` ({i}/{len(targets)})")
        try:
            r = run_one(
                url=url.strip(),
                method=method,
                headers=headers,
                payload_type=payload_type,
                base_payload_obj=base_payload_obj,
                base_payload_raw_csv=base_payload_raw_csv,
                omit_path=path,
                timeout_s=int(timeout_s),
                missing_required_regex=missing_required_regex,
                send_mode_for_csv=send_mode_for_csv,
                force_content_type=force_content_type,
            )
        except Exception as e:
            r = TestResult(
                omitted_path=path,
                removed=False,
                status_code=0,
                classification="CLIENT_ERROR",
                why=f"Request exception: {e}",
                response_snippet="",
                elapsed_ms=0,
            )
        results.append(r)
        progress.progress(i / len(targets))

    df = pd.DataFrame([asdict(r) for r in results])

    # Persist the run + results
    payload_hash = sha256_text(payload_text)
    run_id = db_insert_run(
        conn,
        endpoint=url.strip(),
        method=method,
        payload_type=payload_type,
        payload_hash=payload_hash,
        headers_json=json.dumps(headers, ensure_ascii=False),
        protected_paths_json=json.dumps(protected_list, ensure_ascii=False),
        tested_paths_json=json.dumps(targets, ensure_ascii=False),
        missing_required_regex=missing_required_regex,
        force_content_type=force_content_type,
        csv_send_mode=send_mode_for_csv if payload_type == "csv" else None,
        notes=notes,
    )
    db_insert_results(conn, run_id, df.to_dict(orient="records"))

    st.success(f"Saved run #{run_id} to {DB_PATH}")

    st.write("### Results (current run)")
    st.dataframe(df, use_container_width=True)

    st.write("### Summary")
    summary = df["classification"].value_counts().reset_index()
    summary.columns = ["classification", "count"]
    st.dataframe(summary, use_container_width=True)

    st.download_button(
        "Download CSV (current run)",
        df.to_csv(index=False).encode("utf-8"),
        f"field_test_results_run_{run_id}.csv",
        "text/csv",
    )
    st.download_button(
        "Download JSON (current run)",
        df.to_json(orient="records", indent=2).encode("utf-8"),
        f"field_test_results_run_{run_id}.json",
        "application/json",
    )
