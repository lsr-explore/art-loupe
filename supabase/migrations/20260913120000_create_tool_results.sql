-- The agent's node cache: one row per deterministic tool run, keyed on its FR-305 recipe.
--
-- Why a table, when every tool is deterministic and could simply run again: the face detector
-- sends Google a usage report each time a landmarker closes (#43), so a result that is recomputed
-- on every reopen is a report sent on every reopen. `docs/design/geometry-confidence-plan.md` §6
-- promises that reopening a study sends nothing, and this table is what keeps that promise.
--
-- Same shape of defence as `source_images`, and for the same reason: the agent reads and writes
-- this table as the signed-in artist, relaying their Supabase-issued JWT (ADR 0002), so it must
-- sit in the API-exposed schema and row policies are the boundary.
--
--   1. every privilege is revoked from `anon`, and from `authenticated` before anything is granted
--      back, so Supabase's schema-wide default grants cannot leave a verb behind;
--   2. `authenticated` is granted SELECT and INSERT only -- a cached result never changes, and it
--      leaves only when its project does;
--   3. RLS confines an artist to rows under their own projects, and the insert policy also ties
--      each row to the photograph it claims to describe.
--
-- Requirements this file enforces rather than merely records:
--   FR-105  a result cites the checksum of its project's own original, and only that one
--   FR-305  the key is the recipe: tool, tool version, and validated parameters
--   FR-806  deletion cascades from the project, so it is complete without a change to the path
--           ADR 0003 describes

create table if not exists public.tool_results (
    id uuid primary key default gen_random_uuid(),

    -- ADR 0003: derivative tables "join the cascade as they are built and need no change to the
    -- deletion path, provided they hang off `projects`." This one does.
    --
    -- Keyed per project rather than per owner and checksum on purpose. An artist may upload one
    -- photograph to two projects; deleting one of them must take its results and leave the
    -- other's, and a shared row could do only one of those.
    project_id uuid not null references public.projects (id) on delete cascade,

    -- FR-105. The checksum of the project's original, restated so a row can be read on its own
    -- as a claim about specific bytes. The insert policy refuses any other checksum.
    source_checksum text not null,

    -- Which run of which tool. Deliberately not a check-constrained vocabulary, for the reason
    -- `projects.intent.medium` is not one: the names are owned in Python, beside the tools, and
    -- a third copy here would make adding a tool a migration.
    tool text not null,

    -- FR-305. The version names every library that can move the output, so a library upgrade is
    -- a new key rather than a stale hit.
    tool_version text not null,

    -- SHA-256 of the validated parameters as canonical JSON. A digest rather than the parameters
    -- themselves so the unique key stays a fixed width; the parameters are inside `result`.
    parameters_digest text not null,

    -- The tool's result, pixels excluded. Slice 1 keeps no derivative pixels (FR-305's recipe
    -- regenerates them), so what is stored is everything else the tool measured.
    result jsonb not null,

    created_at timestamptz not null default now(),

    constraint tool_results_checksum_is_sha256 check (source_checksum ~ '^[0-9a-f]{64}$'),
    constraint tool_results_parameters_digest_is_sha256
        check (parameters_digest ~ '^[0-9a-f]{64}$'),

    -- One row per recipe. A second insert for the same recipe is a cache race between two runs,
    -- and the agent writes with ignore-duplicates, so the loser simply keeps the winner's row.
    constraint tool_results_one_row_per_recipe
        unique (project_id, tool, tool_version, parameters_digest)
);

comment on table public.tool_results is
    'The agent''s node cache (slice-1 PR 12): one deterministic tool result per FR-305 recipe, per project. Written and read as the artist; immutable; removed only by the project cascade.';

comment on column public.tool_results.result is
    'The tool result as JSON, pixels excluded -- slice 1 regenerates pixels from the recipe rather than storing them.';

-- ---------------------------------------------------------------------------------------------
-- Immutability
-- ---------------------------------------------------------------------------------------------

-- A cached result that changed under the same recipe would mean the tool is not deterministic, or
-- that something rewrote a measurement after the fact. Neither has a legitimate path, so the
-- trigger refuses it for callers that bypass RLS as well -- the same reasoning, and the same
-- construction, as `artloupe_reject_source_image_update`.
create or replace function public.artloupe_reject_tool_result_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    raise exception
        'tool_results rows are immutable -- a changed recipe is a new row, not an edit'
        using errcode = 'restrict_violation';
end;
$$;

comment on function public.artloupe_reject_tool_result_update() is
    'Cached tool results are immutable, for callers that bypass RLS as well as for those that do not.';

revoke all on function public.artloupe_reject_tool_result_update() from anon, authenticated;

create or replace trigger tool_results_are_immutable
before update on public.tool_results
for each row
execute function public.artloupe_reject_tool_result_update();

-- ---------------------------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------------------------

revoke all on public.tool_results from anon, authenticated;

grant select, insert on public.tool_results to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------------------------

alter table public.tool_results enable row level security;

-- No owner column of its own. Ownership is derived from the project, so the owner is recorded in
-- exactly one place, as it is for `source_images`.
drop policy if exists tool_results_select_own on public.tool_results;
create policy tool_results_select_own on public.tool_results
for select to authenticated
using (
    exists (
        select 1
        from public.projects as owning_project
        where owning_project.id = tool_results.project_id
          and owning_project.owner_id = (select auth.uid())
    )
);

-- Two conditions, and the second is the one worth reading. Owning the project is the isolation
-- half. Matching the project's own original is the FR-105 half: without it, a row could sit under
-- project A while claiming to describe some other checksum, and every later cache hit would hand
-- a measurement of the wrong photograph to the artist as a measurement of theirs.
drop policy if exists tool_results_insert_own on public.tool_results;
create policy tool_results_insert_own on public.tool_results
for insert to authenticated
with check (
    exists (
        select 1
        from public.projects as owning_project
        join public.source_images as original on original.project_id = owning_project.id
        where owning_project.id = tool_results.project_id
          and owning_project.owner_id = (select auth.uid())
          and original.checksum = tool_results.source_checksum
    )
);

-- No UPDATE policy and no DELETE policy, matching the grants above. A result leaves when its
-- project is deleted; a cascade is performed internally and is not subject to this table's
-- policies, which `test_tool_results_rls.py` asserts rather than assumes.
