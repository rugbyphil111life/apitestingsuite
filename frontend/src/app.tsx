import React, { useEffect, useMemo, useState } from "react";
import { Card } from "./components/Card";
import { Button } from "./components/Button";
import { CodeEditor } from "./components/CodeEditor";
import { FieldPicker } from "./components/FieldPicker";
import { RunResultsTable } from "./components/RunResultsTable";
import { createRun, getRun, listRuns, parsePayload } from "./api";
import type { RunDetail, RunMeta } from "./types";

// const samplePayload = `{
//   "enrollmentID": 644,
//   "accessCode": "MOSSADAMSP",
//   "vnetClientID": "977929180",
//   "supplierName": "ExampleVendor",
//   "addresses": [{"type":"primary","city":"Fake City"}],
//   "contacts": [{"email":"test@example.com"}],
//   "createCaseMode": "ignore_duplicate"
// }`;

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

  // Payload input
  // const [payloadText, setPayloadText] = useState(samplePayload);
  const [payloadType, setPayloadType] = useState<string>("");

  // Fields
  const [allPaths, setAllPaths] = useState<string[]>([]);
  const [protectedPaths, setProtectedPaths] = useState<Set<string>>(new Set());

  // Runs / results
  const [runs, setRuns] = useState<RunMeta[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<number | null>(null);
  const [runDetail, setRunDetail] = useState<RunDetail | null>(null);

  const [busy, setBusy] = useState<string>("");

  const testedCount = useMemo(() => Math.max(0, allPaths.length - protectedPaths.size), [allPaths, protectedPaths]);

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
    <div className="min-h-screen">
      <div className="mx-auto max-w-7xl px-4 py-8">
        <div className="flex flex-wrap items-center gap-3">
          <div className="text-2xl font-bold tracking-tight">Field Tester</div>
          <div className="text-sm text-slate-400">Omit-one-field runner + persistent results</div>
          <div className="ml-auto flex gap-2">
            <Button variant={tab === "new" ? "primary" : "ghost"} onClick={() => setTab("new")}>
              New Run
            </Button>
            <Button variant={tab === "history" ? "primary" : "ghost"} onClick={() => setTab("history")}>
              History
            </Button>
          </div>
        </div>

        {busy && (
          <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-900/60 px-4 py-3 text-sm text-slate-200">
            {busy}
          </div>
        )}

        {tab === "new" && (
          <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
            <Card
              title="Request"
              right={
                <div className="text-xs text-slate-400">
                  To test: <span className="font-semibold text-slate-200">{testedCount}</span>
                </div>
              }
            >
              <div className="space-y-3">
                <div className="grid grid-cols-1 gap-3">
                  <label className="text-xs font-semibold text-slate-300">Endpoint URL</label>
                  <input
                    className="rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-500"
                    value={endpointUrl}
                    onChange={(e) => setEndpointUrl(e.target.value)}
                    placeholder="https://api.example.com/vendors"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="text-xs font-semibold text-slate-300">Method</div>
                    <select
                      className="mt-2 w-full rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-500"
                      value={method}
                      onChange={(e) => setMethod(e.target.value)}
                    >
                      <option>POST</option>
                      <option>PUT</option>
                      <option>PATCH</option>
                    </select>
                  </div>

                  <div>
                    <div className="text-xs font-semibold text-slate-300">Timeout (s)</div>
                    <input
                      type="number"
                      className="mt-2 w-full rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-500"
                      value={timeoutSeconds}
                      onChange={(e) => setTimeoutSeconds(parseInt(e.target.value || "25", 10))}
                      min={1}
                      max={300}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <label className="flex items-center gap-2 text-sm text-slate-200">
                    <input type="checkbox" checked={includeContainers} onChange={(e) => setIncludeContainers(e.target.checked)} />
                    Include container nodes
                  </label>

                  <div>
                    <div className="text-xs font-semibold text-slate-300">CSV mode</div>
                    <select
                      className="mt-2 w-full rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-500"
                      value={csvSendMode}
                      onChange={(e) => setCsvSendMode(e.target.value as any)}
                    >
                      <option value="csv_as_json">csv_as_json</option>
                      <option value="raw_csv">raw_csv</option>
                    </select>
                  </div>
                </div>

                <CodeEditor label="Headers (JSON object)" value={headersText} onChange={setHeadersText} heightClass="h-36" />
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="text-xs font-semibold text-slate-300">Payload type (optional)</div>
                    <input
                      className="mt-2 w-full rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-500"
                      value={payloadType}
                      onChange={(e) => setPayloadType(e.target.value)}
                      placeholder="json | xml | csv"
                    />
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-slate-300">Content-Type override</div>
                    <input
                      className="mt-2 w-full rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-500"
                      value={contentTypeOverride}
                      onChange={(e) => setContentTypeOverride(e.target.value)}
                      placeholder="application/json"
                    />
                  </div>
                </div>

                <CodeEditor label="Missing-required regex" value={missingRegex} onChange={setMissingRegex} heightClass="h-24" />
                <div>
                  <div className="text-xs font-semibold text-slate-300">Notes</div>
                  <input
                    className="mt-2 w-full rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-500"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Optional"
                  />
                </div>
              </div>
            </Card>

            <Card
              title="Payload"
              right={
                <div className="flex gap-2">
                  <Button variant="ghost" onClick={discoverFields} disabled={!payloadText.trim()}>
                    Discover fields
                  </Button>
                  <Button onClick={runSuite} disabled={!allPaths.length || !endpointUrl.trim()}>
                    Run suite
                  </Button>
                </div>
              }
            >
              <div className="space-y-3">
                <div className="rounded-2xl border border-dashed border-slate-700 bg-slate-950/30 p-4">
                  <div className="text-sm text-slate-200 font-semibold">Upload payload file</div>
                  <div className="text-xs text-slate-400 mt-1">JSON / XML / CSV / TXT</div>
                  <input
                    className="mt-3 block w-full text-sm text-slate-200"
                    type="file"
                    onChange={(e) => e.target.files?.[0] && onUpload(e.target.files[0])}
                  />
                </div>
                <CodeEditor label="Paste payload" value={payloadText} onChange={setPayloadText} heightClass="h-80" />
              </div>
            </Card>

            <Card title="Protected fields">
              <FieldPicker allPaths={allPaths} protectedPaths={protectedPaths} setProtectedPaths={setProtectedPaths} />
            </Card>
          </div>
        )}

        {tab === "history" && (
          <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
            <Card title="Runs" right={<Button variant="ghost" onClick={() => refreshRuns()}>Refresh</Button>}>
              <div className="space-y-2">
                {runs.length === 0 && <div className="text-sm text-slate-400">No runs yet.</div>}
                {runs.map((r) => (
                  <button
                    key={r.id}
                    className={`w-full rounded-xl border px-3 py-2 text-left text-sm transition ${
                      selectedRunId === r.id ? "border-slate-500 bg-slate-800/60" : "border-slate-800 bg-slate-950/30 hover:bg-slate-900/30"
                    }`}
                    onClick={() => loadRun(r.id)}
                  >
                    <div className="flex items-center justify-between">
                      <div className="font-semibold text-slate-200">#{r.id}</div>
                      <div className="text-xs text-slate-400">{new Date(r.created_at_utc).toLocaleString()}</div>
                    </div>
                    <div className="mt-1 text-xs text-slate-400">
                      {r.method} {r.endpoint}
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      {r.payload_type} • {r.payload_hash.slice(0, 10)}… {r.notes ? `• ${r.notes}` : ""}
                    </div>
                  </button>
                ))}
              </div>
            </Card>

            <div className="lg:col-span-2">
              <Card title="Run details">
                {!runDetail && <div className="text-sm text-slate-400">Select a run to view results.</div>}
                {runDetail && (
                  <div className="space-y-4">
                    <div className="rounded-2xl border border-slate-800 bg-slate-950/30 p-3 text-xs text-slate-300">
                      <pre className="overflow-auto">{JSON.stringify(runDetail.run, null, 2)}</pre>
                    </div>
                    <RunResultsTable rows={runDetail.results} runId={selectedRunId ?? undefined} />
                  </div>
                )}
              </Card>
            </div>
          </div>
        )}

        <div className="mt-8 text-xs text-slate-500">
          API base: <code className="text-slate-300">{import.meta.env.VITE_API_BASE_URL || "(not set)"}</code>
        </div>
      </div>
    </div>
  );
}
