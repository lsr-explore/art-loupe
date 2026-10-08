-- Run health (FR-901) for the operations dashboard: `artloupe_ops_reader` may now read runs and
-- a narrowed view of their event log, as well as the cost ledger.
--
-- What run health must not see is a run's outcome as the artist sees it:
--   - `result` holds the artist's routing decision and the rationale written for them;
--   - `owner_id` names the artist.
-- Operators need to know that a run succeeded, not what it told the artist or whose it was.
-- `project_id` stays readable, so an operator can tell repeated runs of one project apart. It
-- is an opaque id; the role still cannot read `projects`, so it resolves to nothing further.
--
-- So the grant on `runs` is column-level, and `run_events` is not granted at all. A run's
-- `succeeded` event carries the same full result as `runs.result` (owner and routing
-- included), so any grant on the raw payload would undo the column-level one. The reader gets
-- `ops.run_event_log` instead: each event's kind and time, the node a node event names, and a
-- failure's reason code — never the payload itself.
--
-- The view lives in its own `ops` schema, which PostgREST does not expose
-- (`supabase/config.toml` exposes `public` and `graphql_public`). Like any view it reads its
-- table as its owner, so it is granted to this role alone and to nobody else.

grant select (
    id, project_id, status, error, last_seq, created_at, started_at, finished_at
) on public.runs to artloupe_ops_reader;

create policy ops_reader_reads_runs on public.runs
    for select to artloupe_ops_reader using (true);

create schema if not exists ops;
revoke all on schema ops from public, anon, authenticated;
grant usage on schema ops to artloupe_ops_reader;

create or replace view ops.run_event_log as
select
    run_id,
    seq,
    kind,
    case when kind in ('node_started', 'node_finished') then payload ->> 'node' end as node,
    case when kind = 'failed' then payload ->> 'reason' end as reason,
    created_at
from public.run_events;

comment on view ops.run_event_log is
    'run_events without their payloads: kind, time, node name and failure reason only. Read by artloupe_ops_reader for run health (FR-901).';

revoke all on ops.run_event_log from public, anon, authenticated;
grant select on ops.run_event_log to artloupe_ops_reader;
