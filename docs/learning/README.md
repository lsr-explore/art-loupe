# Book-grounded learning POC

The Studio's `/en/learn` and `/es/learn` pages answer questions from the three books
listed in `books.json`. The home, inspiration, and project pages link to the assistant.
Every factual claim references a retrieved passage. Source cards show the actual
excerpt, author, chapter or page, original publication link, and license metadata.
An exercise is explicitly a suggestion; an evidence gap uses a fixed localized
notice without factual claims or invented citations.

## Architecture

The browser posts through the authenticated Studio route to the Python agent's
`POST /learning/ask`. The agent verifies artist/superuser access, retrieves at most
six passages, and asks the existing Anthropic client for a structured answer.
The server resolves citation IDs against retrieved passages rather than trusting
model-generated bibliographic data. Zod validates responses again at the web boundary.

The assistant supports a portable file index (BM25 keywords plus optional OpenAI vectors)
and a PostgreSQL backend (full-text search plus pgvector cosine search). Both combine ranks
with reciprocal rank fusion and use `text-embedding-3-small` at 1536 dimensions. Docker
selects PostgreSQL; existing file workflows remain available explicitly. The 963-passage
corpus uses roughly 350-word chunks with 50-word overlap. The evaluation CLI accepts
`--backend pgvector` to measure the database path against the same corpus and gold cases.

Questions, history, and book passages are untrusted model input. Retrieved text is
screened, the prompt isolates data, unknown citation IDs fail closed, and responses
render as escaped text. These checks do not establish semantic truth; live evals
measure whether cited text actually supports claims.

The UI retains up to 20 exchanges in tab memory and sends at most three previous
exchanges. It stores no chat transcript. Answer synthesis sends questions, recent
turns, and excerpts to Anthropic. Hybrid search sends the retrieval query to OpenAI.
Operational metering records token usage separately from project-plan credits.
A process-local rate limiter permits three questions in a burst, replenishing one
slot every 20 seconds. Answer work has a 55-second deadline, reserving time inside
Studio's 60-second timeout for the proxy and a metrics flush capped at 0.5 seconds.
Token-ceiling stops return a deliberate limit response and a localized notice.
Requests have bounded output.
This is not a persistent account-credit system or a distributed rate limiter.

For a complete clean setup, follow [ingestion from scratch](INGESTION.md).

## Prepare and run

The complete local setup, including the keychain, `python/.env` and the variables that must be
exported, is in the root [README's agent section](../../README.md#the-python-agent). This
section keeps the learning-specific detail.

Run these commands from the repository's `python/` directory, after `uv sync --all-packages`.
Use the existing macOS keychain resolver. Set only lookup coordinates in the shell:

```sh
export ARTLOUPE_KEYCHAIN_SERVICE='<existing service>'
export ARTLOUPE_ANTHROPIC_KEYCHAIN_ACCOUNT='<existing account>'
export ARTLOUPE_OPENAI_KEYCHAIN_ACCOUNT='<existing account>'
```

The resolver passes a fetched secret directly to the client. It never exports the
value or reads API-key values from env files. Keychain coordinates can remain in
shell configuration; no local file is necessary. CI/production use platform secrets
through the existing process-environment seam because macOS Keychain is unavailable.

```sh
# Authenticate with model-list requests before paid operations.
uv run --all-packages python -m artloupe.agent.learning.cli verify

uv run --all-packages python -m artloupe.agent.learning.cli ingest \
  --books /absolute/path/to/reference-docs/books \
  --manifest ../docs/learning/books.json --output learning-corpus

# Paid: embeds the extracted book passages with OpenAI.
uv run --all-packages python -m artloupe.agent.learning.cli embed \
  --corpus learning-corpus --allow-paid

export ARTLOUPE_LEARNING_CORPUS="$PWD/learning-corpus"
uv run --all-packages python -m artloupe.agent.service
```

Configure Studio's existing `ARTLOUPE_AGENT_URL` and normal authentication, then run
`pnpm dev:studio` from the repository root. Model IDs can be overridden with
`ARTLOUPE_LEARNING_MODEL` and `ARTLOUPE_LEARNING_JUDGE_MODEL`; the defaults match
this checkout's existing Director model. API keys should be validated with the
providers' authenticated model-list endpoints before paid operations.

To host, package or mount `corpus.jsonl`, `manifest.json`, `vectors.npy`, and
`vectors.json` as read-only files alongside the Python agent. Point the corpus
variable at that directory. Keyword mode needs only the first two files and no
OpenAI key; answers still need Anthropic. The index verifies corpus hashes, vector
shape, and model compatibility. Publish updates as a complete bundle and restart
the agent so its in-memory index refreshes. Generated corpora and vectors are
ignored by Git. No deployment was performed for this deliverable.

See [validation results](VALIDATION.md) for the initial and revised runs.

## Evals

```sh
# Offline, free: gold-evidence retrieval only.
uv run --all-packages python -m artloupe.agent.learning.cli eval \
  --corpus learning-corpus --cases ../docs/learning/eval-cases.json \
  --output learning-eval-reports/retrieval.json

# Paid: hybrid retrieval, model answers, and semantic judging.
uv run --all-packages python -m artloupe.agent.learning.cli eval \
  --corpus learning-corpus --cases ../docs/learning/eval-cases.json \
  --output learning-eval-reports/live.json --live
```

The main 32 cases include 20 questions with gold passage anchors, plus 12 evidence-gap,
injection, and medium cases. Gold anchors must exist in the selected corpus or the
run fails. Offline mode measures keyword retrieval even when vectors are installed;
it does not claim to test generated answers, semantic search, or abstention.

Retrieval gates are hit-at-six at least 85%, MRR at least 0.5, and zero execution
errors. Live gates additionally require at least 85% correct answers, 95% supported
answers, 95% medium-appropriate answers, and 100% abstention on expected gaps.
Failed gates exit nonzero. The separate `eval-followups.json` suite tests a
history-dependent practice questions in English and Spanish and an explicit short
topic switch and consecutive follow-ups using the
same retrieval-query helper as the HTTP route. With vectors installed, Spanish
queries use multilingual semantic ranking because the books are English; Spanish
keyword-only retrieval is limited by that language mismatch. When a suite has no expected gaps,
its abstention metric is unmeasured rather than a failed zero. Reports include
per-case source IDs, source locations,
latency, and (live) answers, excerpts, token usage, and rubric judgments. The judge
uses the same default model family as synthesis; human review remains necessary.
This small curated set is a regression baseline, not an independent quality study.

Hermetic tests cover EPUB spine ordering, chunk tails, provenance, stale vectors,
retrieval negative controls, refusal/truncation, prompt isolation, embedding shape,
auth, request limits, citation contracts, and keychain boundaries. Browser tests
use a synthetic response to verify citation disclosure, accessibility, and mobile
layout; they do not substitute for live grounding evals.

## Scope and corpus review

This version provides a dedicated assistant and navigation entry points. It does
not yet receive artwork pixels or project context, embed chat in the study session,
search museums/web sources, persist conversations, or critique uploaded images.
Questions about a specific image require that later integration. Spanish UI and
answer prompts exist; the English-only keyword corpus has limited Spanish recall.
Use vectors for multilingual retrieval and add bilingual evals before claiming parity.

EPUB extraction follows spine order and chapter headings, excludes navigation,
Gutenberg boilerplate, and indexes. PDF extraction skips this edition's eight-page
front matter and removes recurring headers and common credit lines. Page citations
include printed and PDF page numbers. Multi-column PDFs can have reading-order
artifacts; spot-check extraction before enlarging the corpus or changing editions.

`books.json` preserves publication and license metadata. The Introduction's original
text is CC BY-SA, with third-party exceptions; the historical books have separate
Gutenberg edition terms. Text extraction is not a rights audit: figure captions and
quotations may need further review. Keep original license notices with any hosted
or redistributed bundle and review third-party content before public distribution.
Historical materials advice is labeled and should not become current chemical or
studio-safety guidance. The eval set includes this boundary.

## Database backend

See [PostgreSQL ingestion and retrieval](./pgvector.md) for publishing saved embeddings,
Docker configuration, access roles, and Cloud Run / Cloud SQL setup.
