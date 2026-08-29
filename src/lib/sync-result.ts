export type SyncResult =
  | { success: true }
  | { success: false; retryable: boolean; error: string };
