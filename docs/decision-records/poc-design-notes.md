# Proof-of-concept design notes

Running notes on design calls made while the walking skeleton is still a proof of concept.
These are directions, not commitments. A note graduates to a numbered ADR once the design
settles, and is removed from here when it does.

## Run lifecycle, progress streaming, and who writes run state

**Guidance.** A run is a background job, not a request. `POST /runs` records the run and
returns at once. A worker executes the graph and appends progress to an append-only event log,
and that log is the only source of truth for what a run has done. The browser follows progress
over SSE, through a same-origin Next route that adds the artist's token on the server. The SSE
endpoint replays every event after the client's `Last-Event-ID`, then tails the log, so a reload
or a dropped connection loses nothing. The run's own writes (its status and its events) go
through a narrow Postgres role held only by the Python service. That role can execute a few
functions that enforce legal transitions, and nothing else. The artist's token reads run state
but cannot write it. The run still reads artist data as the artist, through RLS.

### Notes — 2026-10-07

- **Transport is SSE**, with the run detached from the connection (option B). Tying the run to
  the request (option A) was rejected because a closed or reloaded tab would cancel the run.
- **The event log is a `run_events` table** with a per-run sequence number. Rows are never
  updated. The `runs` row carries the current status and the final result.
- **The SSE endpoint polls the cursor** (`seq > last seen`) for now. `LISTEN/NOTIFY` needs a
  direct database connection and can replace polling later without changing the contract. The
  endpoint sends a heartbeat about every 15 seconds and closes after a terminal event.
- **The worker is stubbed behind one seam.** `dispatch_run` starts an in-process background task
  today. The NFR-02 worker pool (a queued Cloud Run worker) replaces only that function.
  Unverified: Cloud Run's default CPU throttling after a response is sent would starve an
  in-process task once deployed, which is one more reason the seam exists.
- **Run state is written by a scoped role, not the artist's token.** If the artist's token could
  update a run row, the artist could forge their own run's status or result through PostgREST,
  and run-health figures (PR 14b) would inherit the forgery. A role in the style of
  `artloupe_inspiration_cache`, held only by Python, closes that.
- **No MCP server.** MCP exposes tools to a model, and these writes come from the deterministic
  runtime. An MCP server may still fit later, for model-driven writes by the Planner or Tutor,
  and would wrap the same functions.
- **No per-project credential.** ADR 0002 forbids minting tokens, so the role restricts which
  operations are possible, and the functions check that the run and project match.
- **A queued design needs this anyway.** A job waiting in a queue cannot safely carry the
  artist's token, which may expire before a worker picks it up. That is the same reason the
  token stays out of `RunState`.

### What an eventual ADR must address

- It amends ADR 0002 (Python holds a credential for system-level writes) and the current-state
  invariant "the agent reads and writes artist data only as the artist".
- Whether the queued worker reads artist data with the artist's token or with a system role,
  once NFR-02 lands.
- The foreign key from `run_node_metrics.run_id` to `runs.id`, which S1 left out. The column is
  `text` and `runs.id` is `uuid`, and the key would decide whether a run's cost ledger survives
  its project's deletion, which is a retention call.
