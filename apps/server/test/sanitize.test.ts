import { describe, it, expect } from "vitest";
import { sanitize } from "../src/llm.js";

describe("input sanitization (F8.9)", () => {
  it("strips control characters but keeps newline/tab", () => {
    const dirty = "a" + String.fromCharCode(0) + "b" + String.fromCharCode(7) + "\nc\td" + String.fromCharCode(27);
    expect(sanitize(dirty)).toBe("ab\nc\td");
  });
  it("caps length", () => {
    expect(sanitize("x".repeat(5000)).length).toBe(2000);
  });
  it("non-strings become empty", () => {
    expect(sanitize(42)).toBe("");
    expect(sanitize(null)).toBe("");
  });
});
