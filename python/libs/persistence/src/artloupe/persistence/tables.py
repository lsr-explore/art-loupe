"""Where artist project data lives, named once.

These three names appear in four places between them — the migration that creates them, the
TypeScript helpers in `apps/studio/src/lib/storage/`, the Python that will read them, and the
tests that assert the policies hold. Naming them here gives the Python half one spelling.

Unlike `CHECKPOINT_SCHEMA`, these are in `public` deliberately. The studio queries them as the
signed-in artist, relaying that artist's Supabase-issued JWT so `auth.uid()` resolves to a real
person (ADR 0002), and that only works through the API-exposed schema. The consequence is that
row-level security is the boundary rather than schema placement, which is why
`tests/test_projects_rls.py` proves each policy denies something it would otherwise allow.
"""

# Qualified, because a bare table name resolves against `search_path` — and the checkpointer
# sets a non-default `search_path` on its own connections.
PROJECTS_TABLE = "public.projects"

# The immutable original (FR-105). One row per project (FR-101).
SOURCE_IMAGES_TABLE = "public.source_images"

# The private Supabase Storage bucket holding the uploaded bytes. Object keys are
# `{owner_id}/{project_id}/{checksum}`; the leading segment is what the storage policies match.
REFERENCE_IMAGE_BUCKET = "reference-images"
