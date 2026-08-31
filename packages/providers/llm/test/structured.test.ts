import { describe, it, expect } from "vitest";
import { z } from "zod";
import { parseStructured, stripFences } from "../src/index.js";

const schema = z.array(z.object({ context: z.string(), target: z.string() }));

describe("structured output pipeline (spike-5 finding 2)", () => {
  it("parses clean JSON", () => {
    const out = parseStructured('[{"context":"c","target":"t"}]', schema);
    expect(out).toHaveLength(1);
  });
  it("strips ```json fences (observed CLI behavior)", () => {
    const raw = '```json\n[{"context":"学生请求延期","target":"I need more time."}]\n```';
    const out = parseStructured(raw, schema);
    expect(out[0]?.target).toContain("more time");
  });
  it("strips bare ``` fences and surrounding whitespace", () => {
    expect(stripFences('  ```\n{"a":1}\n```  ')).toBe('{"a":1}');
  });
  it("rejects schema-invalid payloads", () => {
    expect(() => parseStructured('[{"context":1}]', schema)).toThrow();
  });
});
