import { getIronSession } from 'iron-session';
import type { NextRequest, NextResponse } from 'next/server';
import { getSessionOptions } from './options';
import type { Session, SessionData } from './types';

/**
 * Read the session inside Edge Middleware.
 *
 * Middleware doesn't have the `next/headers` cookie store, so iron-session reads
 * from the request and would write Set-Cookie to the response. The guard only
 * reads, so pass any response you intend to return (or a throwaway one) — it is
 * left untouched unless something calls `.save()`.
 */
export const getSessionFromRequest = async (
  req: NextRequest,
  res: NextResponse,
): Promise<Session | null> => {
  const session = await getIronSession<SessionData>(req, res, getSessionOptions());
  return session.user ?? null;
};
