/* Notepads (Electron) — renderer logic */
(function () {
  'use strict';
  const api = window.api;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  const FONTS = ['Consolas', 'Cascadia Code', 'Cascadia Mono', 'Courier New', 'SF Mono',
    'Menlo', 'Monaco', 'DejaVu Sans Mono', 'Liberation Mono', 'monospace'];

  const DEFAULT_SETTINGS = {
    theme: 'system', accent: '#018574',
    fontFamily: 'Consolas', fontSize: 14, tabSize: 4,
    wordWrap: true, lineNumbers: true, spellcheck: false, showStatusbar: true,
    defaultEol: 'crlf', defaultEncoding: 'utf-8',
    autoIndent: false, autocorrect: false, showRecent: true,
    videoBackground: true, videoDim: 45, videoBlur: 0,
    openFileMode: 'tab', startupMode: 'blank',
    pageSetup: { orientation: 'portrait', paper: 'A4', margin: 12 },
    defaultsVersion: 1
  };

  // 默认值版本号：默认值发生变化时递增，用于把新默认值迁移到已保存的旧配置上
  const SETTINGS_DEFAULTS_VERSION = 1;

  // ===================== Welcome document =====================
  // Text shown in the initial tab when the app starts with nothing else to open.
  const WELCOME_TEXT = [
    'This is the latest simple preview version, which can be added and downloaded directly.',
    '这是简单的最新预览版本，可以直接添加下载。',
    'If you have any questions, please contact the author: pashpon@qq.com.',
    '如果你有任何疑问，请联系作者：pashpon@qq.com。',
    'Please note that this version does not come with community software pre-installed.',
    '需要注意的是，此版本未预装社区软件。',
    'Users can obtain the latest community software version support through an email key.',
    '用户可以通过邮件密钥获取最新的社区软件版本支持。',
    "Obtain the latest test file through the latest command 'tabler test', thank you.",
    '通过最新的指令“tabler test”获得最新的测试文件，谢谢。',
    'Do you need to download the attachment?',
    '需要下载附件吗？',
    'This is very important!',
    '这非常重要！'
  ].join('\n');

  let settings = loadSettings();
  let tabs = [];
  let activeId = null;
  let tabSeq = 0;

  // ===================== Settings =====================
  function loadSettings() {
    let s = null;
    try { s = JSON.parse(localStorage.getItem('notepads-settings')); } catch (e) {}
    const merged = Object.assign({}, DEFAULT_SETTINGS, s);
    // 迁移：v1 起“自动换行”默认开启，旧配置（无版本记录）跟随新的默认值
    if (!s || typeof s.defaultsVersion !== 'number' || s.defaultsVersion < SETTINGS_DEFAULTS_VERSION) {
      merged.wordWrap = DEFAULT_SETTINGS.wordWrap;
      merged.defaultsVersion = SETTINGS_DEFAULTS_VERSION;
      try { localStorage.setItem('notepads-settings', JSON.stringify(merged)); } catch (e) {}
    }
    return merged;
  }
  function saveSettings() {
    localStorage.setItem('notepads-settings', JSON.stringify(settings));
  }

  // ===================== Recent files =====================
  const RECENT_KEY = 'notepads-recent';
  const MAX_RECENT = 10;
  function getRecentFiles() {
    try { const a = JSON.parse(localStorage.getItem(RECENT_KEY)); return Array.isArray(a) ? a : []; }
    catch (e) { return []; }
  }
  function pushRecentFile(p) {
    if (!p) return;
    const list = getRecentFiles().filter(x => x !== p);
    list.unshift(p);
    localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, MAX_RECENT)));
  }
  function clearRecentFiles() { localStorage.removeItem(RECENT_KEY); }

  // ===================== Helpers =====================
  function activeTab() { return tabs.find(t => t.id === activeId) || null; }
  function activeEditor() { const t = activeTab(); return t ? t.ta : null; }

  function eolLabel(e) {
    return e === 'crlf' ? 'Windows (CRLF)' : e === 'lf' ? 'Unix (LF)' : 'Macintosh (CR)';
  }
  function eolStr(e) { return e === 'crlf' ? '\r\n' : e === 'cr' ? '\r' : '\n'; }

  function detectEol(text) {
    if (text.includes('\r\n')) return 'crlf';
    if (text.includes('\r')) return 'cr';
    if (text.includes('\n')) return 'lf';
    return settings.defaultEol;
  }
  function normalizeEol(text, eol) {
    const lines = text.split(/\r\n|\r|\n/);
    return lines.join(eolStr(eol));
  }
  function encLabel(enc, bom) {
    if (bom && enc === 'utf-8') return 'UTF-8 BOM';
    if (bom && enc === 'utf-16-le') return 'UTF-16 LE BOM';
    if (bom && enc === 'utf-16-be') return 'UTF-16 BE BOM';
    return ({ 'utf-8': 'UTF-8', 'utf-16-le': 'UTF-16 LE', 'utf-16-be': 'UTF-16 BE', 'ansi': 'ANSI' })[enc] || enc.toUpperCase();
  }
  function parseEncoding(e) {
    if (e === 'utf-8-bom') return { encoding: 'utf-8', hasBom: true };
    if (e === 'utf-16-le-bom') return { encoding: 'utf-16-le', hasBom: true };
    if (e === 'utf-16-be-bom') return { encoding: 'utf-16-be', hasBom: true };
    return { encoding: e, hasBom: false };
  }
  function saveEncoding(tab) {
    if (tab.hasBom) {
      if (tab.encoding === 'utf-8') return 'utf-8-bom';
      if (tab.encoding === 'utf-16-le') return 'utf-16-le-bom';
      if (tab.encoding === 'utf-16-be') return 'utf-16-be-bom';
    }
    return tab.encoding;
  }
  function isMarkdown(path) { return /\.(md|markdown|mdown|mkdn)$/i.test(path || ''); }
  function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ===================== Tab / Editor =====================
  function createTab(opts) {
    opts = opts || {};
    const id = ++tabSeq;
    const enc = opts.encoding ? parseEncoding(opts.encoding) : parseEncoding(settings.defaultEncoding);
    const tab = {
      id,
      title: opts.title || 'Untitled',
      path: opts.path || null,
      dir: opts.dir || null,
      content: opts.content != null ? opts.content : '',
      encoding: enc.encoding,
      hasBom: enc.hasBom,
      eol: opts.eol || settings.defaultEol,
      modified: false,
      zoom: 100,
      diskContent: opts.content != null ? opts.content : '',
      ta: null,
      el: null,
      tabEl: null
    };

    // tab strip element
    const tabEl = document.createElement('div');
    tabEl.className = 'tab';
    tabEl.dataset.id = id;
    tabEl.innerHTML = '<span class="tab-title"></span><button class="tab-close" title="Close">✕</button>';
    tabEl.querySelector('.tab-title').textContent = tab.title;
    tabEl.addEventListener('mousedown', (e) => { if (e.button === 1) { e.preventDefault(); closeTab(id); } });
    tabEl.addEventListener('click', (e) => { if (!e.target.classList.contains('tab-close')) activateTab(id); });
    tabEl.querySelector('.tab-close').addEventListener('click', (e) => { e.stopPropagation(); closeTab(id); });
    tabEl.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      activateTab(id);
      showTabContextMenu(e.clientX, e.clientY, id);
    });

    // drag reorder
    tabEl.draggable = true;
    tabEl.addEventListener('dragstart', () => tabEl.classList.add('dragging'));
    tabEl.addEventListener('dragend', () => { tabEl.classList.remove('dragging'); $$('.tab').forEach(t => t.classList.remove('drop-target')); });
    tabEl.addEventListener('dragover', (e) => { e.preventDefault(); tabEl.classList.add('drop-target'); });
    tabEl.addEventListener('dragleave', () => tabEl.classList.remove('drop-target'));
    tabEl.addEventListener('drop', (e) => {
      e.preventDefault(); tabEl.classList.remove('drop-target');
      const from = tabs.find(t => t.tabEl.classList.contains('dragging'));
      if (from && from !== tab) reorderTab(from.id, id);
    });

    // editor layer
    const layer = document.createElement('div');
    layer.className = 'editor-layer';
    layer.dataset.id = id;
    layer.style.display = 'none';
    layer.innerHTML = '<div class="gutter"><div class="gutter-inner"></div></div>' +
      '<textarea class="editor" spellcheck="false"></textarea>';
    const ta = layer.querySelector('.editor');
    const gutter = layer.querySelector('.gutter-inner');
    ta.value = tab.content;
    tab.ta = ta; tab.el = layer; tab.tabEl = tabEl; tab.gutter = gutter;

    ta.addEventListener('input', () => onEditorInput(tab));
    ta.addEventListener('scroll', () => { gutter.style.transform = `translateY(${-ta.scrollTop}px)`; });
    ta.addEventListener('keyup', () => updateLineCol(tab));
    ta.addEventListener('click', () => updateLineCol(tab));
    ta.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      updateLineCol(tab);
      showContextMenu(e.clientX, e.clientY);
    });
    ta.addEventListener('keydown', (e) => onEditorKeyDown(tab, e));

    $('#tabs').appendChild(tabEl);
    $('#editor-host').appendChild(layer);

    applyEditorStyle(tab);
    updateGutter(tab);
    tabs.push(tab);
    activateTab(id);
    updateTabsDensity();
    return tab;
  }

  function reorderTab(fromId, toId) {
    const fi = tabs.findIndex(t => t.id === fromId);
    const ti = tabs.findIndex(t => t.id === toId);
    if (fi < 0 || ti < 0) return;
    const [m] = tabs.splice(fi, 1);
    tabs.splice(ti, 0, m);
    renderTabs();
  }

  function renderTabs() {
    const host = $('#tabs');
    host.innerHTML = '';
    for (const t of tabs) host.appendChild(t.tabEl);
    activateTab(activeId, true);
    updateTabsDensity();
  }

  // Tabs normally keep their comfortable width; they are only allowed to squeeze
  // once there are so many of them that the strip runs out of room.
  // Keep these in sync with --tab-min-w / --tab-crowded-min-w in styles.css.
  const TAB_MIN_W = 180;
  const TAB_CROWDED_MIN_W = 72;

  function tabsAvailableWidth() {
    const tb = $('#titlebar');
    if (!tb) return 0;
    let available = tb.clientWidth;
    for (const el of tb.children) {
      if (el.id === 'tabs') continue;
      if (el.offsetParent === null) continue; // hidden siblings take no space
      available -= el.offsetWidth;
    }
    return Math.max(0, available);
  }

  function updateTabsDensity() {
    const host = $('#tabs');
    if (!host) return;
    const n = host.querySelectorAll('.tab').length;
    host.classList.toggle('crowded', n > 1 && n * TAB_MIN_W > tabsAvailableWidth());
  }

  function updateWindowTitle() {
    const tab = activeTab();
    document.title = (tab && tab.title ? tab.title + ' - ' : '') + 'Notepads';
  }

  function setTabTitle(tab, title) {
    tab.title = title;
    const el = tab.tabEl.querySelector('.tab-title');
    if (el) el.textContent = title;
    if (tab.id === activeId) updateWindowTitle();
  }

  function activateTab(id, keepScroll) {
    const tab = tabs.find(t => t.id === id);
    if (!tab) return;
    activeId = id;
    for (const t of tabs) {
      t.el.style.display = (t.id === id) ? 'flex' : 'none';
      t.tabEl.classList.toggle('active', t.id === id);
    }
    updateGutter(tab);
    updateStatus(tab);
    updateWindowTitle();
    if (!keepScroll) setTimeout(() => tab.ta.focus(), 0);
  }

  function closeTab(id) {
    const idx = tabs.findIndex(t => t.id === id);
    if (idx < 0) return;
    if (renamingTabId === id) finishRenameTab(false, false);
    const tab = tabs[idx];
    if (tab.modified && !confirm(`"${tab.title}" has unsaved changes. Close anyway?`)) return;
    tab.el.remove(); tab.tabEl.remove();
    tabs.splice(idx, 1);
    if (tabs.length === 0) { createTab({}); return; }
    if (activeId === id) {
      const next = tabs[Math.max(0, idx - 1)];
      activateTab(next.id);
    }
    updateTabsDensity();
  }

  // ===================== Tab rename =====================
  let renamingTabId = null;
  let renameOriginal = '';

  // Swaps the tab label for an inline input and applies every keystroke live.
  function beginRenameTab(id) {
    const tab = tabs.find(t => t.id === id);
    if (!tab) return;
    finishRenameTab(true, false);
    const label = tab.tabEl.querySelector('.tab-title');
    if (!label) return;

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'tab-title tab-rename-input';
    input.value = tab.title;
    input.spellcheck = false;
    label.replaceWith(input);

    renamingTabId = tab.id;
    renameOriginal = tab.title;
    tab.tabEl.classList.add('renaming');
    // dragging the tab would swallow text selection inside the input
    tab.tabEl.draggable = false;

    input.addEventListener('input', () => {
      const next = input.value;
      tab.title = next;
      if (tab.id === activeId) updateWindowTitle();
    });
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); finishRenameTab(true, true); }
      else if (e.key === 'Escape') { e.preventDefault(); finishRenameTab(false, true); }
    });
    input.addEventListener('blur', () => finishRenameTab(true, false));
    input.addEventListener('click', (e) => e.stopPropagation());
    input.addEventListener('dblclick', (e) => e.stopPropagation());
    input.addEventListener('contextmenu', (e) => e.stopPropagation());
    setTimeout(() => { input.focus(); input.select(); }, 0);
  }

  function finishRenameTab(commit, refocusEditor) {
    if (renamingTabId === null) return;
    const tab = tabs.find(t => t.id === renamingTabId);
    renamingTabId = null;
    if (!tab) return;
    const input = tab.tabEl.querySelector('.tab-rename-input');
    tab.tabEl.classList.remove('renaming');
    tab.tabEl.draggable = true;
    if (!input) return;

    const original = renameOriginal;
    const label = document.createElement('span');
    label.className = 'tab-title';
    input.replaceWith(label);

    let value = commit ? input.value.trim() : original;
    if (!value) value = tab.path ? api.basename(tab.path) : 'Untitled';
    setTabTitle(tab, value);
    if (refocusEditor) {
      const t = activeTab();
      if (t) t.ta.focus();
    }
  }

  function onEditorInput(tab) {
    tab.content = tab.ta.value;
    tab.modified = (tab.ta.value !== tab.diskContent);
    tab.tabEl.classList.toggle('modified', tab.modified);
    updateGutter(tab);
    updateStatus(tab);
    if (!$('#find-panel').classList.contains('hidden')) refreshFind();
  }

  function updateGutter(tab) {
    const n = tab.ta.value.split('\n').length;
    let s = '';
    for (let i = 1; i <= n; i++) s += i + '\n';
    if (s.endsWith('\n')) s = s.slice(0, -1);
    tab.gutter.textContent = s;
    tab.gutter.style.transform = `translateY(${-tab.ta.scrollTop}px)`;
  }

  function indentUnit() { return ' '.repeat(Math.max(1, settings.tabSize)); }

  const AUTOCORRECT_MAP = {
    teh: 'the', adn: 'and', taht: 'that', thier: 'their', recieve: 'receive',
    seperate: 'separate', occured: 'occurred', untill: 'until', wich: 'which',
    adress: 'address', becuase: 'because', definately: 'definitely', freind: 'friend'
  };
  // Fix the word right before the caret when a delimiter is typed. Returns true if changed.
  function applyAutocorrect(tab) {
    const ta = tab.ta;
    const pos = ta.selectionStart;
    if (pos < 2) return false;
    const before = ta.value.slice(0, pos);
    const m = before.match(/[A-Za-z]{2,}$/);
    if (!m) return false;
    const word = m[0];
    const fix = AUTOCORRECT_MAP[word.toLowerCase()];
    if (!fix || word === fix) return false;
    // preserve capitalization for Capitalized words; leave ALL-CAPS untouched
    const fixed = (word[0] === word[0].toUpperCase() && word.slice(1) === word.slice(1).toLowerCase())
      ? fix[0].toUpperCase() + fix.slice(1) : fix;
    if (fixed === word) return false;
    ta.value = before.slice(0, m.index) + fixed + before.slice(pos);
    ta.selectionStart = ta.selectionEnd = m.index + fixed.length;
    onEditorInput(tab);
    updateGutter(tab);
    return true;
  }

  function onEditorKeyDown(tab, e) {
    const ta = tab.ta;
    const start = ta.selectionStart, end = ta.selectionEnd;

    if (settings.autocorrect && (e.key === ' ' || e.key === 'Enter' || /^[,.;:!?，。；：！？]$/.test(e.key)) && start === end) {
      if (applyAutocorrect(tab)) return;
    }

    if (e.key === 'Tab') {
      e.preventDefault();
      const multi = ta.value.slice(start, end).includes('\n');
      if (e.shiftKey) return outdentSelection(tab);
      if (!multi) {
        insertText(tab, indentUnit());
        return;
      }
      // indent whole selected lines
      const lines = ta.value.split('\n');
      const firstLine = ta.value.slice(0, start).split('\n').length - 1;
      const lastLine = ta.value.slice(0, end).split('\n').length - 1;
      const unit = indentUnit();
      for (let i = firstLine; i <= lastLine; i++) lines[i] = unit + lines[i];
      const newValue = lines.join('\n');
      ta.value = newValue;
      ta.selectionStart = start + unit.length;
      ta.selectionEnd = end + unit.length * (lastLine - firstLine + 1);
      onEditorInput(tab);
      updateGutter(tab);
      return;
    }

    if (settings.autoIndent && e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey && start === end) {
      const lineStart = ta.value.lastIndexOf('\n', start - 1) + 1;
      const curLine = ta.value.slice(lineStart, start);
      const lead = (curLine.match(/^[ \t]*/) || [''])[0];
      const extra = /[({[]\s*$/.test(curLine) ? indentUnit() : '';
      if (lead || extra) {
        e.preventDefault();
        insertText(tab, eolStr(tab.eol) + lead + extra);
      }
    }
  }

  function outdentSelection(tab) {
    const ta = tab.ta;
    const lines = ta.value.split('\n');
    const firstLine = ta.value.slice(0, ta.selectionStart).split('\n').length - 1;
    const lastLine = ta.value.slice(0, ta.selectionEnd).split('\n').length - 1;
    const tabLen = Math.max(1, settings.tabSize);
    let removedFirst = 0, removedTotal = 0;
    for (let i = firstLine; i <= lastLine; i++) {
      let cut = 0;
      if (lines[i].startsWith('\t')) cut = 1;
      else { const m = lines[i].match(/^ +/); if (m) cut = Math.min(m[0].length, tabLen); }
      if (!cut) continue;
      lines[i] = lines[i].slice(cut);
      if (i === firstLine) removedFirst = cut;
      removedTotal += cut;
    }
    const start = ta.selectionStart, len = ta.selectionEnd - ta.selectionStart;
    replaceValue(tab, lines.join('\n'));
    ta.selectionStart = Math.max(0, start - removedFirst);
    ta.selectionEnd = ta.selectionStart + len - (removedTotal - removedFirst);
  }

  // Replace the whole document (used by block indent / outdent).
  function replaceValue(tab, value) {
    tab.ta.value = value;
    onEditorInput(tab);
  }

  // Insert text at the caret, keeping the native undo stack when possible.
  function insertText(tab, text) {
    const ta = tab.ta;
    const before = ta.value;
    ta.focus();
    let ok = false;
    if (document.execCommand) ok = document.execCommand('insertText', false, text);
    if (!ok || (ta.value === before && text !== '')) {
      const s = ta.selectionStart, e = ta.selectionEnd;
      ta.value = before.slice(0, s) + text + before.slice(e);
      ta.selectionStart = ta.selectionEnd = s + text.length;
    }
    // programmatic mutations do not fire 'input', so refresh state manually
    onEditorInput(tab);
    updateLineCol(tab);
  }

  function applyEditorStyle(tab) {
    const fs = (settings.fontSize * tab.zoom / 100);
    const lh = fs * 1.5;
    const fam = settings.fontFamily || 'monospace';
    tab.ta.style.fontSize = fs + 'px';
    tab.ta.style.lineHeight = lh + 'px';
    tab.ta.style.fontFamily = `"${fam}", monospace`;
    tab.gutter.style.fontSize = fs + 'px';
    tab.gutter.style.lineHeight = lh + 'px';
    tab.ta.classList.toggle('wrap', settings.wordWrap);
    tab.ta.style.tabSize = Math.max(1, settings.tabSize);
    tab.ta.spellcheck = settings.spellcheck;
    tab.el.querySelector('.gutter').style.display = settings.lineNumbers ? 'block' : 'none';
  }
  function applyEditorStyleAll() { tabs.forEach(applyEditorStyle); }

  function updateLineCol(tab) {
    const pos = tab.ta.selectionStart;
    const before = tab.ta.value.slice(0, pos);
    const lines = before.split('\n');
    $('#sb-linecol').textContent = `行: ${lines.length}, 列: ${lines[lines.length - 1].length + 1}`;
    $('#sb-chars').textContent = `${tab.ta.value.length} 个字符`;
  }

  function updateStatus(tab) {
    $('#statusbar').classList.toggle('hidden', !settings.showStatusbar);
    $('#sb-zoom').textContent = tab.zoom + '%';
    $('#sb-eol').textContent = eolLabel(tab.eol);
    $('#sb-encoding').textContent = encLabel(tab.encoding, tab.hasBom);
    updateLineCol(tab);
  }

  // ===================== File operations =====================
  function newTab() { createTab({}); }

  // Fill an empty tab with the welcome text without marking it as modified.
  function showWelcome(tab) {
    if (!tab || tab.modified || tab.ta.value !== '') return;
    tab.ta.value = WELCOME_TEXT;
    tab.ta.setSelectionRange(0, 0);
    onEditorInput(tab);
    tab.diskContent = tab.ta.value;
    tab.modified = false;
    tab.tabEl.classList.remove('modified');
    updateGutter(tab);
    updateStatus(tab);
  }

  async function openFile() {
    const res = await api.openFileDialog([{ name: 'All Files', extensions: ['*'] }]);
    if (res && !res.canceled) for (const p of res.filePaths) openPath(p);
  }
  function openPath(p) {
    if (!api.fileExists(p)) { toast('File not found: ' + p); return; }
    const r = api.readFile(p);
    if (r.binary) { toast('Cannot open binary file.'); return; }
    pushRecentFile(p);
    if (settings.openFileMode === 'window') { api.newWindow(p); return; }
    createTab({
      title: api.basename(p), path: p, dir: api.dirname(p),
      content: r.content, encoding: r.hasBom ? r.encoding + '-bom' : r.encoding,
      eol: detectEol(r.content)
    });
  }

  async function saveTab(tab, forceDialog) {
    if (!tab.path || forceDialog) return saveAs(tab);
    try {
      api.writeFile(tab.path, normalizeEol(tab.ta.value, tab.eol), saveEncoding(tab));
      tab.diskContent = tab.ta.value;
      tab.modified = false;
      tab.tabEl.classList.remove('modified');
      updateStatus(tab);
      toast('Saved ' + tab.title);
    } catch (e) { toast('Save failed: ' + e.message); }
  }
  async function saveAs(tab) {
    const def = tab.path || (tab.dir ? tab.dir + '/Untitled.txt' : 'Untitled.txt');
    const res = await api.saveFileDialog(def);
    if (res && !res.canceled) {
      tab.path = res.filePath;
      tab.dir = api.dirname(res.filePath);
      setTabTitle(tab, api.basename(res.filePath));
      pushRecentFile(res.filePath);
      await saveTab(tab, false);
    }
  }
  async function saveAll() { for (const t of tabs) if (t.modified) await saveTab(t, !t.path); }

  // ===================== Find / Replace =====================
  let findMatches = [];
  let findIdx = -1;
  function openFind(replace) {
    $('#find-panel').classList.remove('hidden');
    $('#fr-replace-row').classList.toggle('hidden', !replace);
    $('#fr-find').focus();
    refreshFind();
  }
  function closeFind() { $('#find-panel').classList.add('hidden'); findMatches = []; findIdx = -1; $('#fr-status').textContent = ''; }

  function escapeReg(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  function computeMatches() {
    const ta = activeEditor(); if (!ta) return [];
    const q = $('#fr-find').value; if (!q) { $('#fr-status').textContent = ''; return []; }
    const opt = { mc: $('#fr-match-case').checked, ww: $('#fr-whole-word').checked, rx: $('#fr-regex').checked };
    let re;
    if (opt.rx) { try { re = new RegExp(q, opt.mc ? 'g' : 'gi'); } catch (e) { $('#fr-status').textContent = 'Invalid regex'; $('#fr-status').classList.add('error'); return []; } }
    else { let src = escapeReg(q); if (opt.ww) src = '\\b' + src + '\\b'; re = new RegExp(src, opt.mc ? 'g' : 'gi'); }
    const text = ta.value, out = []; let m;
    if (re.global) while ((m = re.exec(text))) { out.push([m.index, m.index + m[0].length]); if (m.index === re.lastIndex) re.lastIndex++; }
    $('#fr-status').classList.remove('error');
    return out;
  }
  function refreshFind() {
    findMatches = computeMatches();
    findIdx = findMatches.length ? 0 : -1;
    showMatch();
  }
  function showMatch() {
    const ta = activeEditor(); if (!ta || findIdx < 0) { $('#fr-status').textContent = findMatches.length ? '' : 'No results'; return; }
    const [s, e] = findMatches[findIdx];
    ta.focus(); ta.setSelectionRange(s, e);
    $('#fr-status').textContent = `${findIdx + 1} of ${findMatches.length}`;
  }
  function findNext() { if (!findMatches.length) return; findIdx = (findIdx + 1) % findMatches.length; showMatch(); }
  function findPrev() { if (!findMatches.length) return; findIdx = (findIdx - 1 + findMatches.length) % findMatches.length; showMatch(); }
  function findNextAction() {
    if ($('#find-panel').classList.contains('hidden')) { openFind(false); return; }
    if (!findMatches.length) refreshFind();
    findNext();
  }
  function findPrevAction() {
    if ($('#find-panel').classList.contains('hidden')) { openFind(false); return; }
    if (!findMatches.length) refreshFind();
    findPrev();
  }
  function replaceOne() {
    const ta = activeEditor(); if (!ta || findIdx < 0) return;
    const [s, e] = findMatches[findIdx];
    const rep = $('#fr-replace').value;
    ta.value = ta.value.slice(0, s) + rep + ta.value.slice(e);
    onEditorInput(activeTab());
    refreshFind();
  }
  function replaceAll() {
    const ta = activeEditor(); if (!ta) return;
    const rep = $('#fr-replace').value;
    let txt = ta.value, count = 0, off = 0;
    for (const [s, e] of findMatches) {
      const ns = s + off, ne = e + off;
      txt = txt.slice(0, ns) + rep + txt.slice(ne);
      off += rep.length - (e - s); count++;
    }
    if (count) { ta.value = txt; onEditorInput(activeTab()); }
    $('#fr-status').textContent = `Replaced ${count}`;
    findMatches = []; findIdx = -1;
  }

  // ===================== Markdown / Diff =====================
  function toggleMarkdown() {
    const tab = activeTab(); if (!tab) return;
    if (!isMarkdown(tab.path)) { toast('Not a Markdown file. Open a .md file to preview.'); return; }
    const pane = $('#md-preview');
    if (pane.classList.contains('hidden')) {
      $('#diff-preview').classList.add('hidden');
      pane.classList.remove('hidden');
      $('#md-content').innerHTML = mdToHtml(tab.ta.value);
    } else pane.classList.add('hidden');
  }
  function toggleDiff() {
    const tab = activeTab(); if (!tab) return;
    const pane = $('#diff-preview');
    if (pane.classList.contains('hidden')) {
      $('#md-preview').classList.add('hidden');
      pane.classList.remove('hidden');
      renderDiff(tab.diskContent, tab.ta.value);
    } else pane.classList.add('hidden');
  }
  function renderDiff(a, b) {
    const host = $('#diff-content'); host.innerHTML = '';
    const rows = diffLines(a, b);
    for (const r of rows) {
      const d = document.createElement('div');
      d.className = r.t === 'add' ? 'diff-add' : r.t === 'del' ? 'diff-del' : 'diff-same';
      d.textContent = r.line;
      host.appendChild(d);
    }
  }
  function diffLines(a, b) {
    const A = a.split('\n'), B = b.split('\n'), n = A.length, m = B.length;
    const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--)
      dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    let i = 0, j = 0; const res = [];
    while (i < n && j < m) {
      if (A[i] === B[j]) { res.push({ t: 'same', line: A[i] }); i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) { res.push({ t: 'del', line: A[i] }); i++; }
      else { res.push({ t: 'add', line: B[j] }); j++; }
    }
    while (i < n) { res.push({ t: 'del', line: A[i] }); i++; }
    while (j < m) { res.push({ t: 'add', line: B[j] }); j++; }
    return res;
  }
  function inlineMd(s) {
    return s
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>')
      .replace(/__([^_]+)__/g, '<strong>$1</strong>')
      .replace(/_([^_]+)_/g, '<em>$1</em>')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  }
  function mdToHtml(src) {
    const lines = src.replace(/\r\n?/g, '\n').split('\n');
    let html = '', i = 0;
    const esc = (s) => escapeHtml(s);
    while (i < lines.length) {
      const line = lines[i];
      if (/^```/.test(line)) {
        let code = ''; i++;
        while (i < lines.length && !/^```/.test(lines[i])) { code += lines[i] + '\n'; i++; }
        i++; html += '<pre><code>' + esc(code) + '</code></pre>'; continue;
      }
      let h = line.match(/^(#{1,6})\s+(.*)$/);
      if (h) { html += `<h${h[1].length}>${inlineMd(esc(h[2]))}</h${h[1].length}>`; i++; continue; }
      if (/^\s*>\s?/.test(line)) {
        let q = ''; while (i < lines.length && /^\s*>\s?/.test(lines[i])) { q += lines[i].replace(/^\s*>\s?/, '') + ' '; i++; }
        html += '<blockquote>' + inlineMd(esc(q)) + '</blockquote>'; continue;
      }
      if (/^\s*([-*+])\s+/.test(line)) {
        let items = ''; while (i < lines.length && /^\s*([-*+])\s+/.test(lines[i])) { items += '<li>' + inlineMd(esc(lines[i].replace(/^\s*([-*+])\s+/, ''))) + '</li>'; i++; }
        html += '<ul>' + items + '</ul>'; continue;
      }
      if (/^\s*\d+\.\s+/.test(line)) {
        let items = ''; while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) { items += '<li>' + inlineMd(esc(lines[i].replace(/^\s*\d+\.\s+/, ''))) + '</li>'; i++; }
        html += '<ol>' + items + '</ol>'; continue;
      }
      if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) { html += '<hr>'; i++; continue; }
      if (line.trim() === '') { i++; continue; }
      let p = line; i++;
      while (i < lines.length && lines[i].trim() !== '' && !/^(#{1,6}\s|```|\s*>|\s*[-*+]\s|\s*\d+\.\s)/.test(lines[i])) { p += '\n' + lines[i]; i++; }
      html += '<p>' + inlineMd(esc(p)).replace(/\n/g, '<br>') + '</p>';
    }
    return html;
  }

  function printActive() {
    const ta = activeEditor(); if (!ta) return;
    const ps = Object.assign({ orientation: 'portrait', paper: 'A4', margin: 12 }, settings.pageSetup || {});
    const f = document.createElement('iframe');
    f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
    document.body.appendChild(f);
    const doc = f.contentDocument;
    doc.open();
    doc.write('<!doctype html><html><head><style>' +
      '@page { size: ' + ps.paper + ' ' + ps.orientation + '; margin: ' + ps.margin + 'mm; }' +
      'html,body{margin:0;}pre{font-family:monospace;white-space:pre-wrap;font-size:12pt;}</style></head><body>' +
      '<pre>' + escapeHtml(ta.value) + '</pre></body></html>');
    doc.close();
    f.contentWindow.focus();
    f.contentWindow.print();
    setTimeout(() => f.remove(), 1000);
  }

  // ===================== Page setup =====================
  function openPageSetup() {
    const ps = Object.assign({ orientation: 'portrait', paper: 'A4', margin: 12 }, settings.pageSetup || {});
    $('#ps-orientation').value = ps.orientation;
    $('#ps-paper').value = ps.paper;
    $('#ps-margin').value = ps.margin;
    $('#page-setup').classList.remove('hidden');
  }
  function closePageSetup() { $('#page-setup').classList.add('hidden'); }
  function savePageSetup() {
    settings.pageSetup = {
      orientation: $('#ps-orientation').value,
      paper: $('#ps-paper').value,
      margin: Math.max(0, Math.min(50, +$('#ps-margin').value || 0))
    };
    saveSettings();
    closePageSetup();
    toast('页面设置已保存');
  }

  // ===================== Go to line / date / font =====================
  function openGotoLine() {
    const t = activeTab(); if (!t) return;
    const total = t.ta.value.split('\n').length;
    const input = $('#goto-input');
    input.max = total;
    input.value = '';
    $('#goto-line').classList.remove('hidden');
    setTimeout(() => input.focus(), 0);
  }
  function closeGotoLine() { $('#goto-line').classList.add('hidden'); }
  function doGotoLine() {
    const t = activeTab(); if (!t) return;
    const lines = t.ta.value.split('\n');
    const line = Math.max(1, Math.min(parseInt($('#goto-input').value, 10) || 1, lines.length));
    let pos = 0;
    for (let i = 0; i < line - 1; i++) pos += lines[i].length + 1;
    t.ta.focus();
    t.ta.setSelectionRange(pos, pos);
    updateLineCol(t);
    closeGotoLine();
  }

  function insertDateTime() {
    const t = activeTab(); if (!t) return;
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    const s = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
    insertText(t, s);
  }

  function openFontSettings() {
    openSettings();
    const f = $('#set-font'); if (f) f.focus();
  }

  // ===================== View menu toggles =====================
  function updateViewChecks() {
    const sb = $('[data-action="toggle-statusbar"] .fi-check');
    const ww = $('[data-action="toggle-wordwrap"] .fi-check');
    if (sb) sb.style.visibility = settings.showStatusbar ? 'visible' : 'hidden';
    if (ww) ww.style.visibility = settings.wordWrap ? 'visible' : 'hidden';
  }
  function toggleStatusbar() {
    settings.showStatusbar = !settings.showStatusbar;
    saveSettings();
    const t = activeTab();
    if (t) updateStatus(t);
    else $('#statusbar').classList.toggle('hidden', !settings.showStatusbar);
    updateViewChecks();
  }
  function toggleWordWrap() {
    settings.wordWrap = !settings.wordWrap;
    saveSettings();
    applyEditorStyleAll();
    $('#set-wordwrap').checked = settings.wordWrap;
    updateViewChecks();
  }
  function updateRecentVisibility() {
    const item = $('.flyout-item[data-sub="recent"]');
    if (item) item.style.display = settings.showRecent ? '' : 'none';
  }

  // ===================== Theme / Settings UI =====================
  function applyTheme() {
    let dark;
    if (settings.theme === 'light') dark = false;
    else if (settings.theme === 'dark') dark = true;
    else dark = matchMedia('(prefers-color-scheme: dark)').matches;
    document.body.classList.toggle('theme-dark', dark);
    document.body.classList.toggle('theme-light', !dark);
  }
  function applyAccent() { document.documentElement.style.setProperty('--accent', settings.accent); }
  function openSettings() {
    document.body.classList.add('settings-open');
    $('#settings-tb').classList.remove('hidden');
    $('#settings-pane').classList.remove('hidden');
    syncSettingsUI();
  }
  function closeSettings() {
    document.body.classList.remove('settings-open');
    $('#settings-tb').classList.add('hidden');
    $('#settings-pane').classList.add('hidden');
  }
  function toggleSettings() {
    if ($('#settings-pane').classList.contains('hidden')) openSettings();
    else closeSettings();
  }
  // ===================== Video background =====================
  // The clip lives in node_modules/assets and is streamed by the main process
  // through the custom `notepads-asset://` scheme (see serveAsset() in main.js).
  let bgVideo = null;
  function initVideoBackground() {
    bgVideo = $('#bg-video');
    if (!bgVideo) return;
    bgVideo.addEventListener('error', () => {
      // missing / undecodable clip: fall back to the plain theme background
      document.body.classList.remove('video-bg');
      if (settings.videoBackground) toast('视频背景加载失败');
    });
    document.addEventListener('visibilitychange', () => {
      if (!bgVideo) return;
      if (document.hidden) bgVideo.pause();
      else if (settings.videoBackground) playBgVideo();
    });
    if (typeof api.getBackgroundVideo !== 'function') return;
    api.getBackgroundVideo().then((info) => {
      if (!info || !info.url) { document.body.classList.remove('video-bg'); return; }
      bgVideo.src = info.url;
      applyVideoBackground();
    }).catch(() => document.body.classList.remove('video-bg'));
  }
  function playBgVideo() {
    if (!bgVideo) return;
    const p = bgVideo.play();
    if (p && typeof p.catch === 'function') p.catch(() => {}); // autoplay can be refused
  }
  function applyVideoBackground() {
    const on = !!settings.videoBackground;
    document.body.classList.toggle('video-bg', on);
    document.documentElement.classList.toggle('video-bg', on);
    const dim = Number(settings.videoDim) || 0;
    const blur = Number(settings.videoBlur) || 0;
    document.documentElement.style.setProperty('--video-dim', String(dim / 100));
    document.documentElement.style.setProperty('--video-blur', blur + 'px');
    const layer = $('#bg-layer');
    if (layer) layer.classList.toggle('hidden', !on);
    if (on) playBgVideo(); else if (bgVideo) bgVideo.pause();
  }
  function updateVideoLabels() {
    const d = $('#videodim-val'), b = $('#videoblur-val');
    if (d) d.textContent = (Number(settings.videoDim) || 0) + '%';
    if (b) b.textContent = (Number(settings.videoBlur) || 0) + 'px';
  }

  function syncSettingsUI() {
    $('#set-videobg').checked = settings.videoBackground;
    $('#set-videodim').value = Number(settings.videoDim) || 0;
    $('#set-videoblur').value = Number(settings.videoBlur) || 0;
    updateVideoLabels();
    $('#set-theme').value = settings.theme;
    $('#set-font').value = settings.fontFamily;
    $('#set-wordwrap').checked = settings.wordWrap;
    $('#set-autoindent').checked = settings.autoIndent;
    $('#set-openmode').value = settings.openFileMode;
    $('#set-startup').value = settings.startupMode;
    $('#set-recent').checked = settings.showRecent;
    $('#set-spellcheck').checked = settings.spellcheck;
    $('#set-autocorrect').checked = settings.autocorrect;
  }
  function buildSettingsUI() {
    const sel = $('#set-font');
    FONTS.forEach(f => { const o = document.createElement('option'); o.value = f; o.textContent = f; sel.appendChild(o); });
    if (!FONTS.includes(settings.fontFamily)) { const o = document.createElement('option'); o.value = settings.fontFamily; o.textContent = settings.fontFamily; sel.appendChild(o); }
  }

  // ===================== Menu bar flyouts =====================
  function closeAllMenus() {
    hideTabContextMenu();
    $$('.flyout').forEach(m => m.classList.add('hidden'));
    $$('.flyout-submenu').forEach(s => { s.classList.add('hidden'); s.style.left = ''; s.style.right = ''; });
    $$('.menu-top').forEach(b => b.classList.remove('open'));
  }
  function toggleMenu(name, btn) {
    const m = $('#menu-' + name);
    const wasOpen = !m.classList.contains('hidden');
    closeAllMenus();
    if (!wasOpen) {
      m.classList.remove('hidden');
      m.style.left = Math.max(4, btn.getBoundingClientRect().left) + 'px';
      btn.classList.add('open');
      updateViewChecks();
    }
  }
  const MENU_ACTIONS = {
    'new': newTab,
    'new-window': () => api.newWindow(),
    'open': openFile,
    'save': () => { const t = activeTab(); if (t) saveTab(t, !t.path); },
    'save-as': () => { const t = activeTab(); if (t) saveAs(t); },
    'save-all': saveAll,
    'undo': () => runCtxAction('undo'),
    'cut': () => runCtxAction('cut'),
    'copy': () => runCtxAction('copy'),
    'paste': () => runCtxAction('paste'),
    'delete': () => runCtxAction('delete'),
    'bing': () => runCtxAction('bing'),
    'selectall': () => runCtxAction('selectall'),
    'find': () => openFind(false),
    'find-next': findNextAction,
    'find-prev': findPrevAction,
    'replace': () => openFind(true),
    'goto': openGotoLine,
    'datetime': insertDateTime,
    'font': openFontSettings,
    'zoom-in': () => zoomActive(10),
    'zoom-out': () => zoomActive(-10),
    'zoom-reset': () => setZoomActive(100),
    'fullscreen': () => { if (!document.fullscreenElement) document.documentElement.requestFullscreen(); else document.exitFullscreen(); },
    'print': printActive,
    'page-setup': openPageSetup,
    'toggle-statusbar': toggleStatusbar,
    'toggle-wordwrap': toggleWordWrap,
    'close-tab': () => { if (activeId) closeTab(activeId); },
    'close-window': () => api.windowControl('close'),
    'quit': () => api.quitApp(),
    'settings': openSettings
  };

  function buildRecentSubmenu() {
    const sub = $('#menu-recent');
    sub.innerHTML = '';
    const files = getRecentFiles();
    if (!files.length) {
      const empty = document.createElement('div');
      empty.className = 'flyout-item disabled';
      const lab = document.createElement('span');
      lab.className = 'fi-label';
      lab.textContent = '无最近使用的文件';
      empty.appendChild(lab);
      sub.appendChild(empty);
      return;
    }
    for (const p of files) {
      const it = document.createElement('div');
      it.className = 'flyout-item';
      const lab = document.createElement('span');
      lab.className = 'fi-label';
      lab.textContent = api.basename(p);
      lab.title = p;
      it.appendChild(lab);
      it.addEventListener('click', (e) => { e.stopPropagation(); openPath(p); closeAllMenus(); });
      sub.appendChild(it);
    }
    const sep = document.createElement('div');
    sep.className = 'flyout-sep';
    sub.appendChild(sep);
    const clear = document.createElement('div');
    clear.className = 'flyout-item';
    const cl = document.createElement('span');
    cl.className = 'fi-label';
    cl.textContent = '清除最近使用的文件';
    clear.appendChild(cl);
    clear.addEventListener('click', (e) => { e.stopPropagation(); clearRecentFiles(); closeAllMenus(); });
    sub.appendChild(clear);
  }

  function openFlyoutSubmenu(itemEl) {
    const sub = itemEl.querySelector('.flyout-submenu');
    if (!sub) return;
    const wasOpen = !sub.classList.contains('hidden');
    $$('.flyout-submenu').forEach(s => { s.classList.add('hidden'); s.style.left = ''; s.style.right = ''; });
    if (wasOpen) return;
    if (sub.id === 'menu-recent') buildRecentSubmenu();
    sub.classList.remove('hidden');
    // flip to the left when it would overflow the viewport
    if (sub.getBoundingClientRect().right > window.innerWidth - 8) {
      sub.style.left = 'auto';
      sub.style.right = 'calc(100% - 4px)';
    }
  }

  // ===================== Editor context menu =====================
  const CTX_ENCODINGS = [
    ['utf-8', false, 'UTF-8'],
    ['utf-8', true, 'UTF-8 BOM'],
    ['utf-16-le', true, 'UTF-16 LE'],
    ['utf-16-be', true, 'UTF-16 BE'],
    ['ansi', false, 'ANSI']
  ];

  function hideContextMenu() {
    $('#ctx-menu').classList.add('hidden');
    $$('.ctx-submenu').forEach(s => s.classList.add('hidden'));
  }

  // ===================== Tab context menu =====================
  let tabCtxTargetId = null;

  function hideTabContextMenu() {
    $('#tab-ctx-menu').classList.add('hidden');
    tabCtxTargetId = null;
  }

  function showTabContextMenu(x, y, id) {
    hideContextMenu();
    closeAllMenus();
    tabCtxTargetId = id;
    const menu = $('#tab-ctx-menu');
    menu.classList.remove('hidden');
    const r = menu.getBoundingClientRect();
    menu.style.left = Math.max(4, Math.min(x, window.innerWidth - r.width - 8)) + 'px';
    menu.style.top = Math.max(4, Math.min(y, window.innerHeight - r.height - 8)) + 'px';
  }

  function initTabContextMenu() {
    const menu = $('#tab-ctx-menu');
    menu.addEventListener('click', (e) => {
      e.stopPropagation();
      const item = e.target.closest('.ctx-item');
      if (!item || item.classList.contains('disabled')) return;
      const targetId = tabCtxTargetId;
      hideTabContextMenu();
      if (item.dataset.tabAction === 'rename' && targetId != null) beginRenameTab(targetId);
    });
    document.addEventListener('click', (e) => {
      if (!e.target.closest('#tab-ctx-menu')) hideTabContextMenu();
    });
    document.addEventListener('blur', hideTabContextMenu);
    window.addEventListener('resize', hideTabContextMenu);
  }

  function showContextMenu(x, y) {
    closeAllMenus();
    $$('.ctx-submenu').forEach(s => s.classList.add('hidden'));
    refreshCtxMenu();
    const menu = $('#ctx-menu');
    menu.classList.remove('hidden');
    const r = menu.getBoundingClientRect();
    menu.style.left = Math.max(4, Math.min(x, window.innerWidth - r.width - 8)) + 'px';
    menu.style.top = Math.max(4, Math.min(y, window.innerHeight - r.height - 8)) + 'px';
  }

  function refreshCtxMenu() {
    const ta = activeEditor();
    const menu = $('#ctx-menu');
    const hasSel = !!ta && ta.selectionStart !== ta.selectionEnd;
    const hasText = !!ta && ta.value.length > 0;
    let undoable = false;
    try { undoable = document.queryCommandEnabled('undo'); } catch (e) {}
    menu.querySelectorAll('[data-action]').forEach(el => {
      const a = el.dataset.action;
      let dis = false;
      if (a === 'cut' || a === 'copy' || a === 'delete' || a === 'bing') dis = !hasSel;
      else if (a === 'undo') dis = !undoable;
      else if (a === 'paste') dis = false;
      else if (a === 'selectall') dis = !hasText;
      el.classList.toggle('disabled', dis);
    });
    $('#ctx-spell-toggle').querySelector('span').textContent =
      settings.spellcheck ? '禁用拼写检查' : '启用拼写检查';
    buildUnicodeSubmenu();
  }

  function buildUnicodeSubmenu() {
    const sub = $('#ctx-sub-unicode');
    const t = activeTab();
    sub.innerHTML = '';
    if (!t) return;
    for (const [enc, bom, label] of CTX_ENCODINGS) {
      const it = document.createElement('div');
      it.className = 'ctx-item';
      const lab = document.createElement('span');
      lab.textContent = label;
      it.appendChild(lab);
      if (t.encoding === enc && t.hasBom === bom) {
        const c = document.createElement('span');
        c.className = 'ctx-check';
        c.textContent = '✓';
        it.appendChild(c);
      }
      it.addEventListener('click', (e) => {
        e.stopPropagation();
        t.encoding = enc; t.hasBom = bom;
        updateStatus(t);
        toast('编码: ' + encLabel(enc, bom));
        hideContextMenu();
      });
      sub.appendChild(it);
    }
  }

  function runCtxAction(a) {
    const tab = activeTab(); if (!tab) return;
    const ta = tab.ta;
    ta.focus();
    switch (a) {
      case 'undo':
        try { document.execCommand('undo'); } catch (e) {}
        onEditorInput(tab);
        break;
      case 'cut':
        try { document.execCommand('cut'); } catch (e) {}
        onEditorInput(tab);
        break;
      case 'copy':
        try { document.execCommand('copy'); } catch (e) {}
        break;
      case 'paste':
        if (navigator.clipboard && navigator.clipboard.readText) {
          navigator.clipboard.readText().then(txt => { if (txt) insertText(tab, txt); }).catch(() => {});
        } else {
          try { document.execCommand('paste'); } catch (e) {}
        }
        break;
      case 'selectall':
        ta.select();
        updateLineCol(tab);
        break;
      case 'delete':
        try { document.execCommand('delete'); } catch (e) {}
        onEditorInput(tab);
        break;
      case 'bing': {
        const sel = ta.value.slice(ta.selectionStart, ta.selectionEnd).trim();
        if (!sel) { toast('请先选择要搜索的文本'); return; }
        api.openExternal('https://www.bing.com/search?q=' + encodeURIComponent(sel));
        break;
      }
    }
  }

  function toggleSpellFromMenu() {
    settings.spellcheck = !settings.spellcheck;
    saveSettings();
    applyEditorStyleAll();
    $('#set-spellcheck').checked = settings.spellcheck;
    toast(settings.spellcheck ? '已启用拼写检查' : '已禁用拼写检查');
  }

  function openCtxSubmenu(itemEl) {
    const sub = itemEl.querySelector('.ctx-submenu');
    if (!sub) return;
    const wasOpen = !sub.classList.contains('hidden');
    $$('.ctx-submenu').forEach(s => { s.classList.add('hidden'); s.style.top = ''; });
    if (wasOpen) return;
    refreshCtxMenu();
    sub.classList.remove('hidden');
    // clamp submenu inside viewport
    const r = sub.getBoundingClientRect();
    const over = r.bottom - window.innerHeight + 8;
    if (over > 0) {
      const base = parseFloat(getComputedStyle(sub).top) || 0;
      sub.style.top = (base - over) + 'px';
    }
  }

  function initContextMenu() {
    const menu = $('#ctx-menu');
    menu.addEventListener('click', (e) => {
      e.stopPropagation();
      const item = e.target.closest('.ctx-item, .ctx-icon');
      if (!item) return;
      if (item.dataset.subaction === 'spell-toggle') { toggleSpellFromMenu(); hideContextMenu(); return; }
      if (item.closest('.ctx-submenu')) return;
      const a = item.dataset.action;
      if (!a) return;
      runCtxAction(a);
      hideContextMenu();
    });
    menu.querySelectorAll('.ctx-sub').forEach(el => {
      el.addEventListener('click', (e) => { e.stopPropagation(); openCtxSubmenu(el); });
      el.addEventListener('mouseenter', () => {
        if ($$('.ctx-submenu').some(s => !s.classList.contains('hidden'))) openCtxSubmenu(el);
      });
    });
    document.addEventListener('click', (e) => {
      if (!e.target.closest('#ctx-menu')) hideContextMenu();
    });
    document.addEventListener('blur', hideContextMenu);
    window.addEventListener('resize', hideContextMenu);
  }

  // ===================== Toast =====================
  let toastTimer = null;
  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.classList.remove('hidden');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.add('hidden'), 2200);
    addNotification(msg);
  }

  // ===================== Notifications =====================
  const notifications = [];
  function addNotification(msg) {
    notifications.unshift({ text: String(msg), time: new Date() });
    if (notifications.length > 100) notifications.pop();
    renderNotifications();
  }
  function renderNotifications() {
    const list = $('#notif-list'); if (!list) return;
    list.textContent = '';
    if (!notifications.length) {
      const empty = document.createElement('div');
      empty.className = 'notif-empty'; empty.textContent = '暂无通知';
      list.appendChild(empty); return;
    }
    notifications.forEach(n => {
      const item = document.createElement('div'); item.className = 'notif-item';
      const text = document.createElement('div'); text.className = 'notif-text'; text.textContent = n.text;
      const time = document.createElement('div'); time.className = 'notif-time'; time.textContent = n.time.toLocaleTimeString();
      item.appendChild(text); item.appendChild(time);
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        const i = notifications.indexOf(n); if (i >= 0) notifications.splice(i, 1);
        renderNotifications();
      });
      list.appendChild(item);
    });
  }
  function showNotifications() {
    const panel = $('#notif-panel'); if (!panel) return;
    renderNotifications();
    panel.classList.toggle('hidden');
  }
  function hideNotifications() {
    const panel = $('#notif-panel'); if (panel) panel.classList.add('hidden');
  }

  // ===================== Notifications full-screen page =====================
  // Page shown by default when the 通知 page opens.
  const NOTIF_DEFAULT_PAGE = 'C:\\Users\\LyraInc\\Desktop\\electron-main\\electron-main\\asset\\test.html';
  let notifPagePath = NOTIF_DEFAULT_PAGE;

  function toFileUrl(p) { return 'file:///' + String(p).replace(/\\/g, '/'); }
  function escHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function setNotifFrameHtml(html) {
    const frame = $('#notif-page-frame'); if (!frame) return;
    frame.removeAttribute('src');
    frame.srcdoc = html;
  }
  function notifErrorHtml(msg) {
    return '<body style="font:14px/1.7 \'Segoe UI\',system-ui,sans-serif;padding:24px;color:#888">' +
      escHtml(msg) + '</body>';
  }
  // http(s) origin (dev server) cannot frame file:// URLs, so inline the markup with a <base>.
  function withBaseTag(html, p) {
    const base = '<base href="' + toFileUrl(api.dirname(p)) + '/">';
    if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, m => m + base);
    if (/<html[^>]*>/i.test(html)) return html.replace(/<html[^>]*>/i, m => m + '<head>' + base + '</head>');
    return base + html;
  }
  function loadNotificationPage(p) {
    notifPagePath = p || notifPagePath || NOTIF_DEFAULT_PAGE;
    const label = $('#notif-page-path');
    if (label) { label.textContent = notifPagePath; label.title = notifPagePath; }
    const frame = $('#notif-page-frame'); if (!frame) return;

    let exists = false;
    try { exists = api.fileExists(notifPagePath); } catch (e) { exists = false; }
    if (!exists) { setNotifFrameHtml(notifErrorHtml('找不到页面文件：' + notifPagePath)); return; }

    if (location.protocol === 'file:') {
      frame.removeAttribute('srcdoc');
      frame.src = toFileUrl(notifPagePath);
    } else {
      try {
        setNotifFrameHtml(withBaseTag(api.readFile(notifPagePath).content, notifPagePath));
      } catch (err) {
        setNotifFrameHtml(notifErrorHtml('读取页面失败：' + (err && err.message ? err.message : err)));
      }
    }
  }
  function openNotificationPage() {
    hideNotifications();
    closeAllMenus();
    $('#notif-page').classList.remove('hidden');
    loadNotificationPage(notifPagePath);
  }
  function closeNotificationPage() {
    const page = $('#notif-page'); if (!page) return;
    page.classList.add('hidden');
    const frame = $('#notif-page-frame');
    if (frame) { frame.removeAttribute('srcdoc'); frame.src = 'about:blank'; }
  }

  // ===================== What's new dialog =====================
  const WHATSNEW_FEATURES = [
    { title: '你的必备文本编辑器，焕然升级',
      desc: '你熟悉的记事本，支持语法格式和无干扰空间，适合快速编辑和日记。' },
    { title: '轻量级格式化',
      desc: '使用 Markdown 设置笔记格式，轻松排版标题、列表与代码块。' }
  ];
  function selectWhatsNewFeature(i) {
    $$('.whatsnew-item').forEach(el => el.classList.toggle('active', +el.dataset.feature === i));
    const f = WHATSNEW_FEATURES[i]; if (!f) return;
    $('#whatsnew-detail-title').textContent = f.title;
    $('#whatsnew-detail-desc').textContent = f.desc;
  }
  function showWhatsNew() {
    hideNotifications();
    selectWhatsNewFeature(0);
    $('#whatsnew').classList.remove('hidden');
  }
  function closeWhatsNew() { $('#whatsnew').classList.add('hidden'); }

  // ===================== Shortcuts =====================
  function bindShortcuts() {
    document.addEventListener('keydown', (e) => {
      const k = e.key.toLowerCase();
      const mod = e.ctrlKey || e.metaKey;
      if (mod && k === 'n' && !e.shiftKey) { e.preventDefault(); newTab(); }
      else if (mod && k === 'n' && e.shiftKey) { e.preventDefault(); api.newWindow(); }
      else if (mod && k === 'o') { e.preventDefault(); openFile(); }
      else if (mod && k === 's' && e.altKey) { e.preventDefault(); saveAll(); }
      else if (mod && k === 's' && e.shiftKey) { e.preventDefault(); const t = activeTab(); if (t) saveAs(t); }
      else if (mod && k === 's') { e.preventDefault(); const t = activeTab(); if (t) saveTab(t, !t.path); }
      else if (mod && k === 'f' && !e.shiftKey) { e.preventDefault(); openFind(false); }
      else if (mod && k === 'f' && e.shiftKey) { e.preventDefault(); openFind(true); }
      else if (mod && k === 'h') { e.preventDefault(); openFind(true); }
      else if (mod && k === 'e') { e.preventDefault(); runCtxAction('bing'); }
      else if (mod && k === 'g') { e.preventDefault(); openGotoLine(); }
      else if (mod && k === 'p') { e.preventDefault(); printActive(); }
      else if (e.key === 'F1') { e.preventDefault(); toggleSettings(); }
      else if (e.key === 'F5') { e.preventDefault(); insertDateTime(); }
      else if (e.key === 'F11') { e.preventDefault(); if (!document.fullscreenElement) document.documentElement.requestFullscreen(); else document.exitFullscreen(); }
      else if (mod && k === 'tab' && !e.shiftKey) { e.preventDefault(); cycleTab(1); }
      else if (mod && k === 'tab' && e.shiftKey) { e.preventDefault(); cycleTab(-1); }
      else if (mod && k === 'w' && e.shiftKey) { e.preventDefault(); api.windowControl('close'); }
      else if (mod && k === 'w') { e.preventDefault(); if (activeId) closeTab(activeId); }
      else if (mod && (e.key === '=' || e.key === '+')) { e.preventDefault(); zoomActive(10); }
      else if (mod && e.key === '-') { e.preventDefault(); zoomActive(-10); }
      else if (mod && e.key === '0') { e.preventDefault(); setZoomActive(100); }
      else if (e.altKey && k === 'p') { e.preventDefault(); toggleMarkdown(); }
      else if (e.altKey && k === 'd') { e.preventDefault(); toggleDiff(); }
      else if (/^[1-9]$/.test(e.key) && mod) { e.preventDefault(); const i = +e.key - 1; if (tabs[i]) activateTab(tabs[i].id); }
      else if (e.key === 'Escape') {
        if (renamingTabId !== null) finishRenameTab(false, true);
        else if (!$('#notif-page').classList.contains('hidden')) closeNotificationPage();
        else if (!$('#whatsnew').classList.contains('hidden')) closeWhatsNew();
        else if (!$('#page-setup').classList.contains('hidden')) closePageSetup();
        else if (!$('#goto-line').classList.contains('hidden')) closeGotoLine();
        else if (!$('#find-panel').classList.contains('hidden')) closeFind();
        else if (!$('#settings-pane').classList.contains('hidden')) closeSettings();
        else if ($$('.flyout').some(m => !m.classList.contains('hidden'))) closeAllMenus();
        else if (!$('#ctx-menu').classList.contains('hidden')) hideContextMenu();
        else if (!$('#fr-options-menu').classList.contains('hidden')) $('#fr-options-menu').classList.add('hidden');
        else if (!$('#notif-panel').classList.contains('hidden')) hideNotifications();
      }
      // find navigation keys
      if (e.key === 'F3') {
        e.preventDefault();
        e.shiftKey ? findPrevAction() : findNextAction();
      }
    });
  }
  function cycleTab(dir) {
    const i = tabs.findIndex(t => t.id === activeId);
    const ni = (i + dir + tabs.length) % tabs.length;
    activateTab(tabs[ni].id);
  }
  function zoomActive(delta) {
    const t = activeTab(); if (!t) return;
    t.zoom = Math.max(10, Math.min(500, t.zoom + delta));
    applyEditorStyle(t); updateStatus(t);
  }
  function setZoomActive(v) { const t = activeTab(); if (!t) return; t.zoom = v; applyEditorStyle(t); updateStatus(t); }

  // ===================== Wire up static UI =====================
  function bindUI() {
    $('#new-tab-btn').addEventListener('click', newTab);
    $('#win-min').addEventListener('click', () => api.windowControl('min'));
    $('#win-max').addEventListener('click', () => api.windowControl('max'));
    $('#win-close').addEventListener('click', () => api.windowControl('close'));

    // menu bar
    $$('.menu-top').forEach(btn => {
      btn.addEventListener('click', (e) => { e.stopPropagation(); toggleMenu(btn.dataset.menu, btn); });
      btn.addEventListener('mouseenter', () => {
        const anyOpen = $$('.flyout').some(m => !m.classList.contains('hidden'));
        if (anyOpen) toggleMenu(btn.dataset.menu, btn);
      });
    });
    $('#mb-notifications').addEventListener('click', (e) => { e.stopPropagation(); openNotificationPage(); });
    $('#mb-settings').addEventListener('click', (e) => { e.stopPropagation(); toggleSettings(); });
    $$('.flyout').forEach(m => m.addEventListener('click', (e) => {
      const item = e.target.closest('.flyout-item'); if (!item) return;
      if (item.classList.contains('flyout-sub')) return;
      const a = item.dataset.action; if (MENU_ACTIONS[a]) MENU_ACTIONS[a]();
      closeAllMenus();
    }));
    $$('.flyout-sub').forEach(el => {
      el.addEventListener('click', (e) => { e.stopPropagation(); openFlyoutSubmenu(el); });
      el.addEventListener('mouseenter', () => {
        if ($$('.flyout-submenu').some(s => !s.classList.contains('hidden'))) openFlyoutSubmenu(el);
      });
    });
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.flyout') && !e.target.closest('.menu-top'))
        closeAllMenus();
    });

    // notifications
    $('#notif-clear').addEventListener('click', (e) => {
      e.stopPropagation(); notifications.length = 0; renderNotifications();
    });
    document.addEventListener('click', (e) => {
      if (!e.target.closest('#notif-panel') && !e.target.closest('#mb-notifications')
        && !e.target.closest('#notif-page')) hideNotifications();
    });

    // notifications full-screen page
    $('#notif-page-close').addEventListener('click', closeNotificationPage);

    // what's new dialog
    $('#whatsnew-close').addEventListener('click', closeWhatsNew);
    $('#whatsnew-explore').addEventListener('click', closeWhatsNew);
    $('#whatsnew').addEventListener('click', (e) => { if (e.target === $('#whatsnew')) closeWhatsNew(); });
    $$('.whatsnew-item').forEach(el =>
      el.addEventListener('click', () => selectWhatsNewFeature(+el.dataset.feature)));

    // page setup dialog
    $('#ps-ok').addEventListener('click', savePageSetup);
    $('#ps-cancel').addEventListener('click', closePageSetup);
    $('#page-setup').addEventListener('click', (e) => { if (e.target === $('#page-setup')) closePageSetup(); });

    // go to line dialog
    $('#goto-ok').addEventListener('click', doGotoLine);
    $('#goto-cancel').addEventListener('click', closeGotoLine);
    $('#goto-line').addEventListener('click', (e) => { if (e.target === $('#goto-line')) closeGotoLine(); });
    $('#goto-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doGotoLine(); } });

    // settings page
    $('#settings-back').addEventListener('click', closeSettings);
    $('#set-videobg').addEventListener('change', (e) => {
      settings.videoBackground = e.target.checked; saveSettings(); applyVideoBackground();
    });
    $('#set-videodim').addEventListener('input', (e) => {
      settings.videoDim = +e.target.value;
      document.documentElement.style.setProperty('--video-dim', String(settings.videoDim / 100));
      updateVideoLabels();
    });
    $('#set-videodim').addEventListener('change', () => saveSettings());
    $('#set-videoblur').addEventListener('input', (e) => {
      settings.videoBlur = +e.target.value;
      document.documentElement.style.setProperty('--video-blur', settings.videoBlur + 'px');
      updateVideoLabels();
    });
    $('#set-videoblur').addEventListener('change', () => saveSettings());
    $('#videobg-expand').addEventListener('click', (e) => {
      e.stopPropagation();
      $('#card-videobg').classList.toggle('expanded');
    });
    $('#set-theme').addEventListener('change', (e) => { settings.theme = e.target.value; applyTheme(); saveSettings(); });
    $('#set-font').addEventListener('change', (e) => { settings.fontFamily = e.target.value; saveSettings(); applyEditorStyleAll(); });
    $('#set-wordwrap').addEventListener('change', (e) => { settings.wordWrap = e.target.checked; saveSettings(); applyEditorStyleAll(); updateViewChecks(); });
    $('#set-autoindent').addEventListener('change', (e) => { settings.autoIndent = e.target.checked; saveSettings(); });
    $('#set-openmode').addEventListener('change', (e) => { settings.openFileMode = e.target.value; saveSettings(); });
    $('#set-startup').addEventListener('change', (e) => { settings.startupMode = e.target.value; saveSettings(); });
    $('#set-recent').addEventListener('change', (e) => { settings.showRecent = e.target.checked; saveSettings(); updateRecentVisibility(); });
    $('#set-spellcheck').addEventListener('change', (e) => { settings.spellcheck = e.target.checked; saveSettings(); applyEditorStyleAll(); });
    $('#set-autocorrect').addEventListener('change', (e) => { settings.autocorrect = e.target.checked; saveSettings(); });
    $('#spell-expand').addEventListener('click', (e) => {
      e.stopPropagation();
      $('#card-spell').classList.toggle('expanded');
    });
    $('#side-license').addEventListener('click', () => api.openExternal('https://github.com/0x7c13/Notepads/blob/master/LICENSE.txt'));
    $('#side-source').addEventListener('click', () => api.openExternal('https://github.com/0x7c13/Notepads'));
    $('#side-privacy').addEventListener('click', () => api.openExternal('https://github.com/0x7c13/Notepads'));
    $('#side-feedback').addEventListener('click', () => api.openExternal('https://github.com/0x7c13/Notepads/issues'));
    $('#side-help').addEventListener('click', () => api.openExternal('https://github.com/0x7c13/Notepads#readme'));

    // markdown / diff close
    $('#md-close').addEventListener('click', () => $('#md-preview').classList.add('hidden'));
    $('#diff-close').addEventListener('click', () => $('#diff-preview').classList.add('hidden'));

    // find panel
    $('#fr-close').addEventListener('click', closeFind);
    $('#fr-next').addEventListener('click', findNext);
    $('#fr-prev').addEventListener('click', findPrev);
    $('#fr-toggle').addEventListener('click', () => $('#fr-replace-row').classList.toggle('hidden'));
    $('#fr-options').addEventListener('click', (e) => { e.stopPropagation(); $('#fr-options-menu').classList.toggle('hidden'); });
    $('#fr-options-menu').addEventListener('click', (e) => e.stopPropagation());
    ['fr-find', 'fr-match-case', 'fr-whole-word', 'fr-regex'].forEach(id =>
      $('#' + id).addEventListener('input', refreshFind));
    $('#fr-find').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); e.shiftKey ? findPrev() : findNext(); }
    });
    $('#fr-replace-one').addEventListener('click', replaceOne);
    $('#fr-replace-all').addEventListener('click', replaceAll);

    // status bar interactions
    $('#sb-zoom').addEventListener('click', () => setZoomActive(100));
    $('#sb-eol').addEventListener('click', () => {
      const t = activeTab(); if (!t) return;
      t.eol = t.eol === 'crlf' ? 'lf' : t.eol === 'lf' ? 'cr' : 'crlf';
      updateStatus(t); toast('Line ending: ' + eolLabel(t.eol));
    });
    $('#sb-encoding').addEventListener('click', () => {
      const t = activeTab(); if (!t) return;
      const order = [['utf-8', false], ['utf-8', true], ['utf-16-le', true], ['utf-16-be', true], ['ansi', false]];
      const i = order.findIndex(x => x[0] === t.encoding && x[1] === t.hasBom);
      const nx = order[(i + 1) % order.length];
      t.encoding = nx[0]; t.hasBom = nx[1]; updateStatus(t); toast('Encoding: ' + encLabel(t.encoding, t.hasBom));
    });

    // drag & drop files
    document.addEventListener('dragover', (e) => e.preventDefault());
    document.addEventListener('drop', (e) => {
      e.preventDefault();
      if (e.dataTransfer && e.dataTransfer.files) for (const f of e.dataTransfer.files) openPath(f.path);
    });

    window.addEventListener('resize', updateTabsDensity);

    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (settings.theme === 'system') applyTheme(); });

    // before close: save session, warn unsaved
    window.addEventListener('beforeunload', (e) => {
      saveSession();
      if (tabs.some(t => t.modified)) { e.preventDefault(); e.returnValue = ''; }
    });
  }

  // ===================== Init =====================
  function saveSession() {
    try {
      const paths = tabs.filter(t => t.path).map(t => t.path);
      localStorage.setItem('notepads-session', JSON.stringify(paths));
    } catch (e) {}
  }
  function getSavedSession() {
    try {
      const a = JSON.parse(localStorage.getItem('notepads-session'));
      return Array.isArray(a) ? a.filter(p => api.fileExists(p)) : [];
    } catch (e) { return []; }
  }
  // ===================== Frosted glass =====================
  // The blurred backdrop is drawn by the OS (see glassWindowOptions() in main.js);
  // only when the material is really available do we swap solid colours for
  // translucent ones, otherwise text would sit on an undefined background.
  function initGlass() {
    if (typeof api.onGlass !== 'function') return;
    api.onGlass((mode) => {
      // 'system' => the OS blurs behind the window, the page itself can stay clear;
      // 'css'    => no OS material, so the page paints an opaque base and only the
      //             floating panels show the liquid-glass blur.
      const on = mode === 'system' || mode === 'css';
      document.documentElement.classList.toggle('glass', on);
      document.body.classList.toggle('glass', on);
      document.documentElement.classList.toggle('glass-css', mode === 'css');
      document.body.classList.toggle('glass-css', mode === 'css');
    });
  }

  function init() {
    applyTheme();
    applyAccent();
    initGlass();
    applyVideoBackground();
    initVideoBackground();
    buildSettingsUI();
    initContextMenu();
    initTabContextMenu();
    bindShortcuts();
    bindUI();
    syncSettingsUI();
    updateViewChecks();
    updateRecentVisibility();
    const firstTab = createTab({});
    // open files passed on the command line / via OS file association,
    // or restore the previous session if configured in Settings
    api.getStartupFiles().then((files) => {
      const list = (Array.isArray(files) && files.length) ? files
        : (settings.startupMode === 'restore' ? getSavedSession() : []);
      list.forEach(openPath);
      if (!firstTab.path && !firstTab.modified && tabs.length > 1) closeTab(firstTab.id);
      else showWelcome(firstTab);
    }).catch(() => { showWelcome(firstTab); });
  }

  init();
})();
