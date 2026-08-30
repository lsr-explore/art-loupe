---
name: backlog
description: File deferred work as a GitHub issue and refresh the backlog docs — create the issue, add it to the project board with a Priority, link its epic, then regenerate docs/backlog/issues.md. Use when deferring something, filing a bug/enhancement, adding an epic, or when the backlog docs look stale.
---

# Backlog maintenance

The tracker is the source of truth; `docs/backlog/` is a map of it. Four things exist and
they have different rules. None of the three files exist yet — `issues.md` appears the first
time the report runs, and the two hand-written ones are worth writing only once there are
epics to describe:

| Thing | Rule |
| --- | --- |
| GitHub issues + the project board | the source of truth — always edit here first |
| `docs/backlog/issues.md` | **generated** by `pnpm backlog:report` — never hand-edit |
| `docs/backlog/README.md` | hand-written; only changes when the **epic set** changes |
| `docs/backlog/critical-path.md` | hand-written **proposal** — Laurie's call, see §4 |

Filing an issue is not done when `gh issue create` returns. An issue that isn't on the
project board has no Priority, and one without a parent link never appears under its epic in
the generated report — it lands in "unparented" instead. Both failure modes were common in
the predecessor repo, which is why steps 2 and 3 below are not optional.

> **Not live yet.** This skill needs the GitHub repo to exist and a user-owned Project to be
> created. Until then there is nowhere to file, so raise the deferral in conversation and let
> Laurie decide whether it is worth an issue once the board exists. The ids in §2 are
> placeholders — derive the real ones with the `gh project field-list` call below and record
> them here in the same commit that first uses them.

## 1. File the issue

**Title:** `area: what it is` — `agent:` `data:` `deploy:` `docs:` `entry:` `fascia:`
`observability:` `operations:` `packages:` `product:` `python:` `quality:` `repo:` `studio:`
`supabase:` `test:` `ux:`. The prefix is the *area*; the **type is the label**
(`enhancement` / `bug` / `documentation` / `epic`), never the prefix.

Body should carry why it's deferred and what "done" looks like — enough that it's actionable
months later without the session context. For an epic, follow the existing shape: Goal / why
now · In scope · Out of scope · Acceptance / done-when · ADR & docs links.

```sh
gh issue create --title "agent: ..." --label enhancement --body "..."
```

## 2. Put it on the board and set Priority

`gh issue create --project` is unreliable for user-owned projects; add it explicitly.

```sh
# returns the item id (PVTI_…)
gh project item-add <PROJECT-NUMBER> --owner lsr-explore --url <issue-url> --format json --jq '.id'
```

Then set Priority. **Priority is a Project field, not a label** — the P0–P3 labels were
deleted deliberately, one source of truth.

Derive the project id, the Priority field id, and its P0–P3 option ids once, then record them
here so the next session does not have to:

```sh
gh project list --owner lsr-explore --format json --jq '.projects[] | {number, id, title}'
gh project field-list <PROJECT-NUMBER> --owner lsr-explore --format json \
  --jq '.fields[] | select(.name == "Priority" or .name == "Status")'
```

```sh
gh project item-edit --id <PVTI_…> \
  --project-id <PVT_…> \
  --field-id <PVTSSF_… for Priority> \
  --single-select-option-id <the P0 | P1 | P2 | P3 option id>
```

Status defaults to `Backlog`; set it to `Future` for genuinely post-capstone work, using the
Status field's own id from the same `field-list` call. Re-look-up any id if an edit 404s —
they are stable but not guaranteed.

**Priority is Laurie's call.** Propose one with a reason and let her confirm; don't assign
P0/P1 silently. Deferring an in-scope defect to P3 is a scope decision wearing a field value.

## 3. Link it to its epic

Epic → child is a real GitHub **sub-issue** link. Listing the child in the epic body is not
enough — the report reads the link, and body prose goes stale.

```sh
# parent node id
gh api graphql -f query='{repository(owner:"lsr-explore",name:"art-loupe"){issue(number:<EPIC>){id}}}' \
  --jq '.data.repository.issue.id'

gh api graphql -f query='
  mutation($parent: ID!, $url: String!) {
    addSubIssue(input: {issueId: $parent, subIssueUrl: $url}) { issue { number } }
  }' -F parent=<parent-node-id> -F url=<child-issue-url>
```

If nothing fits, leaving it unparented is fine — but say so, rather than forcing it under a
loosely-related epic. If several new issues share a theme, propose a new epic instead.

## 4. Regenerate and update the docs

```sh
pnpm backlog:report      # rewrites docs/backlog/issues.md
```

Then, and only if it applies:

- **`README.md`** — update only when the **epic set** changes (new epic, epic closed, an
  epic's purpose or dependency changed). Adding a child issue does **not** touch it. Keep the
  entry to what the epic is *for* and what it depends on; no issue lists — that's `issues.md`.
- **`critical-path.md`** — this is opinion, and sequencing is Laurie's. Don't silently rewrite
  it. Surface what changed (a new blocker, a shipped step, a stale claim) and let her decide.
  If she asks for a refresh, re-date it and keep the **Status: Proposal** header.

Regenerating drops issues that closed, so the diff can be larger than the work — read it
before staging.

## 5. Verify

```sh
pnpm format
pnpm lint:md
```

`lint:md` runs repo-wide, so it may report pre-existing failures in files you didn't touch —
check the paths before chasing them, and don't fix unrelated files in a backlog commit.

Confirm the new issue actually landed where intended: it should appear under its epic (not in
"unparented") with the right Priority in the regenerated `issues.md`.

Do not commit unless asked. New skills need a `.gitignore` negation — `/.claude/skills/*` is
ignored wholesale, so an unnegated skill ships as a dangling reference.
