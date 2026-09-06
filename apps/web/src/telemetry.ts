import { getSetting, setSetting } from "./db.js";

/**
 * 客户端遥测（N8/N11 时序）：
 * - 首屏至首次训练完成前零上报（激活前 no-op）；
 * - 无安装 ID；跨日留存由本地 ReviewLog/时间戳计算后上报布尔事件（每事件至多一次）。
 */

let activated = false;

export async function initTelemetryGate(): Promise<void> {
  activated = (await getSetting<boolean>("activated")) ?? false;
}

export async function markActivated(): Promise<void> {
  if (activated) return;
  activated = true;
  await setSetting("activated", true);
}

export function track(event: string): void {
  if (!activated) return; // 首训完成前零上报（N11）
  void fetch("/api/t", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event }),
  }).catch(() => undefined);
}

/** 一次性事件（d1/d7/streak 里程碑）：本地记录已发标记。 */
export async function trackOnce(event: string): Promise<void> {
  if (!activated) return;
  const key = `sent:${event}`;
  if (await getSetting<boolean>(key)) return;
  await setSetting(key, true);
  track(event);
}

export async function checkRetentionEvents(firstSessionAt: string | null): Promise<void> {
  if (!firstSessionAt || !activated) return;
  const days = Math.floor((Date.now() - Date.parse(firstSessionAt)) / 86_400_000);
  if (days >= 1) await trackOnce("d1_retained");
  if (days >= 7) await trackOnce("d7_retained");
}
