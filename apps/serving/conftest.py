"""Puts apps/serving on sys.path so the flat absolute imports
(`from config import settings`, `from services.loader import ...`) resolve
under pytest exactly as they do under `uvicorn main:app` — same reasoning
`images/trainer/conftest.py` already documents for that image.
"""

import sys
from pathlib import Path

_SERVICE_ROOT = Path(__file__).resolve().parent
if str(_SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(_SERVICE_ROOT))
