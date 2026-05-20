import { createServer } from 'node:http'
import next from 'next'
import { WebSocketServer, WebSocket } from 'ws'
import { SerialPort } from 'serialport'
import { ReadlineParser } from '@serialport/parser-readline'

const port = parseInt(process.env.PORT ?? '3000', 10)
const dev = process.env.NODE_ENV !== 'production'
const app = next({ dev })
const handle = app.getRequestHandler()

app.prepare().then(() => {
  const httpServer = createServer((req, res) => {
    handle(req, res)
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
              if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'data', text: line }))
              }
            })

            serial.on('close', () => {
              if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'disconnected' }))
              }
            })

            serial.on('error', (err: Error) => {
              if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'error', message: err.message }))
              }
            })

            serial.open((err) => {
              if (err) {
                ws.send(JSON.stringify({ type: 'error', message: `Open failed: ${err.message}` }))
              } else {
                ws.send(JSON.stringify({ type: 'connected' }))
              }
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
          if (serial?.isOpen && msg.text) {
            serial.write(msg.text)
          }
          break
        }

        case 'bytes': {
          if (serial?.isOpen && Array.isArray(msg.data)) {
            serial.write(Buffer.from(msg.data))
          }
          break
        }
      }
    })
  })

  httpServer.listen(port, '0.0.0.0', () => {
    console.log(`> Ready on http://0.0.0.0:${port}`)
    console.log(`> WebSocket bridge active at ws://0.0.0.0:${port}/ws`)
  })
})
