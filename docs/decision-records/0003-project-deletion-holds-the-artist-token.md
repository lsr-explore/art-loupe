# 0003 — Project deletion holds the artist's token, and storage immutability is a policy

- **Status:** Accepted
- **Date:** 2026-09-06
- **Deciders:** Laurie Reynolds

## Context

`on delete cascade` reaches rows. It does not reach the Storage API. Two defects followed from
that gap, both raised by Greptile on [#20](https://github.com/lsr-explore/art-loupe/pull/20) and
deferred to [#22](https://github.com/lsr-explore/art-loupe/issues/22):

1. Deleting a project removed its `source_images` row and left the **bytes** in the bucket. The
   prefix-only SELECT policy kept authorizing the owner for the known key, so a photograph the
   artist deleted stayed retrievable. FR-806 and NFR-10 both require deletion to be complete.
2. An owner could DELETE the storage object and INSERT different bytes at the same
   `{owner}/{project}/{checksum}` key while `source_images` kept the original checksum. Every
   derivative and cache entry then cited content that had changed underneath it, breaking FR-105
   from the storage side.

`apps/studio/src/env.ts` also carried a standing commitment worth preserving: *"the service-role
key is never read by the app."* No app runtime had ever held an RLS-bypassing credential.

## What was measured first

Two plausible designs were eliminated by testing the live stack rather than by reasoning:

- **A `security definer` Postgres function cannot delete storage objects.** Supabase installs a
  `protect_objects_delete` trigger on `storage.objects` that raises *"Direct deletion from
  storage tables is not allowed. Use the Storage API instead"* for every role, `postgres`
  included. Deletion is therefore irreducibly two systems and **cannot be one transaction**.
- **Deleting through the Storage API removes the bytes**, not merely the metadata row. Confirmed
  against the local file backend: the object under `/mnt/stub/stub/reference-images/…`
  disappeared along with its row.

The first finding is load-bearing enough that `test_projects_rls.py` now asserts the trigger's
behaviour, so a change upstream reopens the design rather than silently invalidating it.

## Decision

**The deletion path holds the artist's own access token, never `service_role`**, and calls the
Storage API followed by PostgREST. RLS continues to answer every ownership question.

**Order is the safety property**: storage objects first, rows second. Storage returns the array
of objects it actually removed, so a short result is detected and the rows are deliberately left
in place rather than deleted on top of an incomplete removal.

**Storage-side immutability is enforced by policy, not by credential custody.** The storage
INSERT policy gains a clause refusing any write to a key that a `source_images` row already
cites. The object is uploaded before its row is written, so the original upload passes and every
later write to that key is refused.

The client-side storage DELETE policy is **kept** — the disposition #22 asked to be recorded.

## Rationale

Keeping `service_role` out of the app was worth more than the simplicity of removing the client
DELETE policy. An RLS-bypassing key in a request-handling process is a permanent increase in
blast radius: every future bug in that app becomes a potential full-database read. The policy
guard achieves the same immutability without it.

The guard is also the same remedy the row side already chose. `source_images` has no DELETE
policy and no DELETE grant *precisely because* delete-then-insert reaches the same end as an
update. The object had that identical hole one layer down, and now gets a consistent answer
rather than a different one.

Ordering objects-before-rows is chosen because the two failure modes are not symmetric. Rows
without bytes is visible, retryable, and safe. Bytes without rows is defect (1) itself.

## Alternatives considered

- **`service_role` in the studio runtime.** Would have closed the byte swap by removing client
  storage DELETE entirely, making the server the only deletion route. Rejected: it reverses the
  `env.ts` commitment and would have been the first RLS-bypassing key in any app runtime.
- **A `security definer` Postgres function**, giving genuine single-transaction deletion.
  Impossible — see the trigger above.
- **Ship the deletion path and defer the byte swap.** Rejected: #22 lists the byte swap as a
  done-when clause, so it would have closed the issue only partly.
- **Listing the bucket by prefix** instead of reading keys from the rows. Rejected: the rows are
  the record of what this system wrote, so anything a listing turned up that no row cites would
  be deleted on a guess.

## Consequences

- No app runtime holds a credential that bypasses RLS. The anon key is used only as PostgREST's
  required `apikey` header; the artist's bearer token remains the real credential.
- Deletion can report `partial`, which is surfaced as HTTP 500 and must never read as success.
- **Completeness is judged by the end state, not by a count of removals.** Storage answers
  `200 []` for a key that is already gone, and keeping the client DELETE policy makes
  "already gone" a *supported* state — an artist may remove their own object directly, and
  `source_images` has no DELETE policy so the row stays. An earlier draft compared the removed
  count against the requested count, which read that as a partial failure, refused to delete the
  rows, and failed identically on every retry — leaving the project permanently undeletable and
  breaking FR-806 harder than the defect being fixed. Keys storage does not report are now
  probed: absent is success, present is a genuine partial, and anything else fails safe as
  `unavailable` rather than guessing.
- **The upload path is now order-constrained.** Writing the `source_images` row before uploading
  the object would make every first upload fail with a bare permissions error. PR 7 must
  preserve upload-then-row; `test_the_guard_does_not_refuse_the_upload_that_creates_the_pair`
  is what names the cause if it is inverted.
- Derivative tables join the cascade as they are built and need no change to the deletion path,
  provided they hang off `projects`.
- Replacing a project's photograph remains impossible by design, at both layers.

## Open follow-ups

- The retention sweep acting on `retention_expires_at` is still unbuilt; #22 scoped it out
  deliberately. It will need this same path.
- No derivative tables exist yet, so "removes every derivative" is currently satisfied
  vacuously.

## Related

- [ADR 0002](./0002-authentication-authority-and-deployment-topology.md) — why the artist's
  token is available server-side at all.
- [#22](https://github.com/lsr-explore/art-loupe/issues/22) · FR-105, FR-806, NFR-10.
