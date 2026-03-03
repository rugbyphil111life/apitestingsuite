import React from "react";

export function Card(props: { title: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/60 shadow-sm">
      <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
        <div className="text-sm font-semibold text-slate-100">{props.title}</div>
        {props.right}
      </div>
      <div className="p-4">{props.children}</div>
    </div>
  );
}
