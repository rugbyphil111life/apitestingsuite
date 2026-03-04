import React, { useMemo, useState } from "react";
import type { RunResultRow } from "../types";

export function RunResultsTable(props: { results: RunResultRow[]; runId?: number }) {
  const [q, setQ] = useState("");
  const [cls, setCls] = useState<string>("");

  const rows = props.results ?? [];

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return rows.filter((r) => {
      const omitted = (r.omitted_path ?? "").toLowerCase();
      const why = (r.why ?? "").toLowerCase();
      const matchesQ = !s || omitted.includes(s) || why.includes(s);
      const matchesC = !cls || r.classification === cls;
      return matchesQ && matchesC;
    });
  }, [q, cls, rows]);

  const classes = useMemo(() => {
    const set = new Set(rows.map((r) => r.classification).filter(Boolean));
    return Array.from(set).sort();
  }, [rows]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 items-center">
        <input
          className="w-full md:w-80 rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-500"
          placeholder="Search results…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select
          className="rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-500"
          value={cls}
          onChange={(e) => setCls(e.target.value)}
        >
          <option value="">All classifications</option>
          {classes.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>

        {props.runId && (
          <div className="ml-auto flex gap-2">
            <a
              className="rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2 text-sm hover:bg-slate-900"
              href={`${import.meta.env.VITE_API_BASE_URL}/api/runs/${props.runId}/export.csv`}
              target="_blank"
              rel="noreferrer"
            >
              Export CSV
            </a>
            <a
              className="rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2 text-sm hover:bg-slate-900"
              href={`${import.meta.env.VITE_API_BASE_URL}/api/runs/${props.runId}/export.json`}
              target="_blank"
              rel="noreferrer"
            >
              Export JSON
            </a>
          </div>
        )}
      </div>

      <div className="overflow-auto rounded-2xl border border-slate-800">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-900">
            <tr className="text-left text-slate-300">
              <th className="p-3">Omitted path</th>
              <th className="p-3">Status</th>
              <th className="p-3">Classification</th>
              <th className="p-3">Why</th>
              <th className="p-3">ms</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-900 bg-slate-950/30">
            {filtered.map((r) => (
              <tr key={r.omitted_path} className="align-top hover:bg-slate-900/30">
                <td className="p-3">
                  <code className="text-xs text-slate-200">{r.omitted_path}</code>
                </td>
                <td className="p-3 text-slate-200">{r.status_code}</td>
                <td className="p-3">
                  <span className="rounded-full border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200">
                    {r.classification}
                  </span>
                </td>
                <td className="p-3 text-slate-300 max-w-xl">
                  <div className="line-clamp-3">{r.why}</div>
                </td>
                <td className="p-3 text-slate-300">{r.elapsed_ms}</td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td className="p-3 text-slate-400" colSpan={5}>
                  No results match your filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
