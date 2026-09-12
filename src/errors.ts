export type ErrorCode = 'CREDENTIALS_MISSING' | 'AUTH_FAILED' | 'AUTH_CHALLENGE_REQUIRED' | 'SESSION_EXPIRED' | 'NETWORK_ERROR' | 'PARSE_ERROR' | 'ENDPOINT_UNAVAILABLE' | 'DOWNLOAD_TOO_LARGE';
export class LearnUsError extends Error {
  constructor(public readonly code: ErrorCode) { super(code); }
}
export function safeCode(error: unknown): ErrorCode {
  return error instanceof LearnUsError ? error.code : 'NETWORK_ERROR';
}
