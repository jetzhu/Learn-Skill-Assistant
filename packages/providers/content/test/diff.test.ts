import { describe, it, expect } from "vitest";
import type { SkillPack } from "@lsa/core";
import { diffPacks, BuiltinContentSource } from "../src/index.js";

function mkPack(cards: Partial<SkillPack["cards"][number]>[], version = "1.0.0"): SkillPack {
  return {
    schemaVersion: 1,
    id: "test-pack",
    packVersion: version,
    name: { en: "Test", zh: "测试" },
    domain: "language",
    promptLanguage: "en",
    origin: "builtin",
    answerModes: ["keyboard", "self"],
    evaluation: "self",
    ext: { lang: { targetLanguage: "zh-CN" } },
    cards: cards.map((c, i) => ({
      id: c.id ?? `C${i}`,
      cardType: "recall-output",
      skillId: c.skillId ?? `s${i}`,
      context: c.context ?? "ctx",
      target: c.target ?? "tgt",
      hints: c.hints ?? ["h1", "h2h2"],
      ...(c.supersedes ? { supersedes: c.supersedes } : {}),
    })),
  } as SkillPack;
}

describe("diffPacks (F1.8 upgrade pipeline)", () => {
  it("classifies added / updated / retired / unchanged", () => {
    const oldP = mkPack([{ id: "C1" }, { id: "C2" }, { id: "C3", context: "old ctx" }]);
    const newP = mkPack(
      [{ id: "C1" }, { id: "C3", context: "new ctx" }, { id: "C4" }],
      "1.1.0",
    );
    const d = diffPacks(oldP, newP);
    expect(d.added.map((c) => c.id)).toEqual(["C4"]);
    expect(d.updated.map((c) => c.id)).toEqual(["C3"]);
    expect(d.retired).toEqual(["C2"]);
    expect(d.unchanged).toBe(1);
    expect(d.warnings).toHaveLength(0);
  });

  it("supersedes retires the old card even if still present", () => {
    const oldP = mkPack([{ id: "C1", target: "old target" }]);
    const newP = mkPack([{ id: "C1", target: "old target" }, { id: "C9", supersedes: "C1" }], "2.0.0");
    const d = diffPacks(oldP, newP);
    expect(d.retired).toContain("C1");
    expect(d.added.map((c) => c.id)).toContain("C9");
  });

  it("warns when target changes under the same id (publishing discipline)", () => {
    const oldP = mkPack([{ id: "C1", target: "original" }]);
    const newP = mkPack([{ id: "C1", target: "completely different" }], "1.0.1");
    const d = diffPacks(oldP, newP);
    expect(d.warnings[0]).toContain("C1");
  });
});

describe("BuiltinContentSource", () => {
  const raw = mkPack([{ id: "C1" }]);
  it("lists, fetches, and reports updates", async () => {
    const src = new BuiltinContentSource([raw]);
    const list = await src.listPacks();
    expect(list[0]).toMatchObject({ id: "test-pack", cardCount: 1 });
    const p = await src.fetchPack("test-pack");
    expect(p.packVersion).toBe("1.0.0");
    const updates = await src.checkUpdates([{ id: "test-pack", packVersion: "0.9.0" }]);
    expect(updates).toHaveLength(1);
    await expect(src.fetchPack("nope")).rejects.toThrow("not found");
  });
});
