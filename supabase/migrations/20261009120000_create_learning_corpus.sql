-- Shared, versioned book evidence. Backend access only; no artist data or PostgREST exposure.
create schema if not exists extensions;
create extension if not exists vector with schema extensions;
create schema learning;
revoke all on schema learning from public, anon, authenticated;
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'artloupe_learning_reader') then
    create role artloupe_learning_reader nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'artloupe_learning_writer') then
    create role artloupe_learning_writer nologin;
  end if;
end $$;
-- The migration owner can run local publication/read commands. Deployment logins receive
-- reader or writer separately; the application never uses this owner in production.
grant artloupe_learning_reader, artloupe_learning_writer to current_user;
set local search_path = learning, extensions, pg_catalog;
create table learning.corpora (
  version text primary key check (length(version) = 64),
  embedding_hash text not null check (length(embedding_hash) = 64),
  model text not null check (model = 'text-embedding-3-small'),
  dimensions integer not null check (dimensions = 1536),
  passage_count integer not null check (passage_count > 0),
  manifest jsonb not null,
  created_at timestamptz not null default now()
);
create table learning.passages (
  corpus_version text not null references learning.corpora(version),
  id text not null,
  book_id text not null,
  text text not null check (length(text) > 0),
  locator text not null,
  metadata jsonb not null,
  embedding vector(1536) not null,
  tsv tsvector generated always as (to_tsvector('english', locator || ' ' || text)) stored,
  primary key (corpus_version, id)
);
create index learning_passages_fts on learning.passages using gin(tsv);
create index learning_passages_cosine on learning.passages using hnsw(embedding vector_cosine_ops)
  with (m = 16, ef_construction = 64);
create table learning.active_corpus (
  singleton boolean primary key default true check (singleton),
  version text not null references learning.corpora(version)
);
create table learning.ingestion_runs (
  id bigint generated always as identity primary key,
  finished_at timestamptz not null default now(),
  status text not null check (status in ('published', 'unchanged', 'failed')),
  corpus_version text,
  source_count integer not null,
  passage_count integer not null,
  model text not null,
  dimensions integer not null,
  duration_seconds double precision not null,
  -- Only a failure category, never secrets, filesystem paths, or source text.
  failure text
);
grant usage on schema learning, extensions to artloupe_learning_reader, artloupe_learning_writer;
grant select on all tables in schema learning to artloupe_learning_reader;
grant select, insert, update on all tables in schema learning to artloupe_learning_writer;
grant usage on all sequences in schema learning to artloupe_learning_writer;
do $$ declare t text; begin
  foreach t in array array['corpora','passages','active_corpus','ingestion_runs'] loop
    execute format('alter table learning.%I enable row level security', t);
    execute format('create policy reader on learning.%I for select to artloupe_learning_reader using (true)', t);
    execute format('create policy writer on learning.%I for all to artloupe_learning_writer using (true) with check (true)', t);
  end loop;
end $$;
