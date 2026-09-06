import { useTranslation } from "react-i18next";
import { useApp } from "../store.js";

const TIER_COLORS = ["var(--tier0)", "var(--tier1)", "var(--tier2)", "var(--tier3)", "var(--tier4)"];

/** 技能包掌握度地图（F10.1/F10.2）：等级只由 ReviewLog 派生数据决定（F10.5）。 */
export default function Packs() {
  const { t } = useTranslation();
  const app = useApp();

  return (
    <div>
      <h1>{t("packs.title")}</h1>
      {app.packs.map((pack) => {
        const cards = pack.cards.filter((c) => !c.retired && !c.isProbe);
        const tiers = cards.map((c) => app.states.get(c.id)?.masteryTier ?? 0);
        const internalized = tiers.filter((x) => x === 4).length;
        return (
          <div className="card" key={pack.id}>
            <h2>{pack.name[app.profile.uiLang]}</h2>
            <div className="mut">{t("packs.internalized", { done: internalized, total: cards.length })}</div>
            <div className="countbar"><div style={{ width: `${(internalized / cards.length) * 100}%`, background: "var(--tier4)" }} /></div>
            <div className="grid">
              {cards.map((c, i) => (
                <div key={c.id} className="cell" style={{ background: TIER_COLORS[tiers[i] ?? 0] }} title={`${c.id} ${c.target}`}>
                  {c.id.replace(/^[AB]0?/, "")}
                </div>
              ))}
            </div>
            <div className="tierlegend">
              {(t("packs.tiers", { returnObjects: true }) as string[]).map((label, i) => (
                <span key={i}><span className="dot" style={{ background: TIER_COLORS[i] }} />{label}</span>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
