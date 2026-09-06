import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { DAY_MS } from "@lsa/core";
import { useApp } from "../store.js";
import { localDate } from "../store.js";

/** 个人成长（F10.3，M2 简版：累计数字 + 近 14 天条形）。 */
export default function Stats() {
  const { t } = useTranslation();
  const app = useApp();

  const agg = useMemo(() => {
    const logs = app.logs;
    const firstTry = logs.filter((l) => l.hintLevel === 0 && (l.phase === "review" || l.phase === "learning"));
    const fluent = firstTry.filter((l) => l.grade === "fluent").length;
    const internalized = [...app.states.values()].filter((s) => s.masteryTier === 4).length;
    const byDay = new Map<string, number>();
    for (let i = 13; i >= 0; i--) byDay.set(localDate(new Date(Date.now() - i * DAY_MS)), 0);
    for (const l of logs) {
      const d = localDate(new Date(l.ts));
      if (byDay.has(d)) byDay.set(d, (byDay.get(d) ?? 0) + 1);
    }
    return {
      answered: logs.length,
      fluentFirstRate: firstTry.length ? Math.round((fluent / firstTry.length) * 100) : 0,
      internalized,
      days: [...byDay.values()],
    };
  }, [app.logs, app.states]);

  const max = Math.max(1, ...agg.days);

  return (
    <div>
      <h1>{t("stats.title")}</h1>
      <div className="statgrid">
        <div className="stat"><div className="big">{agg.answered}</div><div className="mut">{t("stats.answered")}</div></div>
        <div className="stat"><div className="big">{agg.fluentFirstRate}%</div><div className="mut">{t("stats.fluentFirst")}</div></div>
        <div className="stat"><div className="big">{agg.internalized}</div><div className="mut">{t("stats.internalized")}</div></div>
        <div className="stat"><div className="big">{app.streak.best}</div><div className="mut">Best 🔥</div></div>
      </div>
      <div className="card">
        <div className="mut">{t("stats.last14")}</div>
        <div className="bars">
          {agg.days.map((v, i) => (
            <div key={i} style={{ height: `${(v / max) * 100}%` }} title={String(v)} />
          ))}
        </div>
      </div>
    </div>
  );
}
