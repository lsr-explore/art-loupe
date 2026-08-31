#!/usr/bin/env bash
#
# apply-ruleset.sh — create or update the branch ruleset protecting the default branch.
#
# Idempotent: re-running updates the existing ruleset rather than adding a duplicate.
# This file is the source of truth; do not hand-edit the ruleset in the GitHub UI, or the
# next run of this script will silently revert whatever was clicked.
#
#   ./scripts/github/apply-ruleset.sh              # apply to lsr-explore/art-loupe
#   REPO=owner/name ./scripts/github/apply-ruleset.sh
#
# Requires `gh auth login` with a token carrying repo admin scope.
#
# WHY EACH RULE
#
#   deletion / non_fast_forward
#     Block deleting or force-pushing the default branch. Force-push is the one action
#     that can destroy history that exists nowhere else.
#
#   pull_request with required_approving_review_count = 0
#     Zero is deliberate, not an oversight. GitHub forbids approving your own pull request,
#     so on a solo repo any non-zero count makes every PR unmergeable. The rule still forces
#     work through a PR, which is what gives CI somewhere to run.
#
#   required_review_thread_resolution
#     An unresolved review comment blocks the merge. This is what makes the `ship` skill's
#     "disposition every finding" step enforceable rather than aspirational.
#
#   allowed_merge_methods = squash
#     Settled decision: rebase rewrites commits and breaks their SSH signatures.
#
#   required_signatures
#     Every commit must be signed. Local commits use the SSH key in ~/.gitconfig; GitHub
#     signs its own squash-merge and Dependabot commits, so this does not block either.
#
#   required_status_checks
#     Names are the job `name:` as GitHub reports it, NOT the workflow or job id. Read them
#     from a real run before editing:
#       gh api repos/OWNER/REPO/commits/main/check-runs --jq '.check_runs[].name'
#
#     The `Analyze (…)` names include the matrix build-mode — `Analyze (python, none)`, not
#     `Analyze (python)`. Requiring them is only safe because codeql.yml has NO paths-ignore:
#     a path filter would skip the jobs on a docs-only PR, and a required check that never
#     reports blocks the merge forever with nothing on screen to explain why. If a filter is
#     ever added back, drop these two from the required list in the same commit.
#
#   code_scanning
#     Stronger than the status check above. The status check asks "did the job pass?"; this
#     asks "are there open alerts at or above a severity?" — so a high-severity finding blocks
#     the merge even when the job itself is green.
#
#   bypass_actors: RepositoryRole 5 (admin)
#     The repo owner can push directly when a situation genuinely calls for it. The husky
#     pre-push hook is the day-to-day guard; this ruleset is the backstop that survives a
#     fresh clone with no hooks installed.
set -euo pipefail

REPO="${REPO:-lsr-explore/art-loupe}"
RULESET_NAME="main"

payload="$(cat <<'JSON'
{
  "name": "main",
  "target": "branch",
  "enforcement": "active",
  "conditions": { "ref_name": { "include": ["~DEFAULT_BRANCH"], "exclude": [] } },
  "bypass_actors": [
    { "actor_id": 5, "actor_type": "RepositoryRole", "bypass_mode": "always" }
  ],
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" },
    { "type": "required_signatures" },
    {
      "type": "pull_request",
      "parameters": {
        "required_approving_review_count": 0,
        "dismiss_stale_reviews_on_push": true,
        "require_code_owner_review": false,
        "require_last_push_approval": false,
        "required_review_thread_resolution": true,
        "allowed_merge_methods": ["squash"]
      }
    },
    {
      "type": "required_status_checks",
      "parameters": {
        "strict_required_status_checks_policy": true,
        "do_not_enforce_on_create": false,
        "required_status_checks": [
          { "context": "Quality Checks" },
          { "context": "Unit Tests" },
          { "context": "Build" },
          { "context": "Static Analysis" },
          { "context": "Python Checks" },
          { "context": "Playwright E2E" },
          { "context": "Analyze (javascript-typescript, none)" },
          { "context": "Analyze (python, none)" }
        ]
      }
    },
    {
      "type": "code_scanning",
      "parameters": {
        "code_scanning_tools": [
          {
            "tool": "CodeQL",
            "security_alerts_threshold": "high_or_higher",
            "alerts_threshold": "errors"
          }
        ]
      }
    }
  ]
}
JSON
)"

existing="$(gh api "repos/${REPO}/rulesets" --jq ".[] | select(.name == \"${RULESET_NAME}\") | .id" 2>/dev/null || true)"

if [[ -n "$existing" ]]; then
  echo "Updating ruleset '${RULESET_NAME}' (id ${existing}) on ${REPO} ..."
  printf '%s' "$payload" | gh api -X PUT "repos/${REPO}/rulesets/${existing}" --input - > /dev/null
else
  echo "Creating ruleset '${RULESET_NAME}' on ${REPO} ..."
  printf '%s' "$payload" | gh api -X POST "repos/${REPO}/rulesets" --input - > /dev/null
fi

echo "Done. Active rules:"
gh api "repos/${REPO}/rulesets" --jq ".[] | select(.name == \"${RULESET_NAME}\") | \"  \(.name)  [\(.enforcement)]\""
