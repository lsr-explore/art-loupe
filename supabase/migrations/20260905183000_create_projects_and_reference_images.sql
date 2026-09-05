-- Projects, the immutable reference photograph each one is built from, and the private
-- bucket that holds the bytes.
--
-- Why `public`, when the checkpoint tables deliberately went somewhere else: checkpoints are
-- machine state that no browser ever queries, so the strongest guarantee available was to put
-- them outside the PostgREST surface entirely. These tables are the opposite. The studio reads
-- and writes them as the signed-in artist, relaying that artist's Supabase-issued JWT so
-- `auth.uid()` resolves to a real person (ADR 0002). That requires an API-exposed schema, which
-- means row policies are the only thing standing between one artist's work and another's.
--
-- Measured, not assumed: Supabase's default-privilege grants to `anon` and `authenticated` are
-- schema-scoped, and `public` is one of the schemas they cover. A table created here is granted
-- to `anon` unless something takes the grant away, and the anon key is a published value rather
-- than a secret. So this migration does three separable things, and each is tested on its own:
--
--   1. revokes every privilege from `anon`, because nothing anonymous has business here;
--   2. grants `authenticated` exactly the verbs the artist needs -- explicitly, so the tables
--      keep working when `auto_expose_new_tables` flips to false (see supabase/config.toml);
--   3. enables RLS and writes owner policies, which is what confines a signed-in artist to
--      their own rows.
--
-- `service_role` and `postgres` hold BYPASSRLS and are unaffected by any of this. That is
-- deliberate and is why neither key is ever handed to a browser.
--
-- Requirements this file enforces rather than merely records:
--   FR-101  one reference photograph per project; format, size, and long-edge bounds
--   FR-104  the typed ProjectIntent is persisted against the project
--   FR-105  the original upload is immutable, and its checksum is what derivatives point at
--   FR-106  EXIF and filename are stored as untrusted provenance, never as instruction
--   NFR-10  retention is stated on the row, and deletion cascades so it is complete

-- ---------------------------------------------------------------------------------------------
-- projects
-- ---------------------------------------------------------------------------------------------

create table if not exists public.projects (
    id uuid primary key default gen_random_uuid(),

    -- The artist. `on delete cascade` is half of NFR-10: deleting the account deletes the work,
    -- rather than leaving orphaned rows that no policy can any longer reach.
    owner_id uuid not null references auth.users (id) on delete cascade,

    title text,

    -- FR-104. The typed `ProjectIntent` lands here as JSON.
    --
    -- The check is structural on purpose. `medium` is a closed vocabulary that already exists in
    -- two places -- `packages/schemas/src/intent.ts` and `python/libs/schemas` -- and encoding it
    -- a third time in a check constraint would make widening it a migration rather than a
    -- two-line diff, with three copies to drift apart. Zod and Pydantic own the vocabulary; the
    -- database owns "this is an object and it has the two fields nothing downstream can run
    -- without".
    intent jsonb,

    -- NFR-10, the "stated" half. The sweep that acts on this is not built yet; the column exists
    -- so retention is a fact on the row rather than a sentence in a document, and so the job that
    -- eventually enforces it has something to select on.
    retention_expires_at timestamptz not null default (now() + interval '365 days'),

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    -- `jsonb_exists` before `jsonb_typeof`, and not for tidiness: `jsonb_typeof` of a missing
    -- key is NULL, a check constraint passes on NULL, and the constraint would have admitted an
    -- intent with no time budget at all. Caught by the test that asserts it is refused.
    constraint projects_intent_is_shaped check (
        intent is null
        or (
            jsonb_typeof(intent) = 'object'
            and jsonb_exists(intent, 'medium')
            and jsonb_typeof(intent -> 'medium') = 'string'
            and jsonb_exists(intent, 'time_budget_minutes')
            and jsonb_typeof(intent -> 'time_budget_minutes') = 'number'
        )
    )
);

comment on table public.projects is
    'One artist project: the intent they stated (FR-104) and the retention clock on it (NFR-10). Owner-scoped by RLS -- this table is API-exposed, so the policies are the boundary.';

comment on column public.projects.intent is
    'Typed ProjectIntent as JSON (FR-104). The medium vocabulary is owned by packages/schemas and python/libs/schemas, not by a check constraint here.';

comment on column public.projects.retention_expires_at is
    'When this project and everything cascading from it becomes eligible for deletion (NFR-10). Enforcement job not built yet.';

create index if not exists projects_owner_id_idx on public.projects (owner_id);

-- ---------------------------------------------------------------------------------------------
-- source_images -- the immutable original (FR-101, FR-105, FR-106)
-- ---------------------------------------------------------------------------------------------

create table if not exists public.source_images (
    id uuid primary key default gen_random_uuid(),

    -- Unique, not merely a foreign key: FR-101 is "the artist uploads *one* reference
    -- photograph". Stated as a constraint, a second upload is a conflict the database reports
    -- rather than a rule the route handler is trusted to remember.
    project_id uuid not null unique references public.projects (id) on delete cascade,

    -- FR-105. Lowercase hex SHA-256 of the bytes, matching `checksumSchema` in
    -- packages/schemas. Every derivative, cache entry, and measured claim points back at this
    -- value -- never at the signed URL, which rotates, and never at the bytes.
    checksum text not null,

    -- Object key inside the private bucket. Format is `{owner_id}/{project_id}/{checksum}`:
    -- the leading segment is what the storage policies below match on, and the trailing segment
    -- is what the `storage_key_ends_with_checksum` constraint ties to the content.
    storage_key text not null unique,

    mime_type text not null,
    width_px integer not null,
    height_px integer not null,
    byte_size bigint not null,

    -- FR-106. Both of these are attacker-controlled text that arrived inside an image file.
    -- They are kept for provenance and for the injection screening that runs at ingest, and
    -- they are never read back as instruction. The column comments say so where a future
    -- reader will actually be standing.
    original_filename text,
    exif jsonb not null default '{}'::jsonb,

    created_at timestamptz not null default now(),

    constraint source_images_checksum_is_sha256 check (checksum ~ '^[0-9a-f]{64}$'),

    -- FR-101, restated where it cannot be skipped. The route handler refuses these with a
    -- reason the artist can read; the constraint is what makes the refusal load-bearing rather
    -- than advisory.
    constraint source_images_mime_type_is_accepted check (
        mime_type in ('image/jpeg', 'image/png', 'image/webp')
    ),
    constraint source_images_within_size_limit check (byte_size > 0 and byte_size <= 26214400),
    constraint source_images_has_pixels check (width_px > 0 and height_px > 0),
    constraint source_images_long_edge_is_usable check (greatest(width_px, height_px) >= 800),

    -- Content addressing, enforced. A key that does not end in its own row's checksum means the
    -- bytes in the bucket and the checksum every derivative cites have come apart, which is the
    -- one way FR-105 fails silently.
    --
    -- The project segment is checked too, not only the checksum. Checking the suffix alone let
    -- a row own project A while pointing at project B's object path: the RLS policy validates
    -- that you own `project_id`, and this constraint validated the checksum, and neither
    -- noticed the middle segment naming somebody else's project. Signed reads and derivatives
    -- would then resolve the wrong bytes.
    --
    -- That leaves only the owner segment unchecked here, and it is closed elsewhere rather
    -- than left open: the storage policies match `(storage.foldername(name))[1] = auth.uid()`,
    -- so a client can only write under its own prefix, and the insert policy requires it to
    -- own `project_id` — so the owner segment is necessarily the project's owner.
    constraint source_images_key_matches_project_and_checksum
        check (storage_key like ('%/' || project_id::text || '/' || checksum))
);

comment on table public.source_images is
    'The immutable original (FR-105). One row per project (FR-101). Updates are refused by trigger, by the absence of an UPDATE policy, and by the absence of an UPDATE grant.';

comment on column public.source_images.original_filename is
    'UNTRUSTED (FR-106). Attacker-controlled text stored for provenance and injection screening. Never interpreted as instruction.';

comment on column public.source_images.exif is
    'UNTRUSTED (FR-106). Extracted EXIF, stored for provenance and injection screening. Never interpreted as instruction.';

-- ---------------------------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------------------------

create or replace function public.artloupe_set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    new.updated_at := now();
    return new;
end;
$$;

-- FR-105, in the database rather than in a convention.
--
-- The RLS story below already omits an UPDATE policy, and the grants below already omit the
-- UPDATE privilege, so an artist cannot mutate a row through the API. This trigger covers the
-- paths those two do not: `service_role`, `postgres`, and any future migration or job that
-- reaches the table with RLS bypassed. Immutability that only holds for the least-privileged
-- caller is not immutability.
create or replace function public.artloupe_reject_source_image_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    raise exception
        'source_images rows are immutable (FR-105) -- delete the project and re-upload instead'
        using errcode = 'restrict_violation';
end;
$$;

comment on function public.artloupe_reject_source_image_update() is
    'FR-105 immutability, enforced for callers that bypass RLS as well as for those that do not.';

-- Trigger functions are not RPC. Revoking EXECUTE keeps them off the PostgREST surface without
-- affecting the triggers, whose permissions are checked when the trigger is created.
revoke all on function public.artloupe_set_updated_at() from anon, authenticated;
revoke all on function public.artloupe_reject_source_image_update() from anon, authenticated;

create or replace trigger projects_set_updated_at
before update on public.projects
for each row
execute function public.artloupe_set_updated_at();

create or replace trigger source_images_are_immutable
before update on public.source_images
for each row
execute function public.artloupe_reject_source_image_update();

-- ---------------------------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------------------------

-- Revoke first, from both roles, and only then grant back what is actually needed.
--
-- Revoking from `authenticated` as well is not symmetry for its own sake. Supabase's default
-- privileges grant ALL on a new `public` table, so `grant select, insert, delete` alone leaves
-- the inherited UPDATE sitting there — and UPDATE on `source_images` is precisely what FR-105
-- says must not exist. Caught by the test that asserts the privilege is absent. Adding to a
-- grant is visible in review; failing to take one away is not.
--
-- `anon` is revoked and never granted anything: nothing anonymous reads artist work, and the
-- studio is login-gated end to end. That is a separate defence from RLS, and only one of the
-- two can be got wrong by writing a policy badly.
revoke all on public.projects from anon, authenticated;
revoke all on public.source_images from anon, authenticated;

-- Explicit rather than inherited. `supabase/config.toml` records that `auto_expose_new_tables`
-- is on its way to defaulting false; when it flips, an inherited grant disappears and every
-- authenticated query starts failing. Naming the verbs here makes that a no-op.
grant select, insert, update, delete on public.projects to authenticated;
grant select, insert, delete on public.source_images to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------------------------

alter table public.projects enable row level security;
alter table public.source_images enable row level security;

-- `(select auth.uid())` rather than a bare call: wrapping it in a scalar subquery lets the
-- planner evaluate it once as an InitPlan instead of once per row, which is the difference
-- between an index scan and a sequential one on a table of any size.

drop policy if exists projects_select_own on public.projects;
create policy projects_select_own on public.projects
for select to authenticated
using (owner_id = (select auth.uid()));

-- WITH CHECK on insert is the half that is easy to leave out and expensive to leave out: without
-- it a signed-in artist can create rows owned by somebody else and then never see them again.
drop policy if exists projects_insert_own on public.projects;
create policy projects_insert_own on public.projects
for insert to authenticated
with check (owner_id = (select auth.uid()));

-- FR-104: the artist can edit their intent and re-run. USING decides which rows they may touch;
-- WITH CHECK stops the edit from handing the row to another owner.
drop policy if exists projects_update_own on public.projects;
create policy projects_update_own on public.projects
for update to authenticated
using (owner_id = (select auth.uid()))
with check (owner_id = (select auth.uid()));

-- NFR-10: the artist can delete their own work, and the cascades make it complete.
drop policy if exists projects_delete_own on public.projects;
create policy projects_delete_own on public.projects
for delete to authenticated
using (owner_id = (select auth.uid()));

-- `source_images` has no owner column of its own. Ownership is derived from the project, so
-- there is exactly one place the owner is recorded and no second copy to fall out of step.

drop policy if exists source_images_select_own on public.source_images;
create policy source_images_select_own on public.source_images
for select to authenticated
using (
    exists (
        select 1
        from public.projects as owning_project
        where owning_project.id = source_images.project_id
          and owning_project.owner_id = (select auth.uid())
    )
);

drop policy if exists source_images_insert_own on public.source_images;
create policy source_images_insert_own on public.source_images
for insert to authenticated
with check (
    exists (
        select 1
        from public.projects as owning_project
        where owning_project.id = source_images.project_id
          and owning_project.owner_id = (select auth.uid())
    )
);

drop policy if exists source_images_delete_own on public.source_images;
create policy source_images_delete_own on public.source_images
for delete to authenticated
using (
    exists (
        select 1
        from public.projects as owning_project
        where owning_project.id = source_images.project_id
          and owning_project.owner_id = (select auth.uid())
    )
);

-- Deliberately no UPDATE policy. See FR-105 and the trigger above.

-- ---------------------------------------------------------------------------------------------
-- Storage
-- ---------------------------------------------------------------------------------------------

-- Private bucket. `public = false` means no unauthenticated URL exists for any object in it;
-- reads go through a signed URL minted with the artist's own token, or through the read-through
-- image route the apps serve.
--
-- `file_size_limit` and `allowed_mime_types` restate FR-101 at the point of upload, where the
-- storage service can refuse the bytes before they are written. That is a different enforcement
-- point from the `source_images` constraints, which describe a row that already exists.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
    'reference-images',
    'reference-images',
    false,
    26214400,
    array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- Object policies match on the first path segment, which the key format makes the owner's user
-- id. A join back to `source_images` was the alternative and is worse: the object and the row
-- are written by two separate calls, so during an upload one of them always exists without the
-- other, and a policy spanning both would refuse the write that is meant to create the pair.
--
-- Every policy is scoped to `bucket_id`. `storage.objects` is one table shared by every bucket
-- in the project, so an unscoped policy would silently grant access to buckets added later.

drop policy if exists artloupe_reference_images_select_own on storage.objects;
create policy artloupe_reference_images_select_own on storage.objects
for select to authenticated
using (
    bucket_id = 'reference-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists artloupe_reference_images_insert_own on storage.objects;
create policy artloupe_reference_images_insert_own on storage.objects
for insert to authenticated
with check (
    bucket_id = 'reference-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
);

-- NFR-10 again: the artist can delete the bytes, not only the row that describes them.
drop policy if exists artloupe_reference_images_delete_own on storage.objects;
create policy artloupe_reference_images_delete_own on storage.objects
for delete to authenticated
using (
    bucket_id = 'reference-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
);

-- No UPDATE policy, which is what makes FR-105 true of the bytes and not only of the row: a
-- Supabase upload with `upsert: true` issues an UPDATE, so an overwrite of an existing original
-- is refused rather than silently replacing the thing every checksum points at.
