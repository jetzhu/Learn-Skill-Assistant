import { estimateSpeechMs } from "./capability.js";

/**
 * SpeechService（DESIGN §7.2 工程约束，全部来自 spike-1 实测）：
 * - AudioSessionMutex：TTS 与识别不得并发（并发时识别收不到语音）；
 * - TTS：首次手势解锁；onend 丢失 → 时长估算兜底；
 * - ASR：一律单句式；会话冷却 ≥800ms；`aborted` 自动重试一次；12s 守护。
 */

let audioUnlocked = false;
let ttsBusy = false;
let asrBusy = false;
let lastAsrEndAt = 0;
let currentUtterance: SpeechSynthesisUtterance | null = null; // 防 GC 丢事件

let voiceFailures = 0;
export function resetVoiceFailures(): void {
  voiceFailures = 0;
}
export function noteVoiceFailure(): number {
  return ++voiceFailures;
}
export function getVoiceFailures(): number {
  return voiceFailures;
}

/** 必须在用户手势调用链内调用（F2.4）。 */
export function unlockAudio(): void {
  if (audioUnlocked) return;
  audioUnlocked = true;
  try {
    type AC = typeof AudioContext;
    const Ctor: AC | undefined =
      (window as unknown as { AudioContext?: AC; webkitAudioContext?: AC }).AudioContext ??
      (window as unknown as { webkitAudioContext?: AC }).webkitAudioContext;
    if (Ctor) void new Ctor().resume();
    if ("speechSynthesis" in window) {
      speechSynthesis.cancel();
      speechSynthesis.speak(new SpeechSynthesisUtterance(""));
    }
  } catch {
    /* 解锁失败不阻塞（F2.4） */
  }
}

export type SpeakResult = "end" | "fallback-timer" | "unavailable";

export function speak(text: string, lang: string): Promise<SpeakResult> {
  if (!("speechSynthesis" in window) || asrBusy) return Promise.resolve("unavailable");
  return new Promise((resolve) => {
    ttsBusy = true;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    currentUtterance = u;
    u.lang = lang;
    let settled = false;
    const finish = (r: SpeakResult) => {
      if (settled) return;
      settled = true;
      ttsBusy = false;
      currentUtterance = null;
      resolve(r);
    };
    const guard = setTimeout(() => finish("fallback-timer"), estimateSpeechMs(text, lang) * 1.4 + 800);
    u.onend = () => {
      clearTimeout(guard);
      finish("end");
    };
    u.onerror = () => {
      clearTimeout(guard);
      finish("fallback-timer");
    };
    speechSynthesis.speak(u);
  });
}

export interface RecognizeResult {
  ok: boolean;
  transcript: string;
  confidence: number;
  error?: string;
}

type SRCtor = new () => SpeechRecognitionLike;
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((ev: { results: ArrayLike<ArrayLike<{ transcript: string; confidence: number }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((ev: { error: string }) => void) | null;
  onend: (() => void) | null;
}

function srCtor(): SRCtor | null {
  const w = window as unknown as { SpeechRecognition?: SRCtor; webkitSpeechRecognition?: SRCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function recognizeOnce(opts: {
  lang: string;
  onInterim?: (text: string) => void;
}): Promise<RecognizeResult> {
  const Ctor = srCtor();
  if (!Ctor) return { ok: false, transcript: "", confidence: 0, error: "unsupported" };
  if (ttsBusy) return { ok: false, transcript: "", confidence: 0, error: "tts-active" };
  if (asrBusy) return { ok: false, transcript: "", confidence: 0, error: "asr-active" };

  // 会话冷却（spike-1：快速重启 → aborted "Another request is started"）
  const wait = 800 - (Date.now() - lastAsrEndAt);
  if (wait > 0) await sleep(wait);

  asrBusy = true;
  try {
    const first = await attempt(Ctor, opts);
    if (!first.ok && first.error === "aborted") {
      await sleep(600);
      return await attempt(Ctor, opts); // 自动重试一次
    }
    return first;
  } finally {
    asrBusy = false;
    lastAsrEndAt = Date.now();
  }
}

function attempt(Ctor: SRCtor, opts: { lang: string; onInterim?: (t: string) => void }): Promise<RecognizeResult> {
  return new Promise((resolve) => {
    const r = new Ctor();
    r.lang = opts.lang; // 取自技能包 targetLanguage，禁止回退 UI 语言（F1.3）
    r.continuous = false; // 一律单句式（spike-1：连续模式无 final）
    r.interimResults = true;
    r.maxAlternatives = 1;

    let finalText = "";
    let confidence = 0;
    let errorCode: string | null = null;
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(guard);
      if (finalText) resolve({ ok: true, transcript: finalText, confidence });
      else resolve({ ok: false, transcript: "", confidence: 0, error: errorCode ?? "no-result" });
    };
    const guard = setTimeout(() => {
      try {
        r.stop();
      } catch {
        /* noop */
      }
      setTimeout(finish, 1500); // stop 后等 final 一小会
    }, 12_000);

    r.onresult = (ev) => {
      const res = ev.results[ev.results.length - 1];
      if (!res) return;
      const alt = res[0];
      if (!alt) return;
      if (res.isFinal) {
        finalText = alt.transcript;
        confidence = alt.confidence ?? 0;
      } else {
        opts.onInterim?.(alt.transcript);
      }
    };
    r.onerror = (ev) => {
      errorCode = ev.error;
    };
    r.onend = finish;

    try {
      r.start();
    } catch {
      errorCode = "start-threw";
      finish();
    }
  });
}
