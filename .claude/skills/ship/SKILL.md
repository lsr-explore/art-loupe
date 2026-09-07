---
name: ship
description: Take verified work from working tree to merge-ready — pre-push checks, branch + conventional commit, PR, CI watch, then a Greptile review once the branch is final, each finding dispositioned and posted as its own PR comment before hand-off. Use after finishing a change that should become a PR, or when asked to commit/push/open a PR. Laurie merges; you never do.
---

# Ship

Takes work that is **already done and verified** through to merge-ready. It does not decide
*what* to commit — that's Laurie's call, and you should already know the scope.

**Two things this skill never does:** merge the PR, and bypass husky.

**Review is Greptile, and it fires on its own — but not reliably on every push.** The
`skipReview: "AUTOMATIC"` this section used to describe is **no longer in `greptile.json`**,
and `triggerOnUpdates` is `true`. Observed on #29: a review arrived by itself about four
minutes after the branch was first pushed, and **no** review arrived within ten minutes of the
next push to the same branch.

Treat that as the working model rather than a mechanism you understand: **the first push
usually gets a review; a later push may not.** So the rule is unchanged in spirit and different
in practice — do not spend a manual review before checking whether one already ran, and never
report a branch as reviewed without confirming which commit the review actually read. §5 says
how.

## 1. Pre-push checks

Each of these has cost a real session. Run them before staging anything.

```sh
git status --short                       # know everything you're about to stage
git check-ignore -v <new-file>           # see below — this one is the sneaky one
pnpm format                              # Biome formats JSON too; format:check blocks the commit
pnpm check:all                           # or the subset the change touches
```

- **Is anything you built silently gitignored?** Check every *new* file, especially under
  `.claude/`. `/.claude/skills/` was ignored wholesale, so a skill referenced by `CLAUDE.md`
  would have shipped as a dangling reference. `git status` won't show it — it just isn't there.
- **Are there stale generated artifacts?** If a chart, report, or fixture was dropped during
  the work, its output file may still be on disk and will get staged. Regenerate and diff.
- **Run `pnpm format` before committing**, not just `format:check`. Biome formats JSON, so
  hand-written records fail the check and block the commit.
- **Never commit to `main`** — it's ruleset-protected and PR-only. Branch first.

## 2. Branch and commit

```sh
git checkout -b <type>/<short-slug>
git add -A && git status --short          # re-read before committing
```

Conventional commits: `feat:` `fix:` `chore:` `docs:` `refactor:` `test:` `ci:`.
**Lowercase subject**; commitlint caps body lines at 100 chars. Write the body to explain
*why*, not to list files — the diff already lists files. Do not bypass husky with
`--no-verify`; its lint-staged pass will reformat staged files, which is expected.

End the message with the `Co-Authored-By:` trailer only.

**Never include a `Claude-Session:` trailer or any `claude.ai/code/session_…` URL**, in a
commit message or a PR body. This repo is public, so both are world-readable and a commit
message is effectively permanent. The link does not expose the transcript — it is scoped to
Laurie's account — but publishing a pointer to her sessions is not something a public
portfolio repo should do. The harness supplies that trailer in its standing attribution
instruction; this line deliberately overrides it, so drop it when composing the message rather
than committing and amending afterwards.

Intermediate commits are fine and cost nothing — nothing reviews them.

## 3. Push and open the PR

The PR body is the durable artifact — a reviewer reads it before the diff, and future-you
reads it instead of the diff. Cover: **why** the change exists, what it does, anything
deliberately *not* done, and any decision a reviewer might otherwise re-litigate. Call out
anything you decided that wasn't explicitly approved.

Sign it off with the generic `🤖 Generated with [Claude Code](https://claude.com/claude-code)`
line and **no session URL** — same rule as the commit trailer in §2, same reason.

## 4. Watch CI

Backgrounded `gh pr checks <N> --watch --interval 30` — **always `run_in_background: true`**,
never a foreground loop.

This is not about token efficiency. A long **foreground** call blocks the turn, and
mid-turn messages only surface alongside the *next tool result* — so while it runs, Laurie
cannot reach you, and she has to hit Esc to get a word in. That is exactly when she is most
likely to know something you don't: that the flake is known, that the PR should just be
merged. Backgrounding keeps the channel open.

Bound the wait rather than trusting a watch command to exit:

```sh
timeout 600 gh pr checks <N> --watch --interval 30
```

**`gh pr checks` is not commit-scoped.** It reports the latest check-run state and says
nothing about which commit ran, so on a PR with follow-up pushes a green board can belong to
an older commit. Confirm with `gh run list --json name,status,conclusion,headSha` against
`git rev-parse HEAD` before calling CI green.

**Runner-infra flake:** a whole-run failure at ~15m1s with "job not acquired by Runner" is
hosted-runner infra, not your diff. Re-trigger once (`gh run rerun` or an empty commit —
pick one), don't debug the code. **If it recurs after that one retry, stop and tell
Laurie.** Do not keep retrying.

Fix genuine CI failures (test/lint/type) on the branch and re-push. Those pushes are still
intermediate — the review has not run yet.

## 5. Greptile review — once, when the branch is final

**Trigger condition, not a step you reach by default.** Run this only when the final commit
is pushed and the branch is ready to merge: CI green, no further edits planned. If you are
still expecting to push fixes, you are not there yet. Reviewing a branch you are about to
change spends a cycle on a diff that will not exist.

```sh
git rev-parse HEAD                    # the reviewed SHA — findings anchor to this commit
greptile review --json -b main
```

- **Record the SHA before the review runs.** A review is bound to the commit it saw, and §6
  anchors every posted comment to that commit — not to whatever HEAD becomes once the fixes
  are pushed.
- **`--json`** prints findings as JSON — structured for you to act on. `--agent` / `--text`
  are plain-text variants for a human reading a terminal.
- **`-b main`** names the base explicitly. Omit and it uses the repository default.
- **`--instructions "<text>"`** passes extra focus for this run, exactly as
  `@greptileai <instructions>` would in a PR comment (the CLI's own `--help` writes this as
  `@greptile`, which is wrong — the bot answers to `@greptileai`). Use it when the diff has a
  specific risk
  worth naming; don't use it to narrow a review that should be broad.
- **`greptile review --resume`** continues the latest unfinished review rather than spending
  a new one. Reach for this instead of re-running after an interruption.
- **`greptile config`** prints the *effective* config for the repo — the fastest way to
  confirm `greptile.json` is actually being read before blaming the tool.

**Background it** (`run_in_background: true`), then **actually wait**. Observed behaviour:
the CLI can run for many minutes on a large diff and emits **nothing at all** until it
finishes, so "0 bytes so far" is indistinguishable from a hang. Wait on the *process*, not on
output appearing. Backgrounding is about staying reachable, not about moving on.

**Check the PR before spending a review.** Greptile often posts one by itself, so
`gh pr view <N> --json comments` and `gh api repos/{owner}/{repo}/pulls/<N>/comments` come
first — a review may already be there, and the summary footer names the commit it read. Only
run the CLI when no review covers the current HEAD.

A missing review is not automatically a failure to diagnose: on #29 the second push drew none
at all within ten minutes. Waiting a few minutes and re-checking is right; polling indefinitely
is not. If Laurie wants a review on the PR rather than in the terminal, comment `@greptileai`
on it (GitHub won't autocomplete bot handles, so the missing dropdown entry is normal).

**If the review doesn't run** — quota exhausted, the CLI erroring, a diff too large — say so
plainly in the PR body and hand back. Never let a PR imply it was reviewed when it wasn't,
and don't retry-loop against a non-retryable limit: note it and move on.

**Skip this step** only for a genuinely trivial diff (a typo, a version bump, a docs
one-liner). When in doubt, run it — it's cheaper than a review round-trip.

## 6. Disposition with judgment, never auto-apply

**Verify each finding against the code before acting.** For each:

- **Fix** — a genuine, in-scope defect with a clear correct fix. Fix it in a follow-up commit.
- **Defer** — valid but out of scope, pre-existing, or a design call that's Laurie's. File it
  with the **`backlog`** skill, which carries the issue + board + epic-link procedure, and
  reference the issue in the finding's comment.
- **Decline** — not applicable, wrong direction, or low-value gold-plating.

Be willing to invert a suggested fix when its *direction* is wrong. A review once proposed
deleting real data to satisfy a schema; the schema was what was wrong. On safety-critical
paths especially, a mechanical "make them match" can point the wrong way — if the direction
isn't obvious, that's a defer, not a fix.

**Where the reasoning lands depends on where the review ran.**

- **Terminal review — the normal path.** There are no threads to reply to, so **each finding
  becomes its own comment on the PR**, carrying its own disposition. Never one grouped blob in
  the PR body: a reviewer needs somewhere to argue with one specific call, and the body is the
  one part of a PR that gets rewritten. A comment is immutable and timestamped — it records
  what was known when the call was made.
- **On-PR `@greptileai` review.** Greptile already made the threads — reply on each one and
  post nothing new.

### Posting the dispositions

**Disposition first, post second.** Verify every finding, decide, push the fixes, file any
deferrals. Only then post: a comment that names a fix commit or an issue number cannot be
written before either exists.

Read the findings from the right fields. `greptile review --json` emits
`{ summary, confidence, confidenceReasoning, securitySummary, instructions, comments }`, and
each entry in `comments` is:

```jsonc
{ "id": "…", "path": "packages/auth/src/session.ts", "startLine": 42, "endLine": 42,
  "side": "new",        // "new" → GitHub side=RIGHT; "old" → LEFT
  "severity": "P1",     // P0 | P1 | P2, defaulting to P2
  "securityIssue": false,
  "category": "logic",  // info|syntax|logic|style|advice|checks|summary|notes|old|new
  "body": "markdown",   // the finding text itself
  "verifiedEvidence": "…", "suggestion": "…", "hunk": { … } | null }
```

There is **no `file`, `line`, or `title` field** — it's `path`, `startLine`/`endLine`, and
`body`. Anything written against the names you'd expect will silently produce `undefined`.

Collect your calls into a scratchpad JSON file, one object per finding: the fields above plus
`disposition` (`fixed` | `deferred` | `declined`), `note` (your reasoning), and `ref` (the fix
commit SHA, the issue number, or empty). Then **post the whole file in one loop** — a single
Bash invocation rather than one call per finding, so it costs one permission prompt instead of
N.

One template, used identically inline and top-level:

```markdown
**Greptile · P1 · logic** — `packages/auth/src/session.ts:42`

> Session cookie is written before the CSRF check, so a forged request lands authenticated.

**Disposition: fixed** — `abc1234`

The check now runs before the cookie write. The early return was the wrong guard.

_Greptile finding, dispositioned by Claude Code (`ship` skill); reviewed by @lsr-explore
before posting._
```

- Keep `path:line` in the heading **even inline**. Email notifications and the fallback both
  lose that context otherwise, and it keeps one template instead of two.
- Blockquote the finding's `body` verbatim, so Greptile's words stay visibly Greptile's and
  your reasoning stays visibly yours.
- Disposition line: **fixed** → the fix commit SHA · **deferred** → the issue link ·
  **declined** → no ref. The note says *what changed* for a fix, and *why* for a defer or a
  decline — the declines are what a reviewer is most likely to want to challenge.

Post inline, on the file and line:

```sh
gh api repos/{owner}/{repo}/pulls/<N>/comments \
  -f commit_id=<reviewed-sha> \
  -f path=<path> \
  -F line=<endLine> \
  -f side=RIGHT \
  -F body=@<body-file>
```

**`-F` for the body, never `-f`.** This line read `-f body=@<body-file>` and was wrong in the
worst available way. Per `gh api --help`, `-F/--field` supports `"@<path>"` to read a value
from a file; `-f/--raw-field` adds the string **literally**. So `-f body=@/tmp/finding.md`
posts a comment whose entire content is the seven characters `@/tmp/f…` — and the API answers
**201 with an `html_url`**, so it looks like it worked.

That happened on #29: two dispositions posted as literal filenames, and both were reported as
successfully posted because the response carried a URL.

Add `-F start_line=<startLine> -f start_side=<side>` when `startLine != endLine`, and use
`side=LEFT` when the finding's `side` is `old`.

**Anchor to the reviewed SHA, not current HEAD.** Every finding's line is guaranteed to exist
in the diff Greptile actually read; against a post-fix HEAD the fixed lines have moved or
vanished and the fallback fires on nearly everything. GitHub marks comments on since-changed
lines *outdated* and collapses them — which is the honest rendering, since the code changed
because of the comment.

**Fall back on a non-2xx.** A 422 means the line isn't in that commit's diff:

```sh
gh pr comment <N> --body-file <body-file>
```

**Then read each body back and diff it against the file you posted, before reporting anything
as posted.**

Compare the **whole stored body** to its source file, not a summary of it. Length and first
line are a proxy, and this section exists because a proxy check is what let a wrong body
through in the first place — a body whose opening survives while the rest does not would pass
any spot-check, and there is no reason to spot-check when an exact comparison is one command.

Capture the id **at post time**; it is the only thing tying a comment to the file it was meant
to carry.

```sh
# inline — the id comes straight back
id=$(gh api repos/{owner}/{repo}/pulls/<N>/comments \
  -f commit_id=<reviewed-sha> -f path=<path> -F line=<endLine> -f side=RIGHT \
  -F body=@<body-file> --jq '.id')

[ "$(gh api repos/{owner}/{repo}/pulls/comments/"$id" --jq '.body')" = "$(cat <body-file>)" ] \
  && echo "inline $id verified" || echo "inline $id MISMATCH"
```

```sh
# top-level fallback — `gh pr comment` prints a URL ending in #issuecomment-<id>
url=$(gh pr comment <N> --body-file <body-file>)
id=${url##*issuecomment-}

[ "$(gh api repos/{owner}/{repo}/issues/comments/"$id" --jq '.body')" = "$(cat <body-file>)" ] \
  && echo "top-level $id verified" || echo "top-level $id MISMATCH"
```

Inline comments and top-level comments live in **different, disjoint collections**, and the two
posting paths write to one each — `pulls/comments/<id>` and `issues/comments/<id>`. A read-back
that queries only one leaves the other path unverified, and the fallback is the likelier of the
two to carry a hand-built body, because it runs exactly when the inline post was refused.

**Compare with `[ "$(…)" = "$(…)" ]`, not `diff`.** `gh api --jq '.body'` appends a trailing
newline that the source file does not have, so a naive `diff` reports a one-line difference on
**every** correctly posted comment. A check that always fails is worse than no check, because it
trains you to wave it through. Command substitution strips trailing newlines from both sides,
which normalises exactly that difference and still catches a genuinely wrong body — measured
both ways before this line was written.

Finish by counting: every finding you set out to disposition should have produced exactly one
verified id. A finding with no id is a disposition that does not exist.

A 2xx with an `html_url` proves a comment object was *created*. It does not prove the comment
says anything. Those are different claims, and for an outward-facing write only the second one
matters — the first is what you have when the body is the literal string `@/tmp/f1.md`.

The check costs one command and is the only thing standing between a wrong flag and a PR whose
record claims reasoning it does not contain. A wrong body is repairable, but only if somebody notices — and the repair endpoint differs by
kind, the same way the read-back does:

```sh
# inline
gh api repos/{owner}/{repo}/pulls/comments/<id> -X PATCH --input <json>
# top-level
gh api repos/{owner}/{repo}/issues/comments/<id> -X PATCH --input <json>
```

Build `<json>` rather than passing the body inline, for the same reason the flag mattered:
`python3 -c "import json;print(json.dumps({'body': open('f.md').read()}))" > patch.json`.

Neither `gh api` nor `gh pr comment` is allowlisted in `.claude/settings.json`, so both
prompt. That is deliberate — posting is outward-facing, and `gh api` is a general-purpose
authenticated write to any endpoint.

**Resolve the threads when the dispositions are posted.** The `main` ruleset requires resolved
conversations, so an open thread **blocks the merge Laurie is about to do** — including a thread
you opened yourself to carry a disposition. Greptile resolves its own threads sometimes and not
others, so check rather than assume:

```sh
gh api graphql -f query='
{ repository(owner:"lsr-explore", name:"art-loupe") { pullRequest(number:<N>) {
    reviewThreads(first:20) { nodes { id isResolved path } } } } }'

gh api graphql -f query='
mutation { resolveReviewThread(input: {threadId: "<PRRT_…>"}) { thread { isResolved } } }'
```

Resolve only threads you actually addressed. A thread carrying an open question for Laurie stays
open, and you say so in the hand-off rather than tidying it away.

**The PR body gets an index line, not the reasoning:**

```markdown
**Greptile:** 4 findings — 2 fixed, 1 deferred (#83), 1 declined. Each is a separate comment
on this PR.
```

A review that *couldn't* run still gets said plainly in the body per §5 — there would be no
comments to carry it.

A fix pushed after a review **may or may not** draw a re-review — on #29 it drew none. Never
assume the earlier review covers the newer diff: it was bound to the commit it read, and that
commit no longer exists at HEAD. Check for a review naming the current SHA; if none arrived and
the fix is substantial, run a deliberate second `greptile review` and say that you did.

A second review may also diff against a **stale base**. On #29 the CLI run reported the branch
as "upgrading the repository to Vitest 5" — a change that had already merged to `main` in a
different PR and appeared nowhere in the diff. Before acting on a finding, confirm the code it
names is actually in `git diff origin/main`; if it is not, that is a decline with evidence, not
a fix.

## 7. Update docs, then hand off

Update whatever docs the change touches. If the session is also wrapping, that's `/wrap` —
separate skill, run it after this one.

End the turn with: **CI status · which reviewer ran, what it raised, and how each finding was
dispositioned · how many comments posted inline vs. fell back to top-level · "ready to
merge."** Flag anything you decided that she didn't explicitly approve. Report the fallback
count even when it's zero — a silent run of 422s otherwise looks identical to a clean post.

**Do not merge.** Laurie merges, squash — rebase breaks SSH commit signatures. Resume for the
post-merge wrap-up when she says it's merged.
