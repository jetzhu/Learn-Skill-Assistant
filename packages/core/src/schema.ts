import { z } from "zod";

/** 上限（F1.6(a)）：超限整包拒绝。总体积上限（1MB）在导入层按字节校验。 */
export const PACK_LIMITS = { maxCards: 500, maxText: 500, maxHint: 200 } as const;

export const localizedTextSchema = z
  .object({ en: z.string().min(1).max(200), zh: z.string().min(1).max(200) })
  .strict();

export const cardSchema = z
  .object({
    /** 一经发布即与考核目标绑定，不得复用（F1.8）。 */
    id: z.string().min(1).max(64),
    /** 未知类型由消费方跳过而非报错（F1.9 向前兼容）。 */
    cardType: z.string().min(1).max(32),
    /** 核心技能项：交错约束（F3.4）与变体归组。 */
    skillId: z.string().min(1).max(64),
    context: z.string().min(1).max(PACK_LIMITS.maxText),
    target: z.string().min(1).max(PACK_LIMITS.maxText),
    acceptableAnswers: z.array(z.string().min(1).max(PACK_LIMITS.maxText)).max(10).optional(),
    explanation: z.string().max(1000).optional(),
    /** 一级/二级提示，作者/AI 产出，禁止运行时截取（F2.3）。 */
    hints: z.tuple([z.string().min(1).max(PACK_LIMITS.maxHint), z.string().min(1).max(PACK_LIMITS.maxHint)]),
    variantOf: z.string().max(64).optional(),
    supersedes: z.string().max(64).optional(),
    retired: z.boolean().optional(),
    isProbe: z.boolean().optional(),
    /** 领域扩展命名空间：已注册命名空间严格校验，未知命名空间保留不解析（F1.9）。 */
    ext: z
      .object({
        lang: z
          .object({
            pinyin: z.string().max(300).optional(),
            literalGloss: z.string().max(300).optional(),
            toneNotes: z.string().max(300).optional(),
          })
          .strict()
          .optional(),
      })
      .passthrough()
      .optional(),
  })
  .strict();

export const skillPackSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
    /** semver（F1.8）。 */
    packVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
    name: localizedTextSchema,
    domain: z.string().min(1).max(32),
    /** 情境面语言（BCP-47）。 */
    promptLanguage: z.string().min(2).max(16),
    origin: z.enum(["builtin", "imported", "user", "remote"]),
    /** 包声明可用作答方式；键盘/自评为全域基线（F1.9/F2）。 */
    answerModes: z.array(z.enum(["voice", "keyboard", "self"])).min(1),
    evaluation: z.enum(["self", "ai-assisted"]),
    ext: z
      .object({
        lang: z.object({ targetLanguage: z.string().min(2).max(16) }).strict().optional(),
      })
      .passthrough()
      .optional(),
    cards: z.array(cardSchema).min(1).max(PACK_LIMITS.maxCards),
  })
  .strict()
  .superRefine((pack, ctx) => {
    const ids = new Set<string>();
    for (const c of pack.cards) {
      if (ids.has(c.id)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `duplicate card id: ${c.id}` });
      }
      ids.add(c.id);
    }
    for (const c of pack.cards) {
      if (c.variantOf && !ids.has(c.variantOf)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `variantOf points to missing card: ${c.variantOf}` });
      }
    }
    if (pack.domain === "language" && !pack.ext?.lang?.targetLanguage) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "language pack requires ext.lang.targetLanguage" });
    }
    if (pack.answerModes.includes("voice") && pack.domain !== "language") {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "voice answerMode is language-domain only (F2)" });
    }
  });

export type SkillPack = z.infer<typeof skillPackSchema>;
export type Card = z.infer<typeof cardSchema>;

/** 严格校验；失败抛 ZodError（导入层将其转为「整包拒绝」）。 */
export function validateSkillPack(data: unknown): SkillPack {
  return skillPackSchema.parse(data);
}
