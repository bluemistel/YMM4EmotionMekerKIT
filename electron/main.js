// SPDX-License-Identifier: AGPL-3.0-or-later
const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const path = require("path");
const http = require("http");
const { spawn } = require("child_process");
const net = require("net");
const fs = require("fs");

let mainWindow = null;
let backendProcess = null;
let frontendServer = null;
let backendPort = 8000;
let frontendPort = 3100;

function isDev() {
  return !app.isPackaged;
}

function getResourcePath(...segments) {
  if (isDev()) {
    return path.join(__dirname, "..", ...segments);
  }
  return path.join(process.resourcesPath, ...segments);
}

function findFreePort(startPort) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(startPort, "127.0.0.1", () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
    server.on("error", () => {
      resolve(findFreePort(startPort + 1));
    });
  });
}

function getBackendExePath() {
  // 本番: PyInstaller でバンドルした単体実行ファイル（Python 不要）。
  const dir = getResourcePath("backend-dist");
  const name = process.platform === "win32" ? "ymm4-backend.exe" : "ymm4-backend";
  return path.join(dir, name);
}

function startBackend(port) {
  return new Promise((resolve, reject) => {
    // 設定・学習データ・モデルキャッシュは書込可能なユーザー領域に固定する
    // （バンドル内は読取専用。アップデートしても引き継がれる）。
    const dataDir = path.join(app.getPath("userData"), "data");
    const env = {
      ...process.env,
      PYTHONDONTWRITEBYTECODE: "1",
      YMM4_DATA_DIR: dataDir,
      HF_HOME: path.join(dataDir, "hf"),
      // 親(Electron)が異常終了してもバックエンドが自律終了できるよう PID を渡す。
      YMM4_PARENT_PID: String(process.pid),
    };

    let command;
    let args;
    let cwd;
    if (!isDev()) {
      // バンドル済みバックエンドを起動（Python 環境に依存しない）。
      const exe = getBackendExePath();
      if (!fs.existsSync(exe)) {
        reject(
          new Error(
            `バックエンド実行ファイルが見つかりません:\n${exe}\nインストールが破損している可能性があります。再インストールをお試しください。`
          )
        );
        return;
      }
      command = exe;
      args = ["--host", "127.0.0.1", "--port", String(port)];
      cwd = getResourcePath("backend-dist");
    } else {
      // 開発時はリポジトリの Python 環境で uvicorn を起動。
      command = process.platform === "win32" ? "python" : "python3";
      args = ["-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", String(port)];
      cwd = getResourcePath("backend");
    }

    backendProcess = spawn(command, args, {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    let started = false;

    backendProcess.stdout.on("data", (data) => {
      const text = data.toString();
      console.log("[backend]", text.trim());
      if (!started && text.includes("Uvicorn running")) {
        started = true;
        resolve();
      }
    });

    backendProcess.stderr.on("data", (data) => {
      const text = data.toString();
      console.error("[backend]", text.trim());
      if (!started && text.includes("Uvicorn running")) {
        started = true;
        resolve();
      }
    });

    backendProcess.on("error", (err) => {
      console.error("Failed to start backend:", err.message);
      if (!started) reject(err);
    });

    backendProcess.on("exit", (code) => {
      console.log("Backend exited with code", code);
      if (!started) reject(new Error(`Backend exited with code ${code}`));
      backendProcess = null;
    });

    setTimeout(() => {
      if (!started) {
        started = true;
        resolve();
      }
    }, 60000);
  });
}

function waitForBackend(port, maxRetries = 120) {
  return new Promise((resolve, reject) => {
    let retries = 0;
    const check = () => {
      const req = require("http").get(
        `http://127.0.0.1:${port}/docs`,
        (res) => {
          resolve();
        }
      );
      req.on("error", () => {
        retries++;
        if (retries >= maxRetries) {
          reject(new Error("Backend did not start in time"));
        } else {
          setTimeout(check, 500);
        }
      });
      req.end();
    };
    check();
  });
}

const MIME_TYPES = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain",
};

function startFrontendServer(staticDir, port) {
  return new Promise((resolve, reject) => {
    frontendServer = http.createServer((req, res) => {
      let urlPath = decodeURIComponent(req.url.split("?")[0]);
      if (urlPath === "/") urlPath = "/index.html";

      const filePath = path.join(staticDir, urlPath);
      const ext = path.extname(filePath).toLowerCase();

      fs.readFile(filePath, (err, data) => {
        if (err) {
          const indexPath = path.join(staticDir, "index.html");
          fs.readFile(indexPath, (err2, fallback) => {
            if (err2) {
              res.writeHead(404);
              res.end("Not Found");
              return;
            }
            res.writeHead(200, { "Content-Type": "text/html" });
            res.end(fallback);
          });
          return;
        }
        res.writeHead(200, {
          "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
        });
        res.end(data);
      });
    });

    frontendServer.listen(port, "127.0.0.1", () => {
      console.log(`Frontend server running on http://127.0.0.1:${port}`);
      resolve();
    });
    frontendServer.on("error", reject);
  });
}

function stopFrontendServer() {
  if (frontendServer) {
    frontendServer.close();
    frontendServer = null;
  }
}

function stopBackend() {
  if (!backendProcess) return;

  try {
    if (process.platform === "win32") {
      spawn("taskkill", ["/pid", String(backendProcess.pid), "/f", "/t"], {
        windowsHide: true,
      });
    } else {
      backendProcess.kill("SIGTERM");
    }
  } catch (e) {
    console.error("Error stopping backend:", e.message);
  }
  backendProcess = null;
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    title: "YMM4 EmotionMaker KIT",
    icon: path.join(__dirname, "icon.png"),
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  mainWindow.setMenuBarVisibility(false);

  if (isDev()) {
    mainWindow.loadURL("http://localhost:3000");
  } else {
    mainWindow.loadURL(`http://127.0.0.1:${frontendPort}`);
  }

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.on("ready", async () => {
  ipcMain.handle("get-api-port", () => backendPort);

  ipcMain.handle("open-ymmp-dialog", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "YMM4 プロジェクトを開く",
      properties: ["openFile"],
      filters: [{ name: "YMM4 Project", extensions: ["ymmp"] }],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  ipcMain.handle("save-ymmp-dialog", async (_event, defaultPath) => {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: "名前を付けて書き出し",
      defaultPath: defaultPath || undefined,
      filters: [{ name: "YMM4 Project", extensions: ["ymmp"] }],
    });
    if (result.canceled || !result.filePath) return null;
    // Guarantee a .ymmp extension regardless of what the user typed.
    let fp = result.filePath;
    if (!/\.ymmp$/i.test(fp)) fp += ".ymmp";
    return fp;
  });

  ipcMain.handle("save-workstate-dialog", async (_event, defaultPath) => {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: "作業状態を保存",
      defaultPath: defaultPath || undefined,
      filters: [{ name: "EmotionMaker 作業状態", extensions: ["ymmemo"] }],
    });
    if (result.canceled || !result.filePath) return null;
    let fp = result.filePath;
    if (!/\.ymmemo$/i.test(fp)) fp += ".ymmemo";
    return fp;
  });

  ipcMain.handle("open-workstate-dialog", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "作業状態を読み込む",
      properties: ["openFile"],
      filters: [{ name: "EmotionMaker 作業状態", extensions: ["ymmemo"] }],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  ipcMain.handle("open-exe-dialog", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "YukkuriMovieMaker.exe を選択",
      properties: ["openFile"],
      filters: [
        { name: "実行ファイル", extensions: ["exe"] },
        { name: "すべてのファイル", extensions: ["*"] },
      ],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  ipcMain.handle("open-external", async (_event, url) => {
    if (typeof url === "string" && /^https?:\/\//i.test(url)) {
      await shell.openExternal(url);
      return true;
    }
    return false;
  });

  ipcMain.handle("get-app-version", () => app.getVersion());

  try {
    backendPort = await findFreePort(8000);
    console.log(`Starting backend on port ${backendPort}...`);

    await startBackend(backendPort);
    console.log("Backend process started, waiting for HTTP ready...");

    await waitForBackend(backendPort);
    console.log("Backend is ready!");

    if (!isDev()) {
      frontendPort = await findFreePort(3100);
      const frontendDir = getResourcePath("frontend-out");
      await startFrontendServer(frontendDir, frontendPort);
    }

    await createWindow();
  } catch (err) {
    console.error("Startup error:", err);
    const hint = isDev()
      ? "開発モードです。Python と依存関係（uvicorn 等）がインストールされているか確認してください。"
      : "アプリの初回起動には数十秒かかる場合があります。解消しない場合は再インストールをお試しください。";
    dialog.showErrorBox(
      "起動エラー",
      `バックエンドの起動に失敗しました。\n${hint}\n\n${err.message}`
    );
    app.quit();
  }
});

app.on("window-all-closed", () => {
  stopFrontendServer();
  stopBackend();
  app.quit();
});

app.on("before-quit", () => {
  stopFrontendServer();
  stopBackend();
});

process.on("exit", () => {
  stopFrontendServer();
  stopBackend();
});
