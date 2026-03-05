// src/App.tsx
import React, { useMemo, useState } from "react";
import { Card } from "./components/Card";
import { Button } from "./components/Button";
import { CodeEditor } from "./components/CodeEditor";
import { FieldPicker } from "./components/FieldPicker";
import { RunResultsTable } from "./components/RunResultsTable";
import { createRun, getRun, listRuns, parsePayload } from "./api";
import type { AuthConfig, RunDetail, RunMeta } from "./types";

type PayloadType = "json" | "xml" | "csv";
type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export default function App() {
  const [targetUrl, setTargetUrl] = useState("");
  const [method, setMethod] = useState<HttpMethod>("POST");
  const [payloadType, setPayloadType] = useState<PayloadType>("json");
  const [payloadText, setPayloadText] = useState("");

  const [auth, setAuth] = useState<AuthConfig>({ type: "none" });

  const [discoveredFields, setDiscoveredFields] = useState<string[]>([]);
  const [protectedFields, setProtectedFields] = useState<string[]>([]);

  const [runs, setRuns] = useState<RunMeta[]>([]);
  const [activeRun, setActiveRun] = useState<RunDetail | null>(null);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canDiscover = useMemo(() => payloadText.trim().length > 0, [payloadText]);
  const canRun = useMemo(() => targetUrl.trim().length > 0, [targetUrl]);

  async function onRefreshRuns() {
    setError(null);
    try {
      const data = await listRuns();
      setRuns(data);
    } catch (e: any) {
      setError(e?.message || "Failed to load runs");
    }
  }

  async function onDiscoverFields() {
    setBusy(true);
    setError(null);
    try {
      const resp = await parsePayload({
        payloadText,
        payloadType,
        auth,
      });
      const fields = resp.fields || [];
      setDiscoveredFields(fields);
      // keep protectedFields stable; user chooses
    } catch (e: any) {
      setError(e?.message || "Discover fields failed");
    } finally {
      setBusy(false);
    }
  }

  async function onCreateRun() {
    setBusy(true);
    setError(null);
    try {
      const resp = await createRun({
        targetUrl,
        method,
        payloadText: payloadText.trim().length ? payloadText : undefined,
        payloadType: payloadText.trim().length ? payloadType : undefined,
        protectedFields,
        auth,
      });

      const detail = await getRun(resp.id);
      setActiveRun(detail);
      await onRefreshRuns();
    } catch (e: any) {
      setError(e?.message || "Run failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="mx-auto max-w-6xl px-4 py-8">
        <div className="flex flex-col gap-2">
          <div className="text-2xl font-bold tracking-tight">API Testing Suite</div>
          <div className="text-sm text-white/60">
            Parse payloads, protect fields, and run automated tests.
          </div>
        </div>

        {error && (
          <div className="mt-6 rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            {error}
          </div>
        )}

        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card>
            <div className="flex flex-col gap-4">
              <div className="text-lg font-semibold">Request Setup</div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="sm:col-span-2">
                  <label className="mb-1 block text-xs text-white/60">Target URL</label>
                  <input
                    className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-white/20"
                    placeholder="https://api.example.com/endpoint"
                    value={targetUrl}
                    onChange={(e) => setTargetUrl(e.target.value)}
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs text-white/60">Method</label>
                  <select
                    className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-white/20"
                    value={method}
                    onChange={(e) => setMethod(e.target.value as HttpMethod)}
                  >
                    <option value="GET">GET</option>
                    <option value="POST">POST</option>
                    <option value="PUT">PUT</option>
                    <option value="PATCH">PATCH</option>
                    <option value="DELETE">DELETE</option>
                  </select>
                </div>
              </div>

              {/* Auth block */}
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <div className="text-sm font-semibold">Authentication</div>
                    <div className="text-xs text-white/60">
                      Choose how outbound requests are authenticated.
                    </div>
                  </div>

                  <select
                    className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-white/20"
                    value={auth.type}
                    onChange={(e) => {
                      const v = e.target.value as AuthConfig["type"];
                      if (v === "none") setAuth({ type: "none" });
                      if (v === "basic") setAuth({ type: "basic", username: "", password: "" });
                      if (v === "bearer") setAuth({ type: "bearer", token: "" });
                    }}
                  >
                    <option value="none">None</option>
                    <option value="basic">Basic Auth (username/password)</option>
                    <option value="bearer">Bearer Token</option>
                  </select>
                </div>

                {auth.type === "basic" && (
                  <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-xs text-white/60">Username</label>
                      <input
                        className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-white/20"
                        value={auth.username}
                        onChange={(e) => setAuth({ ...auth, username: e.target.value })}
                        autoComplete="username"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs text-white/60">Password</label>
                      <input
                        className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-white/20"
                        type="password"
                        value={auth.password}
                        onChange={(e) => setAuth({ ...auth, password: e.target.value })}
                        autoComplete="current-password"
                      />
                    </div>
                    <div className="sm:col-span-2 text-xs text-white/50">
                      Stored in memory only unless you add persistence.
                    </div>
                  </div>
                )}

                {auth.type === "bearer" && (
                  <div className="mt-4">
                    <label className="mb-1 block text-xs text-white/60">Bearer token</label>
                    <input
                      className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-white/20"
                      value={auth.token}
                      onChange={(e) => setAuth({ ...auth, token: e.target.value })}
                    />
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <label className="mb-1 block text-xs text-white/60">Payload Type</label>
                  <select
                    className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-white/20"
                    value={payloadType}
                    onChange={(e) => setPayloadType(e.target.value as PayloadType)}
                  >
                    <option value="json">JSON</option>
                    <option value="xml">XML</option>
                    <option value="csv">CSV</option>
                  </select>
                </div>

                <div className="sm:col-span-2 flex items-end justify-end gap-2">
                  <Button disabled={busy || !canDiscover} onClick={onDiscoverFields}>
                    Discover Fields
                  </Button>
                  <Button disabled={busy || !canRun} onClick={onCreateRun}>
                    Run Tests
                  </Button>
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs text-white/60">Payload</label>
                <CodeEditor value={payloadText} onChange={setPayloadText} />
              </div>
            </div>
          </Card>

          <Card>
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-lg font-semibold">Fields</div>
                  <div className="text-xs text-white/60">
                    Select protected fields (excluded from tests).
                  </div>
                </div>
                <Button onClick={onRefreshRuns} disabled={busy}>
                  Refresh Runs
                </Button>
              </div>

              <FieldPicker
                fields={discoveredFields}
                selected={protectedFields}
                onChange={setProtectedFields}
              />

              <div className="mt-2">
                <div className="text-sm font-semibold">Recent Runs</div>
                <div className="mt-2 rounded-2xl border border-white/10 bg-white/5">
                  <div className="max-h-48 overflow-auto">
                    {runs.length === 0 ? (
                      <div className="p-4 text-sm text-white/60">No runs yet.</div>
                    ) : (
                      <div className="divide-y divide-white/10">
                        {runs.map((r) => (
                          <button
                            key={r.id}
                            className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-white/5"
                            onClick={async () => {
                              setBusy(true);
                              setError(null);
                              try {
                                const d = await getRun(r.id);
                                setActiveRun(d);
                              } catch (e: any) {
                                setError(e?.message || "Failed to load run");
                              } finally {
                                setBusy(false);
                              }
                            }}
                          >
                            <div className="text-sm">
                              <div className="font-medium">{r.id}</div>
                              <div className="text-xs text-white/60">{r.createdAt}</div>
                            </div>
                            <div className="text-xs text-white/60">{r.status}</div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </Card>
        </div>

        <div className="mt-6">
          <Card>
            <div className="flex flex-col gap-3">
              <div className="text-lg font-semibold">Results</div>
              <RunResultsTable run={activeRun} />
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
