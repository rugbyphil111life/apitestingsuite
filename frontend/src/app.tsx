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

  // NEW: Auth config
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
      setProtectedPaths(new Set()); // reset each discovery for now
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

    // Basic client-side auth validation (backend will validate too)
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

        // NEW: auth payload
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
    <div className="container">
      <h1>Field Tester</h1>
      <p>Omit-one-field runner + persistent results</p>

      <div className="tabs">
        <Button onClick={() => setTab("new")}>New Run</Button>
        <Button onClick={() => setTab("history")}>History</Button>
      </div>

      {busy && (
        <Card>
          <div>{busy}</div>
        </Card>
      )}

      {tab === "new" && (
        <div className="grid">
          <Card>
            <div className="row between">
              <div><b>To test:</b> {testedCount}</div>
            </div>

            <div className="form">
              <label>Endpoint URL</label>
              <input value={endpointUrl} onChange={(e) => setEndpointUrl(e.target.value)} placeholder="https://api.example.com/vendors" />

              <label>Method</label>
              <select value={method} onChange={(e) => setMethod(e.target.value)}>
                <option>POST</option>
                <option>PUT</option>
                <option>PATCH</option>
              </select>

              <label>Timeout (s)</label>
              <input
                value={timeoutSeconds}
                onChange={(e) => setTimeoutSeconds(parseInt(e.target.value || "25", 10))}
                min={1}
                max={300}
                type="number"
              />

              <label>
                <input type="checkbox" checked={includeContainers} onChange={(e) => setIncludeContainers(e.target.checked)} /> Include container nodes
              </label>

              <label>CSV mode</label>
              <select value={csvSendMode} onChange={(e) => setCsvSendMode(e.target.value as any)}>
                <option value="csv_as_json">csv_as_json</option>
                <option value="raw_csv">raw_csv</option>
              </select>

              <label>Payload type (optional)</label>
              <input value={payloadType} onChange={(e) => setPayloadType(e.target.value)} placeholder="json | xml | csv" />

              <label>Content-Type override</label>
              <input value={contentTypeOverride} onChange={(e) => setContentTypeOverride(e.target.value)} placeholder="application/json" />

              <label>Notes</label>
              <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />

              <label>Headers (JSON)</label>
              <CodeEditor value={headersText} onChange={setHeadersText} />

              {/* NEW: Authentication UI */}
              <div style={{ marginTop: 12 }}>
                <h3>Authentication</h3>

                <label>Auth Type</label>
                <select value={authType} onChange={(e) => setAuthType(e.target.value as AuthType)}>
                  <option value="none">None</option>
                  <option value="bearer">Bearer Token</option>
                  <option value="oauth2_client_credentials">OAuth2 Client Credentials</option>
                </select>

                {authType === "bearer" && (
                  <>
                    <label>Bearer Token</label>
                    <input value={bearerToken} onChange={(e) => setBearerToken(e.target.value)} placeholder="eyJhbGciOi..." />
                  </>
                )}

                {authType === "oauth2_client_credentials" && (
                  <>
                    <label>Token URL</label>
                    <input value={oauthTokenUrl} onChange={(e) => setOauthTokenUrl(e.target.value)} placeholder="https://auth.example.com/oauth/token" />

                    <label>Client ID</label>
                    <input value={oauthClientId} onChange={(e) => setOauthClientId(e.target.value)} placeholder="client_id" />

                    <label>Client Secret</label>
                    <input type="password" value={oauthClientSecret} onChange={(e) => setOauthClientSecret(e.target.value)} placeholder="client_secret" />

                    <label>Scope (optional)</label>
                    <input value={oauthScope} onChange={(e) => setOauthScope(e.target.value)} placeholder="read write" />

                    <label>Audience (optional)</label>
                    <input value={oauthAudience} onChange={(e) => setOauthAudience(e.target.value)} placeholder="https://api.example.com/" />
                  </>
                )}
              </div>

              <div className="row">
                <Button onClick={discoverFields}>Discover fields</Button>
                <Button onClick={runSuite}>Run suite</Button>
              </div>
            </div>
          </Card>

          <Card>
            <label>Upload payload file</label>
            <div>JSON / XML / CSV / TXT</div>
            <input type="file" onChange={(e) => e.target.files?.[0] && onUpload(e.target.files[0])} />

            <label style={{ marginTop: 12 }}>Payload</label>
            <CodeEditor value={payloadText} onChange={setPayloadText} />

            <div style={{ marginTop: 12 }}>
              <FieldPicker paths={allPaths} protectedPaths={protectedPaths} onChange={setProtectedPaths} />
            </div>
          </Card>
        </div>
      )}

      {tab === "history" && (
        <div className="grid">
          <Card>
            <div className="row between">
              <Button onClick={() => refreshRuns()}>Refresh</Button>
            </div>

            {runs.length === 0 && <div>No runs yet.</div>}

            {runs.map((r) => (
              <Card key={r.id}>
                <Button onClick={() => loadRun(r.id)}>
                  #{r.id} — {new Date(r.created_at_utc).toLocaleString()} — {r.method} {r.endpoint}
                </Button>
                <div>
                  {r.payload_type} • {r.payload_hash.slice(0, 10)}… {r.notes ? `• ${r.notes}` : ""}
                </div>
              </Card>
            ))}
          </Card>

          <Card>
            {!runDetail && <div>Select a run to view results.</div>}
            {runDetail && (
              <>
                <h3>Run metadata</h3>
                <pre>{JSON.stringify(runDetail.run, null, 2)}</pre>
                <h3>Results</h3>
                <RunResultsTable results={runDetail.results} />
              </>
            )}
          </Card>
        </div>
      )}

      <div style={{ marginTop: 18, opacity: 0.8 }}>
        API base: <code>{import.meta.env.VITE_API_BASE_URL || "(not set)"}</code>
      </div>
    </div>
  );
}
