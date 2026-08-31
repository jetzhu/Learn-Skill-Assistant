/**
 * ContentSource 契约与包升级演进管线（F1.7/F1.8，DESIGN §5.3）。
 * remote 源是后期「备课系统」的接入点；一切非内置来源经 F1.6 校验管线，无信任豁免。
 */
import type { SkillPack, Card } from "@lsa/core";
import { validateSkillPack } from "@lsa/core";

export interface PackSummary {
  id: string;
  packVersion: string;
  name: { en: string; zh: string };
  domain: string;
  cardCount: number;
}

export interface PackUpdate {
  id: string;
  fromVersion: string;
  toVersion: string;
}

export interface ContentSource {
  readonly kind: "builtin" | "file" | "remote";
  listPacks(): Promise<PackSummary[]>;
  fetchPack(id: string, version?: string): Promise<SkillPack>;
  checkUpdates(installed: { id: string; packVersion: string }[]): Promise<PackUpdate[]>;
}

/** 内置内容源：包数据随应用发布。 */
export class BuiltinContentSource implements ContentSource {
  readonly kind = "builtin" as const;
  private readonly packs: SkillPack[];

  constructor(rawPacks: unknown[]) {
    this.packs = rawPacks.map(validateSkillPack);
  }

  listPacks(): Promise<PackSummary[]> {
    return Promise.resolve(
      this.packs.map((p) => ({
        id: p.id,
        packVersion: p.packVersion,
        name: p.name,
        domain: p.domain,
        cardCount: p.cards.length,
      })),
    );
  }

  fetchPack(id: string): Promise<SkillPack> {
    const p = this.packs.find((x) => x.id === id);
    if (!p) return Promise.reject(new Error(`pack not found: ${id}`));
    return Promise.resolve(p);
  }

  checkUpdates(installed: { id: string; packVersion: string }[]): Promise<PackUpdate[]> {
    const updates: PackUpdate[] = [];
    for (const inst of installed) {
      const p = this.packs.find((x) => x.id === inst.id);
      if (p && p.packVersion !== inst.packVersion) {
        updates.push({ id: p.id, fromVersion: inst.packVersion, toVersion: p.packVersion });
      }
    }
    return Promise.resolve(updates);
  }
}

/** 包升级 diff 结果（F1.8(d) 预览用）。 */
export interface PackDiff {
  added: Card[];
  /** 同 id 内容变化（措辞微调，记忆状态延续）。 */
  updated: Card[];
  /** 新包中消失或被 supersedes 的卡 → 退休（日志保留，不再入队）。 */
  retired: string[];
  /** 完全未变的卡数。 */
  unchanged: number;
  /** 同 id 但 target 大幅变更 → 疑似违反「id 与考核目标绑定」的发布纪律（警告）。 */
  warnings: string[];
}

/** 升级演进管线的 diff 步骤（F1.8(b)），纯函数。 */
export function diffPacks(oldPack: SkillPack, newPack: SkillPack): PackDiff {
  const oldById = new Map(oldPack.cards.map((c) => [c.id, c]));
  const newById = new Map(newPack.cards.map((c) => [c.id, c]));
  const diff: PackDiff = { added: [], updated: [], retired: [], unchanged: 0, warnings: [] };

  const superseded = new Set(
    newPack.cards.map((c) => c.supersedes).filter((s): s is string => !!s),
  );

  for (const c of newPack.cards) {
    const old = oldById.get(c.id);
    if (!old) {
      diff.added.push(c);
      continue;
    }
    if (old.target !== c.target) {
      diff.warnings.push(
        `card ${c.id}: target changed — assessment goal must not change under the same id (F1.8); use a new id + supersedes`,
      );
    }
    if (JSON.stringify(old) === JSON.stringify(c)) diff.unchanged++;
    else diff.updated.push(c);
  }

  for (const c of oldPack.cards) {
    if (!newById.has(c.id) || superseded.has(c.id)) diff.retired.push(c.id);
  }
  return diff;
}
