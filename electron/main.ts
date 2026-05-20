import { app, Tray, Menu, shell, nativeImage } from 'electron'
import { createServer } from 'node:http'
import { WebSocketServer, WebSocket } from 'ws'
import { SerialPort } from 'serialport'
import { ReadlineParser } from '@serialport/parser-readline'
import path from 'node:path'

const BRIDGE_PORT = 3001

let tray: Tray | null = null
let bridgeStarted = false

// Prevent the app from appearing in the dock/taskbar as a window
app.setName("CNC Bridge")
if (process.platform === 'darwin') app.dock?.hide()

function startBridge(): Promise<void> {
  return new Promise((resolve, reject) => {
    const httpServer = createServer((_, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' })
      res.end('CNC Bridge running')
    })

    const wss = new WebSocketServer({ server: httpServer, path: '/ws' })

    wss.on('connection', (ws: WebSocket) => {
      let serial: SerialPort | null = null

      function closeSerial() {
        if (serial?.isOpen) serial.close()
        serial = null
      }

      ws.on('close', closeSerial)

      ws.on('message', async (raw: Buffer) => {
        let msg: { type: string; port?: string; baudRate?: number; text?: string; data?: number[] }
        try {
          msg = JSON.parse(raw.toString())
        } catch {
          return
        }

        switch (msg.type) {
          case 'ports': {
            try {
              const list = await SerialPort.list()
              ws.send(JSON.stringify({ type: 'ports', ports: list.map(p => p.path) }))
            } catch (err: any) {
              ws.send(JSON.stringify({ type: 'error', message: `Failed to list ports: ${err.message}` }))
            }
            break
          }

          case 'connect': {
            closeSerial()
            if (!msg.port) {
              ws.send(JSON.stringify({ type: 'error', message: 'No port specified' }))
              break
            }
            try {
              serial = new SerialPort({ path: msg.port, baudRate: msg.baudRate ?? 115200, autoOpen: false })
              const parser = serial.pipe(new ReadlineParser({ delimiter: '\n' }))

              parser.on('data', (line: string) => {
                if (ws.readyState === WebSocket.OPEN)
                  ws.send(JSON.stringify({ type: 'data', text: line }))
              })
              serial.on('close', () => {
                if (ws.readyState === WebSocket.OPEN)
                  ws.send(JSON.stringify({ type: 'disconnected' }))
              })
              serial.on('error', (err: Error) => {
                if (ws.readyState === WebSocket.OPEN)
                  ws.send(JSON.stringify({ type: 'error', message: err.message }))
              })
              serial.open((err) => {
                if (err)
                  ws.send(JSON.stringify({ type: 'error', message: `Open failed: ${err.message}` }))
                else
                  ws.send(JSON.stringify({ type: 'connected' }))
              })
            } catch (err: any) {
              ws.send(JSON.stringify({ type: 'error', message: err.message }))
            }
            break
          }

          case 'disconnect': {
            closeSerial()
            ws.send(JSON.stringify({ type: 'disconnected' }))
            break
          }

          case 'send': {
            if (serial?.isOpen && msg.text) serial.write(msg.text)
            break
          }

          case 'bytes': {
            if (serial?.isOpen && Array.isArray(msg.data))
              serial.write(Buffer.from(msg.data))
            break
          }
        }
      })
    })

    httpServer.on('error', reject)
    httpServer.listen(BRIDGE_PORT, '127.0.0.1', () => {
      bridgeStarted = true
      resolve()
    })
  })
}

function buildMenu(appUrl: string) {
  return Menu.buildFromTemplate([
    {
      label: bridgeStarted ? `Open Controller` : 'Starting…',
      enabled: bridgeStarted,
      click: () => shell.openExternal(appUrl),
    },
    { type: 'separator' },
    {
      label: `Bridge: localhost:${BRIDGE_PORT}`,
      enabled: false,
    },
    { type: 'separator' },
    { label: 'Quit CNC Bridge', click: () => app.quit() },
  ])
}

app.whenReady().then(async () => {
  app.on('window-all-closed', () => { /* stay alive as tray app */ })

  // Use a blank icon — electron-builder will substitute the real one from buildResources
  const iconPath = path.join(
    app.isPackaged ? process.resourcesPath : path.join(__dirname, '..', 'public'),
    'favicon.ico'
  )
  const icon = nativeImage.createFromPath(iconPath)
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon)
  tray.setToolTip('CNC Bridge — Starting…')

  const APP_URL = process.env.CNC_APP_URL ?? 'https://cnc-psi.vercel.app'

  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Starting…', enabled: false },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]))

  try {
    await startBridge()
    tray.setToolTip(`CNC Bridge — Running on port ${BRIDGE_PORT}`)
    tray.setContextMenu(buildMenu(APP_URL))
    shell.openExternal(APP_URL)
  } catch (err: any) {
    tray.setToolTip(`CNC Bridge — Error: ${err.message}`)
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: `Error: ${err.message}`, enabled: false },
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() },
    ]))
  }
})
