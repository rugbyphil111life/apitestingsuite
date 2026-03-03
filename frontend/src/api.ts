import type { ParseResponse, RunDetail, RunMeta } from "./types";

const API_BASE = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/+$/, "");

async function readErrorBody(res: Response): Promise<string> {
  const ct = res.headers.get("content-type") || "";
  try {
    if (ct.includes("application/json")) {
      const j = await res.json();
      return JSON.stringify(j);
    }
    const t = await res.text();
    return t || "(empty response body)";
  } catch {
    return "(unable to read response body)";
  }
}

async function jsonFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers: {
      ...(opts?.headers || {}),
      // Only set JSON content-type when we actually send JSON
      ...(opts?.body ? { "Content-Type": "application/json" } : {}),
    },
  });

  if (!res.ok) {
    const body = await readErrorBody(res);
    throw new Error(`${res.status} ${res.statusText}: ${body}`);
  }

  // Handle empty bodies (204) safely
  if (res.status === 204) {
    // @ts-expect-error - allow void response
    return undefined as T;
  }

  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("application/json")) {
    const t = await res.text();
    throw new Error(`Expected JSON but got '${ct || "unknown content-type"}': ${t?.slice(0, 300) || "(empty)"}`);
  }

  // If JSON but empty, avoid "Unexpected end of JSON input"
  const text = await res.text();
  if (!text.trim()) {
    throw new Error("Expected JSON but response body was empty.");
  }

  return JSON.parse(text) as T;
}

export async function parsePayload(req: {
  payloadText: string;
  payloadType?: string;
  csvSendMode: string;
  includeContainers: boolean;
}): Promise<ParseResponse> {
  return jsonFetch<ParseResponse>("/api/parse", {
    method: "POST",
    body: JSON.stringify(req),
  });
}

export async function createRun(req: any): Promise<{ runId: number }> {
  return jsonFetch<{ runId: number }>("/api/runs", {
    method: "POST",
    body: JSON.stringify(req),
  });
}

export async function listRuns(): Promise<RunMeta[]> {
  return jsonFetch<RunMeta[]>("/api/runs");
}

export async function getRun(runId: number): Promise<RunDetail> {
  return jsonFetch<RunDetail>(`/api/runs/${runId}`);
}
