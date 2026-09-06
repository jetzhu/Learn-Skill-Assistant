import { useTranslation } from "react-i18next";
import { DAY_MS } from "@lsa/core";
import { useApp } from "../store.js";
import { exportAll, wipeAll } from "../db.js";
import { i18next } from "../i18n.js";

export default function Settings() {
  const { t } = useTranslation();
  const app = useApp();

  async function doExport() {
    // 数据可携（F7.9 本地部分）：公开 JSON 结构下载
    const data = await exportAll();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `lsa-export-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function doWipe() {
    if (!confirm(t("settings.wipeConfirm"))) return;
    await wipeAll();
    location.hash = "#/welcome";
    location.reload();
  }

  async function toggleLang() {
    const next = app.profile.uiLang === "en" ? "zh" : "en";
    await app.setUiLang(next);
    await i18next.changeLanguage(next);
  }

  async function startVacation(days: number) {
    const from = new Date();
    const to = new Date(from.getTime() + days * DAY_MS);
    await app.setVacation({ from: from.toISOString(), to: to.toISOString() });
  }

  return (
    <div>
      <h1>{t("settings.title")}</h1>

      <div className="card">
        <h2>{t("settings.uiLang")}</h2>
        <button className="btn" onClick={() => void toggleLang()}>
          {app.profile.uiLang === "en" ? "切换到中文界面" : "Switch to English UI"}
        </button>
      </div>

      <div className="card">
        <h2>{t("settings.vacation")}</h2>
        {app.vacation ? (
          <>
            <div className="mut">{app.vacation.from.slice(0, 10)} → {app.vacation.to.slice(0, 10)}</div>
            <button className="btn warn" onClick={() => void app.setVacation(null)}>{t("settings.vacationEnd")}</button>
          </>
        ) : (
          <div className="row">
            {[3, 7, 14].map((d) => (
              <button key={d} className="btn" onClick={() => void startVacation(d)}>{d}d</button>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <button className="btn" onClick={() => void doExport()}>{t("settings.exportData")}</button>
        <button className="btn bad" onClick={() => void doWipe()}>{t("settings.wipe")}</button>
      </div>
    </div>
  );
}
