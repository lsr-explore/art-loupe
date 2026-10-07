-- runs and run_events: one row per agent run, and the append-only log of what it did.
--
-- A run is a background job, not a request (docs/decision-records/poc-design-notes.md). The
-- agent records the run and returns at once; the run then appends progress to `run_events`,
-- and the studio follows that log over SSE, replaying from `Last-Event-ID` after a reload.
-- The log is the source of truth for what a run has done. Nothing about a run lives only in a
-- process's memory.
--
-- Who may write, and why it is not the artist. The agent reads artist data with the artist's own
-- token (ADR 0002). Run state cannot be written that way: any policy letting the agent update a
-- run row with the artist's token lets the artist update it too, through PostgREST, and forge
-- their own run's status or result. So:
--
--   1. `anon` and `authenticated` hold SELECT at most, and RLS confines an artist to their runs;
--   2. every write goes through two SECURITY DEFINER functions that enforce the legal
--      transitions, and a finished run cannot be changed by any of them;
--   3. only `artloupe_run_recorder`, a NOLOGIN role the Python service assumes with SET ROLE,
--      may execute those functions. It holds no table privilege at all.
--
-- Requirements this file enforces rather than merely records:
--   NFR-09  `runs.id` is the run id the studio, the agent and operations share
--   FR-806  runs and their events leave with their project (ADR 0003's cascade)
--
-- Deliberately not here: the foreign key from `run_node_metrics.run_id` and an owner read policy
-- on it. That column is `text` and this id is `uuid`, operations' read path is being reworked in
-- parallel (PR 14a), and a run's ledger outliving a deleted project is an open retention call.

do $$ begin
    if not exists (select 1 from pg_roles where rolname = 'artloupe_run_recorder') then
        create role artloupe_run_recorder nologin;
    end if;
end $$;

-- Locally the agent connects as `postgres` and narrows itself with SET ROLE. Postgres 16+ makes a
-- role's creator an ADMIN member without the SET option, so it is granted explicitly. This adds
-- nothing to `postgres`, which already bypasses RLS; a deployment instead grants this role to a
-- dedicated login that holds nothing else.
grant artloupe_run_recorder to postgres with set true, inherit false;

comment on role artloupe_run_recorder is
    'Assumed by the agent service (SET ROLE) to record run progress. May execute the artloupe_run_* functions and nothing else.';

-- ---------------------------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------------------------

create table if not exists public.runs (
    -- Issued by the agent, never by a caller (NFR-09).
    id uuid primary key,

    project_id uuid not null references public.projects (id) on delete cascade,

    -- Copied from the project when the run is created, so a policy can read it without a join.
    -- The create function refuses an owner that is not the project's.
    owner_id uuid not null references auth.users (id) on delete cascade,

    status text not null default 'queued'
        check (status in ('queued', 'running', 'succeeded', 'failed')),

    -- The finished run's response, on success only.
    result jsonb,

    -- A machine-readable reason and an artist-safe detail, on failure only.
    error jsonb,

    -- The last event's sequence number. Kept here so appending is one locked row, not a scan.
    last_seq integer not null default 0 check (last_seq >= 0),

    created_at timestamptz not null default now(),
    started_at timestamptz,
    finished_at timestamptz,

    constraint runs_result_only_on_success check (result is null or status = 'succeeded'),
    constraint runs_error_only_on_failure check (error is null or status = 'failed'),
    constraint runs_finished_when_terminal
        check ((finished_at is not null) = (status in ('succeeded', 'failed')))
);

comment on table public.runs is
    'One agent run (NFR-09). Readable by its owner; written only through the artloupe_run_* functions.';

create index if not exists runs_project_id_idx on public.runs (project_id, created_at desc);
create index if not exists runs_owner_id_idx on public.runs (owner_id);

create table if not exists public.run_events (
    run_id uuid not null references public.runs (id) on delete cascade,

    -- 1-based and gapless per run. This is the SSE event id a reconnecting client sends back.
    seq integer not null check (seq >= 1),

    kind text not null
        check (kind in ('started', 'node_started', 'node_finished', 'succeeded', 'failed')),

    payload jsonb not null default '{}'::jsonb,

    created_at timestamptz not null default now(),

    primary key (run_id, seq)
);

comment on table public.run_events is
    'Append-only progress log of one run. The SSE stream replays it after Last-Event-ID, then tails it.';

-- ---------------------------------------------------------------------------------------------
-- Write path: two functions
-- ---------------------------------------------------------------------------------------------

-- Record a new run as queued. Refuses a project that does not exist or is not the owner's,
-- with the same error for both, so the caller cannot tell which project ids are real.
create or replace function public.artloupe_run_create(
    p_run_id uuid, p_project_id uuid, p_owner_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
    if not exists (
        select 1 from public.projects
        where id = p_project_id and owner_id = p_owner_id
    ) then
        raise exception 'no project % for this owner', p_project_id
            using errcode = 'no_data_found';
    end if;

    insert into public.runs (id, project_id, owner_id) values (p_run_id, p_project_id, p_owner_id);
end;
$$;

-- Append one event, and move the run's status when the event is a transition.
--
--   started                  queued   -> running
--   node_started/finished    running  (no change)
--   succeeded                running  -> succeeded, payload becomes `result`
--   failed                   queued | running -> failed, payload becomes `error`
--
-- The row lock serializes appends to one run, which is what keeps `seq` gapless.
create or replace function public.artloupe_run_record(
    p_run_id uuid, p_kind text, p_payload jsonb default '{}'::jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
    current_status text;
    next_seq integer;
begin
    select status, last_seq + 1 into current_status, next_seq
    from public.runs where id = p_run_id
    for update;

    if not found then
        raise exception 'no run %', p_run_id using errcode = 'no_data_found';
    end if;

    if current_status in ('succeeded', 'failed') then
        raise exception 'run % is finished and cannot change', p_run_id
            using errcode = 'restrict_violation';
    end if;

    if (p_kind = 'started' and current_status <> 'queued')
        or (p_kind in ('node_started', 'node_finished', 'succeeded') and current_status <> 'running')
    then
        raise exception 'run % cannot record % while %', p_run_id, p_kind, current_status
            using errcode = 'restrict_violation';
    end if;

    insert into public.run_events (run_id, seq, kind, payload)
    values (p_run_id, next_seq, p_kind, coalesce(p_payload, '{}'::jsonb));

    update public.runs set
        last_seq = next_seq,
        status = case p_kind
            when 'started' then 'running'
            when 'succeeded' then 'succeeded'
            when 'failed' then 'failed'
            else status
        end,
        started_at = case when p_kind = 'started' then now() else started_at end,
        finished_at = case when p_kind in ('succeeded', 'failed') then now() else finished_at end,
        result = case when p_kind = 'succeeded' then p_payload else result end,
        error = case when p_kind = 'failed' then p_payload else error end
    where id = p_run_id;

    return next_seq;
end;
$$;

-- Supabase grants EXECUTE on new functions in `public` to `anon` and `authenticated` by default,
-- and PostgREST would expose them as RPCs. Revoking from all three is what makes the recorder the
-- only caller.
revoke all on function public.artloupe_run_create(uuid, uuid, uuid)
    from public, anon, authenticated;
revoke all on function public.artloupe_run_record(uuid, text, jsonb)
    from public, anon, authenticated;
grant execute on function public.artloupe_run_create(uuid, uuid, uuid) to artloupe_run_recorder;
grant execute on function public.artloupe_run_record(uuid, text, jsonb) to artloupe_run_recorder;

-- ---------------------------------------------------------------------------------------------
-- Privileges and row-level security
-- ---------------------------------------------------------------------------------------------

revoke all on public.runs, public.run_events from anon, authenticated;
grant select on public.runs, public.run_events to authenticated;

alter table public.runs enable row level security;
alter table public.run_events enable row level security;

drop policy if exists runs_select_own on public.runs;
create policy runs_select_own on public.runs
for select to authenticated
using (owner_id = (select auth.uid()));

drop policy if exists run_events_select_own on public.run_events;
create policy run_events_select_own on public.run_events
for select to authenticated
using (
    exists (
        select 1 from public.runs as owning_run
        where owning_run.id = run_events.run_id
          and owning_run.owner_id = (select auth.uid())
    )
);

-- No INSERT, UPDATE or DELETE policy for any API role, matching the grants above. Rows leave with
-- their project through the cascade.
