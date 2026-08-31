/**
 * StorageProvider 契约（REQUIREMENTS F7 / DESIGN §5.1，语义按 spike-3 实测固化）。
 * 用户数据只存在用户自己控制的存储里；本接口的实现不得依赖盘级元数据接口。
 */

export type StorageKind = "onedrive" | "gdrive" | "local";

/**
 * - "reauth-required"：任何 401 一律映射到此（spike-3：过期令牌报文不可解析文本）。
 * - "provisioning"：云盘未开通（OneDrive 503 pending provisioning）——UI 引导开通 + 指数退避。
 */
export type ProviderStatus = "ready" | "reauth-required" | "provisioning" | "offline";

export interface RemoteEntry {
  path: string;
  etag: string;
  size: number;
  deleted?: boolean;
}

export type ConditionalWriteResult =
  | { ok: true; etag: string }
  | { ok: false; conflict: { body: Uint8Array; etag: string } };

export interface StorageProvider {
  readonly kind: StorageKind;
  status(): Promise<ProviderStatus>;

  /** 追加型分片：只创建不覆盖（conflictBehavior=fail 语义）；已存在 → 幂等成功返回。 */
  createShard(path: string, body: Uint8Array): Promise<void>;

  /** 增量变更（delta/changes）。cursor=null 为初始全量；游标失效应回退全量并返回新游标。 */
  listChanges(cursor: string | null): Promise<{ entries: RemoteEntry[]; cursor: string }>;

  read(path: string): Promise<{ body: Uint8Array; etag: string } | null>;

  /** 可变文档的乐观并发写：etag=null 表示创建；412 冲突返回远端当前内容供合并。 */
  writeConditional(path: string, body: Uint8Array, etag: string | null): Promise<ConditionalWriteResult>;

  delete(path: string): Promise<void>;
}

/** 云端存储布局（DESIGN §3.3）。 */
export const STORAGE_PATHS = {
  meta: "meta.json",
  settings: "settings.json",
  pack: (packId: string) => `packs/${packId}.json`,
  reviewLogShard: (deviceId: string, sessionId: string) => `reviewlog/${deviceId}-${sessionId}.json`,
  coach: (conversationId: string) => `coach/${conversationId}.json`,
} as const;
