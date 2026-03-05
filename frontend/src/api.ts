// src/api.ts
import type {
  CreateRunRequest,
  CreateRunResponse,
  ParseRequest,
  ParseResponse,
  RunDetail,
  RunMeta,
} from "./types";

const API_BASE =
  (import.meta as any).env?.VITE_API_BASE_URL?.replace(/\/+$/, "") || "";

type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

async function readResponse<T>(res: Response): Promise<T> {
  const ct = res.headers.get("content-type") || "";
  const text = await res.text(); // read once

  if (!res.ok) {
    // Try JSON error first, else text
    if (ct.includes("application/json") && text) {
      try {
        const j = JSON.parse(text);
        throw new Error(j?.error?.message || j?.detail || j?.message || "Request failed");
      } catch {
        throw new Error(text || `Request failed (${res.status})`);
      }
    }
    throw new Error(text || `Request failed (${res.status})`);
  }

  // success
  if (ct.includes("application/json")) {
    if (!text) return {} as T;
    return JSON.parse(text) as T;
  }

  // allow empty success responses
  if (!text) return {} as T;

  // unexpected content-type on success
  throw new Error(`Expected JSON but got '${ct || "unknown content-type"}': ${text.slice(0, 200)}`);
}

async function requestJSON<T>(
  path: string,
  method: HttpMethod,
  body?: unknown
): Promise<T> {
  const url = `${API_BASE}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  return readResponse<T>(res);
}

// API functions
export function parsePayload(req: ParseRequest): Promise<ParseResponse> {
  return requestJSON<ParseResponse>("/api/parse", "POST", req);
}

export function createRun(req: CreateRunRequest): Promise<CreateRunResponse> {
  return requestJSON<CreateRunResponse>("/api/runs", "POST", req);
}

export function getRun(id: string): Promise<RunDetail> {
  return requestJSON<RunDetail>(`/api/runs/${encodeURIComponent(id)}`, "GET");
}

export function listRuns(): Promise<RunMeta[]> {
  return requestJSON<RunMeta[]>("/api/runs", "GET");
}
