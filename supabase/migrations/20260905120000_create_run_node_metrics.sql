-- run_node_metrics: one row per node execution -- the ledger operations reads (FR-905).
--
-- Written by `artloupe.metering.PostgresMetricsSink` when a run ends, and by nothing else.
-- It exists before the first paid call on purpose: a cost ledger added afterwards is
-- retroactively blank, and the operations cost panel would render an empty table.
--
-- Why `public` when the checkpoint tables are deliberately not:
-- `supabase/config.toml` exposes `["public", "graphql_public"]` through PostgREST, and this
-- table's only consumer is the operations dashboard, which reads Postgres through exactly
-- that API. Hiding it in an unexposed schema would hide it from the one thing that needs it.
-- What protects it is row-level security with no policy: `anon` and `authenticated` -- the
-- roles PostgREST authenticates as, and the anon key is a published value -- match no policy
-- and therefore see no rows, while `service_role`, which the operations app holds as an
-- environment credential, bypasses RLS entirely. Checkpoints get schema isolation because
-- nothing outside the graph reads them; this gets RLS because something must.
--
-- `run_id` carries no foreign key yet. The `runs` table arrives in a later slice-1 PR, and a
-- constraint pointing at a table that does not exist is not a constraint. When it lands, the
-- reference and an owner-scoped read policy belong together in that migration.

create table if not exists public.run_node_metrics (
    id                 bigint generated always as identity primary key,
    -- The NFR-09 identifier: the same value the studio shows the artist and the same value
    -- the checkpointer threads a resumed run onto.
    run_id             text        not null,
    -- The Supabase subject from the verified token -- what RLS will read as `auth.uid()`
    -- once there is a policy to read it. Never taken from a request body.
    owner              text        not null,
    node               text        not null,
    -- Executions of this node within this run, 1-based. A resumed run re-executes the whole
    -- node containing `interrupt()`, so a second row here is expected -- and is the only
    -- place the resulting double charge is visible.
    attempt            integer     not null check (attempt >= 1),
    started_at         timestamptz not null,
    duration_ms        integer     not null check (duration_ms >= 0),
    -- 'guard_stopped' is not an error: a run cut off by its own ceiling is the system
    -- working as designed (docs/design/agents.md section 8, BUDGET_STOPPED).
    status             text        not null check (status in ('ok', 'error', 'guard_stopped')),
    -- Null for a deterministic node, which spends no tokens at all.
    model              text,
    input_tokens       integer     not null default 0 check (input_tokens >= 0),
    output_tokens      integer     not null default 0 check (output_tokens >= 0),
    -- Kept apart from input_tokens because they bill at different rates. The budget ledger
    -- adds them together, because a token ceiling that ignored cached input would not be a
    -- ceiling; cost keeps them separate, because a cost that ignored the rates would be wrong.
    cache_read_tokens  integer     not null default 0 check (cache_read_tokens >= 0),
    cache_write_tokens integer     not null default 0 check (cache_write_tokens >= 0),
    -- Deterministic image-tool invocations. There is no image *generation* call to meter --
    -- FR-801 makes that structural, not a policy.
    tool_calls         integer     not null default 0 check (tool_calls >= 0),
    -- Nullable, and null means UNPRICED rather than free: the model was not in the price
    -- table. Zero is a real zero, reserved for nodes that spent no tokens. An operations
    -- panel that renders these identically is reporting a number it does not have.
    cost_usd           numeric(12, 6) check (cost_usd is null or cost_usd >= 0),
    error              text,
    recorded_at        timestamptz not null default now()
);

comment on table public.run_node_metrics is
    'Per-node token, latency and cost ledger for one agent run (NFR-04, NFR-09, FR-905). Written by artloupe.metering; read by the operations dashboard as service_role. RLS is enabled with no policy, so anon and authenticated can read nothing.';

-- The operations dashboard asks two questions: what did this run cost, and what has been
-- spent recently. One index each.
create index if not exists run_node_metrics_run_id_idx
    on public.run_node_metrics (run_id);
create index if not exists run_node_metrics_started_at_idx
    on public.run_node_metrics (started_at desc);

-- Deny-all by construction. Enabling RLS without adding a policy is the whole protection:
-- every role except `service_role` (and the table owner) matches nothing.
alter table public.run_node_metrics enable row level security;

-- Belt to the braces. `public` is the one schema where Supabase's default privileges DO
-- reach -- `anon` and `authenticated` are granted on tables created here -- so unlike the
-- revokes in the langgraph migration, these are not inert. RLS alone would already deny
-- every row; revoking the grant means the roles cannot see the table at all.
revoke all on public.run_node_metrics from anon, authenticated;
