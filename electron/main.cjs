'use strict'

const { app, BrowserWindow, screen, dialog } = require('electron')
const path = require('path')
const fs = require('fs')
const os = require('os')
const { spawn } = require('child_process')
const http = require('http')

// Allowed origins for navigation and new-window events
const ALLOWED_ORIGINS = new Set([
  'http://localhost:3333',
  'http://localhost:3334',
])

const SERVER_PORT = 3334
const SERVER_HOST = '127.0.0.1'
const HEALTH_URL = `http://${SERVER_HOST}:${SERVER_PORT}/health`

let win
let serverProcess = null

// ---------------------------------------------------------------------------
// Server lifecycle
// ---------------------------------------------------------------------------

/**
 * Check if the server is already responding on port 3334.
 * Returns a Promise<boolean>.
 */
function isServerRunning() {
  return new Promise((resolve) => {
    const req = http.get(HEALTH_URL, (res) => {
      resolve(res.statusCode === 200)
    })
    req.on('error', () => resolve(false))
    req.setTimeout(1000, () => {
      req.destroy()
      resolve(false)
    })
  })
}

/**
 * Poll /health until the server responds OK or we exhaust retries.
 * Returns a Promise<boolean> — true if ready, false if timed out.
 */
function waitForServer(retries = 30, intervalMs = 300) {
  return new Promise((resolve) => {
    let attempts = 0

    function attempt() {
      attempts++
      const req = http.get(HEALTH_URL, (res) => {
        if (res.statusCode === 200) {
          resolve(true)
        } else if (attempts < retries) {
          setTimeout(attempt, intervalMs)
        } else {
          resolve(false)
        }
      })
      req.on('error', () => {
        if (attempts < retries) {
          setTimeout(attempt, intervalMs)
        } else {
          resolve(false)
        }
      })
      req.setTimeout(1000, () => {
        req.destroy()
        if (attempts < retries) {
          setTimeout(attempt, intervalMs)
        } else {
          resolve(false)
        }
      })
    }

    attempt()
  })
}

/**
 * Start the Express/WebSocket server as a child process.
 * In packaged builds the server remains inside app.asar so it can resolve the
 * bundled node_modules without requiring a system Node.js installation.
 * In dev the files are at <project-root>/server/index.js.
 */
function startServer() {
  const isDev = !app.isPackaged

  const serverEntry = path.join(__dirname, '../server/index.js')

  const runtime = isDev ? 'node' : process.execPath
  const env = isDev
    ? { ...process.env }
    : { ...process.env, ELECTRON_RUN_AS_NODE: '1' }

  console.log('[main] Spawning server:', serverEntry)

  serverProcess = spawn(runtime, [serverEntry], {
    stdio: 'pipe',
    env,
  })

  serverProcess.stdout.on('data', (data) => {
    process.stdout.write(`[server] ${data}`)
  })

  serverProcess.stderr.on('data', (data) => {
    process.stderr.write(`[server] ${data}`)
  })

  serverProcess.on('exit', (code, signal) => {
    console.log(`[main] Server process exited — code=${code} signal=${signal}`)
    serverProcess = null
  })

  serverProcess.on('error', (err) => {
    console.error('[main] Failed to start server process:', err.message)
    serverProcess = null
  })
}

/**
 * Kill the server child process if we own it.
 */
function stopServer() {
  if (serverProcess) {
    console.log('[main] Stopping server process...')
    serverProcess.kill('SIGTERM')
    serverProcess = null
  }
}

// ---------------------------------------------------------------------------
// Codex integration
// ---------------------------------------------------------------------------

const CODEX_HOOK_EVENTS = [
  'SubagentStart',
  'SubagentStop',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'PermissionRequest',
  'SessionStart',
  'SessionEnd',
  'Stop',
  'Interrupt',
]

function codexHome() {
  return process.env.CODEX_HOME || path.join(os.homedir(), '.codex')
}

function relayInstallPath() {
  return path.join(os.homedir(), '.agent-office', 'bin', 'codex-hook-relay.sh')
}

function relaySourcePath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'bin', 'codex-hook-relay.sh')
    : path.join(__dirname, '..', 'hooks', 'codex-hook-relay.sh')
}

function codexHookCommand() {
  const relay = relayInstallPath().replace(/"/g, '\\"')
  return `/bin/bash "${relay}"`
}

function hasCodexIntegration() {
  const hooksFile = path.join(codexHome(), 'hooks.json')
  if (!fs.existsSync(hooksFile)) return false

  try {
    const data = JSON.parse(fs.readFileSync(hooksFile, 'utf8'))
    const hooks = data?.hooks ?? {}
    // Treat incomplete older integrations as needing a one-click update.
    return CODEX_HOOK_EVENTS.every((eventName) =>
      Array.isArray(hooks[eventName]) &&
      hooks[eventName].some((group) =>
        Array.isArray(group?.hooks) &&
        group.hooks.some((hook) =>
          typeof hook?.command === 'string' &&
          hook.command.includes('codex-hook-relay.sh')
        )
      )
    )
  } catch {
    return false
  }
}

function installCodexIntegration() {
  const home = codexHome()
  const hooksFile = path.join(home, 'hooks.json')
  const relaySrc = relaySourcePath()
  const relayDst = relayInstallPath()

  fs.mkdirSync(home, { recursive: true })
  fs.mkdirSync(path.dirname(relayDst), { recursive: true })

  if (!fs.existsSync(relaySrc)) {
    throw new Error(`Bundled Codex relay not found: ${relaySrc}`)
  }

  fs.copyFileSync(relaySrc, relayDst)
  fs.chmodSync(relayDst, 0o755)

  let config = {}
  if (fs.existsSync(hooksFile)) {
    const raw = fs.readFileSync(hooksFile, 'utf8')
    try {
      config = JSON.parse(raw)
    } catch {
      throw new Error(`Cannot parse existing Codex hooks file: ${hooksFile}`)
    }

    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    fs.copyFileSync(hooksFile, `${hooksFile}.backup.${stamp}`)
  }

  if (!config || typeof config !== 'object' || Array.isArray(config)) config = {}
  if (!config.hooks || typeof config.hooks !== 'object' || Array.isArray(config.hooks)) {
    config.hooks = {}
  }

  const command = codexHookCommand()

  for (const eventName of CODEX_HOOK_EVENTS) {
    if (!Array.isArray(config.hooks[eventName])) config.hooks[eventName] = []

    const present = config.hooks[eventName].some((group) =>
      Array.isArray(group?.hooks) &&
      group.hooks.some((hook) => hook?.command === command)
    )

    if (!present) {
      config.hooks[eventName].push({
        hooks: [{
          type: 'command',
          command,
          async: true,
          timeout: 5,
        }],
      })
    }
  }

  fs.writeFileSync(hooksFile, JSON.stringify(config, null, 2) + '\n', 'utf8')
  return hooksFile
}

async function maybeOfferCodexIntegration() {
  // Only prompt when Codex appears to be installed/configured on this Mac.
  if (!fs.existsSync(codexHome()) || hasCodexIntegration()) return

  const result = await dialog.showMessageBox(win, {
    type: 'question',
    title: 'Connect OpenAI Codex',
    message: 'Connect Agent Office to Codex App and Codex CLI?',
    detail:
      'Agent Office will install or update its own hooks in ~/.codex/hooks.json, preserving your existing Orca/other hooks and keeping a timestamped backup. No Node.js or Python installation is required.',
    buttons: ['Connect Codex', 'Not now'],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  })

  if (result.response !== 0) return

  try {
    const hooksFile = installCodexIntegration()
    await dialog.showMessageBox(win, {
      type: 'info',
      title: 'Codex connected',
      message: 'Agent Office is now connected to Codex.',
      detail:
        `Hooks installed in ${hooksFile}. Restart Codex App or start a new Codex CLI session. Codex may ask you to review/trust the new command hooks.`,
      buttons: ['OK'],
    })
  } catch (err) {
    await dialog.showMessageBox(win, {
      type: 'error',
      title: 'Could not connect Codex',
      message: 'Agent Office could not install the Codex integration.',
      detail: err?.message || String(err),
      buttons: ['OK'],
    })
  }
}

// ---------------------------------------------------------------------------
// Window creation
// ---------------------------------------------------------------------------

async function createWindow() {
  // Check if a server is already running (e.g. launched separately during dev)
  const alreadyRunning = await isServerRunning()

  if (alreadyRunning) {
    console.log('[main] Server already running on port 3334 — skipping spawn')
  } else {
    startServer()
    const ready = await waitForServer()
    if (!ready) {
      console.error('[main] Server did not become ready in time — continuing anyway')
    } else {
      console.log('[main] Server is ready')
    }
  }

  const { width: screenW } = screen.getPrimaryDisplay().workAreaSize

  win = new BrowserWindow({
    width: 520,
    height: 720,
    x: screenW - 400,
    y: 20,
    alwaysOnTop: true,
    frame: false,
    transparent: false,
    resizable: true,
    minimizable: true,
    skipTaskbar: false,
    backgroundColor: '#0a0a0f',
    hasShadow: true,
    roundedCorners: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  })

  // Prevent navigation away from the app origin
  win.webContents.on('will-navigate', (event, url) => {
    try {
      const origin = new URL(url).origin
      if (!ALLOWED_ORIGINS.has(origin)) {
        event.preventDefault()
      }
    } catch {
      event.preventDefault()
    }
  })

  // Prevent opening new windows (links, window.open, etc.)
  win.webContents.setWindowOpenHandler(() => {
    return { action: 'deny' }
  })

  // In production the bundled Express server also serves the renderer. Using
  // localhost instead of file:// keeps the app's absolute sprite/room URLs valid.
  const isDev = !app.isPackaged
  if (isDev) {
    await win.loadURL('http://localhost:3333')
  } else {
    await win.loadURL('http://localhost:3334')
  }

  // Offer one-click Codex setup after the UI is available.
  setTimeout(() => {
    maybeOfferCodexIntegration().catch((err) => {
      console.error('[main] Codex integration prompt failed:', err)
    })
  }, 500)

  // Make window level float above everything (like Clippy)
  win.setAlwaysOnTop(true, 'floating')
  win.setVisibleOnAllWorkspaces(true)
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  stopServer()
  app.quit()
})

app.on('before-quit', () => {
  stopServer()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})
