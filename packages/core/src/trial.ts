import type { SkillPack } from "./schema.js";
import type { SessionPlan, SessionPlanItem } from "./sessionBuilder.js";
import { interleaveBySkill } from "./sessionBuilder.js";

/**
 * 首次体验会话（F9.2/F9.3）：5–8 张新卡，前 2 张不启动倒计时（answerWindowSec=0 表示不限时），
 * 选卡取包内最前（选材清单已按「答对率预期最高」排列首主题，SKILL_PACKS_V1）。
 */
export function buildTrialSession(pack: SkillPack, size = 6): SessionPlan {
  const lang = pack.ext?.lang?.targetLanguage ?? "";
  const learningWindow = lang.startsWith("zh") ? 8 : 7;
  const cards = pack.cards
    .filter((c) => !c.retired && !c.isProbe && c.cardType === "recall-output")
    .slice(0, Math.max(5, Math.min(8, size)));

  const items: SessionPlanItem[] = cards.map((c, i) => ({
    packId: pack.id,
    cardId: c.id,
    skillId: c.skillId,
    kind: "new",
    answerWindowSec: i < 2 ? 0 : learningWindow,
  }));

  return {
    mode: "normal",
    items: interleaveBySkill(items),
    dueTodayCount: 0,
    newCount: items.length,
    estMinutes: Math.max(1, Math.round((items.length * 30) / 60)),
  };
}
