import { describe, it, expect } from "vitest";
import { EMPTY_STREAK, recordAchievement } from "../src/index.js";

describe("streak (F11)", () => {
  it("consecutive days increment; same day idempotent", () => {
    let r = recordAchievement(EMPTY_STREAK, "2026-06-01");
    r = recordAchievement(r.state, "2026-06-02");
    expect(r.state.current).toBe(2);
    const again = recordAchievement(r.state, "2026-06-02");
    expect(again.state).toBe(r.state);
  });

  it("awards a freeze every 7 achieved days, capped at 2, never purchasable", () => {
    let s = EMPTY_STREAK;
    for (let d = 1; d <= 21; d++) {
      const r = recordAchievement(s, `2026-06-${String(d).padStart(2, "0")}`);
      s = r.state;
      if (d === 7 || d === 14) expect(r.freezeAwarded).toBe(true);
    }
    expect(s.freezes).toBe(2); // 第三次授予被上限挡住
  });

  it("a missed day silently consumes a freeze and keeps the streak (F11.2)", () => {
    let s = EMPTY_STREAK;
    for (let d = 1; d <= 7; d++) s = recordAchievement(s, `2026-06-0${d}`).state;
    expect(s.freezes).toBe(1);
    const r = recordAchievement(s, "2026-06-09"); // 漏掉 06-08
    expect(r.freezesConsumed).toBe(1);
    expect(r.broke).toBe(false);
    expect(r.state.current).toBe(8);
    expect(r.state.freezes).toBe(0);
  });

  it("misses beyond freezes break the streak but keep best (soft landing data F11.3)", () => {
    let s = EMPTY_STREAK;
    for (let d = 1; d <= 7; d++) s = recordAchievement(s, `2026-06-0${d}`).state;
    const r = recordAchievement(s, "2026-06-20");
    expect(r.broke).toBe(true);
    expect(r.state.current).toBe(1);
    expect(r.state.best).toBe(7);
  });

  it("vacation days are exempt (F4.9 pause semantics)", () => {
    let s = EMPTY_STREAK;
    s = recordAchievement(s, "2026-06-01").state;
    const r = recordAchievement(s, "2026-06-05", 3); // 3 天假期
    expect(r.broke).toBe(false);
    expect(r.state.current).toBe(2);
  });
});
