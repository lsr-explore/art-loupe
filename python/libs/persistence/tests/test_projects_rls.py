"""One artist cannot reach another artist's work.

`public.projects` and `public.source_images` sit in an API-exposed schema on purpose: the studio
queries them as the signed-in artist, relaying that artist's Supabase-issued JWT so `auth.uid()`
resolves to a real person (ADR 0002). The price of that is that row-level security is the entire
boundary. There is no second wall behind it, the way the checkpoint schema has one.

Every assertion here is written against a control, because "the query returned nothing" is the
easiest green in security testing and the least meaningful. A missing grant, a typo in a table
name, a role that does not exist, an empty table -- all of them return nothing and none of them
is a policy working. So each isolation test is paired with a demonstration that the same rows
are readable when RLS is not what is deciding, and each privilege test is paired with a
demonstration that the privilege being denied is one this database hands out by default.
"""

from __future__ import annotations

import json

import psycopg
import pytest
from db_support import (
    ANON,
    ARTIST_A,
    ARTIST_B,
    AUTHENTICATED,
    CHECKSUM_A,
    CHECKSUM_B,
    PROJECT_A,
    PROJECT_B,
    acting_as,
    count,
    refused,
    storage_key,
)

from artloupe.persistence import PROJECTS_TABLE, REFERENCE_IMAGE_BUCKET, SOURCE_IMAGES_TABLE

pytestmark = pytest.mark.trace(flow="intake.project-intent", category="security")

WRITE_ORIGINAL = f"""
    insert into {SOURCE_IMAGES_TABLE}
        (project_id, checksum, storage_key, mime_type, width_px, height_px, byte_size)
    values (%s, %s, %s, 'image/png', 1000, 1000, 5000)
"""


# ---------------------------------------------------------------------------------------------
# Controls. Without these, everything below could be passing for the wrong reason.
# ---------------------------------------------------------------------------------------------


def test_both_projects_are_readable_when_no_policy_is_deciding(
    two_artists: psycopg.Connection,
) -> None:
    """The control for every isolation test in this file.

    `postgres` holds BYPASSRLS, so this is the artists' own query with the policies switched
    off. Two rows here is what makes "artist A sees one" a statement about RLS rather than a
    statement about an empty table.
    """
    visible = count(
        two_artists,
        f"select count(*) from {PROJECTS_TABLE} where id = any(%s)",
        ([PROJECT_A, PROJECT_B],),
    )

    assert visible == 2, "the fixture rows are not there; nothing below proves anything"


def test_a_new_public_table_is_granted_to_the_api_roles_by_default(
    db: psycopg.Connection,
) -> None:
    """The control for the `anon` revoke.

    Supabase's default-privilege grants to `anon` and `authenticated` are schema-scoped, and
    `public` is one of the schemas they cover. If that stops being true, this is no longer a
    database where an un-revoked table would leak, and the revoke assertions below stop saying
    anything.
    """
    db.execute("create table if not exists public.rls_control_probe (id int)")
    granted = {
        role: db.execute(
            "select has_table_privilege(%s, 'public.rls_control_probe', 'SELECT')", (role,)
        ).fetchone()[0]
        for role in (ANON, AUTHENTICATED)
    }
    db.execute("drop table if exists public.rls_control_probe")

    assert all(granted.values()), (
        f"expected {ANON}/{AUTHENTICATED} to be granted SELECT on a new `public` table, got "
        f"{granted}. Without that, the revoke on `projects` proves nothing."
    )


def test_authenticated_holds_the_privileges_the_policies_confine(db: psycopg.Connection) -> None:
    """The control for every `authenticated` isolation test.

    An artist seeing one row instead of two has to be RLS narrowing the result, not a missing
    GRANT refusing the statement outright.
    """
    held = {
        verb: db.execute(
            "select has_table_privilege(%s, %s, %s)", (AUTHENTICATED, PROJECTS_TABLE, verb)
        ).fetchone()[0]
        for verb in ("SELECT", "INSERT", "UPDATE", "DELETE")
    }

    assert all(held.values()), f"{AUTHENTICATED} is missing grants on {PROJECTS_TABLE}: {held}"


# ---------------------------------------------------------------------------------------------
# anon holds nothing here at all
# ---------------------------------------------------------------------------------------------


@pytest.mark.parametrize("table", [PROJECTS_TABLE, SOURCE_IMAGES_TABLE])
def test_anon_holds_no_privilege_on_artist_tables(db: psycopg.Connection, table: str) -> None:
    """The anon key is a published value, so this is the grant that must not exist.

    Kept separate from RLS deliberately: they are two defences, and only one of them can be got
    wrong by writing a policy badly.
    """
    held = {
        verb: db.execute("select has_table_privilege(%s, %s, %s)", (ANON, table, verb)).fetchone()[
            0
        ]
        for verb in ("SELECT", "INSERT", "UPDATE", "DELETE")
    }

    assert not any(held.values()), f"{ANON} holds privileges on {table}: {held}"


def test_anon_is_refused_outright_rather_than_shown_an_empty_table(
    two_artists: psycopg.Connection,
) -> None:
    with acting_as(two_artists, ANON) as conn, refused(conn):
        conn.execute(f"select count(*) from {PROJECTS_TABLE}")


# ---------------------------------------------------------------------------------------------
# projects: an artist reaches their own rows and no others
# ---------------------------------------------------------------------------------------------


def test_an_artist_sees_only_their_own_project(two_artists: psycopg.Connection) -> None:
    with acting_as(two_artists, AUTHENTICATED, ARTIST_A) as conn:
        rows = conn.execute(f"select id, owner_id from {PROJECTS_TABLE}").fetchall()

    assert [(str(row[0]), str(row[1])) for row in rows] == [(PROJECT_A, ARTIST_A)]


def test_an_artist_cannot_create_a_project_owned_by_someone_else(
    two_artists: psycopg.Connection,
) -> None:
    """The WITH CHECK half of the insert policy.

    Easy to leave out, because without it everything still appears to work: the row is created,
    and the artist who created it simply never sees it again.
    """
    with acting_as(two_artists, AUTHENTICATED, ARTIST_A) as conn:
        # Control first: the same statement for themselves succeeds, so the refusal below is
        # about ownership rather than about the insert path being broken.
        conn.execute(f"insert into {PROJECTS_TABLE} (owner_id) values (%s)", (ARTIST_A,))

        with refused(conn):
            conn.execute(f"insert into {PROJECTS_TABLE} (owner_id) values (%s)", (ARTIST_B,))


def test_an_artist_cannot_edit_another_artists_intent(two_artists: psycopg.Connection) -> None:
    """FR-104 lets the artist edit their intent and re-run. Theirs."""
    revised = json.dumps({"medium": "watercolour", "time_budget_minutes": 30})

    with acting_as(two_artists, AUTHENTICATED, ARTIST_A) as conn:
        mine = conn.execute(
            f"update {PROJECTS_TABLE} set intent = %s where id = %s", (revised, PROJECT_A)
        ).rowcount
        theirs = conn.execute(
            f"update {PROJECTS_TABLE} set intent = %s where id = %s", (revised, PROJECT_B)
        ).rowcount

    assert mine == 1, "the update path is broken; the zero below would mean nothing"
    assert theirs == 0


def test_an_artist_cannot_hand_their_project_to_someone_else(
    two_artists: psycopg.Connection,
) -> None:
    """The WITH CHECK half of the update policy: a row may not be reassigned out of reach."""
    with acting_as(two_artists, AUTHENTICATED, ARTIST_A) as conn, refused(conn):
        conn.execute(
            f"update {PROJECTS_TABLE} set owner_id = %s where id = %s", (ARTIST_B, PROJECT_A)
        )


def test_an_artist_cannot_delete_another_artists_project(two_artists: psycopg.Connection) -> None:
    """NFR-10 makes deletion the artist's to perform. Of their own work."""
    with acting_as(two_artists, AUTHENTICATED, ARTIST_A) as conn:
        theirs = conn.execute(f"delete from {PROJECTS_TABLE} where id = %s", (PROJECT_B,)).rowcount
        mine = conn.execute(f"delete from {PROJECTS_TABLE} where id = %s", (PROJECT_A,)).rowcount

    assert theirs == 0
    assert mine == 1, "the delete path is broken; the zero above would mean nothing"


# ---------------------------------------------------------------------------------------------
# source_images: ownership is derived from the project, and updates do not exist
# ---------------------------------------------------------------------------------------------


def test_only_the_owning_artist_sees_the_uploaded_original(
    two_artists: psycopg.Connection,
) -> None:
    assert count(two_artists, f"select count(*) from {SOURCE_IMAGES_TABLE}") == 1, (
        "the fixture upload is missing; both counts below would be zero for the wrong reason"
    )

    with acting_as(two_artists, AUTHENTICATED, ARTIST_A) as conn:
        owner_sees = count(conn, f"select count(*) from {SOURCE_IMAGES_TABLE}")

    with acting_as(two_artists, AUTHENTICATED, ARTIST_B) as conn:
        other_sees = count(conn, f"select count(*) from {SOURCE_IMAGES_TABLE}")

    assert owner_sees == 1
    assert other_sees == 0


def test_an_artist_cannot_attach_an_upload_to_another_artists_project(
    two_artists: psycopg.Connection,
) -> None:
    """`source_images` has no owner column; ownership is read through the project.

    Which means the policy has to be right about a join, and a join is the part that quietly
    stops filtering when someone simplifies it later.
    """
    with acting_as(two_artists, AUTHENTICATED, ARTIST_A) as conn, refused(conn):
        conn.execute(
            WRITE_ORIGINAL,
            (PROJECT_B, CHECKSUM_B, storage_key(ARTIST_B, PROJECT_B, CHECKSUM_B)),
        )


def test_an_artist_can_delete_their_own_upload(two_artists: psycopg.Connection) -> None:
    """NFR-10: the artist deletes their own work, and the deletion is real.

    This is also the control for the refusal above -- the insert policy is not simply refusing
    everything.
    """
    with acting_as(two_artists, AUTHENTICATED, ARTIST_A) as conn:
        removed = conn.execute(
            f"delete from {SOURCE_IMAGES_TABLE} where checksum = %s", (CHECKSUM_A,)
        ).rowcount

    assert removed == 1


def test_no_artist_holds_the_update_privilege_on_an_original(db: psycopg.Connection) -> None:
    """FR-105 at the privilege layer, which is one of three places it is enforced.

    The control is the same role holding UPDATE on `projects`: the absence here is deliberate
    rather than a role that cannot update anything anywhere.
    """
    on_originals = db.execute(
        "select has_table_privilege(%s, %s, 'UPDATE')", (AUTHENTICATED, SOURCE_IMAGES_TABLE)
    ).fetchone()[0]
    on_projects = db.execute(
        "select has_table_privilege(%s, %s, 'UPDATE')", (AUTHENTICATED, PROJECTS_TABLE)
    ).fetchone()[0]

    assert on_projects, f"{AUTHENTICATED} cannot update anything; the assertion below is vacuous"
    assert not on_originals


def test_there_is_no_update_policy_on_originals(db: psycopg.Connection) -> None:
    """Read from the catalog, because a policy added later is invisible to a behavioural test.

    An `ALL` policy counts, since it covers UPDATE -- which is why this does not look for the
    word `UPDATE` alone.
    """
    commands = {
        row[0]
        for row in db.execute(
            "select cmd from pg_policies where schemaname = 'public' and tablename = %s",
            (SOURCE_IMAGES_TABLE.split(".")[1],),
        ).fetchall()
    }

    assert commands, "no policies at all on the originals table -- RLS is not configured"
    assert "UPDATE" not in commands
    assert "ALL" not in commands


# ---------------------------------------------------------------------------------------------
# Storage objects
# ---------------------------------------------------------------------------------------------


def test_an_artist_sees_only_objects_under_their_own_prefix(
    two_artists: psycopg.Connection,
) -> None:
    """The storage policies match the first path segment against `auth.uid()`.

    Which is why the key format puts the owner id there, and why
    `apps/studio/src/lib/storage/reference-images.ts` refuses a non-UUID: a crafted prefix is
    the way out of this policy.
    """
    for owner, project, checksum in (
        (ARTIST_A, PROJECT_A, CHECKSUM_A),
        (ARTIST_B, PROJECT_B, CHECKSUM_B),
    ):
        two_artists.execute(
            "insert into storage.objects (bucket_id, name, owner_id) values (%s, %s, %s)",
            (REFERENCE_IMAGE_BUCKET, storage_key(owner, project, checksum), owner),
        )

    both = count(
        two_artists,
        "select count(*) from storage.objects where bucket_id = %s",
        (REFERENCE_IMAGE_BUCKET,),
    )

    with acting_as(two_artists, AUTHENTICATED, ARTIST_A) as conn:
        names = [
            row[0]
            for row in conn.execute(
                "select name from storage.objects where bucket_id = %s", (REFERENCE_IMAGE_BUCKET,)
            ).fetchall()
        ]

    assert both == 2, "both objects are not there; the single result below would be misleading"
    assert names == [storage_key(ARTIST_A, PROJECT_A, CHECKSUM_A)]


def test_an_artist_cannot_write_an_object_into_another_artists_prefix(
    two_artists: psycopg.Connection,
) -> None:
    with acting_as(two_artists, AUTHENTICATED, ARTIST_A) as conn:
        # Control: writing under their own prefix works, so the refusal is about the prefix.
        conn.execute(
            "insert into storage.objects (bucket_id, name, owner_id) values (%s, %s, %s)",
            (REFERENCE_IMAGE_BUCKET, storage_key(ARTIST_A, PROJECT_A, CHECKSUM_A), ARTIST_A),
        )

        with refused(conn):
            conn.execute(
                "insert into storage.objects (bucket_id, name, owner_id) values (%s, %s, %s)",
                (REFERENCE_IMAGE_BUCKET, storage_key(ARTIST_B, PROJECT_B, CHECKSUM_B), ARTIST_A),
            )


def test_the_reference_bucket_is_private(db: psycopg.Connection) -> None:
    """`public = true` would make every object readable by URL, with no policy consulted."""
    row = db.execute(
        "select public, file_size_limit, allowed_mime_types from storage.buckets where id = %s",
        (REFERENCE_IMAGE_BUCKET,),
    ).fetchone()

    assert row is not None, f"the `{REFERENCE_IMAGE_BUCKET}` bucket does not exist"
    is_public, size_limit, mime_types = row
    assert is_public is False
    assert size_limit == 25 * 1024 * 1024, "FR-101 caps an upload at 25 MB"
    assert sorted(mime_types) == ["image/jpeg", "image/png", "image/webp"]


def test_every_storage_policy_is_scoped_to_our_bucket(db: psycopg.Connection) -> None:
    """`storage.objects` is one table shared by every bucket in the project.

    An unscoped policy would silently grant access to buckets added later -- a bug that would
    not surface until the bucket existed, and then would look like a storage problem.
    """
    policies = db.execute(
        "select policyname, qual, with_check from pg_policies "
        "where schemaname = 'storage' and tablename = 'objects' and policyname like %s",
        ("artloupe%",),
    ).fetchall()

    assert policies, "no Art Loupe policies on storage.objects -- the migration did not run"
    unscoped = [
        name
        for name, expression, check in policies
        if REFERENCE_IMAGE_BUCKET not in f"{expression or ''}{check or ''}"
    ]

    assert unscoped == []
