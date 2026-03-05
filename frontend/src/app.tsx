import React, { useEffect, useMemo, useState } from "react";
import { Card } from "./components/Card";
import { Button } from "./components/Button";
import { CodeEditor } from "./components/CodeEditor";
import { FieldPicker } from "./components/FieldPicker";
import { RunResultsTable } from "./components/RunResultsTable";
import { createRun, getRun, listRuns, parsePayload } from "./api";
import type { RunDetail, RunMeta } from "./types";

type AuthType = "none" | "bearer" | "oauth2_client_credentials";

type OAuth2ClientCredentials = {
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  scope?: string;
  audience?: string;
};

type AuthConfig =
  | { type: "none" }
  | { type: "bearer"; bearerToken: string }
  | { type: "oauth2_client_credentials"; oauth2: OAuth2ClientCredentials };

const samplePayload = `{ }`;

const inputClass =
  "w-full rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:ring-2 focus:ring-slate-500";
const selectClass =
  "w-full rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2 text-sm text-slate-100 outline-none focus:ring-2 focus:ring-slate-500";
const labelClass = "text-xs font-semibold text-slate-300";
const helpClass = "text-xs text-slate-400";

export default function App() {
  const [tab, setTab] = useState<"new" | "history">("new");

  // Request config
  const [endpointUrl, setEndpointUrl] = useState("");
  const [method, setMethod] = useState("POST");
  const [timeoutSeconds, setTimeoutSeconds] = useState(25);
  const [headersText, setHeadersText] = useState(`{ "Content-Type": "application/json" }`);
  const [contentTypeOverride, setContentTypeOverride] = useState("");
  const [missingRegex, setMissingRegex] = useState("(required|missing|must not be null|cannot be null|is null)");
  const [includeContainers, setIncludeContainers] = useState(true);
  const [csvSendMode, setCsvSendMode] = useState<"csv_as_json" | "raw_csv">("csv_as_json");
  const [notes, setNotes] = useState("");

  // Auth config
  const [authType, setAuthType] = useState<AuthType>("none");
  const [bearerToken, setBearerToken] = useState("");
  const [oauthTokenUrl, setOauthTokenUrl] = useState("");
  const [oauthClientId, setOauthClientId] = useState("");
  const [oauthClientSecret, setOauthClientSecret] = useState("");
  const [oauthScope, setOauthScope] = useState("");
  const [oauthAudience, setOauthAudience] = useState("");

  function buildAuth(): AuthConfig {
    if (authType === "none") return { type: "none" };
    if (authType === "bearer") return { type: "bearer", bearerToken };
    return {
      type: "oauth2_client_credentials",
      oauth2: {
        tokenUrl: oauthTokenUrl,
        clientId: oauthClientId,
        clientSecret: oauthClientSecret,
        scope: oauthScope.trim() || undefined,
        audience: oauthAudience.trim() || undefined,
      },
    };
  }

  // Payload input
  const [payloadText, setPayloadText] = useState(samplePayload);
  const [payloadType, setPayloadType] = useState("");

  // Fields
  const [allPaths, setAllPaths] = useState<string[]>([]);
  const [protectedPaths, setProtectedPaths] = useState<Set<string>>(new Set());

  // Runs / results
  const [runs, setRuns] = useState<RunMeta[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<number | null>(null);
  const [runDetail, setRunDetail] = useState<RunDetail | null>(null);
  const [busy, setBusy] = useState("");

  const testedCount = useMemo(
    () => Math.max(0, allPaths.length - protectedPaths.size),
    [allPaths, protectedPaths]
  );

  async function refreshRuns() {
    const r = await listRuns();
    setRuns(r);
  }

  useEffect(() => {
    refreshRuns().catch(() => {});
  }, []);

  async function onUpload(file: File) {
    const text = await file.text();
    setPayloadText(text);
  }

  async function discoverFields() {
    setBusy("Discovering fields…");
    try {
      const parsed = await parsePayload({
        payloadText,
        payloadType: payloadType || undefined,
        csvSendMode,
        includeContainers,
      });
      setAllPaths(parsed.paths);
      setProtectedPaths(new Set());
    } finally {
      setBusy("");
    }
  }

  function parseHeaders(): Record<string, string> {
    const obj = JSON.parse(headersText || "{}");
    if (obj && typeof obj === "object" && !Array.isArray(obj)) return obj;
    throw new Error("Headers must be a JSON object");
  }

  async function runSuite() {
    if (!endpointUrl.trim()) throw new Error("Endpoint URL required");

    if (authType === "bearer" && !bearerToken.trim()) {
      throw new Error("Bearer token is empty");
    }
    if (authType === "oauth2_client_credentials") {
      if (!oauthTokenUrl.trim()) throw new Error("OAuth tokenUrl is required");
      if (!oauthClientId.trim()) throw new Error("OAuth clientId is required");
      if (!oauthClientSecret.trim()) throw new Error("OAuth clientSecret is required");
    }

    setBusy("Running omit-one-field suite…");
    try {
      const req = {
        endpointUrl,
        method,
        headers: parseHeaders(),
        payloadText,
        payloadType: payloadType || undefined,
        csvSendMode,
        includeContainers,
        protectedPaths: Array.from(protectedPaths),
        timeoutSeconds,
        missingRequiredRegex: missingRegex,
        contentTypeOverride: contentTypeOverride.trim() || undefined,
        notes,
        auth: buildAuth(),
      };

      const { runId } = await createRun(req);
      await refreshRuns();
      setSelectedRunId(runId);

      const detail = await getRun(runId);
      setRunDetail(detail);
      setTab("history");
    } finally {
      setBusy("");
    }
  }

  async function loadRun(runId: number) {
    setBusy("Loading run…");
    try {
      setSelectedRunId(runId);
      const detail = await getRun(runId);
      setRunDetail(detail);
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-7xl px-4 py-6 md:px-6 lg:px-8">
        {/* Header */}
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Field Tester</h1>
          <p className="text-sm text-slate-400">Omit-one-field runner + persistent results</p>
        </div>

        {/* Tabs */}
        <div className="mt-4 flex gap-2">
          <Button onClick={() => setTab("new")} variant={tab === "new" ? "default" : "ghost"}>
            New Run
          </Button>
          <Button onClick={() => setTab("history")} variant={tab === "history" ? "default" : "ghost"}>
            History
          </Button>
        </div>

        {/* Busy */}
        {busy && (
          <div className="mt-4">
            <Card>
              <div className="text-sm text-slate-200">{busy}</div>
            </Card>
          </div>
        )}

        {/* NEW RUN */}
        {tab === "new" && (
          <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
            {/* Left column */}
            <Card>
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm">
                  <span className="font-semibold">To test:</span>{" "}
                  <span className="text-slate-200">{testedCount}</span>
                </div>
              </div>

              <div className="mt-4 space-y-4">
                {/* Endpoint */}
                <div className="space-y-2">
                  <div className={labelClass}>Endpoint URL</div>
                  <input
                    className={inputClass}
                    value={endpointUrl}
                    onChange={(e) => setEndpointUrl(e.target.value)}
                    placeholder="https://api.example.com/vendors"
                  />
                </div>

                {/* Method + Timeout */}
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <div className={labelClass}>Method</div>
                    <select className={selectClass} value={method} onChange={(e) => setMethod(e.target.value)}>
                      <option>POST</option>
                      <option>PUT</option>
                      <option>PATCH</option>
                    </select>
                  </div>

                  <div className="space-y-2">
                    <div className={labelClass}>Timeout (s)</div>
                    <input
                      className={inputClass}
                      value={timeoutSeconds}
                      onChange={(e) => setTimeoutSeconds(parseInt(e.target.value || "25", 10))}
                      min={1}
                      max={300}
                      type="number"
                    />
                  </div>
                </div>

                {/* Include containers */}
                <label className="flex items-center gap-2 text-sm text-slate-200">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-slate-700 bg-slate-950"
                    checked={includeContainers}
                    onChange={(e) => setIncludeContainers(e.target.checked)}
                  />
                  Include container nodes
                </label>

                {/* CSV mode + payload type */}
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <div className={labelClass}>CSV mode</div>
                    <select
                      className={selectClass}
                      value={csvSendMode}
                      onChange={(e) => setCsvSendMode(e.target.value as any)}
                    >
                      <option value="csv_as_json">csv_as_json</option>
                      <option value="raw_csv">raw_csv</option>
                    </select>
                  </div>

                  <div className="space-y-2">
                    <div className={labelClass}>Payload type (optional)</div>
                    <input
                      className={inputClass}
                      value={payloadType}
                      onChange={(e) => setPayloadType(e.target.value)}
                      placeholder="json | xml | csv"
                    />
                    <div className={helpClass}>Leave blank to auto-detect.</div>
                  </div>
                </div>

                {/* Content-Type override */}
                <div className="space-y-2">
                  <div className={labelClass}>Content-Type override</div>
                  <input
                    className={inputClass}
                    value={contentTypeOverride}
                    onChange={(e) => setContentTypeOverride(e.target.value)}
                    placeholder="application/json"
                  />
                </div>

                {/* Missing regex */}
                <div className="space-y-2">
                  <div className={labelClass}>Missing/required regex</div>
                  <input
                    className={inputClass}
                    value={missingRegex}
                    onChange={(e) => setMissingRegex(e.target.value)}
                    placeholder="(required|missing|...)"
                  />
                </div>

                {/* Notes */}
                <div className="space-y-2">
                  <div className={labelClass}>Notes</div>
                  <input
                    className={inputClass}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Optional"
                  />
                </div>

                {/* Headers */}
                <div className="space-y-2">
                  <div className={labelClass}>Headers (JSON)</div>
                  <CodeEditor value={headersText} onChange={setHeadersText} heightClass="h-32" />
                </div>

                {/* Auth */}
                <div className="space-y-3 rounded-2xl border border-slate-800 bg-slate-950/30 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-semibold text-slate-200">Authentication</div>
                  </div>

                  <div className="space-y-2">
                    <div className={labelClass}>Auth Type</div>
                    <select
                      className={selectClass}
                      value={authType}
                      onChange={(e) => setAuthType(e.target.value as AuthType)}
                    >
                      <option value="none">None</option>
                      <option value="bearer">Bearer Token</option>
                      <option value="oauth2_client_credentials">OAuth2 Client Credentials</option>
                    </select>
                  </div>

                  {authType === "bearer" && (
                    <div className="space-y-2">
                      <div className={labelClass}>Bearer Token</div>
                      <input
                        className={inputClass}
                        value={bearerToken}
                        onChange={(e) => setBearerToken(e.target.value)}
                        placeholder="eyJhbGciOi..."
                      />
                    </div>
                  )}

                  {authType === "oauth2_client_credentials" && (
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                      <div className="space-y-2 md:col-span-2">
                        <div className={labelClass}>Token URL</div>
                        <input
                          className={inputClass}
                          value={oauthTokenUrl}
                          onChange={(e) => setOauthTokenUrl(e.target.value)}
                          placeholder="https://auth.example.com/oauth/token"
                        />
                      </div>

                      <div className="space-y-2">
                        <div className={labelClass}>Client ID</div>
                        <input
                          className={inputClass}
                          value={oauthClientId}
                          onChange={(e) => setOauthClientId(e.target.value)}
                          placeholder="client_id"
                        />
                      </div>

                      <div className="space-y-2">
                        <div className={labelClass}>Client Secret</div>
                        <input
                          className={inputClass}
                          type="password"
                          value={oauthClientSecret}
                          onChange={(e) => setOauthClientSecret(e.target.value)}
                          placeholder="client_secret"
                        />
                      </div>

                      <div className="space-y-2">
                        <div className={labelClass}>Scope (optional)</div>
                        <input
                          className={inputClass}
                          value={oauthScope}
                          onChange={(e) => setOauthScope(e.target.value)}
                          placeholder="read write"
                        />
                      </div>

                      <div className="space-y-2">
                        <div className={labelClass}>Audience (optional)</div>
                        <input
                          className={inputClass}
                          value={oauthAudience}
                          onChange={(e) => setOauthAudience(e.target.value)}
                          placeholder="https://api.example.com/"
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div className="flex flex-wrap gap-2 pt-2">
                  <Button onClick={discoverFields}>Discover fields</Button>
                  <Button onClick={runSuite}>Run suite</Button>
                </div>
              </div>
            </Card>

            {/* Right column */}
            <Card>
              <div className="space-y-4">
                <div className="space-y-2">
                  <div className={labelClass}>Upload payload file</div>
                  <div className={helpClass}>JSON / XML / CSV / TXT</div>
                  <input
                    className="block w-full text-sm text-slate-300 file:mr-4 file:rounded-xl file:border-0 file:bg-slate-900 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-slate-100 hover:file:bg-slate-800"
                    type="file"
                    onChange={(e) => e.target.files?.[0] && onUpload(e.target.files[0])}
                  />
                </div>

                <div className="space-y-2">
                  <div className={labelClass}>Payload</div>
                  <CodeEditor value={payloadText} onChange={setPayloadText} heightClass="h-64" />
                </div>

                <div className="space-y-2">
                  <div className={labelClass}>Protected fields</div>
                  <FieldPicker paths={allPaths} protectedPaths={protectedPaths} onChange={setProtectedPaths} />
                </div>
              </div>
            </Card>
          </div>
        )}

        {/* HISTORY */}
        {tab === "history" && (
          <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card>
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-semibold text-slate-200">Runs</div>
                <Button onClick={() => refreshRuns()} variant="ghost">
                  Refresh
                </Button>
              </div>

              <div className="mt-4 space-y-3">
                {runs.length === 0 && <div className="text-sm text-slate-400">No runs yet.</div>}

                {runs.map((r) => {
                  const created = (r as any).created_at_utc ?? (r as any).created_at ?? null;
                  const payloadHash = (r as any).payload_hash ?? (r as any).payloadHash ?? "";
                  const payloadType = (r as any).payload_type ?? (r as any).payloadType ?? "";
                  const method = (r as any).method ?? "";
                  const endpoint = (r as any).endpoint ?? "";
                  const notes = (r as any).notes ?? "";

                  return (
                    <div
                      key={r.id}
                      className={`rounded-2xl border border-slate-800 bg-slate-950/30 p-3 ${
                        selectedRunId === r.id ? "ring-2 ring-slate-500" : ""
                      }`}
                    >
                      <Button onClick={() => loadRun(r.id)} variant="ghost">
                        #{r.id} — {created ? new Date(created).toLocaleString() : "(no date)"} — {method} {endpoint}
                      </Button>
                      <div className="mt-1 text-xs text-slate-400">
                        {payloadType} • {payloadHash ? payloadHash.slice(0, 10) : "(no hash)"}…{" "}
                        {notes ? `• ${notes}` : ""}
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>

            <Card>
              {!runDetail && <div className="text-sm text-slate-400">Select a run to view results.</div>}
              {runDetail && (
                <div className="space-y-4">
                  <div>
                    <div className="text-sm font-semibold text-slate-200">Run metadata</div>
                    <pre className="mt-2 max-h-64 overflow-auto rounded-xl border border-slate-800 bg-slate-950/60 p-3 text-xs text-slate-200">
                      {JSON.stringify(runDetail.run, null, 2)}
                    </pre>
                  </div>

                  <div>
                    <div className="text-sm font-semibold text-slate-200">Results</div>
                    <div className="mt-2">
                      <RunResultsTable results={runDetail.results} runId={selectedRunId ?? undefined} />
                    </div>
                  </div>
                </div>
              )}
            </Card>
          </div>
        )}

        {/* Footer */}
        <div className="mt-6 text-xs text-slate-500">
          API base: <code className="text-slate-300">{import.meta.env.VITE_API_BASE_URL || "(not set)"}</code>
        </div>
      </div>
    </div>
  );
}
