# Spike-5 结果：Claude CLI 作为 LLMProvider 后端 ✅（带两个必须适配的发现）

日期：2026-08-30 · 环境：Claude Code 2.1.251（原生 claude.exe）/ Node v24 / Windows 11 · 模型：haiku · 脚本：`bench.mjs`

## 判定：机制可行——F8.10 的调用姿势全部验证通过；LLMProvider 接口按 Claude API 基准冻结的决策正确

| 验证项 | 结果 |
|---|---|
| Windows 无 shell 调用 | ✅ npm 垫片背后是**原生 `claude.exe`**，`spawn(exe, args, {shell:false})` 直接可用（注意：不能 spawn `.cmd` 垫片——Node 18.20+ 因 CVE-2024-27980 会抛 EINVAL） |
| stdin 传提示词（F8.10） | ✅ `-p` 从 stdin 读提示词正常 |
| JSON 信封（`--output-format json`） | ✅ 字段丰富：`result`、`duration_ms`/`duration_api_ms`、`ttft_ms`、`usage`、`total_cost_usd`、`is_error`、`session_id` 等——**每次调用的成本与用量可直接入账（服务 F8.8 配额）** |
| 流式（`--output-format stream-json --verbose --include-partial-messages`） | ✅ 输出标准事件流（`message_start` / `content_block_delta` × N / `message_stop` / `result`），可干净映射到 LLMProvider 流式接口；另有 `rate_limit_event` 可用于退避 |
| 进程启动基线 | `--version` 仅 64ms——慢的不是进程本身，是每次调用的会话初始化 |

## ⚠️ 发现 1：每次调用固定开销 ≈ 5–6 秒

连续两次最小调用：总耗时 6.1s / 7.4s，其中 CLI 内部推理仅 1.4s——**进程 + 会话初始化开销约 5–6 秒**，流式模式下首个文本增量事件在 ~8s 才到达。对教练对话的交互体验不可接受（对开发期批量生成类任务可接受）。

**适配建议（写给设计文档）**：
1. CLI Provider 采用**常驻进程模式**：`claude -p --input-format stream-json --output-format stream-json` 单进程多轮复用，把初始化成本摊到会话级（需在实现时验证多轮 stdin 协议）；
2. 尝试 `--strict-mcp-config`（跳过用户 MCP 服务器加载）压缩初始化时间；
3. 该开销**不影响接口设计**——Claude API Provider 无此开销，再次印证「接口以 API 能力为基准、CLI 只是适配实现」（F8.1）。

## ⚠️ 发现 2：结构化输出会带 markdown 围栏

变体生成测试中，尽管提示词明确要求「Output ONLY a JSON array, no markdown fences」，模型仍返回 ` ```json ... ``` ` 包裹的内容（内容本身是合法 JSON，中文情境质量良好）。

**适配建议**：LLMProvider 的结构化输出约定（F8.1）必须包含**围栏剥离 + JSON.parse + schema 校验**的后处理管线（与 F1.6(e) 的变体入库校验共用）；解析失败自动重试一次并在提示词附上错误信息。

## 成本记录

本 spike 共 5 次 haiku 调用，约 $0.07。
