import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

function loadDotEnv(): void {
  const path = join(dirname(fileURLToPath(import.meta.url)), "..", ".env");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = /^([A-Z_]+)=(.*)$/.exec(line.trim());
    if (m && m[1] && process.env[m[1]] === undefined) process.env[m[1]] = m[2] ?? "";
  }
}
loadDotEnv();

export const config = {
  port: Number(process.env["PORT"] ?? 8787),
  /** MVP 网络边界（F8.7）：仅 loopback。 */
  host: "127.0.0.1",
  sessionSecret: process.env["SESSION_SECRET"] ?? "dev-only-secret-change-me-0123456789abcdef",
  ms: {
    clientId: process.env["MS_CLIENT_ID"] ?? "",
    clientSecret: process.env["MS_CLIENT_SECRET"] ?? "",
    authority: "https://login.microsoftonline.com/consumers", // 个人账户（F7.2）
    redirectPath: "/auth/microsoft/callback",
    identityScopes: "openid profile email offline_access",
    driveScopes: "https://graph.microsoft.com/Files.ReadWrite.AppFolder offline_access",
  },
  claude: {
    exe: process.env["CLAUDE_EXE"] ?? "",
    model: process.env["CLAUDE_MODEL"] ?? "haiku",
  },
} as const;
