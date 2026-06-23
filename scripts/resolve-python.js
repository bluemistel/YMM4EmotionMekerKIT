// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * ビルド／開発時に使用する Python 実行ファイルを解決する。
 *
 * 優先順位:
 *   1. 環境変数 YMM4_PYTHON
 *   2. backend/.venv にある Python
 *   3. backend/.venv がなければ backend/setup_venv.py で作成＋依存インストール
 *   4. それも失敗したらシステムの python（PATH 依存）
 */
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const VENV_DIR = path.join(ROOT, "backend", ".venv");

function venvPython() {
  const binDir = process.platform === "win32" ? "Scripts" : "bin";
  return path.join(VENV_DIR, binDir, "python");
}

function venvPythonExe() {
  const binDir = process.platform === "win32" ? "Scripts" : "bin";
  return path.join(VENV_DIR, binDir, "python.exe");
}

function venvExists() {
  const check = process.platform === "win32" ? venvPythonExe() : venvPython();
  return fs.existsSync(check);
}

function run(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: ROOT,
      stdio: ["ignore", "inherit", "inherit"],
      ...options,
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`"${command}" exited with ${code}`));
      }
    });
  });
}

async function setupVenv() {
  const basePython = process.platform === "win32" ? "python" : "python3";
  await run(basePython, [path.join("backend", "setup_venv.py")]);
}

async function resolvePython() {
  const envPython = process.env.YMM4_PYTHON;
  if (envPython) {
    return envPython;
  }

  if (venvExists()) {
    return venvPython();
  }

  try {
    await setupVenv();
    if (venvExists()) {
      return venvPython();
    }
  } catch (err) {
    console.warn("[resolve-python] venv setup failed, falling back to system python:", err.message);
  }

  return process.platform === "win32" ? "python" : "python3";
}

module.exports = { resolvePython };
