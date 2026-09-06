import type { ReviewLogEntry } from "@lsa/core";
import { getSetting, setSetting, pendingShards, removeShard, mergeLogs } from "../db.js";

/**
 * SyncEngine（F7.4 机会性同步，spike-3 契约）：
 * - 云端只同步 ReviewLog 分片（MemoryState 本地重建，spike-6）；
 * - 分片只创建不覆盖（409 幂等）；delta 增量拉取；
 * - 令牌失效/未开通静默停，绝不弹窗打断训练——状态供 UI 展示。
 */

export interface SessionInfo {
  signedIn: boolean;
  driveConsented: boolean;
  displayName?: string;
}

export interface SyncStatus {
  session: SessionInfo;
  pending: number;
  lastSync: string | null;
  state: "idle" | "synced" | "reauth-required" | "provisioning" | "offline" | "error";
  mergedNew: number;
}

async function j<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

export async function fetchSession(): Promise<SessionInfo> {
  try {
    const res = await fetch("/api/session", { credentials: "include" });
    if (!res.ok) return { signedIn: false, driveConsented: false };
    return await j<SessionInfo>(res);
  } catch {
    return { signedIn: false, driveConsented: false };
  }
}

export async function syncNow(): Promise<SyncStatus> {
  const session = await fetchSession();
  const lastSync = (await getSetting<string>("lastSync")) ?? null;
  const base: Omit<SyncStatus, "state"> = {
    session,
    pending: (await pendingShards()).length,
    lastSync,
    mergedNew: 0,
  };
  if (!session.driveConsented) return { ...base, state: "idle" };

  try {
    // 1) 推送待上传分片（create-only，409 幂等成功）
    for (const shard of await pendingShards()) {
      const res = await fetch(`/api/drive/shard?path=${encodeURIComponent(shard.path)}`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(shard.body),
      });
      if (res.status === 401) return { ...base, state: "reauth-required" };
      if (res.status === 503) return { ...base, state: "provisioning" };
      if (!res.ok) return { ...base, state: "error" };
      await removeShard(shard.path);
    }

    // 2) delta 增量拉取远端分片并合并（幂等：按 ULID 去重）
    let mergedNew = 0;
    let cursor = (await getSetting<string>("driveCursor")) ?? "";
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await fetch(`/api/drive/changes${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`, {
        credentials: "include",
      });
      if (res.status === 401) return { ...base, state: "reauth-required" };
      if (res.status === 503) return { ...base, state: "provisioning" };
      if (!res.ok) return { ...base, state: "error" };
      const data = await j<{ entries?: { path: string; deleted?: boolean }[]; cursor?: string; resync?: boolean }>(res);
      if (data.resync) {
        cursor = ""; // 游标失效 → 全量重来（spike-3 契约）
        continue;
      }
      for (const entry of data.entries ?? []) {
        if (entry.deleted || !entry.path.startsWith("reviewlog/")) continue;
        const fileRes = await fetch(`/api/drive/file?path=${encodeURIComponent(entry.path)}`, { credentials: "include" });
        if (!fileRes.ok) continue;
        const file = await j<{ body: { entries?: ReviewLogEntry[] } }>(fileRes);
        if (file.body?.entries) mergedNew += await mergeLogs(file.body.entries);
      }
      if (data.cursor) await setSetting("driveCursor", data.cursor);
      break;
    }

    const now = new Date().toISOString();
    await setSetting("lastSync", now);
    return {
      session,
      pending: (await pendingShards()).length,
      lastSync: now,
      state: "synced",
      mergedNew,
    };
  } catch {
    return { ...base, state: "offline" };
  }
}
