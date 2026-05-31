const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  isElectron: true,
  getApiPort: () => ipcRenderer.invoke("get-api-port"),
  openYmmpDialog: () => ipcRenderer.invoke("open-ymmp-dialog"),
  saveYmmpDialog: (defaultPath) => ipcRenderer.invoke("save-ymmp-dialog", defaultPath),
  saveWorkstateDialog: (defaultPath) => ipcRenderer.invoke("save-workstate-dialog", defaultPath),
  openWorkstateDialog: () => ipcRenderer.invoke("open-workstate-dialog"),
  openExeDialog: () => ipcRenderer.invoke("open-exe-dialog"),
  openExternal: (url) => ipcRenderer.invoke("open-external", url),
  getAppVersion: () => ipcRenderer.invoke("get-app-version"),
  getPathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file);
    } catch {
      return "";
    }
  },
});
