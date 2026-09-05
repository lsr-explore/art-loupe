-- langgraph: where LangGraph writes checkpoints, deliberately outside the API surface.
--
-- An interrupted run has to resume in a different process than the one that paused it
-- (FR-402/403/404), so checkpoints must be durable rather than in-memory. What they hold is
-- live project state: the artist's intent, geometry candidates, and references to their
-- upload.
--
-- Why a dedicated schema rather than `public`: `supabase/config.toml` exposes
-- `["public", "graphql_public"]` through PostgREST, so a table created in `public` without
-- row policies is readable by anyone holding the anon key -- which is a published value, not
-- a secret. Putting the tables outside those schemas means the API has no route to them at
-- all, which is a stronger guarantee than a policy that has to be written correctly.
--
-- The tables themselves are NOT created here. `AsyncPostgresSaver.setup()` owns their shape
-- and migrates them across LangGraph versions; duplicating that DDL here would fork it. This
-- migration owns the schema and its privileges, which the library does not manage.

create schema if not exists langgraph;

comment on schema langgraph is
    'LangGraph checkpoint storage. Tables are created and migrated by AsyncPostgresSaver.setup(), not by a migration. Never expose this schema through PostgREST -- see supabase/config.toml `schemas`.';

-- Belt to the braces, and measured rather than assumed: as of this migration these revokes
-- are **inert**. Supabase's default-privilege grants to `anon`/`authenticated` are
-- schema-scoped -- `public`, `graphql`, `graphql_public`, `storage`, `supabase_functions` --
-- with no wildcard reaching a schema created here, so each statement below revokes something
-- that was never granted and `pg_default_acl` records nothing for `langgraph`. A schema
-- created with none of this measures identically.
--
-- They stay because what makes them inert is a Supabase provisioning detail, not a promise:
-- the day a platform upgrade grants into new schemas by default, these are what holds. The
-- assertions that actually protect the tables are in
-- `python/libs/persistence/tests/test_schema_privileges.py`, which tests the *outcome* --
-- that neither role can read anything here -- against a control proving the grants it guards
-- against are live in the same database.
revoke all on schema langgraph from anon, authenticated;
revoke all privileges on all tables in schema langgraph from anon, authenticated;

-- The saver creates its tables later, so the revokes above cannot cover them. Default
-- privileges apply to whatever it creates from here on.
alter default privileges in schema langgraph
    revoke all on tables from anon, authenticated;
alter default privileges in schema langgraph
    revoke all on sequences from anon, authenticated;
