/**
 * Delete one project, and everything that belongs to it (issue #22, FR-806, NFR-10).
 *
 * The gate above this handler establishes only that the caller is an artist on this surface —
 * middleware cannot know who owns a given project. Ownership is decided by RLS inside
 * `deleteProject`, which runs with the artist's own token, and a project belonging to someone
 * else is answered `404` rather than `403` so that no account can confirm another's ids.
 */

import { getAccessToken } from '@artloupe/auth/server';
import type { NextRequest } from 'next/server';
import { env } from '@/env';
import { notFound } from '@/lib/api/responses';
import { deleteProject } from '@/lib/storage/delete-project';

/** RFC 4122 shape, matching `reference-images.ts`. Anything else is not an id we ever issued. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const DELETE = async (
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) => {
  const { id } = await params;

  // Refused before it reaches PostgREST: the id is interpolated into a filter, and a value that
  // is not a UUID has no business getting that far.
  if (!UUID_PATTERN.test(id)) {
    return notFound();
  }

  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    return notFound();
  }

  // A demo session carries no Supabase tokens and therefore owns nothing to delete.
  const accessToken = await getAccessToken();
  if (accessToken === null) {
    return notFound();
  }

  const result = await deleteProject({
    supabaseUrl: env.SUPABASE_URL,
    anonKey: env.SUPABASE_ANON_KEY,
    accessToken,
    projectId: id,
  });

  if (result.ok) {
    // 204, not 200: there is nothing left to describe.
    return new Response(null, { status: 204 });
  }

  if (result.reason === 'not-found') {
    return notFound();
  }

  if (result.reason === 'partial') {
    // The one outcome that must never read as success. Storage removed fewer objects than were
    // asked for, so the rows were deliberately left behind and this project still exists. 500
    // rather than 502: the request reached everything it needed to and the *operation* is what
    // failed, and a client retrying is exactly the right response.
    return Response.json({ error: 'deletion_incomplete' }, { status: 500 });
  }

  return Response.json({ error: 'storage_unavailable' }, { status: 502 });
};
