// src/types.ts

export type AuthConfig =
  | { type: "none" }
  | { type: "basic"; username: string; password: string }
  | { type: "bearer"; token: string };

export type RunMeta = {
  id: string;
  createdAt: string; // keep your existing fields if different
  status: "queued" | "running" | "done" | "error";
};

export type RunDetail = RunMeta & {
  // keep your existing structure; these are placeholders
  results?: any;
  error?: any;
};

export type ParseRequest = {
  payloadText: string;
  payloadType: "json" | "xml" | "csv";
  auth?: AuthConfig;
};

export type ParseResponse = {
  // keep your existing response contract
  fields: string[];
  nestedFields?: string[];
};

export type CreateRunRequest = {
  // keep your existing request contract
  targetUrl: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  payloadText?: string;
  payloadType?: "json" | "xml" | "csv";
  protectedFields?: string[];
  auth?: AuthConfig;
};

export type CreateRunResponse = {
  id: string;
};
