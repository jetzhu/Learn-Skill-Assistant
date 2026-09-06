import { spawn, execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";
import { parseStructured, type ChatEvent, type ChatMessage } from "@lsa/provider-llm";
import { config } from "./config.js";

/**
 * ClaudeCliProvider（F8.2/F8.10，spike-5 契约）：
 * - 仅开发者本人自用；服务只绑 127.0.0.1（F8.7），接第二位真实用户前必须切商业 API（F8.11a）；
 * - spawn 原生 claude.exe（禁 .cmd 垫片——Node 18.20+ EINVAL）、shell:false、提示词走 stdin；
 * - 超时 90s、输出上限 256KB；结构化输出走「剥围栏→parse→zod」管线（spike-5 发现 2）。
 * MVP 采用每轮独立进程（spike-5 实测 ~5–6s 固定开销，开发自用可接受；常驻进程为后续优化）。
 */

let exePath: string | null = null;

export function resolveClaudeExe(): string {
  if (exePath) return exePath;
  if (config.claude.exe) return (exePath = config.claude.exe);
  // where claude → .cmd 垫片 → 解析出真实 exe
  const out = (() => {
    try {
      return execSync("where.exe claude", { encoding: "utf8" });
    } catch {
      return "";
    }
  })();
  const cmd = out.split(/\r?\n/).find((l) => l.endsWith(".cmd"));
  if (cmd) {
    const shim = readFileSync(cmd, "utf8");
    const m = /"%dp0%[\\/](.*claude\.exe)"/.exec(shim);
    if (m?.[1]) return (exePath = join(dirname(cmd), m[1]));
  }
  const exe = out.split(/\r?\n/).find((l) => l.endsWith("claude.exe"));
  if (exe) return (exePath = exe);
  throw new Error("Claude CLI not found — set CLAUDE_EXE in apps/server/.env");
}

function renderPrompt(messages: ChatMessage[]): { system: string; prompt: string } {
  const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  const turns = messages
    .filter((m) => m.role !== "system")
    .map((m) => (m.role === "user" ? `[Student]: ${m.content}` : `[Coach]: ${m.content}`))
    .join("\n\n");
  return { system, prompt: turns };
}

function baseArgs(system: string): string[] {
  return [
    "-p",
    "--model",
    config.claude.model,
    "--strict-mcp-config",
    "--disallowed-tools",
    "*",
    ...(system ? ["--append-system-prompt", system] : []),
  ];
}

function runCli(args: string[], stdin: string, timeoutMs = 90_000): Promise<{ out: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    const p = spawn(resolveClaudeExe(), args, { shell: false, windowsHide: true });
    let out = "";
    let err = "";
    const guard = setTimeout(() => {
      p.kill();
      reject(new Error("cli timeout"));
    }, timeoutMs);
    p.stdout.on("data", (d: Buffer) => {
      out += d.toString();
      if (out.length > 256 * 1024) {
        clearTimeout(guard);
        p.kill();
        reject(new Error("cli output limit exceeded"));
      }
    });
    p.stderr.on("data", (d: Buffer) => (err += d.toString()));
    p.on("error", (e) => {
      clearTimeout(guard);
      reject(e);
    });
    p.on("close", (code) => {
      clearTimeout(guard);
      if (code !== 0 && !out) reject(new Error(`cli exit ${code}: ${err.slice(0, 300)}`));
      else resolve({ out, code });
    });
    p.stdin.write(stdin);
    p.stdin.end();
  });
}

export const claudeCliProvider = {
  kind: "claude-cli" as const,

  async *chatStream(req: { messages: ChatMessage[] }): AsyncIterable<ChatEvent> {
    const { system, prompt } = renderPrompt(req.messages);
    const args = [...baseArgs(system), "--output-format", "stream-json", "--verbose", "--include-partial-messages"];
    const p = spawn(resolveClaudeExe(), args, { shell: false, windowsHide: true });
    p.stdin.write(prompt);
    p.stdin.end();

    let buf = "";
    let usage: { inputTokens: number; outputTokens: number } | undefined;
    let costUsd: number | undefined;
    const queue: ChatEvent[] = [];
    let finished = false;
    let notify: (() => void) | null = null;
    const push = (ev: ChatEvent) => {
      queue.push(ev);
      notify?.();
    };

    const guard = setTimeout(() => {
      p.kill();
      push({ type: "error", code: "timeout" });
      finished = true;
      notify?.();
    }, 120_000);

    p.stdout.on("data", (d: Buffer) => {
      buf += d.toString();
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        if (!line.trim()) continue;
        try {
          const ev = JSON.parse(line) as {
            type: string;
            event?: { type: string; delta?: { type: string; text?: string } };
            total_cost_usd?: number;
            usage?: { input_tokens?: number; output_tokens?: number };
            is_error?: boolean;
          };
          if (ev.type === "stream_event" && ev.event?.type === "content_block_delta" && ev.event.delta?.text) {
            push({ type: "delta", text: ev.event.delta.text });
          } else if (ev.type === "result") {
            costUsd = ev.total_cost_usd;
            if (ev.usage) usage = { inputTokens: ev.usage.input_tokens ?? 0, outputTokens: ev.usage.output_tokens ?? 0 };
          }
        } catch {
          /* 非 JSON 行忽略 */
        }
      }
    });
    p.on("close", () => {
      clearTimeout(guard);
      push({ type: "done", ...(usage ? { usage } : {}), ...(costUsd !== undefined ? { costUsd } : {}) });
      finished = true;
      notify?.();
    });

    while (!finished || queue.length > 0) {
      if (queue.length === 0) await new Promise<void>((r) => (notify = r));
      notify = null;
      while (queue.length > 0) {
        const ev = queue.shift()!;
        yield ev;
        if (ev.type === "done" || ev.type === "error") return;
      }
    }
  },

  async generateStructured<T>(req: { messages: ChatMessage[]; schema: z.ZodType<T>; maxRetries?: number }): Promise<T> {
    const { system, prompt } = renderPrompt(req.messages);
    const args = [...baseArgs(system), "--output-format", "json"];
    const attempt = async (extra: string): Promise<T> => {
      const { out } = await runCli(args, prompt + extra);
      const envelope = JSON.parse(out) as { result?: string; is_error?: boolean };
      if (envelope.is_error || typeof envelope.result !== "string") throw new Error("cli returned error envelope");
      return parseStructured(envelope.result, req.schema);
    };
    try {
      return await attempt("");
    } catch (e) {
      if ((req.maxRetries ?? 1) < 1) throw e;
      return await attempt(`\n\n[Your previous output failed to parse: ${String(e).slice(0, 150)}. Output ONLY valid JSON matching the requested shape.]`);
    }
  },
};
