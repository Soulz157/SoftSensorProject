"""Put app/ on sys.path so tests import exactly what the container imports.

The package uses flat absolute imports (`from labels import ...`,
`import pipelines`) because inside the container `sys.path[0]` is the script's
own directory, `/app`. Tests must resolve the same names the same way, or a test
suite can pass against an import graph the image does not have.

This is deliberately a conftest.py at the image root rather than a `pythonpath`
entry in a repo-level pyproject.toml: it keeps the trainer image self-contained,
so building and testing it does not depend on where it sits in the monorepo. If
the repo already centralises pytest config, the equivalent is:

    [tool.pytest.ini_options]
    pythonpath = ["image/trainer/app"]

Use one or the other, not both.
"""

from __future__ import annotations

import sys
from pathlib import Path

APP_DIR = Path(__file__).parent / "app"

# Prepended, and idempotently: pytest may import this file once per rootdir, and
# a duplicated entry would shadow nothing but is noise in tracebacks.
if str(APP_DIR) not in sys.path:
    sys.path.insert(0, str(APP_DIR))
