import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { currentCard, DAY_MS, type Card, type Grade } from "@lsa/core";
import { useApp } from "../store.js";

/**
 * 训练卡状态机（DESIGN §7.2，M2 形态：键盘 + 自评；语音在 M3 注入）：
 * prompt(倒计时) → hint1 → hint2 → reveal → grade。
 * 倒计时约束「开始作答」：首次键入/点击「我说出来了」即暂停计时并记录提取延迟（F2.2）。
 */
export default function Session() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const app = useApp();
  const ctx = app.session;

  if (!ctx && app.endSummary) return <EndScreen />;
  if (!ctx) {
    nav("/");
    return null;
  }
  return <CardTrainer key={`${ctx.runtime.idx}-${ctx.runtime.queue.length}`} />;
}

function CardTrainer() {
  const { t } = useTranslation();
  const app = useApp();
  const ctx = app.session!;
  const item = currentCard(ctx.runtime)!;
  const pack = app.packs.find((p) => p.id === item.packId)!;
  const card = pack.cards.find((c) => c.id === item.cardId)!;
  const isZh = (pack.ext?.lang?.targetLanguage ?? "").startsWith("zh");

  const [phase, setPhase] = useState<"prompt" | "reveal">("prompt");
  const [hintLevel, setHintLevel] = useState<0 | 1 | 2>(0);
  const [typed, setTyped] = useState("");
  const [answerMode, setAnswerMode] = useState<"keyboard" | "self" | null>(null);
  const [latency, setLatency] = useState<number | null>(null);
  const [toneUnsure, setToneUnsure] = useState(false);
  const [remaining, setRemaining] = useState(item.answerWindowSec);
  const shownAt = useRef(performance.now());
  const pausedRef = useRef(item.answerWindowSec === 0);
  const hintRef = useRef<0 | 1 | 2>(0);

  const window_ = item.answerWindowSec;
  const reappeared = item.step > 0;

  // 倒计时：到点 → 分级提示（F2.3），二级提示后再到点 → 翻答案
  useEffect(() => {
    if (window_ === 0 || phase !== "prompt") return;
    const deadlineRef = { t: performance.now() + window_ * 1000 };
    const iv = setInterval(() => {
      if (pausedRef.current) return;
      const left = (deadlineRef.t - performance.now()) / 1000;
      setRemaining(Math.max(0, left));
      if (left <= 0) {
        if (hintRef.current < 2) {
          hintRef.current = (hintRef.current + 1) as 1 | 2;
          setHintLevel(hintRef.current);
          deadlineRef.t = performance.now() + window_ * 1000;
        } else {
          setPhase("reveal");
        }
      }
    }, 100);
    return () => clearInterval(iv);
  }, [window_, phase]);

  function markAnswerStart(mode: "keyboard" | "self") {
    if (latency === null) {
      setLatency(Math.round(performance.now() - shownAt.current));
      setAnswerMode(mode);
      pausedRef.current = true; // 开口/落键后计时暂停（F2.2）
    }
  }

  async function grade(g: Grade) {
    await app.submitAnswer({
      grade: g,
      answerMode: answerMode ?? "self",
      retrievalLatencyMs: latency,
      hintLevel,
      ...(isZh && toneUnsure ? { toneUnsure: true } : {}),
    });
  }

  const total = ctx.runtime.queue.length;
  const done = ctx.runtime.idx;
  const lastThree = total - done <= 3;

  return (
    <div>
      <div className="progress">
        {done + 1} / {total} {lastThree && total > 3 ? "· 🏁" : ""}
      </div>

      {ctx.trial && reappeared && phase === "prompt" && (
        <div className="banner blue">{t("session.tipReappear")}</div>
      )}
      {item.phase === "relearning" && !ctx.trial && phase === "prompt" && (
        <div className="banner blue">{t("session.tipReappear")}</div>
      )}

      <div className="card">
        <div className="context">{card.context}</div>
        {window_ > 0 && phase === "prompt" && (
          <div className="countbar"><div style={{ width: `${(remaining / window_) * 100}%` }} /></div>
        )}
        {hintLevel > 0 && phase === "prompt" && (
          <div className="hintbox">💡 {card.hints[(hintLevel - 1) as 0 | 1]}</div>
        )}
      </div>

      {phase === "prompt" && (
        <>
          <div className="mut">{t("session.sayIt")}</div>
          <input
            type="text"
            placeholder={t("session.typeIt")}
            value={typed}
            autoCapitalize="none"
            autoCorrect="off"
            onChange={(e) => {
              markAnswerStart("keyboard");
              setTyped(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && typed.trim()) setPhase("reveal");
            }}
          />
          <button
            className="btn primary"
            onClick={() => {
              markAnswerStart("self");
              setPhase("reveal");
            }}
          >
            {typed.trim() ? t("session.reveal") : t("session.iSaidIt")}
          </button>
        </>
      )}

      {phase === "reveal" && (
        <>
          <div className="card">
            <div className="mut">{t("session.answer")}</div>
            <div className="target">{card.target}</div>
            {card.ext?.lang?.pinyin && <div className="pinyin">{card.ext.lang.pinyin}</div>}
            {card.ext?.lang?.literalGloss && <div className="gloss">{card.ext.lang.literalGloss}</div>}
            {typed.trim() && <div className="mut" style={{ marginTop: 8 }}>✍️ {typed}</div>}
          </div>

          {ctx.trial && latency === null && (
            <div className="banner blue">{t("session.tipFirstFail")}</div>
          )}
          {item.phase === "relearning" && (
            <div className="banner gold">{ctx.trial ? t("session.activation") : t("session.comeback")}</div>
          )}

          <div className="mut">{t("session.grade")}</div>
          {isZh && (
            <label className="mut" style={{ display: "block", margin: "6px 0" }}>
              <input type="checkbox" checked={toneUnsure} onChange={(e) => setToneUnsure(e.target.checked)} />{" "}
              {t("session.toneUnsure")}
            </label>
          )}
          <div className="row">
            <button className="btn bad" onClick={() => void grade("fail")}>{t("session.fail")}</button>
            <button className="btn warn" onClick={() => void grade("hesitant")}>{t("session.hesitant")}</button>
            <button className="btn ok" onClick={() => void grade("fluent")}>{t("session.fluent")}</button>
          </div>
        </>
      )}

      <button className="btn ghost mut" onClick={() => void app.quitSession()}>
        {t("session.quit")} · {t("session.quitNote", { count: done })}
      </button>
    </div>
  );
}

function EndScreen() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const app = useApp();
  const s = app.endSummary!;
  const internalized = useMemo(
    () => [...app.states.values()].filter((x) => x.masteryTier === 4).length,
    [app.states],
  );
  const isTrial = !app.profile.goalSlot;
  const fluentRate = s.answered ? Math.round((s.fluentFirstTry / s.answered) * 100) : 0;

  return (
    <div>
      <h1>{t("end.done")}</h1>

      {s.freezesConsumed > 0 && <div className="banner blue">{t("end.streakKept")}</div>}
      {s.streakBroke && (
        <div className="banner blue">
          {t("end.streakBroken", { internalized, best: s.streak.best })}
        </div>
      )}

      <div className="card">
        <h2>{t("end.evidence")}</h2>
        <div className="statgrid">
          <div className="stat"><div className="big">{fluentRate}%</div><div className="mut">{t("end.fluentRate")}</div></div>
          <div className="stat"><div className="big">{s.newGraduated}</div><div className="mut">{t("end.newGraduated")}</div></div>
          <div className="stat"><div className="big">{s.comebackCardIds.length}</div><div className="mut">{t("end.comebacks")}</div></div>
          <div className="stat"><div className="big">{s.streak.current}🔥</div><div className="mut">{t("today.streak")} · {s.streak.freezes}❄️</div></div>
        </div>
      </div>

      {s.dueTomorrow > 0 && (
        <div className="card">
          <div>{t("end.tomorrow", { count: s.dueTomorrow, min: Math.max(1, Math.round((s.dueTomorrow * 20) / 60)) })}</div>
          {s.tomorrowCardTarget && <div className="mut">{t("end.tomorrowCard", { card: s.tomorrowCardTarget })}</div>}
        </div>
      )}

      {isTrial ? (
        <div className="card">
          <h2>{t("end.goalTitle")}</h2>
          <div className="mut">{t("end.goalWhen")}</div>
          {(["morning", "noon", "evening", "custom"] as const).map((slot) => (
            <button
              key={slot}
              className="btn"
              onClick={() => {
                void app.setGoalSlot(slot).then(() => nav("/"));
              }}
            >
              {t(`end.slots.${slot}`)}
            </button>
          ))}
        </div>
      ) : (
        <button className="btn primary" onClick={() => nav("/")}>OK</button>
      )}
    </div>
  );
}

void DAY_MS;
export type { Card };
