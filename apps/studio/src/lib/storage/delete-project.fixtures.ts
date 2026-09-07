/** Fixtures for the project deletion path. Real UUIDs and a real checksum shape throughout. */

export const SUPABASE_URL = 'http://127.0.0.1:54321';
export const ANON_KEY = 'anon-key';
export const ACCESS_TOKEN = 'artist-access-token';

export const OWNER_ID = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
export const PROJECT_ID = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
export const CHECKSUM = 'a'.repeat(64);

export const STORAGE_KEY = `${OWNER_ID}/${PROJECT_ID}/${CHECKSUM}`;

/** What each leg of the path is recognised by, so a stub can answer per-URL. */
export const isProjectLookup = (url: string): boolean =>
  url.includes('/rest/v1/projects?') && url.includes('select=id');
export const isImageLookup = (url: string): boolean => url.includes('/rest/v1/source_images?');
export const isStorageDelete = (url: string): boolean => url.includes('/storage/v1/object/');
export const isProjectDelete = (url: string): boolean =>
  url.includes('/rest/v1/projects?') && !url.includes('select=id');

export const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
