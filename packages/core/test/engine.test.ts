import { describe, it, expect } from "vitest";
import type { ReviewLogEntry, Grade, Phase } from "../src/index.js";
import {
  DEFAULT_LADDER,
  DAY_MS,
  deriveMemoryState,
  effectiveGrade,
  applyReview,
  emptyState,
  computeTier,
} from "../src/index.js";

let seq = 0;
function log(
  cardId: string,
  daysFromEpoch: number,
  grade: Grade,
  opts: { phase?: Phase; hintLevel?: 0 | 1 | 2 } = {},
): ReviewLogEntry {
  return {
    v: 1,
    id: String(++seq).padStart(10, "0"),
    packId: "p",
    cardId,
    sessionId: "s1",
    deviceId: "d1",
    ts: new Date(Date.UTC(2026, 0, 1) + daysFromEpoch * DAY_MS).toISOString(),
    phase: opts.phase ?? "review",
    grade,
    scheduledDue: null,
    answerMode: "keyboard",
    retrievalLatencyMs: 1000,
    hintLevel: opts.hintLevel ?? 0,
  };
}

const cfg = DEFAULT_LADDER;

describe("graduation (F4.11)", () => {
  it("hinted success does NOT graduate; unhinted success does", () => {
    const s1 = deriveMemoryState([log("c", 0, "fluent", { phase: "learning", hintLevel: 1 })], cfg);
    expect(s1.get("c")!.graduated).toBe(false);
    const s2 = deriveMemoryState(
      [
        log("c", 0, "fluent", { phase: "learning", hintLevel: 1 }),
        log("c", 0.01, "fluent", { phase: "learning", hintLevel: 0 }),
      ],
      cfg,
    );
    const st = s2.get("c")!;
    expect(st.graduated).toBe(true);
    // 首个跨会话间隔不早于次日（F4.2）
    expect(Date.parse(st.due!) - Date.parse(st.lastReview!)).toBeGreaterThanOrEqual(0.9 * DAY_MS);
  });

  it("learning entries after graduation are ignored (F4.1)", () => {
    const logs = [
      log("c", 0, "fluent", { phase: "learning" }),
      log("c", 0.5, "fail", { phase: "learning" }), // 会话内重现失败不得影响长期状态
    ];
    const st = deriveMemoryState(logs, cfg).get("c")!;
    expect(st.rung).toBe(0);
    expect(st.totalLapses).toBe(0);
  });
});

describe("ladder transitions (F4.3)", () => {
  it("fluent climbs, hesitant holds, fail drops by 2 without reset", () => {
    let s: import("../src/index.js").MemoryState = { ...emptyState("p", "c"), graduated: true, lastReview: new Date(0).toISOString() };
    s = applyReview(s, "fluent", 0, DAY_MS, cfg); // rung 1
    s = applyReview(s, "fluent", 0, 6 * DAY_MS, cfg); // rung 2
    s = applyReview(s, "fluent", 0, 31 * DAY_MS, cfg); // rung 3
    expect(s.rung).toBe(3);
    s = applyReview(s, "hesitant", 0, 91 * DAY_MS, cfg);
    expect(s.rung).toBe(3); // hold
    s = applyReview(s, "fail", 0, 151 * DAY_MS, cfg);
    expect(s.rung).toBe(1); // 3-2，不清零
    expect(s.consecutivePasses).toBe(0);
    expect(s.totalLapses).toBe(1);
  });

  it("hinted review pass counts as fail for scheduling", () => {
    expect(effectiveGrade("fluent", 1)).toBe("fail");
    expect(effectiveGrade("fluent", 0)).toBe("fluent");
  });

  it("rung caps at ladder top", () => {
    let s: import("../src/index.js").MemoryState = { ...emptyState("p", "c"), graduated: true, rung: 4, lastReview: new Date(0).toISOString() };
    s = applyReview(s, "fluent", 0, DAY_MS, cfg);
    expect(s.rung).toBe(4);
  });
});

describe("mastery tiers (F10.1)", () => {
  it("tier progression: 0 new → 1 → 2 consolidated → 3 stable → 4 internalized", () => {
    const s0 = emptyState("p", "c");
    expect(computeTier(s0, cfg)).toBe(0);
    const s1 = { ...s0, graduated: true };
    expect(computeTier(s1, cfg)).toBe(1);
    expect(computeTier({ ...s1, consecutivePasses: 3 }, cfg)).toBe(2);
    expect(computeTier({ ...s1, rung: 2 }, cfg)).toBe(3); // rungsDays[2]=25
    expect(computeTier({ ...s1, passedMatureReview: true }, cfg)).toBe(4);
  });

  it("passing a review after ≥25 elapsed days marks internalized", () => {
    let s: import("../src/index.js").MemoryState = { ...emptyState("p", "c"), graduated: true, rung: 2, lastReview: new Date(0).toISOString() };
    s = applyReview(s, "fluent", 0, 26 * DAY_MS, cfg);
    expect(s.passedMatureReview).toBe(true);
    expect(s.masteryTier).toBe(4);
  });
});

describe("replay determinism (spike-6 requirement)", () => {
  it("two replays over the same log are field-identical", () => {
    const logs: ReviewLogEntry[] = [];
    for (let c = 0; c < 30; c++) {
      logs.push(log(`c${c}`, 0, "fluent", { phase: "learning" }));
      for (let r = 1; r <= 8; r++) {
        logs.push(log(`c${c}`, r * 3, r % 4 === 0 ? "fail" : r % 3 === 0 ? "hesitant" : "fluent"));
      }
    }
    const a = deriveMemoryState(logs, cfg);
    const b = deriveMemoryState([...logs].reverse(), cfg); // 乱序输入也须一致（内部排序）
    for (const [k, va] of a) expect(b.get(k)).toEqual(va);
  });

  it("jitter is deterministic per card and bounded", () => {
    const s = deriveMemoryState([log("jitter-card", 0, "fluent", { phase: "learning" })], cfg).get("jitter-card")!;
    const interval = Date.parse(s.due!) - Date.parse(s.lastReview!);
    expect(interval).toBeGreaterThanOrEqual(1 * DAY_MS * 0.94);
    expect(interval).toBeLessThanOrEqual(1 * DAY_MS * 1.06);
  });
});
