-- What injection screening found on each untrusted surface, recorded per project.
--
-- FR-803 is "detections are recorded by surface and shown in operations", and the second half
-- is what shapes this table: the operations dashboard (PR 14) needs to count by surface and by
-- rule without parsing anything, so `surface` and `rule_id` are columns rather than keys inside
-- a blob. A jsonb column on `source_images` was the alternative and was rejected twice over --
-- that table is immutable by trigger, so a re-screen could never amend it, and counting by
-- surface would mean unnesting jsonb in every ops query.
--
-- **Nothing in this system branches on a row in this table.** Screening records what arrived;
-- it does not gate, redact, or refuse. That is stated here because a reader looking for the
-- enforcement will not find one, and should not add one without deciding, deliberately, what
-- enforcement would mean for an artist whose camera wrote something odd into a maker note.
--
-- The rules themselves are not in the database. They live in
-- `packages/schemas/fixtures/screening-rules.json`, loaded by both the TypeScript screener and
-- the Python one, because a third copy here would be a third thing to drift -- and because
-- re-screening old rows under new rules must stay possible, which a check constraint on
-- `rule_id` would quietly prevent.
--
-- Requirements this file enforces rather than merely records:
--   FR-106  EXIF and filename are untrusted data, extracted for screening, never instruction
--   FR-505  retrieved documents are untrusted on the same footing
--   FR-803  screening on every untrusted surface, recorded by surface
--   NFR-10  deletion is complete -- detections cascade from the project

-- ---------------------------------------------------------------------------------------------
-- screening_detections
-- ---------------------------------------------------------------------------------------------

create table if not exists public.screening_detections (
    id uuid primary key default gen_random_uuid(),

    -- Ownership is derived from the project, exactly as `source_images` derives it: one place
    -- records who owns this, and there is no second copy to fall out of step. The cascade is
    -- what makes NFR-10 deletion complete without a sweep.
    project_id uuid not null references public.projects (id) on delete cascade,

    -- Which untrusted surface the text arrived on. Closed set, checked here because the ops
    -- panel groups by this column and a typo would silently create a fourth category that
    -- nobody is looking at.
    --
    -- Mirrors `SCREENED_SURFACES` in packages/schemas and python/libs/schemas. Unlike the
    -- medium vocabulary -- which is deliberately NOT constrained here, because widening it
    -- should stay a two-line diff -- this set is fixed by the architecture: a surface exists
    -- because something in the system reads text from it, which is a code change, not a
    -- vocabulary change.
    surface text not null,

    -- Which rule fired, e.g. `instruction-override`. Deliberately unconstrained: the rule set
    -- is versioned in the fixture, not here, and re-screening stored provenance under a later
    -- rule set must remain possible without a migration.
    rule_id text not null,

    -- `high` or `medium` today. Ranking for the ops panel; nothing reads it to decide anything.
    severity text not null,

    -- UNTRUSTED. A bounded window of the text that matched, kept so a human can see what
    -- arrived. Bounded at the source (EXCERPT_MAX_LENGTH = 160 in both screeners) and bounded
    -- again here, because the column's guarantee should not depend on the caller's discipline.
    excerpt text not null,

    created_at timestamptz not null default now(),

    constraint screening_detections_surface_is_known check (
        surface in ('filename', 'exif', 'ocr', 'project-goal', 'retrieved-document')
    ),
    constraint screening_detections_severity_is_known check (
        severity in ('high', 'medium', 'none')
    ),
    constraint screening_detections_excerpt_is_bounded check (length(excerpt) <= 512),

    -- One row per surface per rule per project. Screening the same upload twice must not
    -- double the counts the ops panel reports, and a retry after a partial failure is exactly
    -- the case that would otherwise do it.
    constraint screening_detections_are_unique unique (project_id, surface, rule_id)
);

comment on table public.screening_detections is
    'What injection screening found on each untrusted surface (FR-106, FR-505, FR-803). Recorded, never acted on: nothing in this system branches on a row here.';

comment on column public.screening_detections.surface is
    'Which untrusted surface the text arrived on. Mirrors SCREENED_SURFACES in packages/schemas and python/libs/schemas.';

comment on column public.screening_detections.rule_id is
    'Rule that fired, from packages/schemas/fixtures/screening-rules.json. Unconstrained on purpose so a later rule set can be applied to stored provenance without a migration.';

comment on column public.screening_detections.excerpt is
    'UNTRUSTED (FR-106). A bounded window of attacker-controlled text, stored so a human can see what arrived. Never interpreted as instruction.';

-- A surface that was screened and found nothing is NOT a row. A surface that was never screened
-- IS one, carrying `severity = 'none'` and this rule id.
--
-- The distinction is the entire reason this sentinel exists. OCR is not implemented in slice 1,
-- and an absent row is indistinguishable from a clean one -- so the ops panel would report
-- "no detections on any surface" and read as three-surface coverage when only two surfaces were
-- ever looked at. Writing the gap down makes the panel able to say "screened: filename, exif ·
-- not screened: ocr", which is the honest claim.
comment on constraint screening_detections_surface_is_known on public.screening_detections is
    'The closed set of untrusted surfaces. A surface never screened is recorded with rule_id ''surface-not-screened'' and severity ''none'', so an unscreened surface is visible rather than indistinguishable from a clean one.';

create index if not exists screening_detections_project_id_idx
    on public.screening_detections (project_id);

-- ---------------------------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------------------------

-- Revoke from both roles first, then grant back only what is needed. Supabase's default
-- privileges grant ALL on a new table in `public`, so `grant select, insert` alone would leave
-- the inherited UPDATE and DELETE sitting there -- and both are precisely what must not exist.
revoke all on public.screening_detections from anon, authenticated;

-- No UPDATE and no DELETE, and the reason is the same one that makes `source_images` immutable:
-- a detection is a record of what arrived. Amending it, or removing an inconvenient one, would
-- make the ops panel a claim about the present rather than a record of the past. An artist who
-- wants the record gone deletes the project, and the cascade takes it.
grant select, insert on public.screening_detections to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------------------------

alter table public.screening_detections enable row level security;

-- `(select auth.uid())` rather than a bare call, so the planner evaluates it once as an InitPlan
-- instead of once per row.

drop policy if exists screening_detections_select_own on public.screening_detections;
create policy screening_detections_select_own on public.screening_detections
for select to authenticated
using (
    exists (
        select 1
        from public.projects as owning_project
        where owning_project.id = screening_detections.project_id
          and owning_project.owner_id = (select auth.uid())
    )
);

-- WITH CHECK on insert is the half that is cheap to leave out and expensive to have left out:
-- without it a signed-in artist can write detections against another artist's project, which
-- would put attacker-chosen text into a panel a human reads while investigating.
drop policy if exists screening_detections_insert_own on public.screening_detections;
create policy screening_detections_insert_own on public.screening_detections
for insert to authenticated
with check (
    exists (
        select 1
        from public.projects as owning_project
        where owning_project.id = screening_detections.project_id
          and owning_project.owner_id = (select auth.uid())
    )
);
