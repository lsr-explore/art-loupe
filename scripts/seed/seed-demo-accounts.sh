#!/usr/bin/env bash
#
# seed-demo-accounts.sh — create pre-confirmed demo accounts in Supabase Auth for both
# surfaces: artists for the studio app, and operators for the operations console.
#
# The role is written into `app_metadata`, which only the service-role key can set. That
# is precisely why it is trustworthy as an authorization claim: a signed-in user can edit
# their own `user_metadata` freely, but not this. `@artloupe/auth` reads the role from
# here, and the operations login refuses anyone outside the operator roles.
#
# Uses the GoTrue admin API (`POST /auth/v1/admin/users`) with `email_confirm: true`
# so each account is usable immediately with NO email round-trip — the emails are just
# login identifiers, nothing is ever sent. That is the whole point of the password
# route: a deployed demo needs no mail provider (see [issue #12](https://github.com/lsr-explore/art-loupe/issues/12) for the
# magic-link follow-up).
#
# Requires the service-role key (admin scope). It is read at runtime, never committed:
#   - from $SUPABASE_SERVICE_ROLE_KEY if set, otherwise
#   - from the local Supabase CLI (`supabase status -o env`).
#
# Safe by default for LOCAL Supabase. Targeting a non-loopback host is gated: it must
# use https AND explicit non-default passwords for BOTH accounts, so a stray run can't
# provision guessable accounts or leak the service-role key in cleartext.
#
# Usage (from the repo root, with `supabase start` already running):
#   ./scripts/seed/seed-demo-accounts.sh
#
# Env overrides:
#   SUPABASE_URL                (default http://127.0.0.1:54321)
#   SUPABASE_SERVICE_ROLE_KEY   (default: read from the local Supabase CLI)
#   DEMO_ACCOUNT_PASSWORD       (artist; default demo-artist-pass)
#   DEMO_OPERATOR_PASSWORD      (operator; default demo-operator-pass)
#
# The two accounts default to DIFFERENT passwords on purpose: the operator holds the
# console, and a shared default is one leaked string away from handing over both. Each
# must be set to a non-default value for non-local targets.

set -euo pipefail

# Separate defaults, not one shared value. A fresh clone gets working logins with no
# configuration, and the privileged console account never silently shares a password with
# a demo artist login. Both are documented in the README; keep the three in step.
DEFAULT_ARTIST_PASSWORD="demo-artist-pass"
DEFAULT_OPERATOR_PASSWORD="demo-operator-pass"
SUPABASE_URL="${SUPABASE_URL:-http://127.0.0.1:54321}"
DEMO_ACCOUNT_PASSWORD="${DEMO_ACCOUNT_PASSWORD:-$DEFAULT_ARTIST_PASSWORD}"
DEMO_OPERATOR_PASSWORD="${DEMO_OPERATOR_PASSWORD:-$DEFAULT_OPERATOR_PASSWORD}"

# Demo accounts as `email|role`. An empty role seeds no `app_metadata`, which resolves to
# `artist` — the least-privileged fallback — rather than encoding the default twice.
#
# Artists are login identities only for now: the studio has no per-artist record to
# resolve yet. When artist records land, this mapping becomes load-bearing — an address
# seeded here with no matching record must fail closed rather than showing another
# artist's work, so change both together.
DEMO_ACCOUNTS=(
  "demo.artist@demo.artloupestudio.com|"
  "demo.operator@demo.artloupestudio.com|operator"
)

# --- Target parsing + safe-by-default policy ---------------------------------------
# Parse with a real URL parser, not string-slicing: a naive `127.*` glob would treat a
# remote name like `127.attacker.example` as loopback, and userinfo such as
# `http://127.0.0.1@attacker.example` reads as local while curl connects to
# `attacker.example` — either would slip past the https + non-default-password gate
# below. Reject non-HTTP(S) schemes and any userinfo outright.
if ! target="$(SUPABASE_URL_VALUE="$SUPABASE_URL" node -e '
  try {
    const url = new URL(process.env.SUPABASE_URL_VALUE);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
      process.exit(1);
    }
    process.stdout.write(`${url.protocol.slice(0, -1)}\t${url.hostname.toLowerCase()}`);
  } catch {
    process.exit(1);
  }
')"; then
  echo "error: SUPABASE_URL ($SUPABASE_URL) must be a valid http(s) URL with no userinfo." >&2
  exit 1
fi
IFS=$'\t' read -r scheme host <<< "$target"

# Loopback = localhost, the whole 127.0.0.0/8 range (strict dotted-quad), or ::1 / 0.0.0.0.
is_loopback=false
if [[ "$host" == localhost || "$host" == '[::1]' || "$host" == 0.0.0.0 ||
      "$host" =~ ^127(\.[0-9]{1,3}){3}$ ]]; then
  is_loopback=true
fi

if [[ "$is_loopback" != true ]]; then
  if [[ "$scheme" != "https" ]]; then
    echo "error: non-local SUPABASE_URL ($SUPABASE_URL) must use https — refusing to send the service-role key in cleartext." >&2
    exit 1
  fi
  if [[ "$DEMO_ACCOUNT_PASSWORD" == "$DEFAULT_ARTIST_PASSWORD" ]]; then
    echo "error: set an explicit, non-default DEMO_ACCOUNT_PASSWORD before seeding a non-local target." >&2
    exit 1
  fi
  if [[ "$DEMO_OPERATOR_PASSWORD" == "$DEFAULT_OPERATOR_PASSWORD" ]]; then
    echo "error: set an explicit, non-default DEMO_OPERATOR_PASSWORD before seeding a non-local target." >&2
    exit 1
  fi
fi

# --- Resolve the service-role key without printing or committing it ----------------
if [[ -z "${SUPABASE_SERVICE_ROLE_KEY:-}" ]]; then
  CLI="./node_modules/.bin/supabase"
  if [[ ! -x "$CLI" ]]; then
    echo "error: SUPABASE_SERVICE_ROLE_KEY is unset and the Supabase CLI ($CLI) was not found." >&2
    echo "       Set the env var, or run this from the repo root after \`pnpm install\`." >&2
    exit 1
  fi
  SUPABASE_SERVICE_ROLE_KEY="$("$CLI" status -o env 2>/dev/null | sed -n 's/^SERVICE_ROLE_KEY="\(.*\)"$/\1/p')"
  if [[ -z "$SUPABASE_SERVICE_ROLE_KEY" ]]; then
    echo "error: could not read SERVICE_ROLE_KEY from \`supabase status\`. Is \`supabase start\` running?" >&2
    exit 1
  fi
fi

# --- Credential-safe, bounded request setup ----------------------------------------
# Headers (incl. the service-role key) live in a private curl config so they never
# appear in process arguments; the JSON body goes through a temp file for the same
# reason. All temp files are unique (mktemp) and removed on exit.
CURL_CONFIG="$(mktemp)"
RESP="$(mktemp)"
BODY="$(mktemp)"
trap 'rm -f "$CURL_CONFIG" "$RESP" "$BODY"' EXIT

cat > "$CURL_CONFIG" <<CURLCFG
url = "${SUPABASE_URL}/auth/v1/admin/users"
request = "POST"
header = "apikey: ${SUPABASE_SERVICE_ROLE_KEY}"
header = "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}"
header = "Content-Type: application/json"
connect-timeout = "5"
max-time = "30"
CURLCFG

echo "Seeding demo accounts into ${SUPABASE_URL} ..."

# Per-account outcome, as `email|role|created|skipped`. The summary below reports what
# actually happened rather than what was requested: a skipped account keeps whatever
# password it was created with, and printing the one we would have set is a lie that
# costs someone a confused login attempt.
RESULTS=()

for entry in "${DEMO_ACCOUNTS[@]}"; do
  email="${entry%%|*}"
  role="${entry#*|}"

  if [[ "$role" == "operator" ]]; then
    account_password="$DEMO_OPERATOR_PASSWORD"
  else
    account_password="$DEMO_ACCOUNT_PASSWORD"
  fi

  # Build JSON via node (a guaranteed repo dependency) so a password containing
  # quotes, backslashes, or newlines can't corrupt the body; values pass by env,
  # not argv, to keep them out of the process table.
  SEED_EMAIL="$email" SEED_PW="$account_password" SEED_ROLE="$role" node -e \
    'const role = process.env.SEED_ROLE;
     process.stdout.write(JSON.stringify({
       email: process.env.SEED_EMAIL,
       password: process.env.SEED_PW,
       email_confirm: true,
       ...(role ? { app_metadata: { artloupe_role: role } } : {}),
     }))' \
    > "$BODY"

  status="$(curl -sS -K "$CURL_CONFIG" --data-binary @"$BODY" -o "$RESP" -w '%{http_code}')"

  case "$status" in
    200 | 201)
      echo "  created  ${email}${role:+  (role: ${role})}"
      RESULTS+=("${email}|${role}|created")
      ;;
    422)
      # GoTrue returns 422 for an already-registered email. Re-runs intentionally
      # skip (idempotent) rather than resetting the password of a live account.
      #
      # Note this also means a re-run does NOT repair a missing or wrong
      # `app_metadata.artloupe_role` on an account seeded before roles existed. Delete
      # the user and re-seed if the role needs to change.
      echo "  exists   ${email} (skipped)"
      RESULTS+=("${email}|${role}|skipped")
      ;;
    *)
      echo "  FAILED   ${email} (HTTP ${status})" >&2
      cat "$RESP" >&2 || true
      echo >&2
      exit 1
      ;;
  esac
done

# --- Summary — report the real outcome, per account ---------------------------------
# The literal password is echoed only where it is both known and harmless: a freshly
# created account on a loopback target still using the built-in default.
describe_password() {
  local status="$1" password="$2" var_name="$3" default_password="$4"

  if [[ "$status" == "skipped" ]]; then
    echo "password  (unchanged — account already existed)"
  elif [[ "$is_loopback" == true && "$password" == "$default_password" ]]; then
    echo "password  ${password}"
  else
    echo "password  (from \$${var_name})"
  fi
}

echo
echo "Done."

for result in "${RESULTS[@]}"; do
  IFS='|' read -r email role status <<< "$result"

  if [[ "$role" == "operator" ]]; then
    surface="operations → http://127.0.0.1:3000"
    password_line="$(describe_password "$status" "$DEMO_OPERATOR_PASSWORD" DEMO_OPERATOR_PASSWORD "$DEFAULT_OPERATOR_PASSWORD")"
  else
    surface="studio → http://127.0.0.1:3001"
    password_line="$(describe_password "$status" "$DEMO_ACCOUNT_PASSWORD" DEMO_ACCOUNT_PASSWORD "$DEFAULT_ARTIST_PASSWORD")"
  fi

  echo
  echo "${role:-artist} login (${surface}):"
  echo
  echo "  ${email}"
  echo "  ${password_line}"
  [[ -n "$role" ]] && echo "  role      ${role}  (app_metadata.artloupe_role)"
done

cat <<'EOF'

These accounts are pre-confirmed; no email is sent.

A skipped account keeps its original password AND its original app_metadata — re-running
this script does not repair either. Delete the user in Supabase Studio and re-run if a
password or role needs to change.
EOF
