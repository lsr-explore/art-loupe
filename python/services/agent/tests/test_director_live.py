"""One real call to the Director's model. Opt-in, because it spends real money.

Skipped unless `ARTLOUPE_LIVE_TESTS=1`, which `uv run poe test-live` sets. The key is resolved
through the real seam (`artloupe.config`), so locally it is read from the keychain.

It asserts only what must hold of any competent answer: the reply parses, and it accounts for
every offered tool exactly once. Whether the routing is *good* is a question for an eval.
"""

import os

import pytest
from agent_support import FACE_GATE, INTENT, SURVEY

from artloupe.agent.director import ask_director, close_director_client, director_client
from artloupe.schemas import TOOLS, ToolManifest, check_accounts_for

pytestmark = pytest.mark.trace(flow="intake.project-intent", category="functionality")


@pytest.mark.live
@pytest.mark.skipif(
    os.environ.get("ARTLOUPE_LIVE_TESTS") != "1",
    reason="spends real money; run it with `uv run poe test-live`",
)
async def test_the_director_routes_a_portrait_for_real() -> None:
    try:
        answer = await ask_director(
            director_client(), intent=INTENT, gate=FACE_GATE, survey=SURVEY, offered=list(TOOLS)
        )
    finally:
        await close_director_client()

    check_accounts_for(ToolManifest(selected=answer.selected, declined=answer.declined), TOOLS)
    assert answer.rationale.strip()
