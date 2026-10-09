#!/usr/bin/env bash
#
# up.sh — start the development loop in containers: Supabase on its CLI, then the agent and
# the three apps under Docker Compose.
#
# Usage (from the repo root, after a host `pnpm install` for the Supabase CLI):
#   ./scripts/docker/up.sh            # build if needed, start detached
#   ./scripts/docker/up.sh --build    # extra arguments go to `docker compose up`
#
# Stop with `docker compose down`. Supabase keeps running; stop it with `pnpm supabase stop`.
#
# Secrets never touch a file on the host. Provider keys are read from the macOS keychain at
# the coordinates python/.env and python/.env.local name, the same ones the host agent uses,
# into this script's own environment. Compose copies each one into the container as
# /run/secrets/<name>. A key whose keychain account is not configured is not attached, so
# that feature reports itself unavailable, exactly as it does on the host.
#
# The apps' session password is generated fresh on every run, so a restart signs you out.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

CLI="./node_modules/.bin/supabase"
if [[ ! -x "$CLI" ]]; then
  echo "error: the Supabase CLI ($CLI) was not found. Run \`pnpm install\` on the host first." >&2
  exit 1
fi

# --- Supabase ------------------------------------------------------------------------------
if ! "$CLI" status >/dev/null 2>&1; then
  "$CLI" start
fi
./scripts/seed/seed-demo-accounts.sh

status_env="$("$CLI" status -o env 2>/dev/null)"
status_value() {
  sed -n "s/^$1=\"\(.*\)\"$/\1/p" <<<"$status_env"
}

api_url="$(status_value API_URL)"
db_url="$(status_value DB_URL)"
anon_key="$(status_value ANON_KEY)"
if [[ -z "$api_url" || -z "$db_url" || -z "$anon_key" ]]; then
  echo "error: could not read API_URL, DB_URL and ANON_KEY from \`supabase status\`." >&2
  exit 1
fi

# Tokens name the address the browser uses. The containers reach the same Supabase through
# the host, so the issuer is pinned here rather than derived from their SUPABASE_URL.
export ARTLOUPE_DOCKER_SUPABASE_ISSUER="${api_url%/}/auth/v1"
export ARTLOUPE_DOCKER_SUPABASE_ANON_KEY="$anon_key"
export ARTLOUPE_DOCKER_DATABASE_URL="$(
  sed -E 's#@(127\.0\.0\.1|localhost):#@host.docker.internal:#' <<<"$db_url"
)"

# One password for both apps. They share the host-only `artloupe_session` cookie on localhost,
# which ignores the port, so distinct passwords would make each sign-in overwrite the other
# app's cookie. This matches the host setup; production separates the apps by subdomain.
export ARTLOUPE_DOCKER_SESSION_PASSWORD="$(openssl rand -base64 36)"

# --- Provider keys from the keychain -------------------------------------------------------
# The same precedence as the Python settings: the process environment, then
# python/.env.local, then python/.env.

# One dotenv value, read the way python-dotenv reads it for the forms these settings use: a
# single- or double-quoted value is taken verbatim up to its closing quote, and an unquoted
# value ends at a ` #` comment, with surrounding whitespace trimmed.
dotenv_value() {
  local raw="$1"
  raw="${raw#"${raw%%[![:space:]]*}"}"
  case "$raw" in
    \'*)
      raw="${raw#\'}"
      printf '%s' "${raw%%\'*}"
      ;;
    \"*)
      raw="${raw#\"}"
      printf '%s' "${raw%%\"*}"
      ;;
    *)
      raw="${raw%%[[:space:]]#*}"
      printf '%s' "${raw%"${raw##*[![:space:]]}"}"
      ;;
  esac
}

setting() {
  local name="$1" file line
  if [[ -n "${!name:-}" ]]; then
    printf '%s' "${!name}"
    return
  fi
  for file in python/.env.local python/.env; do
    [[ -f "$file" ]] || continue
    line="$(grep -E "^[[:space:]]*(export[[:space:]]+)?${name}[[:space:]]*=" "$file" |
      tail -n 1 || true)"
    if [[ -n "$line" ]]; then
      dotenv_value "${line#*=}"
      return
    fi
  done
}

# bash 3.2, which macOS ships, has no ${var^^}.
upper() {
  tr "[:lower:]" "[:upper:]" <<<"$1"
}

KEYCHAIN_TIMEOUT_SECONDS=30
service="$(setting ARTLOUPE_KEYCHAIN_SERVICE)"
attached=()

# Each entry is `<secret name>|<keychain account setting>`.
for entry in \
  "anthropic_api_key|ARTLOUPE_ANTHROPIC_KEYCHAIN_ACCOUNT" \
  "openai_api_key|ARTLOUPE_OPENAI_KEYCHAIN_ACCOUNT" \
  "pexels_api_key|ARTLOUPE_PEXELS_KEYCHAIN_ACCOUNT"; do
  secret="${entry%%|*}"
  account="$(setting "${entry#*|}")"
  if [[ -z "$account" ]]; then
    echo "  skipped  ${secret} (no ${entry#*|} configured)"
    continue
  fi
  if [[ -z "$service" ]]; then
    echo "error: ${entry#*|} is set but ARTLOUPE_KEYCHAIN_SERVICE is not." >&2
    exit 1
  fi
  # A locked keychain can raise a password dialog, and `security` waits on it. The bound turns
  # a hang into a named error, matching the Python lookup's 30 seconds.
  if ! value="$(perl -e 'alarm shift; exec @ARGV' "$KEYCHAIN_TIMEOUT_SECONDS" \
    security find-generic-password -s "$service" -a "$account" -w 2>/dev/null)" ||
    [[ -z "$value" ]]; then
    echo "error: the keychain item for ${secret} (service '${service}', account '${account}')" \
      "could not be read within ${KEYCHAIN_TIMEOUT_SECONDS}s. The keychain may be locked, or" \
      "the item may not exist." >&2
    exit 1
  fi
  export "ARTLOUPE_DOCKER_SECRET_$(upper "$secret")=$value"
  unset value
  attached+=("$secret")
  echo "  attached ${secret}"
done

# The override names which secrets the agent receives and where each one's value comes
# from. It carries no value itself, and it is read from a pipe, never written to disk.
override() {
  if ((${#attached[@]} == 0)); then
    printf 'services: {}\n'
    return
  fi
  printf 'services:\n  agent:\n    secrets:\n'
  for secret in "${attached[@]}"; do
    printf '      - %s\n' "$secret"
  done
  printf 'secrets:\n'
  for secret in "${attached[@]}"; do
    printf '  %s:\n    environment: ARTLOUPE_DOCKER_SECRET_%s\n' "$secret" "$(upper "$secret")"
  done
}

docker compose -f compose.yaml -f <(override) up --detach "$@"

cat <<'EOF'

Running. The first start installs dependencies and compiles, so give it a minute.
  entry       http://localhost:3003
  studio      http://localhost:3001
  operations  http://localhost:3000
  agent       http://127.0.0.1:8080

Follow the logs with `docker compose logs -f`. Stop with `docker compose down`.
After a Python change, run `docker compose restart agent`.
EOF
