# SPDX-License-Identifier: AGPL-3.0-or-later
"""Start both backend (FastAPI) and frontend (Next.js) servers."""
import subprocess
import sys
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BACKEND_DIR = ROOT / "backend"
FRONTEND_DIR = ROOT / "frontend"


def main():
    procs = []

    # Start backend
    print("[start] Starting FastAPI backend on :8000 ...")
    backend = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"],
        cwd=str(BACKEND_DIR),
    )
    procs.append(backend)

    # Start frontend
    print("[start] Starting Next.js frontend on :3000 ...")
    npm_cmd = "npm.cmd" if os.name == "nt" else "npm"
    frontend = subprocess.Popen(
        [npm_cmd, "run", "dev"],
        cwd=str(FRONTEND_DIR),
    )
    procs.append(frontend)

    print("[start] Both servers running. Press Ctrl+C to stop.")
    try:
        for p in procs:
            p.wait()
    except KeyboardInterrupt:
        print("\n[start] Shutting down ...")
        for p in procs:
            p.terminate()
        for p in procs:
            p.wait()


if __name__ == "__main__":
    main()
