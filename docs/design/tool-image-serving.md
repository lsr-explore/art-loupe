# Tool image serving

The project page serves the selected deterministic tools as private PNG images. These are
reference studies computed from the uploaded photograph, not model-generated artwork.

## Current implementation

The studio relays `GET /projects/{id}/artifacts/{tool}` to the Python agent with the artist's
access token. The agent reads the project and original through Supabase as that artist.
Every request checks access again. Responses use `private, no-store`; private images bypass
Next.js image optimization and its shared cache. Downloads use the same authenticated route.

Grayscale and value maps encode tool pixels directly. Value shapes and outlines draw the
returned polylines on white. Perspective and head construction draw geometry over a copy of
the original. Geometry outside the frame is clipped, never moved to the edge. Cyan denotes
measured geometry and gold denotes the head scaffold or horizon; a level horizon may be an
assumption. The gallery shows the tool's recorded limitations and reliability.

PNG bytes are rendered on demand using current default tool recipes. No derivative store or
database migration is needed. Existing runs replay into the gallery. The gallery includes the recorded checksum and tool version in image requests.
A mismatch is refused rather than silently displaying a different recipe. Persist versioned
derivatives before promising historical exports across tool upgrades. The four plate requests currently compute the plate suite independently.

## Cloud storage recommendation

Use a private Supabase Storage bucket for persisted PNG bytes. Keep the project association,
source checksum, tool version, parameters digest, object key, MIME type and dimensions in
Postgres. Avoid binary image columns or base64 JSON in project rows and graph checkpoints.

Use immutable object keys scoped by artist, project, source checksum and recipe digest. Write
the object before its database row, and delete objects before project rows, matching original
image handling. Add owner-scoped Storage policies and project deletion coverage together.
Keep authenticated delivery, or issue short-lived signed URLs when the product needs them.
Do not make artists' references or studies public merely to enable CDN caching.

Supabase documents private delivery in its
[Storage download guide](https://supabase.com/docs/guides/storage/serving/downloads).
Persisted derivatives become useful for expensive rendering, stable historical exports and
high traffic. On-demand PNGs are sufficient for the current deterministic tools and avoid
introducing a second storage lifecycle before those requirements exist.

## Reopening saved projects

The signed-in Studio home page lists the artist's projects with reference thumbnails, creation
times and the latest analysis status. The list is read as the artist through PostgREST and is
paginated, 24 projects per page. Embedded source images and runs obey their own row policies.

A completed project's `runs.result` is validated against the shared run schema and checked
against both project and run IDs before rendering. The page initializes the panel with this
saved result; it does not start another analysis or need an agent event stream to restore text.
Queued and active runs still follow their event streams. Saved findings and complete lesson
text are shown alongside routing, material choices, stages, self-checks and critic verdicts.

Persistence requires `ARTLOUPE_RUN_LOG=postgres`, as configured by the Docker setup. The memory
run log is only suitable for tests. Project data and completed outputs survive service restarts
in Postgres and private Supabase Storage. Generated PNG bytes remain on-demand derivatives,
subject to the version checks described above; this change adds no derivative storage bucket.
The separate learning chat does not currently save conversation history against a project.
