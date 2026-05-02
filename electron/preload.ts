import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  ping: () => 'pong',
  quitApp: () => ipcRenderer.send('quit-app'),
  toggleFullScreen: () => ipcRenderer.send('toggle-fullscreen')
})