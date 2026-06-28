# SPDX-License-Identifier: AGPL-3.0-or-later
"""Test utilities and sys.path setup for backend imports."""
from __future__ import annotations

import sys
from pathlib import Path

_BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))
