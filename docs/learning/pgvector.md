# PostgreSQL ingestion and retrieval

The learning assistant supports two explicit backends. `files` is the default for existing
local workflows; `pgvector` reads a published PostgreSQL corpus. Docker Compose selects
`pgvector`. There is no silent file fallback when a database is missing or misconfigured.

## Prepare and publish

1. Apply `supabase/migrations/20261009120000_create_learning_corpus.sql` using the migration
   runner (`pnpm supabase migration up` for local Supabase). For a standalone database, apply
   the file in a transaction with `psql -1 -v ON_ERROR_STOP=1 -f ...`. The migration expects
   the existing Supabase roles `anon` and `authenticated`.
2. Extract the approved books with `learning.cli ingest` and create vectors with
   `learning.cli embed --allow-paid` as described in the learning README. Existing validated
   `corpus.jsonl`, `manifest.json`, `vectors.npy`, and `vectors.json` can be reused. Publishing
   itself makes no model calls and has no embedding charge.
3. Run the offline publisher from the repository root:

   ```sh
   export ARTLOUPE_LEARNING_INGEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres
   uv run --directory python --all-packages python -m artloupe.agent.learning.cli publish \
     --corpus /absolute/path/to/learning-corpus
   ```

The publisher validates corpus checksums, unique passage IDs, embedding model/dimensions,
finite nonzero vectors, and citation provenance. It serializes publishers with a transaction
advisory lock. All passages and embeddings are inserted in the same transaction as the active
version switch. Unchanged content and embedding files reuse the stored version. A changed
embedding file for an existing version is refused rather than mutating historical evidence.
Old versions remain available for in-flight requests and reproducible citations. Deliberate
retention cleanup is a future administrative operation, not part of publication.

`learning.ingestion_runs` records published, unchanged, and failed attempts, counts, model,
dimension, duration, and failure category. A database outage cannot record its own failure;
the CLI exits unsuccessfully. No credentials, prompts, source excerpts, or filesystem paths
are written to the audit table.

## Runtime

```sh
export ARTLOUPE_RETRIEVAL_BACKEND=pgvector
export ARTLOUPE_LEARNING_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres
uv run --directory python --all-packages python -m artloupe.agent.service
```

No `ARTLOUPE_LEARNING_CORPUS` setting or corpus filesystem mount is needed by this backend.
An empty/unavailable database returns the learning endpoint's existing 503 response. The
other agent endpoints can still start. OpenAI credentials are required for query embeddings;
Anthropic credentials are required for answer generation.

Dense retrieval uses 1536-dimensional `text-embedding-3-small` vectors, cosine distance,
and an HNSW index (`m=16`, `ef_construction=64`). Sparse retrieval uses English PostgreSQL
full-text search and `ts_rank_cd`; it is **not BM25**. The top 30 candidates from each leg
are combined with reciprocal rank fusion (`k=60`), stable ID tie-breaking, deduplication,
and the existing cosine similarity floor of 0.25. Spanish queries use the multilingual
semantic leg. Existing prompt screening and citation resolution remain downstream.
The migration owner receives both roles for local administration.
The file backend and PostgreSQL sparse backend have different tokenization/ranking;
file-baseline scores should not be presented as PostgreSQL evaluation results.

## Cloud Run and Cloud SQL

Cloud SQL PostgreSQL supports the `vector` extension. Cloud Run can connect via the attached
Cloud SQL Unix socket (`/cloudsql/PROJECT:REGION:INSTANCE`) or configured private networking:

- [Cloud SQL PostgreSQL extensions](https://docs.cloud.google.com/sql/docs/postgres/extensions)
- [Connect Cloud Run to Cloud SQL](https://docs.cloud.google.com/sql/docs/postgres/connect-run)
- [pgvector indexing and distance operators](https://github.com/pgvector/pgvector)

Use a dedicated runtime login with membership **only** in `artloupe_learning_reader` and a
separate ingestion-job login with membership in `artloupe_learning_writer`. These NOLOGIN
roles are created by the migration. Do not grant the runtime the writer role, database-owner
access, or a Supabase service key. The backend sets its role on each transaction; table RLS
also restricts access. The schema is not exposed through PostgREST.

For a standalone Cloud SQL database, provision the application's Supabase role names first
or run the project's full migration/bootstrap process. This migration covers the learning
schema only; moving Supabase authentication and the remaining app tables is separate work.

Mount connection strings with Secret Manager and set `APP_ENV=production`,
`ARTLOUPE_RETRIEVAL_BACKEND=pgvector`, and
`ARTLOUPE_LEARNING_DATABASE_URL_FILE=/run/secrets/learning_database_url`. A socket DSN can
use `host=/cloudsql/PROJECT:REGION:INSTANCE`. Run ingestion as an offline job with its own
`ARTLOUPE_LEARNING_INGEST_DATABASE_URL_FILE` secret. Never ingest during instance startup or
an HTTP request. Corpus data remains in the database across stateless instance restarts.

Each database operation opens a short-lived connection, with a three-second connect and
statement timeout for runtime reads. Bound Cloud Run concurrency and maximum instances to
fit the database connection budget, alongside checkpoint/run/cache connections. This avoids
an unbounded per-process pool but pays connection setup cost; a measured latency issue can
justify introducing a shared pool. This change does not deploy Google Cloud resources.

## Verification

Run the learning unit tests normally. Integration tests require a **disposable migrated
database**; they truncate its learning tables:

```sh
ARTLOUPE_TEST_LEARNING_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/artloupe_learning_test \
  uv run --directory python --all-packages pytest services/agent/tests/test_learning_postgres.py
```

The real-database tests cover semantic paraphrases, keyword search, hybrid fusion, Spanish
retrieval, evidence gaps, repeat ingestion, version switching, preserved snapshots,
failed publication, audit records, and denied runtime writes. They use synthetic vectors
and make no paid calls. These tests establish database behavior; they do not measure real
query-embedding quality or validate generated answers against the capstone gold set.

## Recorded baseline

The saved [PostgreSQL sparse baseline](./pgvector-retrieval-baseline.json) runs the 32 existing
gold cases against the published 963-passage corpus: 20 positive cases, recall/hit@6 of 0.85,
MRR@6 of 0.5433, and zero errors. This uses the **keyword leg only**, makes no provider calls,
and passes the existing gates. It is not a measured dense/hybrid or generated-answer score.

Reproduce it after publishing the same corpus:

```sh
uv run --directory python --all-packages python -m artloupe.agent.learning.cli eval \
  --backend pgvector --corpus /absolute/path/to/learning-corpus \
  --cases docs/learning/eval-cases.json --output /tmp/pgvector-retrieval.json
```

`--corpus` supplies the gold-validation snapshot; the query runs in PostgreSQL and the CLI
refuses a mismatch with the active database version. `--live` additionally embeds queries,
synthesizes answers, and judges grounding, so it is a paid run. Without `--live`, PostgreSQL
is evaluated in keyword mode. Sparse search ORs query tokens before English stemming so a
natural-language question does not require every word to occur in a passage.
