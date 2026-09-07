-- Tie the storage object's lifecycle to the row that describes it (issue #22).
--
-- `on delete cascade` reaches rows; it does not reach the Storage API. Two defects followed
-- from that, and they share one cause:
--
--   1. Deleting a project removed its `source_images` row and left the **bytes** in the bucket.
--      The prefix-only SELECT policy kept authorizing the owner for the known key, so a
--      reference photograph the artist deleted stayed retrievable. FR-806 and NFR-10 both say
--      deletion is complete; it was not.
--   2. An owner could DELETE the object and INSERT different bytes at the same
--      `{owner}/{project}/{checksum}` key while `source_images` kept the original checksum.
--      Signed URLs and every derivative then served bytes that did not match their recorded
--      content identity, breaking FR-105 from the storage side.
--
-- Both were raised by Greptile on #20 and deferred there, because the fix is not something a
-- migration can do alone.
--
-- Measured on a live stack before choosing this shape, because two plausible designs turned
-- out to be impossible:
--
--   * **A `security definer` function cannot do it.** Supabase installs a
--     `protect_objects_delete` trigger on `storage.objects` that raises
--     "Direct deletion from storage tables is not allowed. Use the Storage API instead."
--     No SQL path deletes an object, so deletion is inherently two systems and cannot be one
--     transaction. The server path orders them instead: objects first, then rows, so a partial
--     failure leaves a row citing absent bytes -- recoverable and retryable -- rather than
--     bytes with no row, which is defect (1) above.
--   * **Deleting through the API does remove the bytes**, not just the metadata. Verified
--     against the local file backend: the object under
--     `/mnt/stub/stub/reference-images/...` disappeared with its row. That is what makes the
--     server path sufficient.
--
-- What this migration changes: only defect (2). Defect (1) is closed by the server-side
-- deletion path, which holds the **artist's own token** rather than `service_role` -- so no
-- RLS-bypassing credential enters an app runtime, and Postgres keeps answering the ownership
-- question in the one place it is already answered.

-- ---------------------------------------------------------------------------------------------
-- Refuse a second write to a key that a `source_images` row already claims
-- ---------------------------------------------------------------------------------------------

-- This is the storage-side counterpart to a decision the row side already made. `source_images`
-- has no DELETE policy and no DELETE grant, precisely because "delete then insert reaches the
-- same end" as an update. The object had exactly that hole one layer down, and it gets the same
-- remedy rather than a different one.
--
-- The added clause holds because of the order the pair is created in: the object is uploaded
-- first, then the row is written. At the moment of the original upload no row cites the key, so
-- the insert passes. Once the row exists, every later insert at that key is refused -- which is
-- what makes the bytes as immutable as the row.
--
-- The subquery runs under the caller's own RLS, so it sees only the artist's own rows. That is
-- sufficient rather than a gap: the first clause already confines the caller to keys beginning
-- with their own `auth.uid()`, so no other artist's row could describe a key they are able to
-- write. Adding a `security definer` helper to widen the check would buy nothing and would put
-- an elevated function on the upload path.
--
-- Note the deliberate asymmetry with the DELETE policy below, which is kept. Removing it was
-- the alternative, and it would have forced the deletion path to hold `service_role`. Keeping
-- it means an artist can still delete their own bytes directly, which NFR-10 wants, while the
-- INSERT guard is what stops that deletion being used to smuggle in different content.
drop policy if exists artloupe_reference_images_insert_own on storage.objects;
create policy artloupe_reference_images_insert_own on storage.objects
for insert to authenticated
with check (
    bucket_id = 'reference-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and not exists (
        select 1
        from public.source_images as claimed
        where claimed.storage_key = storage.objects.name
    )
);

comment on policy artloupe_reference_images_insert_own on storage.objects is
    'FR-105 from the storage side: an artist writes only under their own prefix, and never twice to a key a source_images row already cites.';
