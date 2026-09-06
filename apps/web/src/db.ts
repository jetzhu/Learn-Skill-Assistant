import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { ReviewLogEntry } from "@lsa/core";

/** IndexedDB 布局（DESIGN §7.3）。MemoryState 不落库——启动时由日志重放重建（spike-6）。 */
interface LsaDB extends DBSchema {
  reviewlog: { key: string; value: ReviewLogEntry; indexes: { byTs: string } };
  settings: { key: string; value: { key: string; data: unknown } };
}

let dbPromise: Promise<IDBPDatabase<LsaDB>> | null = null;

export function db(): Promise<IDBPDatabase<LsaDB>> {
  dbPromise ??= openDB<LsaDB>("lsa", 1, {
    upgrade(d) {
      const logs = d.createObjectStore("reviewlog", { keyPath: "id" });
      logs.createIndex("byTs", "ts");
      d.createObjectStore("settings", { keyPath: "key" });
    },
  });
  return dbPromise;
}

export async function appendLog(entry: ReviewLogEntry): Promise<void> {
  await (await db()).put("reviewlog", entry);
}

export async function allLogs(): Promise<ReviewLogEntry[]> {
  return (await db()).getAllFromIndex("reviewlog", "byTs");
}

export async function getSetting<T>(key: string): Promise<T | undefined> {
  const row = await (await db()).get("settings", key);
  return row?.data as T | undefined;
}

export async function setSetting<T>(key: string, data: T): Promise<void> {
  await (await db()).put("settings", { key, data });
}

/** 一键删除全部本地数据（F7.8 的本地部分）。 */
export async function wipeAll(): Promise<void> {
  const d = await db();
  await d.clear("reviewlog");
  await d.clear("settings");
}

export async function exportAll(): Promise<{ logs: ReviewLogEntry[]; settings: Record<string, unknown> }> {
  const d = await db();
  const logs = await d.getAllFromIndex("reviewlog", "byTs");
  const settings: Record<string, unknown> = {};
  for (const row of await d.getAll("settings")) settings[row.key] = row.data;
  return { logs, settings };
}

/** 持久存储尽力申请（F6.4：iOS ITP 风险缓解，结果不可靠仍需 UI 提示）。 */
export async function tryPersist(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}
