import Fastify from "fastify";
import fastifyCookie from "@fastify/cookie";
import fastifySession from "@fastify/session";
import { config } from "./config.js";
import { registerAuth } from "./auth.js";
import { registerDrive } from "./drive.js";
import { registerLlm } from "./llm.js";
import { registerTelemetry } from "./telemetry.js";

/**
 * BFF：OAuth 令牌保管 + Graph 代理 + LLM 代理。
 * - 仅监听 127.0.0.1（F8.7，MVP 网络边界）；
 * - 日志红线（N3）：不记录请求体/Authorization/Cookie，仅时间戳、路由、状态、时延。
 */
const app = Fastify({
  logger: {
    level: "info",
    serializers: {
      req(req) {
        return { method: req.method, url: req.url.split("?")[0] };
      },
      res(res) {
        return { statusCode: res.statusCode };
      },
    },
  },
  bodyLimit: 512 * 1024,
});

await app.register(fastifyCookie);
await app.register(fastifySession, {
  secret: config.sessionSecret.padEnd(32, "x"),
  cookie: { httpOnly: true, sameSite: "lax", secure: false, path: "/" }, // MVP: http://localhost
  saveUninitialized: false,
});

registerAuth(app);
registerDrive(app);
registerLlm(app);
registerTelemetry(app);

app.get("/healthz", async () => ({ ok: true }));

await app.listen({ host: config.host, port: config.port });
app.log.info(`BFF on http://${config.host}:${config.port} (loopback only, F8.7)`);
