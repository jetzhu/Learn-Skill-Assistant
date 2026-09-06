import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { makeIdFactory } from "@lsa/core";
import { useApp } from "../store.js";
import { classifySpeech, detectEnv } from "../speech/capability.js";
import { recognizeOnce, unlockAudio } from "../speech/service.js";

const newConvId = makeIdFactory();
const cap = typeof window !== "undefined" ? classifySpeech(detectEnv()) : null;

interface Msg {
  role: "coach" | "me";
  text: string;
}

/** AI 教练（F5）：突发情境 → 学生作答 → 先提示后示范 → 下一题。SSE 流式。 */
export default function Coach() {
  const { t } = useTranslation();
  const app = useApp();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState("");
  const convId = useRef(newConvId());

  const pack = app.packs.find((p) => p.id === app.profile.learnPackId) ?? app.packs[0]!;
  const targetLanguage = pack.ext?.lang?.targetLanguage ?? "en-US";

  /** 薄弱卡注入（F5.6）：已毕业但档位最低的卡。 */
  const weakTargets = useMemo(() => {
    return [...app.states.values()]
      .filter((s) => s.graduated && s.packId === pack.id)
      .sort((a, b) => a.rung - b.rung || b.totalLapses - a.totalLapses)
      .slice(0, 5)
      .map((s) => pack.cards.find((c) => c.id === s.cardId)?.target ?? "")
      .filter(Boolean);
  }, [app.states, pack]);

  async function turn(userAnswerText?: string) {
    setBusy(true);
    setError("");
    if (userAnswerText) setMessages((m) => [...m, { role: "me", text: userAnswerText }]);
    setMessages((m) => [...m, { role: "coach", text: "" }]);
    try {
      const res = await fetch("/api/coach/turn", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: convId.current,
          packName: pack.name.en,
          targetLanguage,
          userAnswerText: userAnswerText ?? "",
          weakTargets,
        }),
      });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const frame = buf.slice(0, i);
          buf = buf.slice(i + 2);
          if (!frame.startsWith("data: ")) continue;
          const ev = JSON.parse(frame.slice(6)) as { delta?: string; done?: boolean; error?: string };
          if (ev.delta) {
            setMessages((m) => {
              const out = [...m];
              const last = out[out.length - 1]!;
              out[out.length - 1] = { ...last, text: last.text + ev.delta };
              return out;
            });
          }
          if (ev.error) setError(ev.error);
        }
      }
    } catch (e) {
      setError(String(e).slice(0, 120));
    } finally {
      setBusy(false);
    }
  }

  async function voiceAnswer() {
    unlockAudio();
    setListening(true);
    const res = await recognizeOnce({ lang: targetLanguage });
    setListening(false);
    if (res.ok && res.transcript.trim()) void turn(res.transcript);
    else setError(t("session.voiceFail"));
  }

  return (
    <div>
      <h1>{t("coach.title")}</h1>
      {messages.length === 0 && (
        <div className="card">
          <div className="mut">{t("coach.intro")}</div>
          <button className="btn primary" disabled={busy} onClick={() => void turn()}>
            {busy ? "…" : t("coach.start")}
          </button>
        </div>
      )}
      {messages.map((m, i) => (
        <div key={i} className="card" style={m.role === "me" ? { borderColor: "var(--brand)" } : {}}>
          <div className="mut">{m.role === "me" ? "🙋" : "🎓"}</div>
          <div style={{ whiteSpace: "pre-wrap" }}>{m.text || (busy && i === messages.length - 1 ? "…" : "")}</div>
        </div>
      ))}
      {error && <div className="hintbox">{error}</div>}
      {messages.length > 0 && (
        <>
          {cap?.asrAvailable && pack.answerModes.includes("voice") && (
            <button className="btn primary" disabled={busy || listening} onClick={() => void voiceAnswer()}>
              {listening ? `👂 ${t("session.listening")}` : `🎤 ${t("session.speakAnswer")}`}
            </button>
          )}
          <div className="row">
            <input
              type="text"
              placeholder={t("session.typeIt")}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && input.trim() && !busy) {
                  void turn(input.trim());
                  setInput("");
                }
              }}
            />
            <button
              className="btn"
              style={{ maxWidth: 90 }}
              disabled={busy || !input.trim()}
              onClick={() => {
                void turn(input.trim());
                setInput("");
              }}
            >
              ➤
            </button>
          </div>
        </>
      )}
    </div>
  );
}
