-- Run health (FR-901) for the operations dashboard: `artloupe_ops_reader` may now read runs and
-- their event log, as well as the cost ledger.
--
-- The grant on `runs` is column-level, and what it leaves out is the point:
--   - `result` holds the artist's routing decision and the rationale written for them. Run
--     health needs to know that a run succeeded, not what it told the artist.
--   - `owner_id` names the artist. Operators do not need to know whose run failed.
-- `project_id` is included, so an operator can tell repeated runs of one project apart. It is
-- an opaque id; the role still cannot read `projects`, so it resolves to nothing further.
--
-- `run_events` is granted whole. Its payloads are node names and, on failure, a reason code
-- with the artist-safe detail the studio already shows.
--
-- As before, each policy names this role alone, so `anon` and `authenticated` gain nothing.

grant select (
    id, project_id, status, error, last_seq, created_at, started_at, finished_at
) on public.runs to artloupe_ops_reader;

grant select on public.run_events to artloupe_ops_reader;

create policy ops_reader_reads_runs on public.runs
    for select to artloupe_ops_reader using (true);

create policy ops_reader_reads_run_events on public.run_events
    for select to artloupe_ops_reader using (true);
