// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * backend/build_backend.py を、解決した Python 実行ファイルで起動する。
 * .venv がなければ自動作成し、失敗したらシステム python でフォールバックする。
 */
const { spawn } = require("child_process");
const path = require("path");
const { resolvePython } = require("./resolve-python");

const ROOT = path.resolve(__dirname, "..");
const BACKEND_DIR = path.join(ROOT, "backend");
const BUILD_SCRIPT = path.join(BACKEND_DIR, "build_backend.py");

async function main() {
  const python = await resolvePython();
  console.log("[build-backend] using:", python);
  const child = spawn(python, [BUILD_SCRIPT], {
    cwd: BACKEND_DIR,
    stdio: "inherit",
  });
  child.on("error", (err) => {
    console.error("[build-backend] failed to start:", err.message);
    process.exit(1);
  });
  child.on("close", (code) => {
    process.exit(code ?? 1);
  });
}

main();
