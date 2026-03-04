import React from "react";

export function CodeEditor(props: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  heightClass?: string;
}) {
  return (
    <textarea
      className={`w-full rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2 font-mono text-xs text-slate-100 outline-none focus:ring-2 focus:ring-slate-500 ${
        props.heightClass || "h-44"
      }`}
      value={props.value ?? ""}
      onChange={(e) => props.onChange(e.target.value)}
      placeholder={props.placeholder}
      spellCheck={false}
    />
  );
}
