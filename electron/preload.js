// Notepads (Electron) — preload: safe, minimal API for the renderer.
const { contextBridge, ipcRenderer } = require('electron');
const fs = require('fs');
const path = require('path');

function detectEncoding(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf)
    return { encoding: 'utf-8', hasBom: true };
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe)
    return { encoding: 'utf-16-le', hasBom: true };
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff)
    return { encoding: 'utf-16-be', hasBom: true };
  let nulls = 0;
  for (let i = 0; i < Math.min(buffer.length, 8192); i++) if (buffer[i] === 0x00) nulls++;
  if (buffer.length > 0 && nulls > buffer.length / 8)
    return { encoding: 'utf-16-le', hasBom: false };
  return { encoding: 'utf-8', hasBom: false };
}

function decodeBuffer(buffer, encoding, hasBom) {
  if (encoding === 'utf-16-le') return buffer.slice(hasBom ? 2 : 0).toString('utf16le');
  if (encoding === 'utf-16-be') {
    const start = hasBom ? 2 : 0;
    const out = Buffer.alloc(buffer.length - start);
    for (let i = 0; i < out.length - 1; i += 2) { out[i] = buffer[start + i + 1]; out[i + 1] = buffer[start + i]; }
    return out.toString('utf16le');
  }
  if (encoding === 'ansi') return buffer.toString('latin1');
  return buffer.slice(hasBom ? 3 : 0).toString('utf-8');
}

function encodeBuffer(content, encoding) {
  switch (encoding) {
    case 'utf-8-bom': return Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(content, 'utf-8')]);
    case 'utf-16-le-bom': return Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(content, 'utf16le')]);
    case 'utf-16-le': return Buffer.from(content, 'utf16le');
    case 'utf-16-be-bom': return Buffer.concat([Buffer.from([0xfe, 0xff]), swap(Buffer.from(content, 'utf16le'))]);
    case 'utf-16-be': return swap(Buffer.from(content, 'utf16le'));
    case 'ansi': return Buffer.from(content, 'latin1');
    default: return Buffer.from(content, 'utf-8');
  }
}
function swap(buf) {
  const out = Buffer.alloc(buf.length);
  for (let i = 0; i < out.length - 1; i += 2) { out[i] = buf[i + 1]; out[i + 1] = buf[i]; }
  return out;
}

contextBridge.exposeInMainWorld('api', {
  openFileDialog: (filters) => ipcRenderer.invoke('dialog:open', filters),
  saveFileDialog: (defaultPath) => ipcRenderer.invoke('dialog:save', defaultPath),
  newWindow: () => ipcRenderer.invoke('window:new'),
  windowControl: (action) => ipcRenderer.invoke('window:control', action),
  quitApp: () => ipcRenderer.invoke('app:quit'),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  getStartupFiles: () => ipcRenderer.invoke('app:startupFiles'),
  onGlass: (cb) => ipcRenderer.on('glass', (_e, supported) => cb(supported)),
  getBackgroundVideo: () => ipcRenderer.invoke('app:backgroundVideo'),

  fileExists: (p) => fs.existsSync(p),
  readFile: (p) => {
    const buffer = fs.readFileSync(p);
    const { encoding, hasBom } = detectEncoding(buffer);
    const isBinary = buffer.includes(0x00) && encoding !== 'utf-16-le' && encoding !== 'utf-16-be';
    return { content: decodeBuffer(buffer, encoding, hasBom), encoding, hasBom, size: buffer.length, binary: isBinary };
  },
  writeFile: (p, content, encoding) => {
    fs.writeFileSync(p, encodeBuffer(content, encoding || 'utf-8'));
    return true;
  },
  basename: (p) => path.basename(p),
  dirname: (p) => path.dirname(p),
});
