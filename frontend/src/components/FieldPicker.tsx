import React, { useMemo, useState } from "react";
import { Button } from "./Button";

export function FieldPicker(props: {
  paths: string[];
  protectedPaths: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  const [q, setQ] = useState("");

  const allPaths = props.paths ?? [];

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return allPaths;
    return allPaths.filter((p) => p.toLowerCase().includes(s));
  }, [q, allPaths]);

  function toggle(path: string) {
    const next = new Set(props.protectedPaths ?? new Set<string>());
    if (next.has(path)) next.delete(path);
    else next.add(path);
    props.onChange(next);
  }

  function selectAllFiltered() {
    const next = new Set(props.protectedPaths ?? new Set<string>());
    filtered.forEach((p) => next.add(p));
    props.onChange(next);
  }

  function clearAllFiltered() {
    const next = new Set(props.protectedPaths ?? new Set<string>());
    filtered.forEach((p) => next.delete(p));
    props.onChange(next);
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <input
          className="w-full rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-500"
          placeholder="Search field paths…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <Button variant="ghost" onClick={selectAllFiltered}>
          Protect all
        </Button>
        <Button variant="ghost" onClick={clearAllFiltered}>
          Unprotect all
        </Button>
      </div>

      <div className="text-xs text-slate-400">
        Showing <span className="font-semibold text-slate-200">{filtered.length}</span> /{" "}
        {allPaths.length}
      </div>

      <div className="h-[420px] overflow-auto rounded-xl border border-slate-800 bg-slate-950/40">
        <ul className="divide-y divide-slate-900">
          {filtered.map((p) => {
            const checked = (props.protectedPaths ?? new Set<string>()).has(p);
            return (
              <li key={p} className="flex items-center gap-3 px-3 py-2 hover:bg-slate-900/40">
                <input type="checkbox" checked={checked} onChange={() => toggle(p)} />
                <code className="text-xs text-slate-200">{p}</code>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
