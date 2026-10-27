-- Safe provenance only: no prompts, artwork, tokens or credentials.
alter table public.run_node_metrics
    add column inference jsonb not null default '[]'::jsonb
    check (jsonb_typeof(inference) = 'array');
comment on column public.run_node_metrics.inference is
    'Per-call task, provider, registered/requested/actual model and prompt ID/version/hash. No inputs.';
