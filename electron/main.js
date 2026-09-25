// Notepads (Electron) — main process
// Minimal window bootstrap inspired by Electron's default_app skeleton.
const { app, BrowserWindow, ipcMain, dialog, shell, Menu, protocol } = require('electron');
const os = require('os');
const path = require('path');
const fs = require('fs');
const { Readable } = require('stream');

const THEME_BG = { dark: '#1f1f1f', light: '#ffffff' }; // 窗口底色，与 renderer 的 --bg 保持一致

// ---- Video background assets ----
// The background clip is streamed to the renderer through a dedicated scheme
// instead of a raw file:// path: that keeps it working both in production
// (file://) and in dev (the renderer is served from the Vite dev server, which
// is not allowed to pull in local files).
const ASSET_SCHEME = 'notepads-asset';
const ASSETS_DIR = path.join(__dirname, 'node_modules', 'assets');
const BACKGROUND_VIDEO = process.env.NOTEPADS_BG_VIDEO || 'video1.mp4';

const ASSET_MIME = {
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm',
  '.ogv': 'video/ogg', '.mov': 'video/quicktime',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif',
};

protocol.registerSchemesAsPrivileged([
  {
    scheme: ASSET_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
]);

function resolveAsset(requestUrl) {
  let name;
  try { name = decodeURIComponent(new URL(requestUrl).pathname.replace(/^\/+/, '')); }
  catch (err) { return null; }
  if (!name) return null;
  const file = path.resolve(ASSETS_DIR, name);
  if (file !== ASSETS_DIR && !file.startsWith(ASSETS_DIR + path.sep)) return null; // no escaping the assets dir
  try { return fs.statSync(file).isFile() ? file : null; }
  catch (err) { return null; }
}

// Serves an asset with `Range` support so the <video> element can seek instead
// of buffering the whole (possibly large) clip in memory.
function serveAsset(request) {
  const file = resolveAsset(request.url);
  if (!file) return new Response('Not Found', { status: 404 });

  const size = fs.statSync(file).size;
  const headers = {
    'Content-Type': ASSET_MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'public, max-age=86400',
  };

  const rangeHeader = request.headers.get('Range');
  const m = rangeHeader && /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
  if (m && (m[1] !== '' || m[2] !== '')) {
    let start = m[1] === '' ? null : Number(m[1]);
    let end = m[2] === '' ? null : Number(m[2]);
    if (start === null) { // suffix form: `bytes=-500` => the last 500 bytes
      const tail = end;
      start = Math.max(0, size - tail);
      end = size - 1;
    } else if (end === null || end >= size) {
      end = size - 1;
    }
    if (start > end || start >= size) {
      return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}`, 'Accept-Ranges': 'bytes' } });
    }
    headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
    headers['Content-Length'] = String(end - start + 1);
    return new Response(Readable.toWeb(fs.createReadStream(file, { start, end })), { status: 206, headers });
  }

  headers['Content-Length'] = String(size);
  return new Response(Readable.toWeb(fs.createReadStream(file)), { status: 200, headers });
}

// Frosted glass: the blurred backdrop has to be drawn by the OS, because the CSS
// blur()/backdrop-filter only affect the window's *web contents* — they can not
// reach what lays behind the window, and `transparent` windows are not reliably
// resizable (see Electron docs: Window Customization > Transparent windows).
// So: Windows 11 22H2+ => system background material, macOS => vibrancy.
// The renderer switches to translucent surfaces only when this is available.
const GLASS_SUPPORTED = (() => {
  if (process.platform === 'darwin') return true;
  if (process.platform !== 'win32') return false;
  return Number((os.release().split('.')[2] || '0')) >= 22621; // first Win11 with `backgroundMaterial`
})();

function glassWindowOptions() {
  if (!GLASS_SUPPORTED) return { backgroundColor: THEME_BG.dark };
  if (process.platform === 'darwin') {
    return { transparent: true, vibrancy: 'fullscreen-ui', backgroundColor: '#00000000' };
  }
  // `backgroundMaterial` is mutually exclusive with `transparent: true`; a fully
  // transparent background colour lets the system material show through the page.
  return { transparent: false, backgroundMaterial: 'acrylic', backgroundColor: '#00000000' };
}

// Dev builds open DevTools automatically; override with NOTEPADS_DEVTOOLS=0.
const isDev = !app.isPackaged;
const autoOpenDevTools = isDev && process.env.NOTEPADS_DEVTOOLS !== '0';
// Set by `npm run dev` (Vite dev server) so the renderer gets HMR instead of file://
const devServerUrl = isDev ? (process.env.NOTEPADS_DEV_URL || '') : '';

function createWindow(bounds) {
  const win = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 420,
    minHeight: 320,
    show: false,
    frame: false, // custom title bar (tab strip acts as drag region)
    ...glassWindowOptions(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // file IO (read/write + encoding detection) lives in the preload, so it
      // needs Node builtins => the renderer sandbox must stay disabled.
      sandbox: false,
      spellcheck: false,
    },
  });

  // tell the renderer which backing it got: 'system' (acrylic/vibrancy) when the
  // OS blurs behind the window, 'css' when the panel blur is all we have
  win.webContents.once('did-finish-load', () =>
    win.webContents.send('glass', GLASS_SUPPORTED ? 'system' : 'css'));

  if (bounds) win.setBounds(bounds);
  if (devServerUrl) {
    win.loadURL(devServerUrl);
  } else {
    win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  }

  if (autoOpenDevTools) {
    win.webContents.openDevTools({ mode: 'detach' });
  }

  win.once('ready-to-show', () => win.show());
  return win;
}

app.whenReady().then(() => {
  protocol.handle(ASSET_SCHEME, serveAsset);
  const template = [
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectall' },
      ],
    },
    {
      label: 'View',
      submenu: [{ role: 'reload' }, { role: 'togglefullscreen' }, { role: 'toggledevtools' }],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ---- IPC bridge to the renderer ----
ipcMain.handle('dialog:open', async (e, filters) => {
  const w = BrowserWindow.fromWebContents(e.sender);
  return dialog.showOpenDialog(w, {
    properties: ['openFile', 'multiSelections'],
    filters: filters || [{ name: 'All Files', extensions: ['*'] }],
  });
});

ipcMain.handle('dialog:save', async (e, defaultPath) => {
  const w = BrowserWindow.fromWebContents(e.sender);
  return dialog.showSaveDialog(w, {
    defaultPath: defaultPath || undefined,
    filters: [{ name: 'All Files', extensions: ['*'] }],
  });
});

// Files that should be opened by a freshly created window (Settings → 打开文件 → 在新窗口中打开)
const pendingStartupFiles = new Map();

ipcMain.handle('window:new', (e, filePath) => {
  const w = BrowserWindow.fromWebContents(e.sender);
  const nw = createWindow(w ? w.getBounds() : null);
  if (filePath) pendingStartupFiles.set(nw.webContents.id, [filePath]);
  return true;
});

ipcMain.handle('app:quit', () => {
  app.quit();
  return true;
});

ipcMain.handle('window:control', (e, action) => {
  const w = BrowserWindow.fromWebContents(e.sender);
  if (!w) return;
  if (action === 'min') w.minimize();
  else if (action === 'max') (w.isMaximized() ? w.unmaximize() : w.maximize());
  else if (action === 'close') w.close();
});

ipcMain.handle('shell:openExternal', async (e, url) => {
  await shell.openExternal(url);
  return true;
});

// The background clip for the video-background feature; `null` when the file is
// missing so the renderer can fall back to the plain theme background.
ipcMain.handle('app:backgroundVideo', () => {
  const file = path.join(ASSETS_DIR, BACKGROUND_VIDEO);
  try {
    if (!fs.statSync(file).isFile()) return null;
  } catch (err) { return null; }
  return {
    name: BACKGROUND_VIDEO,
    url: `${ASSET_SCHEME}://assets/${encodeURIComponent(BACKGROUND_VIDEO)}`,
  };
});

// Files passed on the command line (e.g. `electron . file.txt` / OS file association)
ipcMain.handle('app:startupFiles', (e) => {
  const pending = pendingStartupFiles.get(e.sender.id);
  if (pending) { pendingStartupFiles.delete(e.sender.id); return pending; }
  return process.argv
    .slice(1)
    .filter((a) => a && !a.startsWith('-') && a !== '.')
    .filter((a) => { try { return fs.statSync(a).isFile(); } catch (err) { return false; } });
});
