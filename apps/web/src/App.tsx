import { useEffect, useRef } from "react";
import { Routes, Route, NavLink, Navigate, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useApp } from "./store.js";
import { initI18n, i18next } from "./i18n.js";
import Welcome from "./pages/Welcome.js";
import Today from "./pages/Today.js";
import Session from "./pages/Session.js";
import Packs from "./pages/Packs.js";
import Coach from "./pages/Coach.js";
import Stats from "./pages/Stats.js";
import Settings from "./pages/Settings.js";

initI18n(navigator.language.startsWith("zh") ? "zh" : "en");

export default function App() {
  const { ready, profile, init } = useApp();
  const booted = useRef(false);
  const loc = useLocation();
  const { t } = useTranslation();

  useEffect(() => {
    if (!booted.current) {
      booted.current = true;
      void init();
    }
  }, [init]);

  useEffect(() => {
    if (ready && i18next.language !== profile.uiLang) void i18next.changeLanguage(profile.uiLang);
  }, [ready, profile.uiLang]);

  if (!ready) return <div className="mut">…</div>;
  if (!profile.onboarded && loc.pathname !== "/welcome") return <Navigate to="/welcome" replace />;

  const inSession = loc.pathname === "/session";
  return (
    <>
      <Routes>
        <Route path="/welcome" element={<Welcome />} />
        <Route path="/" element={<Today />} />
        <Route path="/session" element={<Session />} />
        <Route path="/packs" element={<Packs />} />
        <Route path="/coach" element={<Coach />} />
        <Route path="/stats" element={<Stats />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      {!inSession && profile.onboarded && (
        <nav className="nav">
          <NavLink to="/" end className={({ isActive }) => (isActive ? "active" : "")}>{t("nav.today")}</NavLink>
          <NavLink to="/packs" className={({ isActive }) => (isActive ? "active" : "")}>{t("nav.packs")}</NavLink>
          <NavLink to="/coach" className={({ isActive }) => (isActive ? "active" : "")}>{t("nav.coach")}</NavLink>
          <NavLink to="/stats" className={({ isActive }) => (isActive ? "active" : "")}>{t("nav.stats")}</NavLink>
          <NavLink to="/settings" className={({ isActive }) => (isActive ? "active" : "")}>{t("nav.settings")}</NavLink>
        </nav>
      )}
    </>
  );
}
