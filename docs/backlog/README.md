# Backlog — what each epic is for

Hand-written. This file explains what each epic **exists to achieve** and what it depends
on; it does not list issues. The issue inventory is [`issues.md`](./issues.md), which is
generated — read that for the current shape, and edit issues in GitHub rather than here.

This file changes only when the **epic set** changes: an epic is added, closed, or its
purpose or dependencies shift. Adding a child issue does not touch it.

The tracker is the source of truth. The board is
[`art-loupe-backlog`](https://github.com/users/lsr-explore/projects/3), which owns Priority
and Status — there are no priority labels.

## Epics

### [#5](https://github.com/lsr-explore/art-loupe/issues/5) — quality: static-analysis and prose-tooling follow-ups

**For:** closing the gaps in tooling that already runs. Every piece works, but several are
advisory, partially blind, or measuring something other than what their name claims — an
`i18n` check that cannot see the shared-catalog merge, a cycle detector that skips a quarter
of the tree, a size budget with more slack than the last leak that hid in it, and a prose
linter whose package set is unsettled.

**Depends on:** nothing. Every child is actionable today, which is the argument for doing
them before the apps carry real content and each fix gets harder.

**Not in it:** CodeQL gating, which is done — `paths-ignore` is gone from `codeql.yml`, the
`Analyze` jobs are required checks, and a `code_scanning` rule blocks merges on high-severity
alerts.
