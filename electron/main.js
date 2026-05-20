"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const node_http_1 = require("node:http");
const ws_1 = require("ws");
const serialport_1 = require("serialport");
const parser_readline_1 = require("@serialport/parser-readline");
const node_path_1 = __importDefault(require("node:path"));
const BRIDGE_PORT = 3001;
let tray = null;
let bridgeStarted = false;
// Prevent the app from appearing in the dock/taskbar as a window
electron_1.app.setName("CNC Bridge");
if (process.platform === 'darwin')
    electron_1.app.dock?.hide();
function startBridge() {
    return new Promise((resolve, reject) => {
        const httpServer = (0, node_http_1.createServer)((_, res) => {
            res.writeHead(200, { 'Content-Type': 'text/plain' });
            res.end('CNC Bridge running');
        });
        const wss = new ws_1.WebSocketServer({ server: httpServer, path: '/ws' });
        wss.on('connection', (ws) => {
            let serial = null;
            function closeSerial() {
                if (serial?.isOpen)
                    serial.close();
                serial = null;
            }
            ws.on('close', closeSerial);
            ws.on('message', async (raw) => {
                let msg;
                try {
                    msg = JSON.parse(raw.toString());
                }
                catch {
                    return;
                }
                switch (msg.type) {
                    case 'ports': {
                        try {
                            const list = await serialport_1.SerialPort.list();
                            ws.send(JSON.stringify({ type: 'ports', ports: list.map(p => p.path) }));
                        }
                        catch (err) {
                            ws.send(JSON.stringify({ type: 'error', message: `Failed to list ports: ${err.message}` }));
                        }
                        break;
                    }
                    case 'connect': {
                        closeSerial();
                        if (!msg.port) {
                            ws.send(JSON.stringify({ type: 'error', message: 'No port specified' }));
                            break;
                        }
                        try {
                            serial = new serialport_1.SerialPort({ path: msg.port, baudRate: msg.baudRate ?? 115200, autoOpen: false });
                            const parser = serial.pipe(new parser_readline_1.ReadlineParser({ delimiter: '\n' }));
                            parser.on('data', (line) => {
                                if (ws.readyState === ws_1.WebSocket.OPEN)
                                    ws.send(JSON.stringify({ type: 'data', text: line }));
                            });
                            serial.on('close', () => {
                                if (ws.readyState === ws_1.WebSocket.OPEN)
                                    ws.send(JSON.stringify({ type: 'disconnected' }));
                            });
                            serial.on('error', (err) => {
                                if (ws.readyState === ws_1.WebSocket.OPEN)
                                    ws.send(JSON.stringify({ type: 'error', message: err.message }));
                            });
                            serial.open((err) => {
                                if (err)
                                    ws.send(JSON.stringify({ type: 'error', message: `Open failed: ${err.message}` }));
                                else
                                    ws.send(JSON.stringify({ type: 'connected' }));
                            });
                        }
                        catch (err) {
                            ws.send(JSON.stringify({ type: 'error', message: err.message }));
                        }
                        break;
                    }
                    case 'disconnect': {
                        closeSerial();
                        ws.send(JSON.stringify({ type: 'disconnected' }));
                        break;
                    }
                    case 'send': {
                        if (serial?.isOpen && msg.text)
                            serial.write(msg.text);
                        break;
                    }
                    case 'bytes': {
                        if (serial?.isOpen && Array.isArray(msg.data))
                            serial.write(Buffer.from(msg.data));
                        break;
                    }
                }
            });
        });
        httpServer.on('error', reject);
        httpServer.listen(BRIDGE_PORT, '127.0.0.1', () => {
            bridgeStarted = true;
            resolve();
        });
    });
}
function buildMenu(appUrl) {
    return electron_1.Menu.buildFromTemplate([
        {
            label: bridgeStarted ? `Open Controller` : 'Starting…',
            enabled: bridgeStarted,
            click: () => electron_1.shell.openExternal(appUrl),
        },
        { type: 'separator' },
        {
            label: `Bridge: localhost:${BRIDGE_PORT}`,
            enabled: false,
        },
        { type: 'separator' },
        { label: 'Quit CNC Bridge', click: () => electron_1.app.quit() },
    ]);
}
electron_1.app.whenReady().then(async () => {
    electron_1.app.on('window-all-closed', () => { });
    // Use a blank icon — electron-builder will substitute the real one from buildResources
    const iconPath = node_path_1.default.join(electron_1.app.isPackaged ? process.resourcesPath : node_path_1.default.join(__dirname, '..', 'public'), 'favicon.ico');
    const icon = electron_1.nativeImage.createFromPath(iconPath);
    tray = new electron_1.Tray(icon.isEmpty() ? electron_1.nativeImage.createEmpty() : icon);
    tray.setToolTip('CNC Bridge — Starting…');
    const APP_URL = process.env.CNC_APP_URL ?? 'https://cnc-psi.vercel.app';
    tray.setContextMenu(electron_1.Menu.buildFromTemplate([
        { label: 'Starting…', enabled: false },
        { type: 'separator' },
        { label: 'Quit', click: () => electron_1.app.quit() },
    ]));
    try {
        await startBridge();
        tray.setToolTip(`CNC Bridge — Running on port ${BRIDGE_PORT}`);
        tray.setContextMenu(buildMenu(APP_URL));
        electron_1.shell.openExternal(APP_URL);
    }
    catch (err) {
        tray.setToolTip(`CNC Bridge — Error: ${err.message}`);
        tray.setContextMenu(electron_1.Menu.buildFromTemplate([
            { label: `Error: ${err.message}`, enabled: false },
            { type: 'separator' },
            { label: 'Quit', click: () => electron_1.app.quit() },
        ]));
    }
});
