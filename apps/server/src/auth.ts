import type { FastifyInstance } from "fastify";
import { createHash, randomBytes } from "node:crypto";
import { config } from "./config.js";

/**
 * BFF OAuth（F6.5/F6.7）：授权码 + PKCE，令牌只存服务端会话；浏览器仅 HttpOnly Cookie。
 * 登录仅请求身份 scope（F6.2）；云盘 scope 在用户选择云同步时增量请求（F7.7）。
 */

export interface TokenSet {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number; // epoch ms
  scope: string;
}

export interface SessionData {
  displayName?: string;
  identity?: TokenSet;
  drive?: TokenSet;
  pkce?: { verifier: string; flow: "identity" | "drive" };
}

declare module "fastify" {
  interface Session {
    lsa?: SessionData;
  }
}

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function makePkce(): { verifier: string; challenge: string } {
  const verifier = b64url(randomBytes(48));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

async function exchangeToken(params: Record<string, string>): Promise<TokenSet> {
  const body = new URLSearchParams({ client_id: config.ms.clientId, ...params });
  if (config.ms.clientSecret) body.set("client_secret", config.ms.clientSecret);
  const res = await fetch(`${config.ms.authority}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const data = (await res.json()) as Record<string, unknown>;
  if (!res.ok) throw new Error(`token exchange failed: ${String(data["error"] ?? res.status)}`);
  return {
    accessToken: String(data["access_token"]),
    refreshToken: (data["refresh_token"] as string | undefined) ?? null,
    expiresAt: Date.now() + Number(data["expires_in"] ?? 3600) * 1000 - 60_000,
    scope: String(data["scope"] ?? ""),
  };
}

/** 令牌状态机（F7.4/spike-3）：过期或 401 → 静默刷新；刷新失败 → 需重授权。 */
export async function freshToken(set: TokenSet | undefined, scopes: string): Promise<TokenSet | null> {
  if (!set) return null;
  if (Date.now() < set.expiresAt) return set;
  if (!set.refreshToken) return null;
  try {
    return await exchangeToken({
      grant_type: "refresh_token",
      refresh_token: set.refreshToken,
      scope: scopes,
    });
  } catch {
    return null;
  }
}

export function registerAuth(app: FastifyInstance): void {
  const redirectUri = (req: { protocol: string; host: string }) =>
    `${req.protocol}://${req.host}${config.ms.redirectPath}`;

  function startFlow(flow: "identity" | "drive") {
    return async (req: import("fastify").FastifyRequest, reply: import("fastify").FastifyReply) => {
      if (!config.ms.clientId) return reply.code(500).send({ error: "MS_CLIENT_ID not configured (.env)" });
      const { verifier, challenge } = makePkce();
      req.session.lsa = { ...(req.session.lsa ?? {}), pkce: { verifier, flow } };
      const scopes = flow === "identity" ? config.ms.identityScopes : config.ms.driveScopes;
      const url = new URL(`${config.ms.authority}/oauth2/v2.0/authorize`);
      url.search = new URLSearchParams({
        client_id: config.ms.clientId,
        response_type: "code",
        redirect_uri: redirectUri(req),
        scope: scopes,
        code_challenge: challenge,
        code_challenge_method: "S256",
        prompt: flow === "drive" ? "consent" : "select_account",
      }).toString();
      return reply.redirect(url.toString());
    };
  }

  app.get("/auth/microsoft/start", startFlow("identity"));
  app.get("/auth/drive/consent", startFlow("drive")); // 增量授权（F7.7）

  app.get(config.ms.redirectPath, async (req, reply) => {
    const q = req.query as Record<string, string>;
    const pkce = req.session.lsa?.pkce;
    if (!q["code"] || !pkce) return reply.code(400).send({ error: "missing code or pkce state" });
    const tokens = await exchangeToken({
      grant_type: "authorization_code",
      code: q["code"],
      redirect_uri: redirectUri(req),
      code_verifier: pkce.verifier,
      scope: pkce.flow === "identity" ? config.ms.identityScopes : config.ms.driveScopes,
    });
    const lsa: SessionData = { ...(req.session.lsa ?? {}) };
    delete lsa.pkce;
    if (pkce.flow === "identity") {
      lsa.identity = tokens;
      const idToken = tokens.accessToken; // 展示名从 Graph /me 取更稳，但需要额外 scope；MVP 用邮箱占位
      void idToken;
      lsa.displayName = "Microsoft account";
    } else {
      lsa.drive = tokens;
    }
    req.session.lsa = lsa;
    return reply.redirect("http://localhost:5173/#/settings");
  });

  app.post("/auth/logout", async (req, reply) => {
    await req.session.destroy();
    return reply.send({ ok: true });
  });

  app.get("/api/session", async (req, reply) => {
    const lsa = req.session.lsa;
    return reply.send({
      signedIn: !!lsa?.identity,
      idp: lsa?.identity ? "microsoft" : undefined,
      displayName: lsa?.displayName,
      driveConsented: !!lsa?.drive,
    });
  });
}
