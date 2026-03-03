import React from "react";

export function CodeEditor(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  heightClass?: string;
}) {
  return (
    <div className="space-y-2">
      <div className="text-xs font-semibold text-slate-300">{props.label}</div>
      <textarea
        className={`w-full rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2 font-mono text-xs text-slate-100 outline-none focus:ring-2 focus:ring-slate-500 ${props.heightClass || "h-44"}`}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        placeholder={props.placeholder}
        spellCheck={false}
      />
    </div>
  );
}
