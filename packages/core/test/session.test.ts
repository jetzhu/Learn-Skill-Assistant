import { describe, it, expect } from "vitest";
import type { MemoryState, SkillPack } from "../src/index.js";
import {
  DAY_MS,
  DEFAULT_SESSION,
  buildSession,
  effectiveDueMs,
  emptyState,
  createRuntime,
  currentCard,
  answer,
  interleaveBySkill,
} from "../src/index.js";

function mkPack(n: number, opts: { skillGroups?: number } = {}): SkillPack {
  const groups = opts.skillGroups ?? n;
  return {
    schemaVersion: 1,
    id: "p",
    packVersion: "1.0.0",
    name: { en: "P", zh: "包" },
    domain: "language",
    promptLanguage: "en",
    origin: "builtin",
    answerModes: ["keyboard", "self"],
    evaluation: "self",
    ext: { lang: { targetLanguage: "zh-CN" } },
    cards: Array.from({ length: n }, (_, i) => ({
      id: `C${i}`,
      cardType: "recall-output" as const,
      skillId: `sk${i % groups}`,
      context: "ctx",
      target: "tgt",
      hints: ["h1", "h2h2"] as [string, string],
    })),
  };
}

function dueState(cardId: string, daysOverdue: number, rung = 1, now = Date.UTC(2026, 5, 1)): MemoryState {
  const due = now - daysOverdue * DAY_MS;
  return {
    ...emptyState("p", cardId),
    graduated: true,
    rung,
    due: new Date(due).toISOString(),
    lastReview: new Date(due - 5 * DAY_MS).toISOString(),
    masteryTier: 1,
  };
}

const NOW = new Date(Date.UTC(2026, 5, 1));

describe("buildSession (F4.4/F4.7/F4.8/F4.9)", () => {
  it("caps due cards, orders by overdue ratio, never exposes total backlog", () => {
    const pack = mkPack(60);
    const states = new Map<string, MemoryState>();
    for (let i = 0; i < 60; i++) states.set(`C${i}`, dueState(`C${i}`, (i % 10) + 1));
    const plan = buildSession({ states, packs: [pack], now: NOW, lastActivityAt: NOW, vacation: null });
    expect(plan.mode).toBe("normal");
    expect(plan.dueTodayCount).toBeLessThanOrEqual(DEFAULT_SESSION.dueCap);
    expect("backlogTotal" in plan).toBe(false);
  });

  it("adds new (ungraduated) cards up to newCap", () => {
    const pack = mkPack(20);
    const plan = buildSession({ states: new Map(), packs: [pack], now: NOW, lastActivityAt: null, vacation: null });
    expect(plan.newCount).toBe(DEFAULT_SESSION.newCap);
    expect(plan.items.every((i) => i.kind === "new")).toBe(true);
    // 中文包 learning 相开口时限 8 秒（SKILL_PACKS_V1 4.2）
    expect(plan.items[0]!.answerWindowSec).toBe(8);
  });

  it("welcome-back mode: idle ≥4d with big backlog → top-mastery few cards, no new", () => {
    const pack = mkPack(60);
    const states = new Map<string, MemoryState>();
    for (let i = 0; i < 60; i++) states.set(`C${i}`, dueState(`C${i}`, 6, i % 5));
    const plan = buildSession({
      states,
      packs: [pack],
      now: NOW,
      lastActivityAt: new Date(NOW.getTime() - 6 * DAY_MS),
      vacation: null,
    });
    expect(plan.mode).toBe("welcome-back");
    expect(plan.items.length).toBe(DEFAULT_SESSION.welcomeBackPick);
    expect(plan.newCount).toBe(0);
  });

  it("vacation: active window yields empty plan; dues inside window shift after it", () => {
    const vac = { from: new Date(NOW.getTime() - DAY_MS).toISOString(), to: new Date(NOW.getTime() + DAY_MS).toISOString() };
    const plan = buildSession({ states: new Map(), packs: [mkPack(5)], now: NOW, lastActivityAt: NOW, vacation: vac });
    expect(plan.mode).toBe("vacation");
    const dueInVac = NOW.getTime();
    const shifted = effectiveDueMs(dueInVac, vac);
    expect(shifted).toBeGreaterThan(Date.parse(vac.to) - 1);
  });

  it("interleave constraint: adjacent items differ in skillId when avoidable (F3.4)", () => {
    const items = ["a", "a", "b", "b", "c", "c"].map((s, i) => ({
      packId: "p",
      cardId: `C${i}`,
      skillId: s,
      kind: "review" as const,
      answerWindowSec: 5,
    }));
    const out = interleaveBySkill(items);
    for (let i = 1; i < out.length; i++) {
      expect(out[i]!.skillId, out.map((x) => x.skillId).join(",")).not.toBe(out[i - 1]!.skillId);
    }
  });
});

describe("sessionRuntime (F4.1 learning steps + logging)", () => {
  const mkId = (() => { let n = 0; return () => `ID${String(++n).padStart(6, "0")}`; })();
  const ev = (grade: "fail" | "hesitant" | "fluent", hintLevel: 0 | 1 | 2 = 0) => ({
    grade,
    answerMode: "keyboard" as const,
    retrievalLatencyMs: 900,
    hintLevel,
    ts: new Date(Date.UTC(2026, 5, 1, 10)),
  });

  it("new card: fail → reinserted at +3 as learning; unhinted pass graduates", () => {
    const pack = mkPack(10);
    const plan = buildSession({ states: new Map(), packs: [pack], now: NOW, lastActivityAt: null, vacation: null });
    let rt = createRuntime(plan, { sessionId: "s", deviceId: "d" });
    const first = currentCard(rt)!;
    rt = answer(rt, ev("fail"), mkId);
    const reinsertedIdx = rt.queue.findIndex((q, i) => i > 0 && q.cardId === first.cardId);
    expect(reinsertedIdx).toBe(Math.min(4, rt.queue.length - 1));
    // 走到重插卡并通过
    while (currentCard(rt) && currentCard(rt)!.cardId !== first.cardId) rt = answer(rt, ev("fluent"), mkId);
    rt = answer(rt, ev("fluent"), mkId);
    expect(rt.stats.newGraduated).toBeGreaterThan(0);
    // 日志相位正确
    expect(rt.logs[0]!.phase).toBe("learning");
    expect(rt.logs[0]!.grade).toBe("fail");
  });

  it("review fail → relearning copy; fluent on relearning records comeback (F12.3)", () => {
    const pack = mkPack(6);
    const states = new Map<string, MemoryState>();
    for (let i = 0; i < 6; i++) states.set(`C${i}`, dueState(`C${i}`, 1));
    const plan = buildSession({ states, packs: [pack], now: NOW, lastActivityAt: NOW, vacation: null });
    let rt = createRuntime(plan, { sessionId: "s", deviceId: "d" });
    const failedCard = currentCard(rt)!.cardId;
    rt = answer(rt, ev("fail"), mkId);
    while (currentCard(rt) && currentCard(rt)!.cardId !== failedCard) rt = answer(rt, ev("hesitant"), mkId);
    expect(currentCard(rt)!.phase).toBe("relearning");
    rt = answer(rt, ev("fluent"), mkId);
    expect(rt.stats.comebackCardIds).toContain(failedCard);
    expect(rt.stats.reviewsFailed).toBe(1);
  });

  it("hinted pass on new card does not graduate (F4.11)", () => {
    const pack = mkPack(3);
    const plan = buildSession({ states: new Map(), packs: [pack], now: NOW, lastActivityAt: null, vacation: null });
    let rt = createRuntime(plan, { sessionId: "s", deviceId: "d" });
    rt = answer(rt, ev("fluent", 1), mkId);
    expect(rt.stats.newGraduated).toBe(0);
    expect(rt.queue.length).toBeGreaterThan(3); // 被重插
  });

  it("session completes and every answer produced exactly one log entry", () => {
    const pack = mkPack(5);
    const plan = buildSession({ states: new Map(), packs: [pack], now: NOW, lastActivityAt: null, vacation: null });
    let rt = createRuntime(plan, { sessionId: "s", deviceId: "d" });
    let answers = 0;
    while (!rt.done) {
      rt = answer(rt, ev("fluent"), mkId);
      answers++;
      if (answers > 50) break;
    }
    expect(rt.done).toBe(true);
    expect(rt.logs).toHaveLength(answers);
    const ids = new Set(rt.logs.map((l) => l.id));
    expect(ids.size).toBe(answers);
  });
});
