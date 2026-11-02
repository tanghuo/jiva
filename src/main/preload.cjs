const { contextBridge, ipcRenderer } = require("electron");

if (process.isMainFrame) {
  contextBridge.exposeInMainWorld("wikiDesktop", {
    pairLocal: () => ipcRenderer.invoke('wiki:pair-local'),
    ...(process.platform === "win32" ? { setWallpaper: (elementId) => ipcRenderer.invoke("wiki:set-wallpaper", elementId) } : {}),
    pickShareSource: (kind) => ipcRenderer.invoke("wiki:pick-share-source", kind),
    pickProjectDirectory: () => ipcRenderer.invoke("wiki:pick-project-directory"),
    ...(process.platform === "win32" ? { readClipboardFolders: () => ipcRenderer.invoke('wiki:clipboard-folders') } : {}),
    openAionui: () => ipcRenderer.invoke('wiki:open-aionui'),
    embedAionui: (value) => ipcRenderer.invoke('wiki:embed-aionui', value),
    notify: (value) => ipcRenderer.invoke('agent:notify', value),
  });
}
