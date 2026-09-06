/** 语音能力降级矩阵（N9，spike-1 实测定案）。纯函数便于测试。 */

export interface SpeechEnv {
  ua: string;
  standalone: boolean;
  hasSR: boolean;
  hasTTS: boolean;
}

export interface SpeechCapability {
  /** 该平台的默认作答方式。 */
  asrDefault: "voice" | "keyboard";
  /** 语音入口是否展示（off 时完全隐藏，F2.2）。 */
  asrAvailable: boolean;
  ttsAvailable: boolean;
  /** 诊断用矩阵行说明。 */
  reason: string;
}

export function classifySpeech(env: SpeechEnv): SpeechCapability {
  const isIOS = /iPhone|iPad|iPod/.test(env.ua);
  const isEdge = / Edg\//.test(env.ua);
  const isFirefox = /Firefox\//.test(env.ua);
  const tts = env.hasTTS;

  if (!env.hasSR || isFirefox) {
    return { asrDefault: "keyboard", asrAvailable: false, ttsAvailable: tts, reason: "no-speech-recognition" };
  }
  if (isIOS && env.standalone) {
    // spike-1 实测：standalone 下 service-not-allowed，系统级禁用
    return { asrDefault: "keyboard", asrAvailable: false, ttsAvailable: tts, reason: "ios-standalone-blocked" };
  }
  if (isEdge) {
    // 识别后端 2025–2026 多次成规模故障：可尝试，不默认
    return { asrDefault: "keyboard", asrAvailable: true, ttsAvailable: tts, reason: "edge-unreliable" };
  }
  if (isIOS) {
    return { asrDefault: "voice", asrAvailable: true, ttsAvailable: tts, reason: "ios-safari-best-effort" };
  }
  return { asrDefault: "voice", asrAvailable: true, ttsAvailable: tts, reason: "chrome-class" };
}

export function detectEnv(): SpeechEnv {
  const w = window as unknown as Record<string, unknown>;
  return {
    ua: navigator.userAgent,
    standalone:
      (navigator as unknown as { standalone?: boolean }).standalone === true ||
      window.matchMedia?.("(display-mode: standalone)").matches === true,
    hasSR: !!(w["SpeechRecognition"] ?? w["webkitSpeechRecognition"]),
    hasTTS: "speechSynthesis" in window,
  };
}

/** TTS 时长估算（spike-1：onend 会丢失，必须有兜底定时器，F2.4）。 */
export function estimateSpeechMs(text: string, lang: string): number {
  const perChar = lang.startsWith("zh") ? 320 : 65;
  return Math.min(20_000, 600 + text.length * perChar);
}
