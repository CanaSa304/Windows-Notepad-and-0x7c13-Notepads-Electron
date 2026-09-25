/* Vite dev server for the Notepads renderer.
 * - serves  electron/renderer  on http://localhost:5173 with HMR (full reload for JS,
 *   instant swap for CSS/HTML edits)
 * - launches Electron once the server is listening, passing the URL via NOTEPADS_DEV_URL
 * - restarts Electron automatically when main.js / preload.js change
 */
import { defineConfig } from 'vite';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const projectDir = path.dirname(fileURLToPath(import.meta.url));

// main-process files: they cannot be hot-reloaded, so restart the app instead
const MAIN_FILES = ['main.js', 'preload.js'].map((f) => path.join(projectDir, f));

let electronBin = 'electron'; // fallback: resolve from PATH
try { electronBin = require('electron'); } catch { /* electron not installed yet */ }

let child = null;
let restartTimer = null;
let devUrl = '';

function launchElectron() {
  if (!devUrl) return;
  if (child) {
    child.removeAllListeners();
    child.kill();
    child = null;
  }
  child = spawn(electronBin, ['.'], {
    cwd: projectDir,
    stdio: 'inherit',
    env: { ...process.env, NOTEPADS_DEV_URL: devUrl },
  });
  child.on('exit', (code) => {
    child = null;
    console.log(`[electron] 已退出 (code ${code})。修改 main.js / preload.js 会自动重新拉起窗口。`);
  });
}

function restartElectron() {
  clearTimeout(restartTimer);
  restartTimer = setTimeout(launchElectron, 250);
}

function watchMainProcess() {
  MAIN_FILES.forEach((file) => {
    if (!fs.existsSync(file)) return;
    fs.watch(file, () => {
      console.log(`[electron] ${path.basename(file)} 已修改，重启 Electron…`);
      restartElectron();
    });
  });
}

export default defineConfig({
  root: path.join(projectDir, 'renderer'),
  cacheDir: path.join(projectDir, 'node_modules', '.vite'),
  server: {
    host: 'localhost',
    port: 5173,
    strictPort: true,
  },
  plugins: [
    {
      name: 'notepads-electron-dev',
      // The renderer is loaded as a classic <script> so that `electron .`
      // (file:// mode) keeps working. In dev, upgrade it to a module so Vite
      // tracks it in the module graph and reloads the page on every edit.
      transformIndexHtml(html) {
        return html.replace(
          /<script\s+src=["'](?:\.\/)?renderer\.js["']\s*>\s*<\/script>/,
          '<script type="module" src="/renderer.js"></script>'
        );
      },
      configureServer(server) {
        server.httpServer?.once('listening', () => {
          const addr = server.httpServer.address();
          const port = addr && typeof addr === 'object' ? addr.port : 5173;
          devUrl = `http://localhost:${port}`;
          if (process.env.NOTEPADS_NO_ELECTRON !== '1') launchElectron();
          watchMainProcess();
        });
      },
    },
  ],
});
