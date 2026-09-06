import type { FastifyInstance } from "fastify";
import { config } from "./config.js";
import { freshToken } from "./auth.js";

/**
 * OneDrive App Folder 代理（DESIGN §5.1/§5.4；语义按 spike-3 实测）：
 * 令牌不出后端（F6.5）；仅 special/approot 路径，最小 scope（F7.6）；
 * 任何 401 → reauth-required；503 pending provisioning → provisioning（F7.2）。
 */

const G = "https://graph.microsoft.com/v1.0/me/drive/special/approot";

/** 路径白名单：仅存储布局内的相对路径（防穿越）。 */
function safePath(p: unknown): string | null {
  if (typeof p !== "string") return null;
  if (!/^[a-zA-Z0-9._/-]{1,200}$/.test(p) || p.includes("..") || p.startsWith("/")) return null;
  return p;
}

type DriveOutcome<T> = { ok: true; data: T } | { ok: false; status: "reauth-required" | "provisioning" | "error"; code: number };

async function graph(
  token: string,
  method: string,
  url: string,
  opts: { body?: string | Buffer; headers?: Record<string, string> } = {},
): Promise<DriveOutcome<{ status: number; json: unknown }>> {
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(opts.headers ?? {}) },
    ...(opts.body !== undefined ? { body: opts.body } : {}),
  });
  if (res.status === 401) return { ok: false, status: "reauth-required", code: 401 };
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  if (res.status === 503 || res.status === 504) {
    const msg = JSON.stringify(json ?? "");
    if (msg.includes("provision")) return { ok: false, status: "provisioning", code: res.status };
  }
  return { ok: true, data: { status: res.status, json } };
}

export function registerDrive(app: FastifyInstance): void {
  app.addHook("preHandler", async (req, reply) => {
    if (!req.url.startsWith("/api/drive/")) return;
    const tokens = await freshToken(req.session.lsa?.drive, config.ms.driveScopes);
    if (!tokens) return reply.code(401).send({ status: "reauth-required" });
    req.session.lsa = { ...(req.session.lsa ?? {}), drive: tokens };
    (req as unknown as { driveToken: string }).driveToken = tokens.accessToken;
  });

  const tok = (req: unknown) => (req as { driveToken: string }).driveToken;

  app.get("/api/drive/status", async (req, reply) => {
    const r = await graph(tok(req), "GET", G);
    if (!r.ok) return reply.code(r.code).send({ status: r.status });
    return reply.send({ status: "ready" });
  });

  /** 追加型分片：只创建不覆盖（conflictBehavior=fail，已存在幂等成功——spike-3 契约）。 */
  app.put("/api/drive/shard", async (req, reply) => {
    const path = safePath((req.query as Record<string, unknown>)["path"]);
    if (!path) return reply.code(400).send({ error: "bad path" });
    const r = await graph(
      tok(req),
      "PUT",
      `${G}:/${path}:/content?@microsoft.graph.conflictBehavior=fail`,
      { body: JSON.stringify(req.body ?? {}), headers: { "Content-Type": "application/json" } },
    );
    if (!r.ok) return reply.code(r.code).send({ status: r.status });
    if (r.data.status === 409) return reply.send({ ok: true, existed: true }); // 幂等
    if (r.data.status >= 400) return reply.code(r.data.status).send({ error: r.data.json });
    return reply.send({ ok: true, existed: false });
  });

  /** delta 增量（cursor=deltaLink token；无 cursor 为初始全量）。 */
  app.get("/api/drive/changes", async (req, reply) => {
    const q = req.query as Record<string, string>;
    let url = q["cursor"] ? decodeURIComponent(q["cursor"]) : `${G}/delta`;
    if (q["cursor"] && !url.startsWith("https://graph.microsoft.com/")) {
      return reply.code(400).send({ error: "bad cursor" });
    }
    const entries: { path: string; etag: string; size: number; deleted?: boolean }[] = [];
    for (let page = 0; page < 20; page++) {
      const r = await graph(tok(req), "GET", url);
      if (!r.ok) return reply.code(r.code).send({ status: r.status });
      if (r.data.status === 410) return reply.send({ resync: true }); // 游标失效 → 客户端清 cursor 重来
      const data = r.data.json as {
        value?: { name?: string; eTag?: string; size?: number; deleted?: unknown; file?: unknown; parentReference?: { path?: string } }[];
        "@odata.nextLink"?: string;
        "@odata.deltaLink"?: string;
      };
      for (const v of data.value ?? []) {
        if (!v.file && !v.deleted) continue; // 只关心文件
        const parent = v.parentReference?.path ?? "";
        const sub = parent.split("approot")[1]?.replace(/^[:/]+/, "") ?? "";
        const rel = sub ? `${sub}/${v.name ?? ""}` : (v.name ?? "");
        entries.push({ path: rel, etag: v.eTag ?? "", size: v.size ?? 0, ...(v.deleted ? { deleted: true } : {}) });
      }
      if (data["@odata.nextLink"]) {
        url = data["@odata.nextLink"];
        continue;
      }
      return reply.send({ entries, cursor: data["@odata.deltaLink"] ?? "" });
    }
    return reply.code(500).send({ error: "delta pagination overflow" });
  });

  app.get("/api/drive/file", async (req, reply) => {
    const path = safePath((req.query as Record<string, unknown>)["path"]);
    if (!path) return reply.code(400).send({ error: "bad path" });
    const r = await graph(tok(req), "GET", `${G}:/${path}:/content`);
    if (!r.ok) return reply.code(r.code).send({ status: r.status });
    if (r.data.status === 404) return reply.code(404).send({ error: "not found" });
    const meta = await graph(tok(req), "GET", `${G}:/${path}?$select=eTag`);
    const etag = meta.ok ? ((meta.data.json as { eTag?: string }).eTag ?? "") : "";
    return reply.send({ body: r.data.json, etag });
  });

  /** 可变文档：If-Match 乐观并发（412 → 返回远端当前内容供合并，spike-3 契约）。 */
  app.put("/api/drive/file", async (req, reply) => {
    const path = safePath((req.query as Record<string, unknown>)["path"]);
    if (!path) return reply.code(400).send({ error: "bad path" });
    const etag = req.headers["if-match"];
    const r = await graph(tok(req), "PUT", `${G}:/${path}:/content`, {
      body: JSON.stringify(req.body ?? {}),
      headers: {
        "Content-Type": "application/json",
        ...(typeof etag === "string" && etag ? { "If-Match": etag } : {}),
      },
    });
    if (!r.ok) return reply.code(r.code).send({ status: r.status });
    if (r.data.status === 412) {
      const cur = await graph(tok(req), "GET", `${G}:/${path}:/content`);
      const meta = await graph(tok(req), "GET", `${G}:/${path}?$select=eTag`);
      return reply.code(409).send({
        conflict: {
          body: cur.ok ? cur.data.json : null,
          etag: meta.ok ? ((meta.data.json as { eTag?: string }).eTag ?? "") : "",
        },
      });
    }
    if (r.data.status >= 400) return reply.code(r.data.status).send({ error: r.data.json });
    return reply.send({ ok: true, etag: (r.data.json as { eTag?: string }).eTag ?? "" });
  });

  app.delete("/api/drive/file", async (req, reply) => {
    const path = safePath((req.query as Record<string, unknown>)["path"]);
    if (!path) return reply.code(400).send({ error: "bad path" });
    const r = await graph(tok(req), "DELETE", `${G}:/${path}:`);
    if (!r.ok) return reply.code(r.code).send({ status: r.status });
    return reply.send({ ok: true });
  });
}
