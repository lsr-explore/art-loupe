/**
 * Runtime-agnostic exports — safe to import from any runtime (no `next/headers`).
 *
 * For cookie-backed helpers use the runtime-specific entry points:
 * - `@artloupe/auth/server` — Server Components / Actions / Route Handlers
 * - `@artloupe/auth/middleware` — Edge Middleware
 */
export { getSessionOptions, SESSION_COOKIE_NAME } from './options';
export { type AuthProvider, demoAuthProvider, type TokenRefresher } from './provider';
export {
  createSupabaseAuthProvider,
  createSupabaseTokenRefresher,
  type SupabaseAuthConfig,
} from './provider-supabase';
export type { AuthResult, Credentials, Role, Session, SessionData, Tokens } from './types';
