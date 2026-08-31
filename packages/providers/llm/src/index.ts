/**
 * LLMProvider 契约（F8.1）：以 Claude API（商业 API）能力为基准设计，CLI Provider 做适配，
 * 接口不得泄漏 CLI 特有语义（spike-5 已确认可行）。
 */
import type { ZodType } from "zod";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatRequest {
  messages: ChatMessage[];
  maxOutputTokens?: number;
}

export type ChatEvent =
  | { type: "delta"; text: string }
  | { type: "done"; usage?: { inputTokens: number; outputTokens: number }; costUsd?: number }
  | { type: "error"; code: string; message?: string };

export interface StructuredRequest<T> {
  messages: ChatMessage[];
  schema: ZodType<T>;
  /** 解析失败自动重试次数（默认 1，见 generateStructured 管线）。 */
  maxRetries?: number;
}

export interface LLMProvider {
  readonly kind: string;
  chatStream(req: ChatRequest, signal?: AbortSignal): AsyncIterable<ChatEvent>;
  generateStructured<T>(req: StructuredRequest<T>): Promise<T>;
}

/**
 * 结构化输出后处理管线的公共部分（spike-5 发现 2）：
 * 模型即使被明确要求也可能输出 markdown 围栏——剥壳后再交给 JSON.parse + zod。
 */
export function stripFences(text: string): string {
  const trimmed = text.trim();
  const m = /^```[a-zA-Z]*\s*\n?([\s\S]*?)\n?```$/.exec(trimmed);
  return (m?.[1] ?? trimmed).trim();
}

export function parseStructured<T>(raw: string, schema: ZodType<T>): T {
  const json: unknown = JSON.parse(stripFences(raw));
  return schema.parse(json);
}
