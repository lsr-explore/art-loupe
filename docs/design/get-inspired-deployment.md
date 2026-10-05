# Get Inspired deployment configuration

Deployment itself is separate from these feature PRs. No production database migration,
provider key setup, Cloud Run deployment, or Vercel deployment is performed by this change.

## Shared Supabase cache

Apply `20261005120000_create_inspiration_cache.sql` through the normal migration workflow.
The `inspiration` schema must remain outside PostgREST's exposed schemas. The migration
creates a NOLOGIN role restricted to this cache table; browser roles receive no access.

Provision a separate LOGIN role with no elevated privileges and membership in
`artloupe_inspiration_cache`. Store its database connection string as the Cloud Run
secret `ARTLOUPE_INSPIRATION_DATABASE_URL`. Use SSL for a hosted Supabase connection.
Do not supply the project-owner DSN, a user token, or a Supabase service-role key.
The backend explicitly sets the restricted role before querying the table.

The worker can read, insert, update and prune only catalog search results. It cannot read
artist projects or authentication tables. Set Cloud Run instance limits to bound database
connections and provider request load; the code caps simultaneous cache operations at four
per process. Monitor provider quota usage and cache-unavailable warnings.

## Python backend

Supply `PEXELS_API_KEY` through a Cloud Run secret environment binding. Never add it to
Vercel public variables or source control. Met needs no API key.
Existing Supabase JWT verification settings are required as usual. Local configuration
can supply the Pexels key in the process environment; this code does not read a key file.

The endpoint is `POST /inspiration/search`, guarded by the existing verified Supabase
user dependency and restricted to artist/superuser roles. Search is deterministic and
does not invoke a LangGraph agent or language model.

For Cloud Run, keep IAM authentication required. Its HTTPS endpoint must be reachable
from Vercel; internal-only ingress requires separately configured network connectivity.
OIDC authenticates the caller but does not create that network path. The existing
loopback-only development launcher also needs a production ASGI command binding to
`0.0.0.0:$PORT` when packaging the service, as with the other agent endpoints.

## Vercel bridge

Set these server-only variables in Studio:

| Variable | Value |
| --- | --- |
| `ARTLOUPE_AGENT_URL` | The canonical HTTPS `*.run.app` service origin, with no path/query |
| `GCP_WIF_AUDIENCE` | `//iam.googleapis.com/projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/POOL/providers/PROVIDER` |
| `GCP_SERVICE_ACCOUNT` | Service-account email with Cloud Run invoker permission |

Configure a GCP workload identity provider trusting your Vercel team's issuer and audience.
Restrict its attribute condition to the intended team/project/environment. Permit that
federated principal to generate ID tokens for this service account, and give the account
`roles/run.invoker` on this backend only. Enable STS and IAM Credentials APIs as needed.
Follow the linked provider documentation for the exact identity bindings in your project.

The bridge obtains Vercel's request-scoped OIDC token, exchanges it through Google STS,
and requests a Google ID token targeted at the Cloud Run origin. It sends that token in
`X-Serverless-Authorization`; `Authorization` separately carries the user's Supabase token.
Cloud Run validates the service identity and Python validates the user identity. No
service-account private key is required.

For local development only, `ARTLOUPE_AGENT_URL=http://127.0.0.1:8080` skips Cloud Run IAM
while still forwarding the user's Supabase token. Production refuses HTTP/loopback origins.
Absent configuration yields a recoverable 503 instead of falling back to direct browser
provider calls.

## Review boundaries

The stack is organized as backend/contracts/bridge, reusable UI/page, then browser
verification and the learning guide. Review and merge bottom to top. The browser tests
use stubs; live deployment validation still needs configured secrets, workload identity,
network reachability and an applied Supabase migration.
