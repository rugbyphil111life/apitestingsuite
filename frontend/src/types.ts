export type ParseResponse = {
  detectedType: string;
  paths: string[];
};

export type RunMeta = {
  id: number;
  created_at_utc: string;
  endpoint: string;
  method: string;
  payload_type: string;
  payload_hash: string;
  notes: string;
};

export type RunResultRow = {
  omitted_path: string;
  removed: boolean;
  status_code: number;
  classification: string;
  why: string;
  response_snippet: string;
  elapsed_ms: number;
};

export type RunDetail = {
  run: Record<string, any>;
  results: RunResultRow[];
};
