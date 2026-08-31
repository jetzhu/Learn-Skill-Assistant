import type { SkillPack } from "@lsa/core";
import zhStarter from "../packs/zh-starter.json";
import enSpeaking from "../packs/en-speaking.json";

/** 内置技能包原始数据（发布前经 CI 校验，运行时消费方仍应过 validateSkillPack）。 */
export const builtinPackData: unknown[] = [zhStarter, enSpeaking];

export function getBuiltinPacks(validate: (d: unknown) => SkillPack): SkillPack[] {
  return builtinPackData.map(validate);
}
