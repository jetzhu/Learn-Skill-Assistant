import type { MemoryState, ReviewLogEntry } from "./types.js";
import type { LadderConfig } from "./algo.js";
import { applyReview, computeTier, effectiveGrade, emptyState, intervalWithJitter } from "./algo.js";

/**
 * 唯一事实来源 → 派生状态（F4.5/spike-6）：
 * - learning/fluency/probe 相不参与长期记忆估计（F4.1）；
 * - learning 相唯一的作用是毕业判定（F4.11：一次无提示成功提取）；
 * - 确定性：同一份日志任意次重放结果逐字段一致（无随机源，抖动以 cardId 为种子）。
 */
export function deriveMemoryState(
  logs: readonly ReviewLogEntry[],
  cfg: LadderConfig,
): Map<string, MemoryState> {
  const sorted = [...logs].sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : a.id < b.id ? -1 : 1));
  const states = new Map<string, MemoryState>();

  for (const e of sorted) {
    const key = e.cardId;
    let s = states.get(key);
    if (!s) {
      s = emptyState(e.packId, e.cardId);
      states.set(key, s);
    }

    if (e.phase === "fluency" || e.phase === "probe") continue;

    const tsMs = Date.parse(e.ts);

    if (!s.graduated) {
      // 毕业判定：无提示成功提取（任何相；正常流程中为 learning 相）
      if (effectiveGrade(e.grade, e.hintLevel) !== "fail") {
        const next: MemoryState = {
          ...s,
          graduated: true,
          rung: 0,
          lastReview: new Date(tsMs).toISOString(),
          due: new Date(tsMs + intervalWithJitter(cfg, 0, s.cardId)).toISOString(),
        };
        next.masteryTier = computeTier(next, cfg);
        states.set(key, next);
      }
      continue;
    }

    if (e.phase === "learning") continue; // 已毕业后的会话内重现不计入（F4.1）

    states.set(key, applyReview(s, e.grade, e.hintLevel, tsMs, cfg));
  }
  return states;
}
