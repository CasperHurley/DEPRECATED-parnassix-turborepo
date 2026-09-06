import { join } from 'node:path'
import { app, shell, BrowserWindow } from 'electron'

const createWindow = (): void => {
  const mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    show: false,
    // Matches the Tamagui dark theme so there is no white flash before paint.
    backgroundColor: '#050505',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  // electron-vite sets ELECTRON_RENDERER_URL when serving the renderer over HMR.
  const rendererUrl = process.env.ELECTRON_RENDERER_URL

  if (rendererUrl) {
    mainWindow.loadURL(rendererUrl)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
