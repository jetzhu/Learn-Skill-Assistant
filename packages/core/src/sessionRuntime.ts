import type { AnswerMode, Grade, ReviewLogEntry } from "./types.js";
import type { SessionPlan, SessionPlanItem } from "./sessionBuilder.js";
import { effectiveGrade } from "./algo.js";

/**
 * 会话运行时（纯 reducer，UI 层包一层状态管理）：
 * - 会话内 learning steps（F4.1）：新学/答错卡在 +3 / +8 位置重现，重现成绩只影响毕业与会话流；
 * - 每张卡产出 ReviewLogEntry（唯一事实来源，F4.10），由调用方持久化。
 */

export interface RuntimeItem extends SessionPlanItem {
  /** 会话内相：new→learning；review 首答→review；答错重现→relearning。 */
  phase: "learning" | "review" | "relearning";
  /** 第几次重插（0 = 首次呈现）。 */
  step: number;
}

export interface AnswerEvent {
  grade: Grade;
  answerMode: AnswerMode;
  retrievalLatencyMs: number | null;
  hintLevel: 0 | 1 | 2;
  toneUnsure?: boolean;
  /** 事件时间（注入时钟，N6）。 */
  ts: Date;
}

export interface SessionStats {
  answered: number;
  fluentFirstTry: number;
  reviewsPassed: number;
  reviewsFailed: number;
  newGraduated: number;
  /** 「上次没答出、本次流畅答对」峰值时刻卡（F12.3）。 */
  comebackCardIds: string[];
}

export interface RuntimeState {
  sessionId: string;
  deviceId: string;
  queue: RuntimeItem[];
  /** 指向当前卡；≥ queue.length 表示会话完成。 */
  idx: number;
  logs: ReviewLogEntry[];
  stats: SessionStats;
  done: boolean;
}

const REINSERT_OFFSETS = [3, 8] as const;

export function createRuntime(plan: SessionPlan, ids: { sessionId: string; deviceId: string }): RuntimeState {
  return {
    sessionId: ids.sessionId,
    deviceId: ids.deviceId,
    queue: plan.items.map((it) => ({ ...it, phase: it.kind === "new" ? "learning" : "review", step: 0 })),
    idx: 0,
    logs: [],
    stats: { answered: 0, fluentFirstTry: 0, reviewsPassed: 0, reviewsFailed: 0, newGraduated: 0, comebackCardIds: [] },
    done: false,
  };
}

export function currentCard(state: RuntimeState): RuntimeItem | null {
  return state.done ? null : (state.queue[state.idx] ?? null);
}

/** 提交当前卡的作答；makeId 注入保证可测试与 ULID 生成解耦。 */
export function answer(
  state: RuntimeState,
  ev: AnswerEvent,
  makeId: () => string,
): RuntimeState {
  const item = currentCard(state);
  if (!item) return state;

  const log: ReviewLogEntry = {
    v: 1,
    id: makeId(),
    packId: item.packId,
    cardId: item.cardId,
    sessionId: state.sessionId,
    deviceId: state.deviceId,
    ts: ev.ts.toISOString(),
    phase: item.phase,
    grade: ev.grade,
    scheduledDue: null,
    answerMode: ev.answerMode,
    retrievalLatencyMs: ev.retrievalLatencyMs,
    hintLevel: ev.hintLevel,
    ...(ev.toneUnsure !== undefined ? { toneUnsure: ev.toneUnsure } : {}),
  };

  const passed = effectiveGrade(ev.grade, ev.hintLevel) !== "fail";
  const queue = [...state.queue];
  const stats: SessionStats = { ...state.stats, answered: state.stats.answered + 1 };

  if (item.phase === "review") {
    if (passed) {
      stats.reviewsPassed += 1;
      if (ev.grade === "fluent" && ev.hintLevel === 0 && item.step === 0) stats.fluentFirstTry += 1;
    } else {
      stats.reviewsFailed += 1;
      reinsert(queue, state.idx, { ...item, phase: "relearning", step: item.step + 1 });
    }
  } else {
    // learning / relearning：通过即离队；未通过重插
    if (passed) {
      if (item.phase === "learning" && ev.hintLevel === 0) stats.newGraduated += 1;
      if (item.phase === "relearning" && ev.grade === "fluent") {
        stats.comebackCardIds = [...stats.comebackCardIds, item.cardId];
      }
    } else {
      reinsert(queue, state.idx, { ...item, step: item.step + 1 });
    }
  }

  const idx = state.idx + 1;
  return {
    ...state,
    queue,
    idx,
    logs: [...state.logs, log],
    stats,
    done: idx >= queue.length,
  };
}

function reinsert(queue: RuntimeItem[], idx: number, item: RuntimeItem): void {
  const offset = REINSERT_OFFSETS[Math.min(item.step - 1, REINSERT_OFFSETS.length - 1)] ?? 8;
  const pos = Math.min(idx + 1 + offset, queue.length);
  queue.splice(pos, 0, item);
}

/** 中途退出：已完成部分保留（F12.4）——logs 即为已保存进度。 */
export function abandon(state: RuntimeState): RuntimeState {
  return { ...state, done: true };
}
