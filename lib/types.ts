// Supported model IDs
export type ModelId =
  | "gemini-2.5-pro"
  | "gemini-2.0-flash"
  | "qwen-vl-max";

// Single page input: base64 data rendered as image
export interface PageChunk {
  pageNumber: number;      // 1-indexed
  totalPages: number;
  base64Data: string;      // base64 encoded image, without data URI prefix
  mimeType: "image/png" | "image/jpeg";
  isCJK?: boolean;         // true = Route to Qwen VL
}

// Single page conversion result
export interface ConvertedPage {
  pageNumber: number;
  markdown: string;
  hasTables: boolean;
  hasMath: boolean;
  hasCode: boolean;
  confidence: number;      // 0.0 - 1.0, model self-evaluation
  modelUsed: ModelId;
  tokensUsed?: number;
  retried?: boolean;
  serverDurationMs?: number; // Backend processing time for this page
}

// Final statistics
export interface ConversionStats {
  totalPages: number;
  totalTokens: number;
  modelsUsed: Record<ModelId, number>;
  retriedPages: number;
  durationMs: number;
  totalServerDurationMs?: number; // Sum of server processing times
}

// SSE event union type
export type StreamEvent =
  | { type: "start"; totalPages: number; fileName: string }
  | { type: "page_done"; page: ConvertedPage }
  | { type: "progress"; completed: number; total: number }
  | { type: "done"; markdown: string; stats: ConversionStats }
  | { type: "error"; message: string; pageNumber?: number };
