// Spike-5: Claude CLI 作为 LLMProvider 后端的适配性验证
// 按 F8.10 约束实现：spawn 无 shell、提示词经 stdin、超时与输出上限
// 判定标准（附录 D）：LLMProvider 接口以 API 能力为基准冻结；CLI Provider 只是其中一个实现
import { spawn } from "node:child_process";

const EXE = "C:/home/jetzhu/.npm-global/node_modules/@anthropic-ai/claude-code/bin/claude.exe";
const MODEL = "haiku"; // 省额度；进程启动开销与模型无关，是本 spike 的主要问题

function run(args, stdinText, { timeoutMs = 120000, lineTimestamps = false } = {}) {
  return new Promise((resolve, reject) => {
    const t0 = performance.now();
    const p = spawn(EXE, args, { shell: false, windowsHide: true });
    let firstByte = 0, out = "", err = "", buf = "";
    const lines = [];
    p.stdout.on("data", (d) => {
      const now = performance.now() - t0;
      if (!firstByte) firstByte = now;
      out += d;
      if (lineTimestamps) {
        buf += d;
        let i;
        while ((i = buf.indexOf("\n")) >= 0) {
          lines.push({ ms: Math.round(now), line: buf.slice(0, i) });
          buf = buf.slice(i + 1);
        }
      }
    });
    p.stderr.on("data", (d) => (err += d));
    const to = setTimeout(() => { p.kill(); reject(new Error("timeout; stderr=" + err.slice(0, 400))); }, timeoutMs);
    p.on("error", (e) => { clearTimeout(to); reject(e); });
    p.on("close", (code) => {
      clearTimeout(to);
      resolve({ code, out, err, firstByte: Math.round(firstByte), total: Math.round(performance.now() - t0), lines });
    });
    if (stdinText != null) p.stdin.write(stdinText);
    p.stdin.end();
  });
}

console.log("=== Spike-5: Claude CLI 适配验证 ===\n");

// [0] 进程启动基线（无网络推理）
{
  const r = await run(["--version"], null, { timeoutMs: 30000 });
  console.log("[0] 进程启动基线 (--version): %dms → %s", r.total, r.out.trim());
}

// [A] JSON 信封 + stdin 传提示词（教练单轮的基本形态）
{
  const r = await run(["-p", "--output-format", "json", "--model", MODEL],
                      "Reply with exactly: OK");
  let env = null; try { env = JSON.parse(r.out); } catch {}
  console.log("\n[A] -p --output-format json（stdin 提示词）:");
  console.log("    进程总耗时 %dms · 首字节 %dms · 退出码 %d", r.total, r.firstByte, r.code);
  if (env) {
    console.log("    信封字段: %s", Object.keys(env).join(", "));
    console.log("    result=%j · CLI 内部 duration_ms=%s · cost_usd=%s · is_error=%s",
      env.result, env.duration_ms, env.total_cost_usd, env.is_error);
  } else console.log("    ⚠️ stdout 非 JSON: %s / stderr: %s", r.out.slice(0, 200), r.err.slice(0, 200));
}

// [B] stream-json 流式（教练对话的流式体验）
{
  const r = await run(["-p", "--output-format", "stream-json", "--verbose",
                       "--include-partial-messages", "--model", MODEL],
                      "Count from 1 to 5, one number per line.",
                      { lineTimestamps: true });
  console.log("\n[B] -p --output-format stream-json --include-partial-messages:");
  console.log("    进程总耗时 %dms · 首事件 %dms · 事件行数 %d", r.total, r.firstByte, r.lines.length);
  let firstDelta = null, types = new Map();
  for (const { ms, line } of r.lines) {
    if (!line.trim()) continue;
    try {
      const ev = JSON.parse(line);
      const key = ev.type + (ev.event?.type ? ":" + ev.event.type : "");
      types.set(key, (types.get(key) || 0) + 1);
      if (firstDelta === null && (ev.event?.type === "content_block_delta" ||
          (ev.type === "assistant" && !ev.event))) firstDelta = ms;
    } catch { types.set("(non-json)", (types.get("(non-json)") || 0) + 1); }
  }
  console.log("    首个文本增量事件: %sms", firstDelta ?? "未捕获");
  console.log("    事件类型分布: %s", [...types].map(([k, v]) => k + "×" + v).join(", "));
}

// [C] 结构化输出（F3 变体生成的形态）：只要 JSON，能否稳定解析
{
  const prompt = 'For the English sentence "I need more time", generate exactly 2 scenario-variant flashcards for Chinese learners. Output ONLY a JSON array, no markdown fences, each item: {"context":"<Chinese scenario description>","target":"<English sentence variant>"}';
  const r = await run(["-p", "--output-format", "json", "--model", MODEL], prompt);
  let env = null, parsed = null;
  try { env = JSON.parse(r.out); } catch {}
  if (env?.result) { try { parsed = JSON.parse(env.result); } catch {} }
  console.log("\n[C] 结构化输出（变体生成 JSON）:");
  console.log("    进程总耗时 %dms · result 可直接 JSON.parse: %s", r.total, parsed ? "✅" : "❌");
  if (parsed) console.log("    样例: %j", parsed[0]);
  else if (env) console.log("    原始 result 前 200 字符: %s", String(env.result).slice(0, 200));
}

// [D] 连续两次调用（无常驻进程 → 每次都付启动成本；量化它）
{
  const t = [];
  for (let i = 0; i < 2; i++) {
    const r = await run(["-p", "--output-format", "json", "--model", MODEL], "Say: HI");
    let env = null; try { env = JSON.parse(r.out); } catch {}
    t.push({ total: r.total, api: env?.duration_api_ms ?? env?.duration_ms ?? "?" });
  }
  console.log("\n[D] 连续调用开销: %s", t.map(x => `总${x.total}ms(内部${x.api}ms)`).join(" · "));
  console.log("    → 进程启动+初始化开销 ≈ 总耗时 − 内部推理耗时");
}
