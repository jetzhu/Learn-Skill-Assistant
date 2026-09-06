import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useApp } from "../store.js";
import { i18next } from "../i18n.js";
import { unlockAudio, resetVoiceFailures } from "../speech/service.js";

/** F9.1：≤3 步进入第一张卡；登录/遥测同意全部后置（N11 时序）。 */
export default function Welcome() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const { completeOnboarding, startSession } = useApp();

  async function choose(packId: "zh-starter" | "en-speaking") {
    unlockAudio(); // 手势链内解锁音频（F2.4）
    resetVoiceFailures();
    await completeOnboarding(packId);
    await i18next.changeLanguage(packId === "zh-starter" ? "en" : "zh");
    startSession(true); // 体验会话（F9.2）
    nav("/session");
  }

  return (
    <div>
      <h1 style={{ fontSize: 28, marginTop: 48 }}>{t("welcome.title")}</h1>
      <p className="mut">{t("welcome.subtitle")}</p>
      <div className="card">
        <h2>{t("welcome.choose")}</h2>
        <button className="btn primary" onClick={() => void choose("zh-starter")}>{t("welcome.learnZh")}</button>
        <button className="btn primary" onClick={() => void choose("en-speaking")}>{t("welcome.learnEn")}</button>
      </div>
    </div>
  );
}
