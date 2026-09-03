"""Container entrypoint. Dispatch and report, nothing else.

Everything this file used to contain now lives in a module named after what it
does; what remains is the one thing that genuinely belongs at the process
boundary: decide which mode this container was spawned in, and make sure the run
is reported terminal even when it dies.

Deliberately kept this thin so that the top-level exception handler is the FIRST
thing a reader sees. Its correctness matters more than any single algorithm in
this codebase: the runner's exit-code watcher is only a backstop for the case
where even this fails (OOM kill, segfault), and it produces a far less useful
message.
"""

from __future__ import annotations

import sys

from api import RunApi
from config import RunContext
from pipelines import run_training
from pipelines.batch import run_batch_scoring
from pipelines.score import run_scoring


def main(context: RunContext, api: RunApi) -> int:
    """The mode decision, and the only place it is made.

    Takes both objects rather than constructing them, so that `__main__` below
    can own construction — it needs the `api` in scope for its handler, and a
    second construction site here would be a second chance for the two to
    disagree about which mode this container is in.
    """
    if context.is_score_mode:
        return run_scoring(context, api)
    if context.is_batch_mode:
        return run_batch_scoring(context, api)
    return run_training(context, api)


if __name__ == "__main__":
    # `main()` is called rather than re-derived here, and the construction it
    # used to duplicate now sits INSIDE the try. That placement is the point:
    # RunContext.from_env() raises on a missing RUN_ID/RUN_TOKEN/API_BASE, and
    # outside the try that exact failure escaped as a bare traceback with no
    # terminal report — leaving only the runner's exit-code backstop, which the
    # module docstring above calls the far less useful message.
    _api: RunApi | None = None
    try:
        _context = RunContext.from_env()
        _api = RunApi(_context)
        sys.exit(main(_context, _api))
    except SystemExit:
        raise
    except Exception as err:
        # _api is None only when the environment contract itself was unmet, so
        # there is no run token to authenticate a report with and no endpoint
        # to send it to. stderr is all that is left; the exit-code watcher
        # takes it from there.
        if _api is None:
            print(f"[error] {err}", file=sys.stderr, flush=True)
        else:
            _api.log(str(err), "error")
            _api.report_failure(str(err))
        sys.exit(1)
