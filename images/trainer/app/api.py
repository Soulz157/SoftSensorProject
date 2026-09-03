"""The internal API, as one object.

The original file routed on MODE in four separate places (`log()`'s endpoint
ternary, `run_score()`'s hand-written score-* URLs, `main()`'s own, and the
`__main__` handler's failure report). Each was correct, and each was an
independent chance to be wrong — a fifth callback added later could simply
forget.

Here MODE routing happens ONCE, in `_endpoint`, and the methods are named by
ROLE rather than by URL. A scoring container calls `api.claim()` and reaches
`/score-claim`; there is no code path by which it can reach `/claim`. That is
the same invariant the MODE constant's own doc comment argues for, enforced
structurally instead of by four agreeing ternaries.
"""

from __future__ import annotations

import sys
from typing import Any, Mapping

import requests

from config import RunContext

# role -> {mode: path}. The ONLY place these surfaces are paired; every
# caller in this codebase asks for a role, never a literal URL. MODEL-SERVE-
# 003 added the "batch" column — a role missing a "batch" entry (there is
# none today) would KeyError rather than silently reach a train/score route,
# which is the same "no code path here that could reach the wrong endpoint
# even by mistake" guarantee this module's docstring already states.
_ROUTES: dict[str, dict[str, str]] = {
    "claim": {"train": "/claim", "score": "/score-claim", "batch": "/batch-claim"},
    "log": {"train": "/log", "score": "/score-log", "batch": "/batch-log"},
    "upload-urls": {
        "train": "/upload-urls",
        "score": "/score-upload-urls",
        "batch": "/batch-upload-urls",
    },
    "complete": {
        "train": "/complete",
        "score": "/score-complete",
        "batch": "/batch-complete",
    },
}


class RunApi:
    def __init__(self, context: RunContext, session: requests.Session | None = None):
        self.context = context
        # Accepted rather than created, so a test can hand in a session with a
        # mock transport without patching module state.
        self.session = session or requests.Session()
        self.session.headers.update(
            {"Authorization": f"Bearer {context.run_token}"})

    def _endpoint(self, role: str) -> str:
        path = _ROUTES[role][self.context.mode]
        return f"{self.context.api}{path}"

    def log(self, message: str, level: str = "info") -> None:
        """Best-effort remote log. Never fatal.

        A logging outage must not fail a training run that is otherwise fine, so
        this swallows transport errors — but it always mirrors to stderr, which
        the runner captures from the container's exit path.
        """
        print(f"[{level}] {message}", file=sys.stderr, flush=True)
        try:
            self.session.post(
                self._endpoint("log"),
                json={"level": level, "message": message},
                timeout=10,
            )
        except requests.RequestException:
            pass

    def claim(self) -> dict[str, Any]:
        response = self.session.post(self._endpoint("claim"), timeout=60)
        response.raise_for_status()
        return response.json()

    def upload_urls(self, filenames: list[str]) -> dict[str, str]:
        """Write capabilities, requested at upload time and not at claim time.

        The fit may have taken hours, and a capability minted to survive that
        would be far longer-lived than it needs to be. Scoring is far shorter
        than a fit, but the discipline is the same — which is exactly why this
        is one method for both modes rather than two.
        """
        response = self.session.post(
            self._endpoint("upload-urls"), json={"filenames": filenames}, timeout=60
        )
        response.raise_for_status()
        return response.json()["upload_urls"]

    def complete(self, payload: Mapping[str, Any]) -> None:
        response = self.session.post(
            self._endpoint("complete"), json=dict(payload), timeout=60
        )
        response.raise_for_status()

    def report_failure(self, reason: str) -> None:
        """Terminal FAILED report from the top-level handler. Never raises.

        MODE-aware by construction (MODEL-FLOW-016-T07): a scoring container's
        crash reports to /score-complete, never /complete — the latter would
        re-flip this run's already-terminal (SUCCEEDED) status, metrics, and
        owning draft. Both schemas accept the same {status, failureReason}
        shape for a FAILED report.
        """
        try:
            self.session.post(
                self._endpoint("complete"),
                json={"status": "FAILED", "failureReason": reason[:2000]},
                timeout=30,
            )
        except requests.RequestException:
            pass
