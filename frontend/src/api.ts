import type { ParseResponse, RunDetail, RunMeta } from "./types";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "";

async function jsonFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(opts?.headers || {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${text}`);
  }
  return (await res.json()) as T;
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
