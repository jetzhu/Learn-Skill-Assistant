import type { MemoryState } from "./types.js";
import type { SkillPack, Card } from "./schema.js";
import { DAY_MS } from "./algo.js";

export interface SessionConfig {
  /** 单次会话到期卡上限（F4.7，默认 25）。 */
  dueCap: number;
  /** 每日新卡上限（F4.4，默认 8）。 */
  newCap: number;
  /** 中断多少天后进入回归模式（F4.8）。 */
  welcomeBackAfterDays: number;
  /** 回归会话取最有把握的卡数。 */
  welcomeBackPick: number;
  /** 开口时限（秒）：learning 相按目标语言，review 相统一（SKILL_PACKS_V1 4.2）。 */
  answerWindows: { learningZh: number; learningDefault: number; review: number };
}

export const DEFAULT_SESSION: SessionConfig = {
  dueCap: 25,
  newCap: 8,
  welcomeBackAfterDays: 4,
  welcomeBackPick: 12,
  answerWindows: { learningZh: 8, learningDefault: 7, review: 5 },
};

export interface Vacation {
  from: string; // ISO date
  to: string;
}

export interface SessionPlanItem {
  packId: string;
  cardId: string;
  skillId: string;
  kind: "review" | "new";
  answerWindowSec: number;
}

export interface SessionPlan {
  mode: "normal" | "welcome-back" | "vacation" | "empty";
  items: SessionPlanItem[];
  /** 今日实际入队的到期数（F4.7：永不暴露总积压，接口上就不提供）。 */
  dueTodayCount: number;
  newCount: number;
  estMinutes: number;
}

/** 假期顺延（F4.9）：到期时间落在假期内的部分向后顺延。 */
export function effectiveDueMs(dueMs: number, vacation: Vacation | null): number {
  if (!vacation) return dueMs;
  const from = Date.parse(vacation.from);
  const to = Date.parse(vacation.to);
  if (Number.isNaN(from) || Number.isNaN(to) || to <= from) return dueMs;
  if (dueMs >= to) return dueMs;
  if (dueMs < from) return dueMs;
  return to + (dueMs - from); // 假期内到期 → 顺延假期剩余时长
}

function answerWindow(card: Card, pack: SkillPack, kind: "review" | "new", cfg: SessionConfig): number {
  if (kind === "review") return cfg.answerWindows.review;
  const lang = pack.ext?.lang?.targetLanguage ?? "";
  return lang.startsWith("zh") ? cfg.answerWindows.learningZh : cfg.answerWindows.learningDefault;
}

/** 贪心重排：相邻卡 skillId 不同（F3.4 交错约束）；无法满足时保持原序。 */
export function interleaveBySkill(items: SessionPlanItem[]): SessionPlanItem[] {
  const out = [...items];
  for (let i = 1; i < out.length; i++) {
    if (out[i]!.skillId !== out[i - 1]!.skillId) continue;
    let swapped = false;
    for (let j = i + 1; j < out.length; j++) {
      if (out[j]!.skillId !== out[i - 1]!.skillId && (i + 1 >= out.length || out[j]!.skillId !== out[i + 1]?.skillId)) {
        [out[i], out[j]] = [out[j]!, out[i]!];
        swapped = true;
        break;
      }
    }
    if (!swapped) break;
  }
  return out;
}

export function buildSession(input: {
  states: Map<string, MemoryState>;
  packs: SkillPack[];
  now: Date;
  cfg?: SessionConfig;
  lastActivityAt: Date | null;
  vacation: Vacation | null;
}): SessionPlan {
  const cfg = input.cfg ?? DEFAULT_SESSION;
  const nowMs = input.now.getTime();

  // 假期中：不出题、不积压（F4.9）
  if (input.vacation) {
    const from = Date.parse(input.vacation.from);
    const to = Date.parse(input.vacation.to);
    if (nowMs >= from && nowMs < to) {
      return { mode: "vacation", items: [], dueTodayCount: 0, newCount: 0, estMinutes: 0 };
    }
  }

  const cardIndex = new Map<string, { card: Card; pack: SkillPack }>();
  for (const pack of input.packs) {
    for (const card of pack.cards) {
      if (card.retired || card.isProbe || card.cardType !== "recall-output") continue;
      cardIndex.set(card.id, { card, pack });
    }
  }

  // 到期复习卡：按「逾期时间/间隔」比例排序（F4.4）
  const due: { item: SessionPlanItem; ratio: number; rung: number }[] = [];
  for (const s of input.states.values()) {
    if (!s.graduated || !s.due) continue;
    const entry = cardIndex.get(s.cardId);
    if (!entry) continue;
    const dueMs = effectiveDueMs(Date.parse(s.due), input.vacation);
    if (dueMs > nowMs) continue;
    const lastMs = s.lastReview ? Date.parse(s.lastReview) : dueMs - DAY_MS;
    const intervalMs = Math.max(DAY_MS, dueMs - lastMs);
    due.push({
      item: {
        packId: s.packId,
        cardId: s.cardId,
        skillId: entry.card.skillId,
        kind: "review",
        answerWindowSec: answerWindow(entry.card, entry.pack, "review", cfg),
      },
      ratio: (nowMs - dueMs) / intervalMs,
      rung: s.rung,
    });
  }

  // 回归模式（F4.8）：中断 ≥N 天且积压超上限 → 只取最有把握的卡，暂停新卡
  const idleDays = input.lastActivityAt ? (nowMs - input.lastActivityAt.getTime()) / DAY_MS : 0;
  if (idleDays >= cfg.welcomeBackAfterDays && due.length > cfg.dueCap) {
    const picked = [...due].sort((a, b) => b.rung - a.rung).slice(0, cfg.welcomeBackPick);
    const items = interleaveBySkill(picked.map((d) => d.item));
    return {
      mode: "welcome-back",
      items,
      dueTodayCount: items.length,
      newCount: 0,
      estMinutes: Math.max(1, Math.round((items.length * 20) / 60)),
    };
  }

  const reviews = [...due].sort((a, b) => b.ratio - a.ratio).slice(0, cfg.dueCap).map((d) => d.item);

  // 新卡：未毕业的卡按包内顺序（F4.4 日上限；由调用方保证当天只 build 一次或自行扣减）
  const news: SessionPlanItem[] = [];
  for (const pack of input.packs) {
    for (const card of pack.cards) {
      if (news.length >= cfg.newCap) break;
      if (card.retired || card.isProbe || card.cardType !== "recall-output") continue;
      const s = input.states.get(card.id);
      if (s?.graduated) continue;
      news.push({
        packId: pack.id,
        cardId: card.id,
        skillId: card.skillId,
        kind: "new",
        answerWindowSec: answerWindow(card, pack, "new", cfg),
      });
    }
  }

  // 合并：新卡均匀插入复习流，再做交错约束
  const merged: SessionPlanItem[] = [];
  const gap = news.length > 0 ? Math.max(1, Math.floor((reviews.length + news.length) / (news.length + 1))) : 0;
  let ni = 0;
  for (let i = 0; i < reviews.length; i++) {
    merged.push(reviews[i]!);
    if (ni < news.length && (i + 1) % gap === 0) merged.push(news[ni++]!);
  }
  while (ni < news.length) merged.push(news[ni++]!);

  const items = interleaveBySkill(merged);
  const mode = items.length === 0 ? "empty" : "normal";
  return {
    mode,
    items,
    dueTodayCount: reviews.length,
    newCount: news.length,
    estMinutes: Math.max(items.length ? 1 : 0, Math.round((items.length * 20) / 60)),
  };
}
