/** 三档评分（F2.5），映射 FSRS Again/Hard/Good（F4.13）。 */
export type Grade = "fail" | "hesitant" | "fluent";
export type AnswerMode = "voice" | "keyboard" | "self";
/** learning/fluency 相不参与长期记忆估计（F4.1/F15）。 */
export type Phase = "learning" | "review" | "relearning" | "probe" | "fluency";

/** 唯一事实来源，只追加不修改（F4.10）。 */
export interface ReviewLogEntry {
  v: 1;
  /** ULID：时间有序，天然去重键。 */
  id: string;
  packId: string;
  cardId: string;
  sessionId: string;
  deviceId: string;
  /** ISO 8601 UTC */
  ts: string;
  phase: Phase;
  grade: Grade;
  /** review/relearning 相的计划到期时间；learning 相为 null。 */
  scheduledDue: string | null;
  answerMode: AnswerMode;
  /** 题面呈现 → 开始作答（ms）；自评模式为 null。 */
  retrievalLatencyMs: number | null;
  hintLevel: 0 | 1 | 2;
  /** 中文卡可选「声调没把握」标记，不影响调度档位。 */
  toneUnsure?: boolean;
}

/** 掌握度五级（F10.1）：新学→巩固中→已巩固→稳固→已内化。 */
export type MasteryTier = 0 | 1 | 2 | 3 | 4;

/** 派生缓存：由 ReviewLog 重放推导，可随时重建，不参与云同步（spike-6 结论）。 */
export interface MemoryState {
  cardId: string;
  packId: string;
  algo: "ladder-v1";
  /** 是否已毕业进入跨会话调度（F4.11：一次无提示成功提取）。 */
  graduated: boolean;
  /** 阶梯档位下标（ladder-v1 内部实现细节，可整体替换 F4.5）。 */
  rung: number;
  /** 下次到期 ISO；未毕业为 null（在会话内处理）。 */
  due: string | null;
  lastReview: string | null;
  /** 连续跨会话一次通过数；≥3 = 已巩固（F4.11）。 */
  consecutivePasses: number;
  /** 连续答错数（会话间累计），顽固卡检测（F4.12）。 */
  lapseStreak: number;
  /** 累计答错总数。 */
  totalLapses: number;
  /** 是否曾在计划间隔 ≥25 天的复习中通过（已内化）。 */
  passedMatureReview: boolean;
  masteryTier: MasteryTier;
}
