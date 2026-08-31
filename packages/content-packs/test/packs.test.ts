import { describe, it, expect } from "vitest";
import { validateSkillPack } from "@lsa/core";
import { builtinPackData } from "../src/index.js";

describe("builtin skill packs", () => {
  it("both packs pass strict schema validation", () => {
    const packs = builtinPackData.map(validateSkillPack);
    expect(packs.map((p) => p.id).sort()).toEqual(["en-speaking", "zh-starter"]);
  });

  it("each pack has 42 cards with authored two-level hints", () => {
    for (const raw of builtinPackData) {
      const p = validateSkillPack(raw);
      expect(p.cards).toHaveLength(42);
      for (const c of p.cards) {
        expect(c.hints[0].length).toBeGreaterThan(0);
        expect(c.hints[1].length).toBeGreaterThan(0);
        // 二级提示信息量 ≥ 一级（递减线索原则的方向性检查）
        expect(c.hints[1].length).toBeGreaterThanOrEqual(c.hints[0].length);
      }
    }
  });

  it("zh pack cards carry pinyin; en pack cards carry gloss", () => {
    const [zh, en] = builtinPackData.map(validateSkillPack);
    for (const c of zh!.cards) expect(c.ext?.lang?.pinyin, c.id).toBeTruthy();
    for (const c of en!.cards) expect(c.ext?.lang?.literalGloss, c.id).toBeTruthy();
  });

  it("language packs declare targetLanguage and voice mode", () => {
    for (const raw of builtinPackData) {
      const p = validateSkillPack(raw);
      expect(p.ext?.lang?.targetLanguage).toMatch(/^(zh-CN|en-US)$/);
      expect(p.answerModes).toContain("keyboard");
      expect(p.answerModes).toContain("self");
    }
  });
});
