/**
 * AuthProvider 契约（F6，BFF 模式 F6.5）：令牌只存在后端会话中，浏览器仅持 HttpOnly Cookie。
 * 前端消费的是「会话状态」而非令牌；本包定义双端共享的类型与端点约定。
 */

export type IdpKind = "microsoft" | "google";

export interface SessionInfo {
  signedIn: boolean;
  idp?: IdpKind;
  /** 展示名/邮箱（服务端会话下发，不含令牌）。 */
  displayName?: string;
  /** 云盘 scope 是否已增量授权（F7.7）。 */
  driveConsented?: boolean;
}

/** BFF 端点约定（DESIGN §5.4/§6）。 */
export const AUTH_ENDPOINTS = {
  start: (idp: IdpKind) => `/auth/${idp}/start`,
  callback: (idp: IdpKind) => `/auth/${idp}/callback`,
  driveConsent: "/auth/drive/consent",
  logout: "/auth/logout",
  session: "/api/session",
} as const;
