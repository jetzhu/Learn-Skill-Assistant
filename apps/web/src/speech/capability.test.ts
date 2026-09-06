import { describe, it, expect } from "vitest";
import { classifySpeech, estimateSpeechMs } from "./capability.js";

const UA = {
  iosSafari:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 16_7_16 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6.2 Mobile/15E148 Safari/604.1",
  chromeWin: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36",
  edgeWin: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36 Edg/139.0.0.0",
  firefox: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:130.0) Gecko/20100101 Firefox/130.0",
};

describe("N9 speech capability matrix (spike-1 measured)", () => {
  it("Chrome-class → voice default", () => {
    const c = classifySpeech({ ua: UA.chromeWin, standalone: false, hasSR: true, hasTTS: true });
    expect(c).toMatchObject({ asrDefault: "voice", asrAvailable: true });
  });
  it("iOS Safari tab → voice best-effort", () => {
    const c = classifySpeech({ ua: UA.iosSafari, standalone: false, hasSR: true, hasTTS: true });
    expect(c).toMatchObject({ asrDefault: "voice", asrAvailable: true, reason: "ios-safari-best-effort" });
  });
  it("iOS standalone PWA → blocked (service-not-allowed, measured)", () => {
    const c = classifySpeech({ ua: UA.iosSafari, standalone: true, hasSR: true, hasTTS: true });
    expect(c).toMatchObject({ asrDefault: "keyboard", asrAvailable: false, reason: "ios-standalone-blocked" });
  });
  it("Edge → keyboard default, voice can be tried", () => {
    const c = classifySpeech({ ua: UA.edgeWin, standalone: false, hasSR: true, hasTTS: true });
    expect(c).toMatchObject({ asrDefault: "keyboard", asrAvailable: true, reason: "edge-unreliable" });
  });
  it("Firefox / no SR → voice entry hidden entirely", () => {
    const c = classifySpeech({ ua: UA.firefox, standalone: false, hasSR: false, hasTTS: true });
    expect(c).toMatchObject({ asrDefault: "keyboard", asrAvailable: false });
  });
});

describe("TTS duration fallback estimate (F2.4)", () => {
  it("scales with length, zh slower per char, capped", () => {
    expect(estimateSpeechMs("你好", "zh-CN")).toBeGreaterThan(estimateSpeechMs("hi", "en-US"));
    expect(estimateSpeechMs("x".repeat(5000), "en-US")).toBe(20_000);
  });
});
