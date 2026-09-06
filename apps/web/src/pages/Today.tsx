import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { DAY_MS, DEFAULT_SESSION, buildSession } from "@lsa/core";
import { useApp } from "../store.js";
import { localDate } from "../store.js";
import { unlockAudio, resetVoiceFailures } from "../speech/service.js";

/** 今日面板（F10.4）：只显示「今天这一组」，永不显示总积压（F4.7）。 */
export default function Today() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const app = useApp();

  const preview = useMemo(() => {
    const pack = app.packs.find((p) => p.id === app.profile.learnPackId) ?? app.packs[0]!;
    const today = localDate();
    const usedNew = app.newIntroduced.date === today ? app.newIntroduced.count : 0;
    return buildSession({
      states: app.states,
      packs: [pack],
      now: new Date(),
      cfg: { ...DEFAULT_SESSION, newCap: Math.max(0, DEFAULT_SESSION.newCap - usedNew) },
      lastActivityAt: app.lastActivityAt ? new Date(app.lastActivityAt) : null,
      vacation: app.vacation,
    });
  }, [app.states, app.packs, app.profile.learnPackId, app.lastActivityAt, app.vacation, app.newIntroduced]);

  const hasAnyHistory = app.logs.length > 0;

  function start() {
    unlockAudio(); // 手势链内解锁音频（F2.4）
    resetVoiceFailures();
    app.startSession(!hasAnyHistory);
    nav("/session");
  }

  return (
    <div>
      <h1>{t("appName")}</h1>

      <div className="card">
        <div className="big">
          {app.streak.current}🔥 <span className="mut" style={{ fontSize: 14 }}>{t("today.streak")}</span>
          {app.streak.freezes > 0 && (
            <span className="mut" style={{ fontSize: 14 }}> · {app.streak.freezes}❄️ {t("today.freezes")}</span>
          )}
        </div>
      </div>

      {preview.mode === "vacation" ? (
        <div className="banner blue">{t("today.vacation")}</div>
      ) : (
        <div className="card">
          {preview.mode === "welcome-back" && <div className="banner gold">{t("today.welcomeBack")}</div>}
          {preview.dueTodayCount > 0 ? (
            <div className="big">{t("today.due", { count: preview.dueTodayCount, min: Math.max(1, preview.estMinutes) })}</div>
          ) : (
            <div className="mut">{t("today.nothingDue")}</div>
          )}
          {preview.newCount > 0 && <div className="mut">{t("today.newAvailable", { count: preview.newCount })}</div>}
          <button className="btn primary" disabled={preview.items.length === 0} onClick={start}>
            {hasAnyHistory ? t("today.start") : t("today.startTrial")}
          </button>
        </div>
      )}
    </div>
  );
}

void DAY_MS;
