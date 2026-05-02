import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'

function createWindow() {
  const win = new BrowserWindow({
    width: 970,
    height: 820,
    // Use join(__dirname, ...) to find the icon relative to the built main.js
    // Since main.js is in out/main/, we go up one level to find the assets
    icon: join(__dirname, '../../resources/icon.png'),
    kiosk: true,
    webPreferences: {
      preload: join(__dirname, '../preload/preload.js')
    }
  })

  win.setMenu(null)
  // In development, load from the dev server
  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    // In production, load the built index.html
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // Only open DevTools if we aren't in production
  if (process.env.ELECTRON_RENDERER_URL) {
    win.webContents.openDevTools()
  }

  // Inside createWindow()
  win.on('enter-full-screen', () => {
    console.log('Entered Fullscreen')
  })

  // Add an IPC listener if you want to trigger it from your Vue button
  ipcMain.on('toggle-fullscreen', () => {
    const isFullScreen = win.isFullScreen()
    win.setFullScreen(!isFullScreen)
  })
}

app.whenReady().then(createWindow)


// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

ipcMain.on('quit-app', () => {
  app.quit()
})