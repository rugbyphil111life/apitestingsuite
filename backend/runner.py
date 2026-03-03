import hashlib
import json
import re
import time
from copy import deepcopy
from io import StringIO
from typing import Any, Dict, List, Optional, Tuple, Union

import pandas as pd
import requests
import xml.etree.ElementTree as ET


DEFAULT_MISSING_REQUIRED_REGEX = r"(required|missing|must not be null|cannot be null|is null)"


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


def parse_payload(payload_text: str, payload_type: str, csv_send_mode: str) -> Tuple[Any, Optional[str]]:
    """
    Returns (parsed_obj, raw_csv_text_if_any)
    """
    if payload_type == "json":
        obj = json.loads(payload_text)
        if not isinstance(obj, (dict, list)):
            raise ValueError("JSON payload must be an object or array at the top level")
        return obj, None

    if payload_type == "xml":
        return ET.fromstring(payload_text), None

    if payload_type == "csv":
        raw = payload_text
        if csv_send_mode == "raw_csv":
            return raw, raw
        # csv_as_json: first data row -> dict
        df = pd.read_csv(StringIO(raw))
        if df.empty:
            raise ValueError("CSV had no rows")
        row = df.iloc[0].to_dict()
        out = {}
        for k, v in row.items():
            out[str(k)] = None if pd.isna(v) else v
        return out, raw

    raise ValueError(f"Unsupported payload_type={payload_type}")


# ----------------------------
# JSON path ops
# ----------------------------

def _parse_path(path: str) -> List[Union[str, int]]:
    parts: List[Union[str, int]] = []
    if not path:
        return parts
    for seg in path.split("."):
        for m in re.finditer(r"([^\[\]]+)|\[(\d+)\]", seg):
            if m.group(1) is not None:
                parts.append(m.group(1))
            elif m.group(2) is not None:
                parts.append(int(m.group(2)))
    return parts


def delete_by_path_json(obj: Any, path: str) -> bool:
    parts = _parse_path(path)
    if not parts:
        return False
    cur = obj
    for i in range(len(parts) - 1):
        key = parts[i]
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


def extract_paths_json(obj: Any, include_containers: bool) -> List[str]:
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
# XML path ops
# ----------------------------

def _xml_parent_map(root: ET.Element) -> Dict[ET.Element, ET.Element]:
    return {c: p for p in root.iter() for c in list(p)}


def _xml_path(elem: ET.Element, parent_map: Dict[ET.Element, ET.Element]) -> str:
    parts = []
    cur = elem
    while True:
        parent = parent_map.get(cur)
        if parent is None:
            parts.append(cur.tag)
            break
        siblings = [c for c in list(parent) if c.tag == cur.tag]
        idx = siblings.index(cur)
        parts.append(f"{cur.tag}[{idx}]")
        cur = parent
    return "/".join(reversed(parts))


def extract_paths_xml(root: ET.Element, include_containers: bool, include_attributes: bool = True) -> List[str]:
    parent_map = _xml_parent_map(root)
    paths: List[str] = []
    for elem in root.iter():
        p = _xml_path(elem, parent_map)
        if include_containers:
            paths.append(p)
        if include_attributes and elem.attrib:
            for a in elem.attrib.keys():
                paths.append(f"{p}@{a}")
    # de-dupe
    seen = set()
    out = []
    for p in paths:
        if p not in seen:
            seen.add(p)
            out.append(p)
    return out


def _find_element_by_path_xml(root: ET.Element, path: str) -> Optional[ET.Element]:
    parts = path.split("/")
    if not parts or parts[0] != root.tag:
        return None
    cur = root
    for seg in parts[1:]:
        m = re.match(r"^([^\[]+)(?:\[(\d+)\])?$", seg)
        if not m:
            return None
        tag = m.group(1)
        idx = int(m.group(2) or 0)
        matches = [c for c in list(cur) if c.tag == tag]
        if idx < 0 or idx >= len(matches):
            return None
        cur = matches[idx]
    return cur


def _find_parent_xml(root: ET.Element, target: ET.Element) -> Optional[ET.Element]:
    for parent in root.iter():
        for child in list(parent):
            if child is target:
                return parent
    return None


def delete_by_path_xml(root: ET.Element, path: str) -> bool:
    if not path:
        return False

    if "@" in path:
        elem_path, attr = path.split("@", 1)
        target = _find_element_by_path_xml(root, elem_path)
        if target is None:
            return False
        if attr in target.attrib:
            del target.attrib[attr]
            return True
        return False

    target = _find_element_by_path_xml(root, path)
    if target is None or target is root:
        return False
    parent = _find_parent_xml(root, target)
    if parent is None:
        return False
    parent.remove(target)
    return True


# ----------------------------
# CSV paths
# ----------------------------

def extract_paths_csv(parsed_obj: Any, raw_csv: Optional[str], csv_send_mode: str) -> List[str]:
    if csv_send_mode == "raw_csv":
        if not raw_csv:
            return []
        df = pd.read_csv(StringIO(raw_csv))
        return list(map(str, df.columns))
    if isinstance(parsed_obj, dict):
        return list(map(str, parsed_obj.keys()))
    return []


def omit_csv(raw_csv: str, column: str) -> Tuple[str, bool]:
    df = pd.read_csv(StringIO(raw_csv))
    if column not in df.columns:
        return raw_csv, False
    df = df.drop(columns=[column])
    buf = StringIO()
    df.to_csv(buf, index=False)
    return buf.getvalue(), True


# ----------------------------
# HTTP run + classify
# ----------------------------

def classify(status: int, body_text: str, missing_required_regex: str) -> Tuple[str, str]:
    if 200 <= status < 300:
        return "PASS_WITHOUT_FIELD", "2xx success"
    if status == 400 and re.search(missing_required_regex, body_text, re.IGNORECASE):
        return "FAIL_MISSING_REQUIRED", "Looks like missing required field (regex match)"
    return "OTHER_FAIL", "Non-2xx response (not clearly missing-required)"


def response_snippet(text: str, n: int = 800) -> str:
    t = (text or "").replace("\n", " ").replace("\r", " ")
    return t[:n]


def best_effort_why(text: str) -> str:
    s = text or ""
    try:
        obj = json.loads(s)
        if isinstance(obj, dict):
            for k in ("message", "error", "detail", "errors", "title"):
                if k in obj and obj[k]:
                    return str(obj[k])
    except Exception:
        pass
    return response_snippet(s, 220)


def build_body_and_headers(
    payload_type: str,
    payload_obj: Any,
    raw_csv: Optional[str],
    headers: Dict[str, str],
    force_content_type: Optional[str],
    csv_send_mode: str,
) -> Tuple[Union[str, bytes], Dict[str, str]]:
    h = dict(headers)

    if payload_type == "json":
        h["Content-Type"] = force_content_type or h.get("Content-Type", "application/json")
        return json.dumps(payload_obj, ensure_ascii=False), h

    if payload_type == "xml":
        h["Content-Type"] = force_content_type or h.get("Content-Type", "application/xml")
        return ET.tostring(payload_obj, encoding="utf-8", method="xml"), h

    if payload_type == "csv":
        if csv_send_mode == "raw_csv":
            h["Content-Type"] = force_content_type or h.get("Content-Type", "text/csv")
            return (payload_obj if isinstance(payload_obj, str) else (raw_csv or "")), h
        h["Content-Type"] = force_content_type or h.get("Content-Type", "application/json")
        return json.dumps(payload_obj, ensure_ascii=False), h

    return str(payload_obj), h


def run_omit_one(
    *,
    endpoint: str,
    method: str,
    headers: Dict[str, str],
    payload_type: str,
    base_obj: Any,
    raw_csv: Optional[str],
    omit_path: str,
    timeout_s: int,
    missing_required_regex: str,
    csv_send_mode: str,
    force_content_type: Optional[str],
) -> Dict[str, Any]:
    removed = False

    if payload_type == "json":
        obj = deepcopy(base_obj)
        removed = delete_by_path_json(obj, omit_path)
        body, h = build_body_and_headers(payload_type, obj, raw_csv, headers, force_content_type, csv_send_mode)

    elif payload_type == "xml":
        obj = deepcopy(base_obj)
        removed = delete_by_path_xml(obj, omit_path)
        body, h = build_body_and_headers(payload_type, obj, raw_csv, headers, force_content_type, csv_send_mode)

    elif payload_type == "csv":
        if csv_send_mode == "raw_csv":
            if not raw_csv:
                raise ValueError("raw_csv mode requires raw_csv text")
            new_csv, removed = omit_csv(raw_csv, omit_path)
            body, h = build_body_and_headers(payload_type, new_csv, new_csv, headers, force_content_type, csv_send_mode)
        else:
            obj = deepcopy(base_obj)
            if isinstance(obj, dict) and omit_path in obj:
                del obj[omit_path]
                removed = True
            body, h = build_body_and_headers(payload_type, obj, raw_csv, headers, force_content_type, csv_send_mode)

    else:
        raise ValueError(f"Unsupported payload_type={payload_type}")

    start = time.time()
    resp = requests.request(method=method, url=endpoint, headers=h, data=body, timeout=timeout_s)
    elapsed_ms = int((time.time() - start) * 1000)

    text = resp.text or ""
    classification, class_why = classify(resp.status_code, text, missing_required_regex)
    why = f"{class_why}. {best_effort_why(text)}".strip()

    return {
        "omitted_path": omit_path,
        "removed": removed,
        "status_code": resp.status_code,
        "classification": classification,
        "why": why,
        "response_snippet": response_snippet(text),
        "elapsed_ms": elapsed_ms,
    }
