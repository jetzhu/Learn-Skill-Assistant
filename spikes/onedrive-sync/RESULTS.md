# Spike-3 结果：OneDrive App Folder 同步协议闭环 ✅

日期：2026-08-30 · 账户：个人 Microsoft 账户（消费者 OneDrive）· scope：仅 `Files.ReadWrite.AppFolder` · 脚本：`protocol-test.mjs`（设备码登录，测试后令牌即删）

## 判定：通过 —— StorageProvider 需要的三个并发/增量原语在消费者 OneDrive 上全部实测可用

| # | 协议问题 | 实测结果 |
|---|---|---|
| 1 | **乐观并发（If-Match/eTag）**——技术评审时的存疑项 | ✅ **确证可用**：当前 eTag 条件更新 → 200 并返回新 eTag；过期 eTag → **412 Precondition Failed**。可变文档（MemoryState 快照、设置）的并发控制原语成立 |
| 2 | **追加型分片的无锁创建**（`@microsoft.graph.conflictBehavior=fail`） | ✅ 首次创建 201，重复创建 **409 nameAlreadyExists**——ReviewLog「按会话分片、只创建不覆盖」的设计可以完全无锁 |
| 3 | **delta 增量拉取**（`/me/drive/items/{approot-id}/delta`） | ✅ 初始全量 + deltaLink；新上传文件后用 deltaLink 拉取只返回变化条目（约 3 秒索引延迟内即可见） |
| 4 | App Folder 定位 | ✅ `GET /me/drive/special/approot` 自动创建，文件夹以应用名命名（本测试中为登录所用公共客户端的名字；产品用自己的应用注册后即为产品名） |
| 5 | 操作延迟 | 单次 API 调用 1.0–1.8s——后台机会性同步（F7.4）完全够用，不适合放在训练交互路径上（与 N5 一致） |
| 6 | scope 最小化的副作用 | `Files.ReadWrite.AppFolder` 下 `GET /me/drive` 返回 **403**——Provider 实现不得依赖盘级元数据接口，一切操作走 `special/approot` 路径 |

## 计划外的两个真实边界发现（比预期问题更有价值）

1. **「云盘未开通」状态（F7.2 需处理）**：从未使用过 OneDrive 的新个人账户，所有 Graph 调用返回 **503 `serviceNotAvailable — User is pending provisioning`**（伴随长尾 504）。用户在浏览器打开 onedrive.com 一次即完成开通。→ Provider 必须识别该错误码并给出「请先打开 OneDrive 完成开通」的引导 + 退避重试，而不是当成普通网络错误。
2. **过期令牌的误导性错误**：消费者账户的不透明 access token 过期后，Graph 返回的是 **401 `InvalidAuthenticationToken — JWT is not well formed`**（而非「token expired」）。→ 令牌状态机（F7.4）应把**任何 401 一律视为「需要重授权」信号**，不要解析错误文本。

## 写给设计文档的同步协议契约（StorageProvider）

- **ReviewLog**：按会话分片（`reviewlog-{sessionId}.json`），`conflictBehavior=fail` 只创建——天然无冲突，多设备并发写各写各的分片，读取端合并去重（结合 spike-6 结论：MemoryState 本地重放重建，不上云）；
- **可变文档**（设置、技能包）：读取时记录 eTag → 条件写入 If-Match → 412 时拉取远端、三方合并或提示；
- **增量同步**：持久化 deltaLink，每次同步只拉变化；deltaLink 失效（410）时回退全量；
- **令牌状态机**：有效 → 调用；401 → 静默重授权（BFF refresh）→ 成功继续 / 失败转「待重连」状态（不弹窗，见 F7.4）；503 pending-provisioning → 引导开通 + 指数退避；
- 未覆盖项（开发期补）：浏览器端 MSAL 的令牌获取 UX（本测试用设备码流走的是原生客户端路径）、大文件分片上传会话（ReviewLog 分片体积小，暂不需要）。
