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

-- Defence in depth. The schema is already unreachable through PostgREST because it is absent
-- from config.toml's `schemas`, but that is one edit away from being wrong. These revokes
-- mean a future accidental exposure still yields nothing.
revoke all on schema langgraph from anon, authenticated;
revoke all privileges on all tables in schema langgraph from anon, authenticated;

-- The saver creates its tables later, so the revokes above cannot cover them. Default
-- privileges apply to whatever it creates from here on.
alter default privileges in schema langgraph
    revoke all on tables from anon, authenticated;
alter default privileges in schema langgraph
    revoke all on sequences from anon, authenticated;
