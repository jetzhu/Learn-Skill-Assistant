import { create } from "zustand";
import {
  DEFAULT_LADDER,
  DEFAULT_SESSION,
  DAY_MS,
  buildSession,
  buildTrialSession,
  createRuntime,
  answer as runtimeAnswer,
  abandon,
  deriveMemoryState,
  makeIdFactory,
  recordAchievement,
  validateSkillPack,
  EMPTY_STREAK,
  type AnswerEvent,
  type MemoryState,
  type ReviewLogEntry,
  type RuntimeState,
  type SessionPlan,
  type SkillPack,
  type StreakState,
  type Vacation,
} from "@lsa/core";
import { builtinPackData } from "@lsa/content-packs";
import { allLogs, appendLog, enqueueShard, getSetting, setSetting, tryPersist } from "./db.js";
import { syncNow, type SyncStatus } from "./cloud/sync.js";
import { initTelemetryGate, markActivated, track, trackOnce, checkRetentionEvents } from "./telemetry.js";

const makeId = makeIdFactory();

/** 最小达标单元：≈5 张（F11.1）。 */
const DAILY_UNIT_ANSWERS = 5;

export interface Profile {
  deviceId: string;
  onboarded: boolean;
  learnPackId: string; // "zh-starter" | "en-speaking"
  uiLang: "en" | "zh";
  goalSlot: "morning" | "noon" | "evening" | "custom" | null;
}

interface SessionCtx {
  plan: SessionPlan;
  runtime: RuntimeState;
  trial: boolean;
  /** 会话开始时的状态快照（结束画面对比升档）。 */
  tiersBefore: Map<string, number>;
}

interface EndSummary {
  answered: number;
  fluentFirstTry: number;
  newGraduated: number;
  comebackCardIds: string[];
  upgradedCards: { cardId: string; from: number; to: number }[];
  dueTomorrow: number;
  tomorrowCardTarget: string | null;
  streak: StreakState;
  streakBroke: boolean;
  freezesConsumed: number;
  achievedToday: boolean;
}

interface AppState {
  ready: boolean;
  profile: Profile;
  packs: SkillPack[];
  logs: ReviewLogEntry[];
  states: Map<string, MemoryState>;
  streak: StreakState;
  vacation: Vacation | null;
  newIntroduced: { date: string; count: number };
  lastActivityAt: string | null;
  session: SessionCtx | null;
  endSummary: EndSummary | null;
  syncStatus: SyncStatus | null;

  init(): Promise<void>;
  runSync(): Promise<void>;
  completeOnboarding(learnPackId: string): Promise<void>;
  startSession(trial: boolean): void;
  submitAnswer(ev: Omit<AnswerEvent, "ts">): Promise<void>;
  quitSession(): Promise<void>;
  setGoalSlot(slot: Profile["goalSlot"]): Promise<void>;
  setUiLang(l: "en" | "zh"): Promise<void>;
  setVacation(v: Vacation | null): Promise<void>;
}

export function localDate(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function activePack(packs: SkillPack[], profile: Profile): SkillPack {
  return packs.find((p) => p.id === profile.learnPackId) ?? packs[0]!;
}

export const useApp = create<AppState>((set, get) => ({
  ready: false,
  profile: { deviceId: "", onboarded: false, learnPackId: "zh-starter", uiLang: "en", goalSlot: null },
  packs: [],
  logs: [],
  states: new Map(),
  streak: EMPTY_STREAK,
  vacation: null,
  newIntroduced: { date: "", count: 0 },
  lastActivityAt: null,
  session: null,
  endSummary: null,
  syncStatus: null,

  async runSync() {
    const status = await syncNow();
    if (status.mergedNew > 0) {
      // 远端有其他设备的分片 → 重新加载并重放（幂等合并，spike-6 模式）
      const logs = await allLogs();
      set({ logs, states: deriveMemoryState(logs, DEFAULT_LADDER) });
    }
    set({ syncStatus: status });
  },

  async init() {
    const packs = builtinPackData.map(validateSkillPack);
    const logs = await allLogs();
    const states = deriveMemoryState(logs, DEFAULT_LADDER);
    const profile =
      (await getSetting<Profile>("profile")) ??
      ({ deviceId: makeId(), onboarded: false, learnPackId: "zh-starter", uiLang: navigator.language.startsWith("zh") ? "zh" : "en", goalSlot: null } as Profile);
    if (!(await getSetting("profile"))) await setSetting("profile", profile);
    const streak = (await getSetting<StreakState>("streak")) ?? EMPTY_STREAK;
    const vacation = (await getSetting<Vacation | null>("vacation")) ?? null;
    const newIntroduced = (await getSetting<{ date: string; count: number }>("newIntroduced")) ?? { date: "", count: 0 };
    const lastActivityAt = (await getSetting<string>("lastActivityAt")) ?? null;
    void tryPersist();
    await initTelemetryGate();
    set({ ready: true, packs, logs, states, profile, streak, vacation, newIntroduced, lastActivityAt });
    void get().runSync(); // 启动时机会性同步（F7.4），失败静默
    void checkRetentionEvents(await getSetting<string>("firstSessionAt") ?? null);
  },

  async completeOnboarding(learnPackId) {
    const profile: Profile = {
      ...get().profile,
      onboarded: true,
      learnPackId,
      uiLang: learnPackId === "zh-starter" ? "en" : "zh",
    };
    await setSetting("profile", profile);
    set({ profile });
  },

  startSession(trial) {
    const { packs, states, profile, vacation, lastActivityAt, newIntroduced } = get();
    const pack = activePack(packs, profile);
    let plan: SessionPlan;
    if (trial) {
      plan = buildTrialSession(pack);
    } else {
      const today = localDate();
      const usedNew = newIntroduced.date === today ? newIntroduced.count : 0;
      plan = buildSession({
        states,
        packs: [pack],
        now: new Date(),
        cfg: { ...DEFAULT_SESSION, newCap: Math.max(0, DEFAULT_SESSION.newCap - usedNew) },
        lastActivityAt: lastActivityAt ? new Date(lastActivityAt) : null,
        vacation,
      });
    }
    const runtime = createRuntime(plan, { sessionId: makeId(), deviceId: get().profile.deviceId });
    const tiersBefore = new Map<string, number>();
    for (const it of plan.items) tiersBefore.set(it.cardId, states.get(it.cardId)?.masteryTier ?? 0);
    set({ session: { plan, runtime, trial, tiersBefore }, endSummary: null });
  },

  async submitAnswer(ev) {
    const ctx = get().session;
    if (!ctx) return;
    const before = ctx.runtime.logs.length;
    const runtime = runtimeAnswer(ctx.runtime, { ...ev, ts: new Date() }, makeId);
    const newLogs = runtime.logs.slice(before);
    for (const l of newLogs) await appendLog(l);
    set({ session: { ...ctx, runtime }, logs: [...get().logs, ...newLogs] });
    if (runtime.done) await finalize(get, set);
  },

  async quitSession() {
    const ctx = get().session;
    if (!ctx) return;
    set({ session: { ...ctx, runtime: abandon(ctx.runtime) } });
    await finalize(get, set);
  },

  async setGoalSlot(slot) {
    const profile = { ...get().profile, goalSlot: slot };
    await setSetting("profile", profile);
    set({ profile });
  },

  async setUiLang(l) {
    const profile = { ...get().profile, uiLang: l };
    await setSetting("profile", profile);
    set({ profile });
  },

  async setVacation(v) {
    await setSetting("vacation", v);
    set({ vacation: v });
  },
}));

async function finalize(get: () => AppState, set: (p: Partial<AppState>) => void): Promise<void> {
  const { logs, session, streak, vacation, newIntroduced, states: prevStates } = get();
  if (!session) return;
  const states = deriveMemoryState(logs, DEFAULT_LADDER);
  const now = new Date();
  const today = localDate(now);

  // 升档卡（F12.2 成长证据）
  const upgradedCards: EndSummary["upgradedCards"] = [];
  for (const [cardId, before] of session.tiersBefore) {
    const after = states.get(cardId)?.masteryTier ?? 0;
    if (after > before) upgradedCards.push({ cardId, from: before, to: after });
  }

  // 明日预告（F12.2）
  const tomorrowEnd = now.getTime() + 2 * DAY_MS;
  let dueTomorrow = 0;
  let tomorrowCardTarget: string | null = null;
  let bestRung = -1;
  const pack = activePack(get().packs, get().profile);
  for (const s of states.values()) {
    if (!s.graduated || !s.due) continue;
    const d = Date.parse(s.due);
    if (d > now.getTime() && d <= tomorrowEnd) {
      dueTomorrow++;
      if (s.rung > bestRung) {
        bestRung = s.rung;
        tomorrowCardTarget = pack.cards.find((c) => c.id === s.cardId)?.target ?? null;
      }
    }
  }

  // streak（F11）：达标 = 本次会话作答 ≥ 最小单元，或体验会话完成
  const answered = session.runtime.stats.answered;
  const achievedToday = answered >= DAILY_UNIT_ANSWERS || (session.trial && answered > 0);
  let streakUpdate = { state: streak, freezesConsumed: 0, broke: false, freezeAwarded: false };
  if (achievedToday) {
    let exempt = 0;
    if (vacation && streak.lastAchievedDate) {
      const from = Math.max(Date.parse(vacation.from), Date.parse(streak.lastAchievedDate + "T00:00:00Z"));
      const to = Math.min(Date.parse(vacation.to), now.getTime());
      exempt = Math.max(0, Math.round((to - from) / DAY_MS));
    }
    streakUpdate = recordAchievement(streak, today, exempt);
    await setSetting("streak", streakUpdate.state);
  }

  // 每日新卡计数（F4.4 跨会话累计）
  const introducedThisSession = new Set(
    session.runtime.logs.filter((l) => l.phase === "learning").map((l) => l.cardId),
  ).size;
  const usedBefore = newIntroduced.date === today ? newIntroduced.count : 0;
  const ni = { date: today, count: usedBefore + introducedThisSession };
  await setSetting("newIntroduced", ni);
  await setSetting("lastActivityAt", now.toISOString());

  // 会话分片入队（每设备每会话一个分片，create-only 无锁——spike-3 契约）
  if (session.runtime.logs.length > 0) {
    await enqueueShard(
      `reviewlog/${session.runtime.deviceId}-${session.runtime.sessionId}.json`,
      session.runtime.logs,
    );
    void get().runSync(); // 会话结束触发同步（F7.4），失败静默留队列
  }

  // 遥测（N8/N11 时序：首训完成后才开闸，无 ID、纯计数事件）
  if (answered > 0) {
    if (!(await getSetting<string>("firstSessionAt"))) await setSetting("firstSessionAt", now.toISOString());
    await markActivated();
    if (session.trial) {
      track("trial_complete");
      if (session.runtime.stats.comebackCardIds.length > 0) track("activation_moment"); // F9.5 重现闭环
    } else {
      track("session_complete");
    }
    if (streakUpdate.state.current === 7) void trackOnce("streak_7");
    if (streakUpdate.state.current === 30) void trackOnce("streak_30");
  }

  const stats = session.runtime.stats;
  set({
    states,
    streak: streakUpdate.state,
    newIntroduced: ni,
    lastActivityAt: now.toISOString(),
    session: null,
    endSummary: {
      answered,
      fluentFirstTry: stats.fluentFirstTry,
      newGraduated: stats.newGraduated,
      comebackCardIds: stats.comebackCardIds,
      upgradedCards,
      dueTomorrow,
      tomorrowCardTarget,
      streak: streakUpdate.state,
      streakBroke: streakUpdate.broke,
      freezesConsumed: streakUpdate.freezesConsumed,
      achievedToday,
    },
  });
  void prevStates;
}
