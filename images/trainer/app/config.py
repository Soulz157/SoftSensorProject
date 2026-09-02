"""Run-scoped configuration and this container's own environment contract.

Every constant here was module-level in the original single-file train.py.
So was the environment read — and that is the one thing this split
deliberately changes: `RunContext.from_env()` is called ONCE, explicitly, by
the entrypoint, instead of four `os.environ[...]` lookups executing at import
time. Nothing about the runtime contract moved; what moved is that importing
any function in this codebase no longer requires RUN_ID/RUN_TOKEN/API_BASE to
be set, so a unit test can import `labelled_mask` or `build_windows` without
monkeypatching the environment first.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

SCRATCH = Path("/scratch")
STATUS_SUFFIX = "__status"
STATUS_GOOD = 0
TIMESTAMP_COLUMN = "timestamp"


@dataclass(frozen=True)
class RunContext:
    """Everything this process knows about which run it is and what it may do.

    Frozen on purpose: `mode` decides which API surface every callback in this
    container is allowed to touch (see `api.RunApi`), and a value that
    load-bearing must not be reassignable partway through a run.
    """

    run_id: str
    run_token: str
    api_base: str
    # MODEL-FLOW-016-T07. Set by TrainningContainerAuthorizedService.spawn's own
    # `MODE=${mode}` Env entry — "train" (default, unset falls back to it) or
    # "score". Threaded through every callback this container makes, never just
    # the entrypoint choice: a scoring container that posted to the TRAINING
    # `/log` or `/complete` would hit routes ScoreTokenGuard's own token can't
    # authorize anyway (see that guard's doc comment), but never calling them in
    # the first place is the cheaper, first line of defence — and the only one
    # that keeps a scoring container's OWN logs from being silently lost
    # (RunApi.log's `except requests.RequestException` does not notice a 401; it
    # only catches transport failures).
    mode: str = "train"

    @property
    def is_score_mode(self) -> bool:
        return self.mode == "score"

    @property
    def api(self) -> str:
        return f"{self.api_base}/api/v1/authorized/model/runs/{self.run_id}"

    @classmethod
    def from_env(cls) -> "RunContext":
        return cls(
            run_id=os.environ["RUN_ID"],
            run_token=os.environ["RUN_TOKEN"],
            api_base=os.environ["API_BASE"].rstrip("/"),
            mode=os.environ.get("MODE", "train"),
        )
