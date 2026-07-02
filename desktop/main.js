const { app, BrowserWindow, dialog } = require('electron');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const http = require('http');

let mainWindow = null;
let backendProcess = null;
let isQuitting = false;

// 1. Resolve Python backend executable
function getPythonExecutable() {
  if (os.platform() === 'win32') {
    const venvPath = path.join(__dirname, '..', 'venv', 'Scripts', 'python.exe');
    return require('fs').existsSync(venvPath) ? venvPath : 'python';
  } else {
    const venvPath = path.join(__dirname, '..', 'venv', 'bin', 'python');
    return require('fs').existsSync(venvPath) ? venvPath : 'python3';
  }
}

// 2a. Kill any stale process on port 7000 (prevents "address already in use" on restart)
function killPortIfBusy(port, callback) {
  const { exec } = require('child_process');
  if (os.platform() === 'win32') {
    exec(`netstat -ano | findstr ":${port} " | findstr "LISTENING"`, (err, stdout) => {
      if (!stdout.trim()) return callback();
      const lines = stdout.trim().split('\n');
      let killed = 0;
      lines.forEach(line => {
        const parts = line.trim().split(/\s+/);
        const pid = parts[parts.length - 1];
        if (pid && !isNaN(pid)) {
          exec(`taskkill /PID ${pid} /F`, () => { if (++killed === lines.length) callback(); });
        } else {
          if (++killed === lines.length) callback();
        }
      });
    });
  } else {
    exec(`lsof -ti tcp:${port}`, (err, stdout) => {
      if (!stdout.trim()) return callback();
      exec(`kill -9 ${stdout.trim().split('\n').join(' ')}`, () => callback());
    });
  }
}

// 2. Start Python backend
function startBackend() {
  const pythonBin = getPythonExecutable();
  const appPy = path.join(__dirname, '..', 'app.py');
  
  console.log(`[Electron] Starting backend using: ${pythonBin} ${appPy}`);
  
  backendProcess = spawn(pythonBin, [appPy], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      PYTHONPATH: path.join(__dirname, '..'),
      MAVRICK_ELECTRON: 'true'
    }
  });

  backendProcess.stdout.on('data', (data) => {
    console.log(`[Backend]: ${data.toString().trim()}`);
  });

  backendProcess.stderr.on('data', (data) => {
    console.error(`[Backend Error]: ${data.toString().trim()}`);
  });

  backendProcess.on('close', (code) => {
    console.log(`[Backend] Process exited with code ${code}`);
    if (!isQuitting) {
      dialog.showErrorBox(
        'Backend Disconnected',
        `The MAVRICK backend process exited unexpectedly with code ${code}.`
      );
      app.quit();
    }
  });
}

// 3. Ping local port 7000 to check if FastAPI server is ready
function checkServer(url, callback) {
  const req = http.request(url, { method: 'GET', timeout: 800 }, (res) => {
    if (res.statusCode >= 200 && res.statusCode < 400) {
      callback(true);
    } else {
      callback(false);
    }
  });
  req.on('error', () => callback(false));
  req.end();
}

function waitForServer(url, retries, delay, callback) {
  if (retries <= 0) {
    callback(false);
    return;
  }
  checkServer(url, (alive) => {
    if (alive) {
      callback(true);
    } else {
      setTimeout(() => {
        waitForServer(url, retries - 1, delay, callback);
      }, delay);
    }
  });
}

// 4. Create Main Application Window
function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: 'MAVRICK',
    show: false, // Show window only when ready
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  });

  mainWindow.loadURL('http://127.0.0.1:7000');

  // Disable default menu bar but keep standard dev shortcuts active
  mainWindow.setMenuBarVisibility(false);

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Handle window close
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// 5. App Lifecycle Handlers
app.whenReady().then(() => {
  // Clear port 7000 first, then start backend
  killPortIfBusy(7000, () => {
    startBackend();

    // Wait for port 7000 to be active (try for 45 seconds)
    waitForServer('http://127.0.0.1:7000/api/auth/status', 225, 200, (ready) => {
      if (ready) {
        createMainWindow();
      } else {
        dialog.showErrorBox(
          'Startup Timeout',
          'MAVRICK backend failed to start or bind to port 7000 within 45 seconds.'
        );
        app.quit();
      }
    });
  });
});

// Quit when all windows are closed
app.on('window-all-closed', () => {
  isQuitting = true;
  app.quit();
});

// Clean up child processes before exit
app.on('will-quit', () => {
  isQuitting = true;
  if (backendProcess) {
    console.log('[Electron] Shutting down backend...');
    if (os.platform() === 'win32') {
      // Force kill process tree on Windows
      spawn('taskkill', ['/pid', backendProcess.pid, '/f', '/t']);
    } else {
      backendProcess.kill('SIGINT');
    }
  }
});
