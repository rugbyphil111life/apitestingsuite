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

function hasHeader(headers: HeadersInit | undefined, name: string): boolean {
  if (!headers) return false;
  const n = name.toLowerCase();

  if (headers instanceof Headers) {
    return headers.has(name);
  }
  if (Array.isArray(headers)) {
    return headers.some(([k]) => k.toLowerCase() === n);
  }
  return Object.keys(headers).some((k) => k.toLowerCase() === n);
}

async function jsonFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const shouldSetJsonContentType =
    !!opts?.body && !hasHeader(opts?.headers, "Content-Type");

  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers: {
      ...(opts?.headers || {}),
      ...(shouldSetJsonContentType ? { "Content-Type": "application/json" } : {}),
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
    throw new Error(
      `Expected JSON but got '${ct || "unknown content-type"}': ${
        t?.slice(0, 300) || "(empty)"
      }`
    );
  }

  // If JSON but empty, avoid "Unexpected end of JSON input"
  const text = await res.text();
  if (!text.trim()) {
    throw new Error("Expected JSON but response body was empty.");
  }

  return JSON.parse(text) as T;
}

// ---- Types for auth (aligns to backend/main.py) ----
export type AuthType = "none" | "bearer" | "oauth2_client_credentials";

export type OAuth2ClientCredentials = {
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  scope?: string;
  audience?: string;
};

export type AuthConfig =
  | { type: "none" }
  | { type: "bearer"; bearerToken: string }
  | { type: "oauth2_client_credentials"; oauth2: OAuth2ClientCredentials };

export type RunCreateRequest = {
  endpointUrl: string;
  method: string;
  headers: Record<string, string>;

  payloadText: string;
  payloadType?: string;
  csvSendMode: string;
  includeContainers: boolean;

  protectedPaths: string[];
  timeoutSeconds: number;
  missingRequiredRegex: string;
  contentTypeOverride?: string;
  notes: string;

  auth?: AuthConfig;
};

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

export async function createRun(req: RunCreateRequest): Promise<{ runId: number }> {
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
