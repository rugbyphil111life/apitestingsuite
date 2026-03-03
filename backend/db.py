import json
import os
import sqlite3
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

DB_PATH = os.getenv("DATABASE_PATH", "field_tester.db")


def connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


def init_db(conn: sqlite3.Connection) -> None:
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
            include_containers INTEGER NOT NULL,
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


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def insert_run(
    conn: sqlite3.Connection,
    *,
    endpoint: str,
    method: str,
    payload_type: str,
    payload_hash: str,
    headers: Dict[str, str],
    protected_paths: List[str],
    tested_paths: List[str],
    include_containers: bool,
    missing_required_regex: str,
    force_content_type: Optional[str],
    csv_send_mode: Optional[str],
    notes: str,
) -> int:
    cur = conn.cursor()
    cur.execute(
        """
        INSERT INTO runs (
            created_at_utc, endpoint, method, payload_type, payload_hash,
            headers_json, protected_paths_json, tested_paths_json,
            include_containers, missing_required_regex, force_content_type, csv_send_mode, notes
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            utc_now_iso(),
            endpoint,
            method,
            payload_type,
            payload_hash,
            json.dumps(headers, ensure_ascii=False),
            json.dumps(protected_paths, ensure_ascii=False),
            json.dumps(tested_paths, ensure_ascii=False),
            1 if include_containers else 0,
            missing_required_regex,
            force_content_type,
            csv_send_mode,
            notes or "",
        ),
    )
    conn.commit()
    return int(cur.lastrowid)


def insert_results(conn: sqlite3.Connection, run_id: int, rows: List[Dict[str, Any]]) -> None:
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


def list_runs(conn: sqlite3.Connection, limit: int = 100) -> List[Dict[str, Any]]:
    cur = conn.cursor()
    cur.execute(
        """
        SELECT id, created_at_utc, endpoint, method, payload_type, payload_hash, notes
        FROM runs
        ORDER BY id DESC
        LIMIT ?
        """,
        (limit,),
    )
    return [dict(r) for r in cur.fetchall()]


def get_run(conn: sqlite3.Connection, run_id: int) -> Optional[Dict[str, Any]]:
    cur = conn.cursor()
    cur.execute("SELECT * FROM runs WHERE id = ?", (run_id,))
    r = cur.fetchone()
    return dict(r) if r else None


def get_results(conn: sqlite3.Connection, run_id: int) -> List[Dict[str, Any]]:
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
    for r in rows:
        r["removed"] = bool(r["removed"])
    return rows
