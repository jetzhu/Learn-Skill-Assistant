import { describe, it, expect } from "vitest";
import { validateSkillPack } from "../src/index.js";

const base = {
  schemaVersion: 1,
  id: "p1",
  packVersion: "1.0.0",
  name: { en: "P", zh: "包" },
  domain: "language",
  promptLanguage: "en",
  origin: "builtin",
  answerModes: ["voice", "keyboard", "self"],
  evaluation: "self",
  ext: { lang: { targetLanguage: "zh-CN" } },
  cards: [
    {
      id: "C1",
      cardType: "recall-output",
      skillId: "s1",
      context: "ctx",
      target: "tgt",
      hints: ["h1", "h2h2"],
    },
  ],
};

const clone = () => JSON.parse(JSON.stringify(base)) as Record<string, unknown>;

describe("skillPackSchema (F1.6/F1.9)", () => {
  it("accepts a valid pack", () => {
    expect(validateSkillPack(base).id).toBe("p1");
  });

  it("rejects unknown top-level fields (strict)", () => {
    const p = clone();
    p["evil"] = "<script>";
    expect(() => validateSkillPack(p)).toThrow();
  });

  it("rejects duplicate card ids", () => {
    const p = clone();
    (p["cards"] as unknown[]).push({ ...(base.cards[0] as object) });
    expect(() => validateSkillPack(p)).toThrow(/duplicate/);
  });

  it("rejects language pack without targetLanguage", () => {
    const p = clone();
    delete p["ext"];
    expect(() => validateSkillPack(p)).toThrow(/targetLanguage/);
  });

  it("rejects voice answerMode on non-language domains (F2 baseline rule)", () => {
    const p = clone();
    p["domain"] = "coding";
    delete p["ext"];
    expect(() => validateSkillPack(p)).toThrow(/voice/);
  });

  it("accepts non-language pack with keyboard/self baseline", () => {
    const p = clone();
    p["domain"] = "coding";
    p["answerModes"] = ["keyboard", "self"];
    delete p["ext"];
    expect(validateSkillPack(p).domain).toBe("coding");
  });

  it("rejects variantOf pointing to a missing card", () => {
    const p = clone();
    (p["cards"] as Record<string, unknown>[])[0]!["variantOf"] = "nope";
    expect(() => validateSkillPack(p)).toThrow(/variantOf/);
  });

  it("preserves unknown ext namespaces (forward compat) but rejects bad lang ext", () => {
    const p = clone();
    (p["cards"] as Record<string, unknown>[])[0]!["ext"] = { future: { anything: true } };
    const parsed = validateSkillPack(p);
    expect((parsed.cards[0]!.ext as Record<string, unknown>)["future"]).toBeTruthy();
    (p["cards"] as Record<string, unknown>[])[0]!["ext"] = { lang: { bogus: 1 } };
    expect(() => validateSkillPack(p)).toThrow();
  });
});
