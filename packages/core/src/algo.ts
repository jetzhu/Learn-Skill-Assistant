import type { Grade, MemoryState } from "./types.js";

export const DAY_MS = 86_400_000;

/** ladder-v1：冷启动固定阶梯（F4.2），定位为可整体替换的默认实现（F4.5）。 */
export interface LadderConfig {
  kind: "ladder-v1";
  /** 跨会话间隔阶梯（天）；首个间隔不早于次日（F4.2）。 */
  rungsDays: number[];
  /** 答错折减档数，不清零（F4.3）。 */
  failDrop: number;
  /** 确定性抖动幅度（防复习日堆叠）；以 cardId 为种子，不用算法层 fuzz（spike-6）。 */
  jitterPct: number;
  /** 视为「成熟复习」的间隔阈值（天）——通过即「已内化」（F10.1 tier 4）。 */
  matureDays: number;
}

export const DEFAULT_LADDER: LadderConfig = {
  kind: "ladder-v1",
  rungsDays: [1, 5, 25, 60, 120],
  failDrop: 2,
  jitterPct: 0.05,
  matureDays: 25,
};

/** FNV-1a 简易哈希 → [-1, 1)，确定性抖动种子。 */
export function cardJitter(cardId: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < cardId.length; i++) {
    h ^= cardId.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return ((h >>> 0) % 2000) / 1000 - 1;
}

export function intervalWithJitter(cfg: LadderConfig, rung: number, cardId: string): number {
  const days = cfg.rungsDays[Math.min(rung, cfg.rungsDays.length - 1)] ?? 1;
  const jittered = days * (1 + cfg.jitterPct * cardJitter(cardId));
  return Math.max(1, jittered) * DAY_MS;
}

/**
 * 用提示后的成功不算成功提取（F4.11 的调度语义延伸）：
 * 调度器看到的有效评分把 hintLevel>0 的通过降为 fail。
 */
export function effectiveGrade(grade: Grade, hintLevel: number): Grade {
  return hintLevel > 0 ? "fail" : grade;
}

/** 单次跨会话复习的状态转移（纯函数）。 */
export function applyReview(
  state: MemoryState,
  grade: Grade,
  hintLevel: number,
  tsMs: number,
  cfg: LadderConfig,
): MemoryState {
  const g = effectiveGrade(grade, hintLevel);
  const prevReviewMs = state.lastReview ? Date.parse(state.lastReview) : null;
  const elapsedDays = prevReviewMs !== null ? (tsMs - prevReviewMs) / DAY_MS : 0;

  let { rung, consecutivePasses, lapseStreak, totalLapses, passedMatureReview } = state;

  if (g === "fail") {
    rung = Math.max(0, rung - cfg.failDrop);
    consecutivePasses = 0;
    lapseStreak += 1;
    totalLapses += 1;
  } else {
    if (g === "fluent") rung = Math.min(rung + 1, cfg.rungsDays.length - 1);
    // hesitant：通过但不升档（间隔重复当前档）
    consecutivePasses += 1;
    lapseStreak = 0;
    if (elapsedDays >= cfg.matureDays) passedMatureReview = true;
  }

  const next: MemoryState = {
    ...state,
    rung,
    consecutivePasses,
    lapseStreak,
    totalLapses,
    passedMatureReview,
    lastReview: new Date(tsMs).toISOString(),
    due: new Date(tsMs + intervalWithJitter(cfg, rung, state.cardId)).toISOString(),
    masteryTier: 1,
  };
  next.masteryTier = computeTier(next, cfg);
  return next;
}

export function computeTier(s: MemoryState, cfg: LadderConfig): MemoryState["masteryTier"] {
  if (!s.graduated) return 0;
  if (s.passedMatureReview) return 4;
  if ((cfg.rungsDays[Math.min(s.rung, cfg.rungsDays.length - 1)] ?? 0) >= cfg.matureDays) return 3;
  if (s.consecutivePasses >= 3) return 2;
  return 1;
}

export function emptyState(packId: string, cardId: string): MemoryState {
  return {
    cardId,
    packId,
    algo: "ladder-v1",
    graduated: false,
    rung: 0,
    due: null,
    lastReview: null,
    consecutivePasses: 0,
    lapseStreak: 0,
    totalLapses: 0,
    passedMatureReview: false,
    masteryTier: 0,
  };
}
