import type { FastifyInstance } from "fastify";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * 遥测端点（N8 无 ID 聚合模式）：只收白名单事件名，纯计数——
 * 无安装 ID、无自由文本、无时间以外的上下文；跨日指标由客户端本地算好以布尔事件上报。
 */

const WHITELIST = new Set([
  "activation_moment",
  "trial_complete",
  "session_complete",
  "d1_retained",
  "d7_retained",
  "welcome_back_session",
  "streak_7",
  "streak_30",
]);

const FILE = join(dirname(fileURLToPath(import.meta.url)), "..", ".data", "telemetry.json");

function load(): Record<string, Record<string, number>> {
  try {
    return JSON.parse(readFileSync(FILE, "utf8")) as Record<string, Record<string, number>>;
  } catch {
    return {};
  }
}

export function registerTelemetry(app: FastifyInstance): void {
  app.post("/api/t", async (req, reply) => {
    const event = (req.body as Record<string, unknown> | null)?.["event"];
    if (typeof event !== "string" || !WHITELIST.has(event)) {
      return reply.code(400).send({ error: "unknown event" }); // 事件名允许列表（N8）
    }
    const day = new Date().toISOString().slice(0, 10);
    const data = load();
    data[day] ??= {};
    data[day][event] = (data[day][event] ?? 0) + 1;
    mkdirSync(dirname(FILE), { recursive: true });
    writeFileSync(FILE, JSON.stringify(data, null, 2));
    return reply.send({ ok: true });
  });
  if (!existsSync(dirname(FILE))) mkdirSync(dirname(FILE), { recursive: true });
}
