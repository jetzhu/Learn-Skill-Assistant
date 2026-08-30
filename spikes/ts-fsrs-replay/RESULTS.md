# Spike-6 结果：ts-fsrs v5 重放验证 ✅

日期：2026-08-30 · 环境：Node v24.14.0 / ts-fsrs 5.4.1 / Windows 11 · 脚本：`replay.mjs`

## 判定：通过 —— 「完整 ReviewLog 重放推导 MemoryState」架构可行，schema 无障碍

| # | 验证项 | 结果 |
|---|---|---|
| 1 | API 形状：`createEmptyCard` → 逐条 `f.next(card, ts, grade)` 折叠即重放 | ✅ 与 F4.5「引擎输入为完整日志序列」直接吻合 |
| 2 | 答错折减不清零（F4.3） | ✅ 稳定性 187 天的成熟卡答错 → stability 折减为 4.5（非归零）→ 重学步骤 10 分钟 → 通过后新间隔 4 天（新卡初始约 0.5 天） |
| 3 | 重放确定性 | ✅ 两次重放逐卡一致——**前提：`enable_fuzz: false`**（见发现 1） |
| 4 | 性能 | ✅ ~30 万次 `next()`/秒：1000 卡×20 复习 = 66ms；10000 卡×30 = 978ms。单用户全量重放远低于预算，无需快照+增量 |
| 5 | 三档评分映射（F4.13：没答出→Again，犹豫→Hard，流畅→Good，Easy 不用） | ✅ 全部有效 |
| 6 | ts-fsrs 自带 ReviewLog 与我们 ReviewLog 的关系 | ✅ 其 log 字段（rating/state/due/stability/difficulty/elapsed_days/scheduled_days/learning_steps/review）均可由我们的字段推导，**无需双写两套日志** |

## 设计输入（写给设计文档）

1. **fuzz 必须关闭或持久化种子**：`generatorParameters({ enable_fuzz: false })`——否则重放不确定，同一份 ReviewLog 两次推导出不同 MemoryState，破坏「日志为唯一事实源」。若要间隔抖动（防复习日堆叠），应在会话编排层做确定性抖动（以卡片 ID 为种子），不在算法层开 fuzz。
2. **重放即缓存失效策略**：性能数据表明可以「MemoryState 仅作为内存缓存，启动时全量重放重建」，云端只同步 ReviewLog——彻底回避 MemoryState 的同步冲突问题（对 spike-3 的冲突契约是重大简化）。
3. **答错后的分钟级重学步骤**（FSRS 内建）与 F4.1 的会话内 learning steps 语义天然一致，无需在其上另造机制。
4. 冷启动固定阶梯 → FSRS 的切换：同一 ReviewLog 重放即可完成迁移，验证了 F4.2 的「无损切换」承诺。
