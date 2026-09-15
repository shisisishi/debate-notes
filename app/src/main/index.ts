/** 应用入口：窗口、自定义照片协议、菜单、启动流程。 */

import { app, BrowserWindow, dialog, Menu, protocol, session, shell } from 'electron'
import { mkdirSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { PHOTO_SCHEME } from './backgrounds'
import { closeDb, openDb } from './db'
import { mimeForFileName } from './imagefmt'
import { registerIpc, runStartupBackup } from './ipc'
import { ensurePaths, getPaths } from './paths'

const isDev = !app.isPackaged
const usingCustomDataDir = !!process.env.DEBATE_NOTES_DATA_DIR
let mainWindow: BrowserWindow | null = null

// 自定义协议必须在 ready 之前登记
protocol.registerSchemesAsPrivileged([
  {
    scheme: PHOTO_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: false }
  }
])

// 数据目录（含 Chromium 运行时缓存）统一定位，避免污染系统目录
const paths = ensurePaths()
mkdirSync(paths.runtimeDir, { recursive: true })
app.setPath('userData', paths.runtimeDir)

if (!usingCustomDataDir && !app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })
}

function buildMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: '文件',
      submenu: [
        {
          label: '打开数据目录',
          click: () => {
            void shell.openPath(getPaths().dataDir)
          }
        },
        { type: 'separator' },
        { label: '退出', role: 'quit' }
      ]
    },
    {
      label: '视图',
      submenu: [
        { label: '重新载入', role: 'reload' },
        { label: '强制重新载入', role: 'forceReload' },
        { type: 'separator' },
        { label: '实际大小', role: 'resetZoom' },
        { label: '放大', role: 'zoomIn' },
        { label: '缩小', role: 'zoomOut' },
        { type: 'separator' },
        { label: '全屏', role: 'togglefullscreen' },
        ...(isDev ? ([{ type: 'separator' }, { label: '开发者工具', role: 'toggleDevTools' }] as Electron.MenuItemConstructorOptions[]) : [])
      ]
    },
    {
      label: '帮助',
      submenu: [
        {
          label: '关于辩论手记',
          click: () => {
            void dialog.showMessageBox({
              type: 'info',
              title: '关于辩论手记',
              message: '辩论手记',
              detail:
                `版本 ${app.getVersion()}\n` +
                `Electron ${process.versions.electron} · Chromium ${process.versions.chrome} · Node ${process.versions.node}\n\n` +
                `数据目录：${getPaths().dataDir}\n` +
                '全部数据保存在本机，无需登录、不依赖在线服务。',
              buttons: ['好的'],
              noLink: true
            })
          }
        }
      ]
    }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

/**
 * 照片协议。
 * 注意：这里刻意用「读入内存后返回字节」而不是 net.fetch(file://)——
 * 后者会让 Chromium 把照片文件内存映射，之后主进程删除或覆盖该文件（清空背景、恢复备份）
 * 会直接让主进程原生崩溃。自己读字节既避免映射，也避免文件被占用。
 */
function registerPhotoProtocol(): void {
  protocol.handle(PHOTO_SCHEME, async (request) => {
    try {
      const url = new URL(request.url)
      const raw = decodeURIComponent(url.pathname.replace(/^\/+/, ''))
      const base = getPaths().photosDir
      const fileName = path.basename(raw)
      const full = path.join(base, fileName)
      if (path.dirname(full) !== base) {
        return new Response('forbidden', { status: 403 })
      }
      const data = await readFile(full)
      return new Response(new Uint8Array(data), {
        status: 200,
        headers: {
          'Content-Type': mimeForFileName(fileName) ?? 'application/octet-stream',
          'Content-Length': String(data.byteLength),
          'Cache-Control': 'no-cache'
        }
      })
    } catch {
      return new Response('not found', { status: 404 })
    }
  })
}

function applyProductionCsp(): void {
  if (isDev) return
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          [
            "default-src 'self'",
            "script-src 'self'",
            "style-src 'self' 'unsafe-inline'",
            `img-src 'self' data: ${PHOTO_SCHEME}:`,
            "font-src 'self' data:",
            `connect-src 'self' ${PHOTO_SCHEME}:`,
            "object-src 'none'",
            "base-uri 'none'",
            "form-action 'none'"
          ].join('; ')
        ]
      }
    })
  })
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 1024,
    minHeight: 660,
    show: false,
    backgroundColor: '#f5f1e9',
    title: '辩论手记',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false
    }
  })

  mainWindow.once('ready-to-show', () => mainWindow?.show())

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (devUrl) {
    void mainWindow.loadURL(devUrl)
  } else {
    void mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

app.whenReady().then(() => {
  buildMenu()
  registerPhotoProtocol()
  applyProductionCsp()

  openDb()
  registerIpc(() => mainWindow)
  runStartupBackup()

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// 出问题时的现场记录：渲染进程或子进程异常结束时把原因写出来，便于排查
app.on('render-process-gone', (_event, _contents, details) => {
  console.error('[main] 渲染进程异常结束：', details.reason, 'exitCode=', details.exitCode)
})

app.on('child-process-gone', (_event, details) => {
  console.error('[main] 子进程异常结束：', details.type, details.reason, 'exitCode=', details.exitCode)
})

process.on('uncaughtException', (err) => {
  console.error('[main] 未捕获异常：', err)
})

process.on('unhandledRejection', (reason) => {
  console.error('[main] 未处理的 Promise 拒绝：', reason)
})

app.on('window-all-closed', () => {
  console.error('[main] 所有窗口已关闭，准备退出')
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  console.error('[main] before-quit')
  closeDb()
})
