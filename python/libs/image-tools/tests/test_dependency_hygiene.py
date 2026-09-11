"""Exactly one distribution may provide `cv2`, and it is the one `mediapipe` depends on.

`opencv-python` and `opencv-contrib-python` both install the `cv2` namespace, and uv resolves
the pair without error. Whichever unpacks last wins, so the breakage is silent until an import
somewhere reaches for a function the winner lacks. PR 10 brings `mediapipe`, which requires
`opencv-contrib-python`; this package took the same distribution so the two can never clash.

It runs against the synced workspace environment, which is the one CI and every developer use,
so a second provider added anywhere in the workspace — not only in this package — fails here.
See `docs/spikes/mediapipe-feasibility.md` §3.
"""

from importlib.metadata import distributions

import pytest

pytestmark = pytest.mark.trace(flow="analysis.geometry", category="functionality")

CV2_PROVIDERS = {
    "opencv-python",
    "opencv-contrib-python",
    "opencv-python-headless",
    "opencv-contrib-python-headless",
}


def test_exactly_one_cv2_provider() -> None:
    installed = {dist.metadata["Name"].lower() for dist in distributions()}
    providers = installed & CV2_PROVIDERS
    assert providers == {"opencv-contrib-python"}, (
        f"expected only opencv-contrib-python (mediapipe's), found {sorted(providers)}. "
        "Two distributions both install cv2 and uv resolves them without error."
    )
