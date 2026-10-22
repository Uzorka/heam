/** Per-request metadata attached to audit events and logs. Contains no PHI. */
export interface RequestMeta {
  requestId: string | null;
  ip: string | null;
  userAgent: string | null;
}

export const SYSTEM_META: RequestMeta = { requestId: null, ip: null, userAgent: null };
