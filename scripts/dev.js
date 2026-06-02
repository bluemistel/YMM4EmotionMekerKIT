/**
 * 開発用ランチャ: Next.js 開発サーバー(:3000) を起動し、応答を確認してから
 * Electron を起動する。Electron 側はバックエンド(FastAPI) を自前で起動するため、
 * ここでは Next と Electron の2つだけを面倒見る。
 *
 * 使い方: npm run dev
 */
const { spawn } = require("child_process");
const http = require("http");
const path = require("path");
const fs = require("fs");

const ROOT = path.resolve(__dirname, "..");
const FRONTEND_DIR = path.join(ROOT, "frontend");
const NEXT_URL = "http://localhost:3000";

// `npm run build`（静的エクスポート）後に残る .next は dev と不整合になり
// "ENOENT: .next/server/app/page.js" を起こすことがある。起動前に必ず消す。
try {
  fs.rmSync(path.join(FRONTEND_DIR, ".next"), { recursive: true, force: true });
  console.log("[dev] cleared frontend/.next cache");
} catch {
  /* ignore */
}

const children = [];
let shuttingDown = false;

function cleanup() {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const c of children) {
    try {
      c.kill();
    } catch {
      /* ignore */
    }
  }
}
process.on("SIGINT", () => {
  cleanup();
  process.exit(0);
});
process.on("SIGTERM", () => {
  cleanup();
  process.exit(0);
});
process.on("exit", cleanup);

// 1) Next.js 開発サーバー
console.log("[dev] starting Next.js dev server on :3000 ...");
const next = spawn("npm", ["run", "dev"], {
  cwd: FRONTEND_DIR,
  stdio: "inherit",
  shell: true,
});
children.push(next);
next.on("exit", (code) => {
  if (!shuttingDown) {
    console.error(`[dev] Next.js dev server exited (code ${code}).`);
    cleanup();
    process.exit(code || 1);
  }
});

// 2) :3000 が応答するまで待ってから Electron を起動
function waitForNext(retries) {
  const req = http.get(NEXT_URL, () => {
    req.destroy();
    startElectron();
  });
  req.on("error", () => {
    if (retries <= 0) {
      console.error("[dev] Next.js dev server did not become ready on :3000.");
      cleanup();
      process.exit(1);
    }
    setTimeout(() => waitForNext(retries - 1), 1000);
  });
}

function startElectron() {
  console.log("[dev] Next.js is ready. Launching Electron ...");
  // node から require('electron') すると electron 実行ファイルのパスが返る。
  const electronPath = require("electron");
  const electron = spawn(electronPath, ["."], {
    cwd: ROOT,
    stdio: "inherit",
  });
  children.push(electron);
  electron.on("exit", () => {
    cleanup();
    process.exit(0);
  });
}

setTimeout(() => waitForNext(90), 1500);
