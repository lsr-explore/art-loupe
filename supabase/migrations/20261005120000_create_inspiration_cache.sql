-- Public catalog metadata, not user data. Never exposed through PostgREST.
create schema if not exists inspiration;
revoke all on schema inspiration from public, anon, authenticated;
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'artloupe_inspiration_cache') then
    create role artloupe_inspiration_cache nologin;
  end if;
end $$;
create table inspiration.search_cache (
  key text primary key check (length(key) = 64),
  response jsonb not null,
  fetched_at timestamptz not null default now()
);
create index search_cache_fetched_at on inspiration.search_cache (fetched_at);
alter table inspiration.search_cache enable row level security;
create policy cache_worker on inspiration.search_cache for all
  to artloupe_inspiration_cache using (true) with check (true);
grant usage on schema inspiration to artloupe_inspiration_cache;
grant select, insert, update, delete on inspiration.search_cache to artloupe_inspiration_cache;
