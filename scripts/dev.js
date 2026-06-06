/**
 * 開発用ランチャ: Next.js 開発サーバー(:3000) を起動し、応答を確認してから
 * Electron を起動する。Electron 側はバックエンド(FastAPI) を自前で起動するため、
 * ここでは Next と Electron の2つだけを面倒見る。
 *
 * 使い方: npm run dev
 */
const { spawn, execSync } = require("child_process");
const http = require("http");
const path = require("path");
const fs = require("fs");

const ROOT = path.resolve(__dirname, "..");
const FRONTEND_DIR = path.join(ROOT, "frontend");
const NEXT_PORT = 3000;
const NEXT_URL = `http://localhost:${NEXT_PORT}`;

const isWin = process.platform === "win32";

/** プロセスツリーごと強制終了する。Windows では child.kill() が子孫（実体の
 *  next dev サーバーや Electron が起動した Python バックエンド）を残すため、
 *  taskkill /T /F でツリー全体を落とす。同期実行（exit ハンドラからも使うため）。 */
function killTree(pid) {
  if (!pid) return;
  try {
    if (isWin) {
      execSync(`taskkill /PID ${pid} /T /F`, { stdio: "ignore" });
    } else {
      try { process.kill(-pid, "SIGKILL"); } catch { process.kill(pid, "SIGKILL"); }
    }
  } catch {
    /* already gone */
  }
}

/** 起動前に :3000 を掴んでいる残存プロセスを掃除する（前回の取り残し対策）。
 *  これをしないと古い next dev が :3000 に居座り、新規起動が 404 になる。 */
function freePort(port) {
  if (!isWin) return;
  try {
    const out = execSync(`netstat -ano -p tcp | findstr :${port}`, { encoding: "utf8" });
    const pids = new Set();
    for (const line of out.split(/\r?\n/)) {
      const m = line.trim().match(/LISTENING\s+(\d+)\s*$/);
      if (m) pids.add(m[1]);
    }
    for (const pid of pids) {
      killTree(pid);
      console.log(`[dev] freed port ${port} (pid ${pid})`);
    }
  } catch {
    /* nothing was listening */
  }
}

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
    killTree(c.pid);
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

// 0) 前回の取り残し（:3000 を掴んだ古い next dev 等）を掃除してから起動。
freePort(NEXT_PORT);

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
