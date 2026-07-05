const { app, BrowserWindow, dialog, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const os = require('os');
const { spawn, exec } = require('child_process');
const http = require('http');

let mainWindow = null;
let backendProcess = null;
let tray = null;
let isQuitting = false;
let startupStderr = '';

const isPackaged = app.isPackaged;
const appRoot = isPackaged ? process.resourcesPath : path.join(__dirname, '..');

// ─── Auto-updater ────────────────────────────────────────────────────────
function setupAutoUpdater() {
  if (!isPackaged) return;
  try {
    const { autoUpdater } = require('electron-updater');
    autoUpdater.logger = {
      info: (msg) => console.log('[Updater]', msg),
      warn: (msg) => console.warn('[Updater]', msg),
      error: (msg) => console.error('[Updater]', msg),
    };
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;

    autoUpdater.on('update-available', () => {
      dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: 'Update Available',
        message: 'A new version of Mavrick is being downloaded...',
        buttons: ['OK'],
      });
    });

    autoUpdater.on('update-downloaded', () => {
      dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: 'Update Ready',
        message: 'A new version has been downloaded. Restart to apply.',
        buttons: ['Restart', 'Later'],
      }).then(({ response }) => {
        if (response === 0) autoUpdater.quitAndInstall();
      });
    });

    autoUpdater.on('error', (err) => {
      console.error('[Updater] Error:', err.message);
    });

    // Check for updates 5 seconds after launch
    setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 5000);
  } catch {
    // electron-updater not available in dev mode
  }
}

// ─── Python discovery ────────────────────────────────────────────────────
function getPythonExecutable() {
  // Packaged: look for bundled venv in resources
  if (isPackaged) {
    if (os.platform() === 'win32') {
      const venvPy = path.join(appRoot, 'venv', 'Scripts', 'python.exe');
      if (require('fs').existsSync(venvPy)) return venvPy;
    } else {
      const venvPy = path.join(appRoot, 'venv', 'bin', 'python3');
      if (require('fs').existsSync(venvPy)) return venvPy;
      const venvPy2 = path.join(appRoot, 'venv', 'bin', 'python');
      if (require('fs').existsSync(venvPy2)) return venvPy2;
    }
  }
  // Dev mode: look for venv relative to project root
  if (os.platform() === 'win32') {
    const venvPy = path.join(appRoot, 'venv', 'Scripts', 'python.exe');
    return require('fs').existsSync(venvPy) ? venvPy : 'python';
  } else {
    const venvPy = path.join(appRoot, 'venv', 'bin', 'python');
    if (require('fs').existsSync(venvPy)) return venvPy;
    return 'python3';
  }
}

// ─── Kill stale process on port ──────────────────────────────────────────
function killPortIfBusy(port, callback) {
  if (os.platform() === 'win32') {
    exec(`netstat -ano | findstr ":${port} " | findstr "LISTENING"`, (err, stdout) => {
      if (!stdout || !stdout.trim()) return callback();
      const lines = stdout.trim().split('\n');
      let killed = 0;
      if (lines.length === 0) return callback();
      lines.forEach(line => {
        const pid = line.trim().split(/\s+/).pop();
        if (pid && !isNaN(pid)) {
          exec(`taskkill /PID ${pid} /F`, () => { if (++killed >= lines.length) callback(); });
        } else {
          if (++killed >= lines.length) callback();
        }
      });
    });
  } else {
    exec(`lsof -ti tcp:${port}`, (err, stdout) => {
      if (!stdout || !stdout.trim()) return callback();
      exec(`kill -9 ${stdout.trim().split('\n').join(' ')}`, () => callback());
    });
  }
}

// ─── Start Python backend ────────────────────────────────────────────────
function startBackend() {
  const pythonBin = getPythonExecutable();
  const appPy = isPackaged
    ? path.join(appRoot, 'app.py')
    : path.join(__dirname, '..', 'app.py');

  console.log(`[Electron] Starting backend: ${pythonBin} ${appPy} (packaged=${isPackaged})`);

  backendProcess = spawn(pythonBin, [appPy], {
    cwd: appRoot,
    env: {
      ...process.env,
      PYTHONPATH: appRoot,
      MAVRICK_ELECTRON: 'true',
    },
  });

  backendProcess.stdout.on('data', (data) => {
    console.log(`[Backend]: ${data.toString().trim()}`);
  });

  backendProcess.stderr.on('data', (data) => {
    const msg = data.toString();
    console.error(`[Backend Error]: ${msg.trim()}`);
    if (startupStderr.length < 4096) startupStderr += msg;
  });

  backendProcess.on('error', (err) => {
    console.error('[Electron] Failed to start Python:', err.message);
    if (err.code === 'ENOENT') {
      dialog.showErrorBox(
        'Python Not Found',
        'Could not find Python to start the backend.\n\n' +
        'Install Python 3.11+ from https://www.python.org/downloads/\n' +
        'or create a venv manually before launching Mavrick.'
      );
    } else {
      dialog.showErrorBox('Python Launch Error', 'Failed to start Python:\n' + err.message);
    }
    app.quit();
  });

  backendProcess.on('close', (code) => {
    console.log(`[Backend] Process exited with code ${code}`);
    if (!isQuitting) {
      dialog.showErrorBox(
        'Backend Disconnected',
        `The MAVRICK backend exited unexpectedly (code ${code}).\n\n` +
        (startupStderr ? `Last error output:\n${startupStderr.slice(-500)}` : '')
      );
      app.quit();
    }
  });
}

// ─── Wait for server ─────────────────────────────────────────────────────
function checkServer(url, callback) {
  const req = http.request(url, { method: 'GET', timeout: 800 }, (res) => {
    callback(res.statusCode >= 200 && res.statusCode < 400);
  });
  req.on('error', () => callback(false));
  req.end();
}

function waitForServer(url, retries, delay, callback) {
  if (retries <= 0) return callback(false);
  checkServer(url, (alive) => {
    if (alive) return callback(true);
    setTimeout(() => waitForServer(url, retries - 1, delay, callback), delay);
  });
}

// ─── System tray ─────────────────────────────────────────────────────────
function createTray() {
  // Use the app icon or create a simple tray icon
  let iconPath = path.join(appRoot, 'static', 'icon.png');
  const fs = require('fs');
  if (!fs.existsSync(iconPath)) {
    iconPath = path.join(appRoot, 'static', 'icon.ico');
  }

  let trayIcon;
  try {
    trayIcon = nativeImage.createFromPath(iconPath);
    if (trayIcon.isEmpty()) throw new Error('empty');
    // Resize for system tray
    if (os.platform() === 'win32') {
      trayIcon = trayIcon.resize({ width: 16, height: 16 });
    }
  } catch {
    // Fallback: create a tiny blank icon
    trayIcon = nativeImage.createEmpty();
  }

  tray = new Tray(trayIcon);
  tray.setToolTip('Mavrick');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Open Mavrick',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      },
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);

  tray.on('double-click', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

// ─── Main window ─────────────────────────────────────────────────────────
function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: 'Mavrick',
    show: false,
    icon: path.join(appRoot, 'static', 'icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  mainWindow.loadURL('http://127.0.0.1:7000');
  mainWindow.setMenuBarVisibility(false);

  mainWindow.once('ready-to-show', () => mainWindow.show());

  // Minimize to tray instead of closing
  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

// ─── Single instance lock ────────────────────────────────────────────────
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

// ─── App lifecycle ───────────────────────────────────────────────────────
app.whenReady().then(() => {
  setupAutoUpdater();
  createTray();

  killPortIfBusy(7000, () => {
    startBackend();

    waitForServer('http://127.0.0.1:7000/api/auth/status', 225, 200, (ready) => {
      if (ready) {
        createMainWindow();
      } else {
        dialog.showErrorBox(
          'Startup Timeout',
          'MAVRICK backend failed to start within 45 seconds.\n\n' +
          (startupStderr ? `Last error:\n${startupStderr.slice(-500)}` : 'Check logs for details.')
        );
        app.quit();
      }
    });
  });
});

app.on('window-all-closed', () => {
  // Don't quit — keep running in tray
});

app.on('will-quit', () => {
  isQuitting = true;
  if (backendProcess) {
    console.log('[Electron] Shutting down backend...');
    if (os.platform() === 'win32') {
      spawn('taskkill', ['/pid', String(backendProcess.pid), '/f', '/t'], { stdio: 'ignore' });
    } else {
      backendProcess.kill('SIGINT');
    }
  }
  if (tray) {
    tray.destroy();
    tray = null;
  }
});
