# Ingest the learning corpus from scratch

This builds a local, hostable index from your three downloaded books. No API key
value belongs in a command, environment variable, or local file. The first phase
is free extraction; the optional vector phase sends book text to OpenAI and is paid.

## 1. Open the checkout and install Python dependencies

The checkout and source books are separate directories. Keep the original books
where they are; ingestion reads them without modifying them.

```sh
cd /Users/laurie/me/career/interview-kickstart/capstone/art-loupe/feat/art-loupe/python
uv sync --all-packages
```

`uv` uses the repository's Python version and lockfile and creates its managed
virtual environment. If `uv` is unavailable, follow the repository's
[Python setup](../../python/README.md) first.

Confirm these files are in
`/Users/laurie/me/career/interview-kickstart/capstone/art-loupe/reference-docs/books`:

- `Introduction to Art.pdf`
- `The_Practice_and_Science_of_Drawing_by_Harold_Speed.3.epub`
- `The_Painter_in_Oil_by_Daniel_Burleigh_Parkhurst.3.epub`

The [source manifest](books.json) names the exact filenames, source URLs,
authors, and license labels. If a filename differs, update the manifest before
running ingestion. A changed book edition also requires checking the PDF front
matter offset and the golden eval anchors.

## 2. Set keychain lookup coordinates and validate keys

Use the service/account names of your existing keychain entries. These variables
contain names only. Do not export `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` locally.

```sh
export ARTLOUPE_KEYCHAIN_SERVICE='<existing keychain service>'
export ARTLOUPE_ANTHROPIC_KEYCHAIN_ACCOUNT='<Anthropic account name>'
export ARTLOUPE_OPENAI_KEYCHAIN_ACCOUNT='<OpenAI account name>'

uv run --all-packages python -m artloupe.agent.learning.cli verify
```

Both providers must report `authenticated: true` and HTTP 200 before continuing
with paid operations. Verification uses model-list requests, not generated answers.
A macOS keychain access prompt may appear. A missing or locked item raises a named
configuration error. An HTTP 401 means authentication failed; 403 can mean access
restrictions; connection failures must be resolved before paid calls.

The existing resolver reads secrets directly from Keychain and hands them to the
HTTP client or SDK. It never copies their values into environment variables or
files. The setup mirrors the direct-client pattern in your dev-toolkit.

Skip this step if you only want to extract text and run the offline retrieval eval.

## 3. Extract a fresh corpus

Choose a new output directory for a fresh build. This keeps an existing working
index intact and avoids accidentally mixing old vectors with newly extracted text.
The example uses the default directory; for a second build use a new directory
such as `learning-corpus-next` and substitute it in all later commands.

```sh
uv run --all-packages python -m artloupe.agent.learning.cli ingest \
  --books /Users/laurie/me/career/interview-kickstart/capstone/art-loupe/reference-docs/books \
  --manifest ../docs/learning/books.json \
  --output learning-corpus
```

For the current downloads, the summary should report 963 passages: 417 from
Introduction to Art, 266 from Speed, and 280 from Parkhurst. The output contains:

| File | Purpose |
| --- | --- |
| `corpus.jsonl` | Extracted chunks with stable IDs and source metadata |
| `manifest.json` | Extractor version, book checksums, counts, corpus checksum |

Extraction does not call a model. EPUB processing follows spine order and chapter
headings; PDF processing preserves page locators. Review a sample of passages for
readability and source accuracy. Keep the original books and license notices for
review and for any later hosted bundle.

## 4. Run the free retrieval baseline

```sh
uv run --all-packages python -m artloupe.agent.learning.cli eval \
  --corpus learning-corpus \
  --cases ../docs/learning/eval-cases.json \
  --output learning-eval-reports/retrieval.json
```

This measures keyword retrieval against gold passage anchors. It makes no API
calls and does not validate generated answers. The current baseline is 85%
hit-at-six and 0.7375 MRR across 20 positive cases. All 32 cases are loaded and
validated; evidence-gap and adversarial cases need the live phase for answer checks.
A failed gate returns a nonzero exit code; inspect the per-case report.

## 5. Build vectors, then run live evals

Only continue after successful key validation. This step sends all extracted
passages to OpenAI; the current corpus used 344,042 embedding tokens.

```sh
uv run --all-packages python -m artloupe.agent.learning.cli embed \
  --corpus learning-corpus --allow-paid

uv run --all-packages python -m artloupe.agent.learning.cli eval \
  --corpus learning-corpus \
  --cases ../docs/learning/eval-cases.json \
  --output learning-eval-reports/live.json --live
```

Embedding adds `vectors.npy` and `vectors.json`. Vector metadata must match the
corpus checksum and embedding model. Live evals query vectors, generate answers,
and judge support, correctness, selected medium, and abstention. They are paid,
can take several minutes, and fail the command if any quality gate fails. Review
the resulting answers and cited excerpts manually as well as reading the scores.

If interrupted during embedding, rerun the embedding command against the same
unchanged text corpus. If a previous vector bundle is stale, build in a new output
directory. Do not reuse vectors from another book revision. If changing a build
while the agent runs, finish the new bundle first and then switch its configuration.

## 6. Point the local agent at the completed bundle

```sh
export ARTLOUPE_LEARNING_CORPUS="$PWD/learning-corpus"
uv run --all-packages python -m artloupe.agent.service
```

Studio uses its existing agent URL and authentication configuration. From the
repository root in another terminal, run `pnpm dev:studio`, sign in, and choose
**Ask the learning assistant**. The keychain coordinate variables belong in the
agent's shell, not the browser's shell.

Restart the agent after switching or rebuilding its index. Text-only mode can run
without vectors or an OpenAI key, but generating answers still requires Anthropic.
The [POC guide](README.md) describes hosting, limitations, and eval gates. The
corpus and eval outputs are ignored by Git; preserve a complete, versioned bundle
for deployment rather than committing original book content or vector files.
