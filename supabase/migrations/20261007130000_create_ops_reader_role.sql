-- artloupe_ops_reader: the one role that reads the cost ledger for the operations dashboard.
--
-- The operations app holds no database credential and no Supabase key. It forwards the
-- signed-in operator's own token to the agent service, which checks the operator role and
-- then reads `run_node_metrics` through a connection restricted to this role. The role is
-- held only by the Python service, in the style of `artloupe_inspiration_cache`.
--
-- This replaces what the `run_node_metrics` migration anticipated, that operations would hold
-- `service_role`. No app runtime holds it, operations included.
--
-- What the role can do is the whole design: SELECT on one table, nothing else. It cannot read
-- projects, images, auth tables or checkpoints, and it cannot write the ledger it reads.
-- RLS stays on. The policy below names this role alone, so `anon` and `authenticated` still
-- match no policy and keep no grant.
--
-- NOLOGIN, like the inspiration role. A deployment provisions a separate LOGIN role with
-- membership in this one and binds its DSN as ARTLOUPE_OPS_DATABASE_URL; the service sets
-- this role on every pooled connection before any query.

do $$ begin
    if not exists (select 1 from pg_roles where rolname = 'artloupe_ops_reader') then
        create role artloupe_ops_reader nologin;
    end if;
end $$;

-- Lets the project owner step DOWN into the role, which is how the local stack's DSN and the
-- test suite read as it. It adds nothing to `postgres`, which can already read every table.
grant artloupe_ops_reader to postgres;

grant usage on schema public to artloupe_ops_reader;
grant select on public.run_node_metrics to artloupe_ops_reader;

create policy ops_reader_reads_the_ledger on public.run_node_metrics
    for select to artloupe_ops_reader using (true);
