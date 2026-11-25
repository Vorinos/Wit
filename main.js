// Wit for the desktop: one window around the same page the web version uses, plus what only a desktop app can do:
// keep a copy of the record for connected AI apps (MCP), read Claude Code and Codex sessions, notice chat exports in
// Downloads, and ask an AI about the record when you have switched that on.
// The page itself still has no network at all. The only things that leave this computer are questions you send to an
// AI you chose (through this process, to that provider's address only), and the record, if you serve it to ChatGPT.
'use strict';
const { app, BrowserWindow, shell, session, ipcMain, safeStorage, nativeTheme, dialog } = require('electron');
const path = require('path'), fs = require('fs'), os = require('os'), crypto = require('crypto'), { execFile } = require('child_process');
const sources = require('./desktop/sources'), exportsMod = require('./desktop/exports'), connect = require('./desktop/connect'), ai = require('./desktop/ai'), mcp = require('./mcp/wit-mcp');

const MAC = process.platform === 'darwin' && !process.env.WIT_OPAQUE;
// The Mac App Store build runs in Apple's sandbox. It reads Claude Code and Codex sessions only from folders the
// person has picked, and it never writes other apps' settings: the Connect page shows the setup to paste instead.
const MAS = !!process.mas || !!process.env.WIT_MAS;      // WIT_OPAQUE=1 turns the see-through window off
let win = null, ready = false;
const DATA = () => app.getPath('userData');
const file = n => path.join(DATA(), n);

/* ---------- settings, kept in Wit's own folder ---------- */
const DEFAULTS = { glass: 'clear', folders: {}, sources: { claudeCode: false, codex: false }, watchDownloads: false, offered: {}, ai: { provider: 'off', models: {}, localBase: ai.PROVIDERS.local.base, keys: {}, consent: false }, http: { on: false, port: 8765, token: '' } };
let S = null;
function loadSettings() { try { S = Object.assign({}, DEFAULTS, JSON.parse(fs.readFileSync(file('settings.json'), 'utf8'))); } catch (e) { S = JSON.parse(JSON.stringify(DEFAULTS)); } S.ai = Object.assign({}, DEFAULTS.ai, S.ai); S.http = Object.assign({}, DEFAULTS.http, S.http); S.sources = Object.assign({}, DEFAULTS.sources, S.sources); }
function writeAtomic(p, text) { fs.mkdirSync(path.dirname(p), { recursive: true }); const t = p + '.tmp'; fs.writeFileSync(t, text); fs.renameSync(t, p); }
function saveSettings() { writeAtomic(file('settings.json'), JSON.stringify(S, null, 1)); }
let seen = null;                                             // files the page has filed: { claudeCode: { path: stamp }, codex: {...} }
function loadSeen() { try { seen = JSON.parse(fs.readFileSync(file('sources-seen.json'), 'utf8')); } catch (e) { seen = {}; } seen.claudeCode = seen.claudeCode || {}; seen.codex = seen.codex || {}; }
const saveSeen = () => writeAtomic(file('sources-seen.json'), JSON.stringify(seen));
const send = (ch, data) => { if (win && !win.isDestroyed() && ready) win.webContents.send(ch, data); };

/* every request must come from our own page */
function handle(ch, fn) { ipcMain.handle(ch, (ev, ...a) => { const u = ev.senderFrame && ev.senderFrame.url || ''; if (!u.startsWith('file://')) throw new Error('refused'); return fn(...a); }); }

/* ---------- the window ---------- */
function createWindow() {
  win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 960, minHeight: 620,
    title: 'Wit', autoHideMenuBar: true, show: false,
    // On a Mac the window is see-through and the page paints no background of its own, so the desktop shows through,
    // blurred by the system: lightly (Clear) or densely (Frosted), or not at all (Solid; the page paints it). The title bar is hidden
    // so the traffic lights sit inside the sidebar.
    ...(MAC ? { titleBarStyle: 'hidden', trafficLightPosition: { x: 20, y: 20 }, transparent: true, hasShadow: true, visualEffectState: 'active', backgroundColor: '#00000000' } : { backgroundColor: '#000000' }),
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false, preload: path.join(__dirname, 'preload.js') }
  });
  applyGlass();
  win.once('ready-to-show', () => win.show());
  win.loadFile(path.join(__dirname, 'app', 'index.html'), MAC ? { hash: 'brain', query: { vibrancy: '1', glass: S.glass } } : { hash: 'brain' });
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (event, url) => { if (!url.startsWith('file:')) event.preventDefault(); });
  win.on('closed', () => { win = null; ready = false; });
}

/* ---------- the record, mirrored for connected apps ---------- */
handle('app:info', () => ({ desktop: true, mas: MAS, platform: process.platform, version: app.getVersion(), dataDir: DATA(), keyStorage: safeStorage.isEncryptionAvailable() ? 'keychain' : 'session' }));
// the page's light or dark chrome decides whether the glass behind it is light or dark
const GLASS = ['clear', 'frosted', 'solid'];
// Clear: the system's lighter blur; Frosted: its denser one; Solid: none (the page paints the window)
const VIBRANCY = { clear: 'fullscreen-ui', frosted: 'under-window', solid: null };
function applyGlass() { if (MAC && win && !win.isDestroyed() && win.setVibrancy) win.setVibrancy(Object.prototype.hasOwnProperty.call(VIBRANCY, S.glass) ? VIBRANCY[S.glass] : VIBRANCY.clear); }
handle('app:glass', v => { if (GLASS.includes(v) && v !== S.glass) { S.glass = v; saveSettings(); applyGlass(); } return GLASS.includes(S.glass) ? S.glass : 'clear'; });
handle('app:theme', v => { nativeTheme.themeSource = v === 'light' ? 'light' : 'dark'; return nativeTheme.themeSource; });
handle('app:ready', () => { ready = true; setTimeout(() => { scanSources(); checkInbox(); for (const o of pendingOffers.values()) send('exports:found', o); }, 1500); return true; });
handle('record:save', json => { if (typeof json !== 'string' || json.length > 300e6) throw new Error('bad record'); writeAtomic(file('record.json'), json); return true; });
handle('record:clear', () => { try { fs.unlinkSync(file('record.json')); } catch (e) { /* none */ } return true; });

/* ---------- notes that connected apps add: inbox.jsonl, filed by the page ---------- */
const INBOX = () => file('inbox.jsonl'), TAKEN = () => file('inbox.taking.jsonl');
function checkInbox() { try { if (fs.statSync(INBOX()).size > 0 || fs.existsSync(TAKEN())) send('inbox:ready', {}); } catch (e) { if (fs.existsSync(TAKEN())) send('inbox:ready', {}); } }
handle('inbox:take', () => {
  if (!fs.existsSync(TAKEN())) { try { fs.renameSync(INBOX(), TAKEN()); } catch (e) { return { token: null, notes: [] }; } }
  const notes = fs.readFileSync(TAKEN(), 'utf8').split('\n').map(l => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(n => n && typeof n.text === 'string' && n.text.trim());
  return { token: 'inbox', notes };
});
handle('inbox:ack', () => { try { fs.unlinkSync(TAKEN()); } catch (e) { /* gone */ } checkInbox(); return true; });

/* ---------- Claude Code and Codex sessions ---------- */
const inflight = {};
/* In the App Store build the folders come from the person: picked once, kept as security-scoped bookmarks, opened again
   at every start. The real home folder is the one in the account, not the sandbox's own. */
const ENV_OF = { claudeCode: 'CLAUDE_CONFIG_DIR', codex: 'CODEX_HOME' }, INNER = { claudeCode: 'projects', codex: 'sessions' }, opened = {};
const realHome = () => { try { return os.userInfo().homedir; } catch (e) { return os.homedir(); } };
function openFolder(id) {
  const f = S.folders && S.folders[id]; if (!f || !f.path) return false; if (opened[id]) return true;
  if (f.bookmark && app.startAccessingSecurityScopedResource) { try { opened[id] = app.startAccessingSecurityScopedResource(f.bookmark) || true; } catch (e) { return false; } } else opened[id] = true;
  return true;
}
function srcEnv() {
  if (!MAS) return process.env;
  const env = {}; for (const id of Object.keys(ENV_OF)) { const f = S.folders && S.folders[id]; env[ENV_OF[id]] = f && f.path && openFolder(id) ? f.home : path.join(os.tmpdir(), 'wit-no-folder-' + id); }
  return env;
}
function sourceStatus() { const env = srcEnv(), out = {}; for (const id of Object.keys(sources.SOURCES)) { const c = sources.count(id, env), f = S.folders && S.folders[id]; out[id] = Object.assign(c, { on: !!S.sources[id], filed: Object.keys(seen[id] || {}).length, waiting: !!inflight[id], pick: MAS, picked: !!(f && f.path), suggest: path.join(realHome(), id === 'codex' ? '.codex' : '.claude') }); } return out; }
function scanSources(force) {
  if (!ready) return 0; let sent = 0;
  for (const id of Object.keys(sources.SOURCES)) {
    if (!S.sources[id]) continue;
    if (inflight[id] && !force && Date.now() - inflight[id] < 120000) continue;          // the page is still filing the last batch
    let r; try { r = sources.scan(id, seen[id], srcEnv(), 300); } catch (e) { continue; }
    if (!r.items.length) { if (Object.keys(r.stamps).length) { Object.assign(seen[id], r.stamps); saveSeen(); } continue; }
    inflight[id] = Date.now(); sent += r.items.length;
    send('sources:items', { id, label: r.label, items: r.items, stamps: r.stamps, more: r.changed > r.items.length });
  }
  return sent;
}
let srcTimer = null, srcWatchers = [], srcDebounce = 0;
function watchSources() {
  for (const w of srcWatchers) try { w.close(); } catch (e) { /* closed */ } srcWatchers = []; clearInterval(srcTimer); srcTimer = null;
  const on = Object.keys(S.sources).filter(id => S.sources[id]); if (!on.length) return;
  srcTimer = setInterval(() => scanSources(), 120000);
  const env = srcEnv(); for (const id of on) { const dir = sources.SOURCES[id].dir(env); try { srcWatchers.push(fs.watch(dir, { recursive: true }, () => { clearTimeout(srcDebounce); srcDebounce = setTimeout(() => scanSources(), 6000); })); } catch (e) { /* no recursive watching here: the timer covers it */ } }
}
handle('sources:status', () => sourceStatus());
handle('sources:set', (id, on) => { if (!sources.SOURCES[id]) throw new Error('unknown source'); S.sources[id] = !!on; saveSettings(); watchSources(); if (on) setTimeout(() => scanSources(true), 200); return sourceStatus(); });
handle('sources:sync', () => scanSources(true));
/* the App Store build: the person shows Wit the folder once. Picking ~/.claude or its projects folder both work. */
handle('sources:pick', async id => {
  if (!sources.SOURCES[id]) throw new Error('unknown source');
  const name = id === 'codex' ? 'Codex' : 'Claude Code', dot = id === 'codex' ? '.codex' : '.claude';
  const r = await dialog.showOpenDialog(win, { title: 'Choose your ' + dot + ' folder', message: 'Wit reads your ' + name + ' sessions from this folder. It is in your home folder; press Command-Shift-Period if it is hidden.', buttonLabel: 'Use this folder', defaultPath: path.join(realHome(), dot), properties: ['openDirectory', 'showHiddenFiles'], securityScopedBookmarks: MAS });
  if (r.canceled || !r.filePaths || !r.filePaths[0]) return sourceStatus();
  const picked = r.filePaths[0], inner = path.basename(picked) === INNER[id];
  if (typeof opened[id] === 'function') try { opened[id](); } catch (e) { /* already let go */ } delete opened[id];
  S.folders = Object.assign({}, S.folders, { [id]: { path: picked, home: inner ? path.dirname(picked) : picked, bookmark: r.bookmarks && r.bookmarks[0] || null } });
  S.sources[id] = true; saveSettings(); watchSources(); setTimeout(() => scanSources(true), 200);
  return sourceStatus();
});
handle('sources:ack', (id, stamps) => { if (!sources.SOURCES[id] || !stamps || typeof stamps !== 'object') return false; Object.assign(seen[id], stamps); saveSeen(); delete inflight[id]; setTimeout(() => scanSources(), 1500); return true; });
handle('sources:forget', id => { if (!sources.SOURCES[id]) return false; seen[id] = {}; saveSeen(); delete inflight[id]; return sourceStatus(); });

/* ---------- ChatGPT and Claude exports arriving in Downloads ---------- */
const pendingOffers = new Map();
let dlWatcher = null; const dlTimers = new Map();
function offer(it) { const key = it.path + '|' + Math.round(it.mtimeMs); if (S.offered[key]) return; pendingOffers.set(it.path, it); send('exports:found', it); }
function look(p) { clearTimeout(dlTimers.get(p)); dlTimers.set(p, setTimeout(() => { dlTimers.delete(p); let a, b; try { a = fs.statSync(p).size; } catch (e) { return; } setTimeout(() => { try { b = fs.statSync(p).size; } catch (e) { return; } if (a !== b) return look(p); const it = exportsMod.inspect(p); if (it) offer(it); }, 1500); }, 1500)); }
function watchDownloads() {
  if (dlWatcher) { try { dlWatcher.close(); } catch (e) { /* closed */ } dlWatcher = null; }
  if (!S.watchDownloads) return;
  let dir = app.getPath('downloads'); try { dir = fs.realpathSync(dir); } catch (e) { /* as it is */ }
  try { dlWatcher = fs.watch(dir, (ev, name) => { if (name && /\.(zip|dms)$/i.test(name)) look(path.join(dir, name)); }); } catch (e) { /* the folder could not be watched */ }
  for (const it of exportsMod.recent(dir, Date.now() - 3 * 864e5)) offer(it);
}
handle('exports:status', () => ({ watching: !!S.watchDownloads, dir: app.getPath('downloads'), pages: exportsMod.PAGES, found: Array.from(pendingOffers.values()) }));
handle('exports:watch', on => { S.watchDownloads = !!on; saveSettings(); watchDownloads(); return { watching: S.watchDownloads }; });
handle('exports:open', kind => { const P = exportsMod.PAGES[kind]; if (!P) return false; if (!S.watchDownloads) { S.watchDownloads = true; saveSettings(); watchDownloads(); } shell.openExternal(P.url); return { watching: true }; });
handle('exports:read', p => { if (!pendingOffers.has(p)) throw new Error('Wit only opens exports it found for you.'); return new Uint8Array(fs.readFileSync(p)); });
handle('exports:done', p => { const it = pendingOffers.get(p); if (it) { S.offered[it.path + '|' + Math.round(it.mtimeMs)] = Date.now(); pendingOffers.delete(p); saveSettings(); } return true; });

/* ---------- connecting AI apps over MCP ---------- */
function mcpPath() { return app.isPackaged ? path.join(process.resourcesPath, 'app.asar.unpacked', 'mcp', 'wit-mcp.js') : path.join(__dirname, 'mcp', 'wit-mcp.js'); }
const spec = () => connect.serverSpec({ execPath: process.execPath, mcpPath: mcpPath(), dataDir: DATA() });
let httpServer = null;
function httpStatus() { return { on: !!httpServer, url: httpServer ? httpServer.url : null, port: S.http.port }; }
async function setHttp(on) {
  if (httpServer) { await httpServer.close(); httpServer = null; }
  S.http.on = !!on; if (on && !S.http.token) S.http.token = crypto.randomBytes(18).toString('hex'); saveSettings();
  if (on) { try { httpServer = await mcp.startHttp({ port: S.http.port, token: S.http.token, dir: DATA() }); } catch (e) { S.http.on = false; saveSettings(); throw new Error('Port ' + S.http.port + ' is busy. Close whatever is using it and try again.'); } }
  return httpStatus();
}
function findClaude() {
  return new Promise(resolve => {
    const home = os.homedir(), known = process.platform === 'win32' ? [] : [path.join(home, '.claude', 'local', 'claude'), path.join(home, '.local', 'bin', 'claude'), '/opt/homebrew/bin/claude', '/usr/local/bin/claude', path.join(home, '.npm-global', 'bin', 'claude')];
    for (const k of known) if (fs.existsSync(k)) return resolve(k);
    if (process.platform === 'win32') return execFile('where', ['claude'], { timeout: 5000 }, (e, out) => { const p = String(out || '').split(/\r?\n/).find(l => /\.exe$/i.test(l.trim())); resolve(e || !p ? null : p.trim()); });
    execFile(process.env.SHELL || '/bin/zsh', ['-ilc', 'command -v claude'], { timeout: 8000 }, (e, out) => { const p = String(out || '').trim().split('\n').pop(); resolve(!e && p && fs.existsSync(p) ? p : null); });
  });
}
async function clientsStatus() {
  if (MAS) return { mas: true, clients: Object.keys(connect.CLIENTS).map(id => ({ id, label: connect.CLIENTS[id].label, kind: connect.CLIENTS[id].kind, restart: connect.CLIENTS[id].restart, manual: true })), http: httpStatus() };
  const sp = spec(), loc = connect.locations(); const list = Object.keys(connect.CLIENTS).map(id => connect.status(id, sp, loc)); return { clients: list, http: httpStatus() };
}
handle('connect:status', () => clientsStatus());
const MANUAL = 'In the App Store version, Wit does not change other apps’ settings. Copy the setup below and paste it in yourself.';
handle('connect:install', async id => {
  if (!connect.CLIENTS[id]) throw new Error('unknown app');
  if (MAS) throw new Error(MANUAL);
  if (id === 'claudeCode') {
    const bin = await findClaude(); if (!bin) { const e = new Error('Wit could not find the claude command. Run the command below in a terminal instead.'); throw e; }
    const args = connect.claudeCodeArgs(spec());
    await new Promise(r => execFile(bin, args.remove, { timeout: 20000 }, () => r()));          // replace an older entry, if any
    await new Promise((res, rej) => execFile(bin, args.add, { timeout: 20000 }, (e, out, err) => e ? rej(new Error('claude said: ' + (String(err || out || e.message).trim().split('\n').pop()))) : res()));
  } else connect.install(id, spec());
  return clientsStatus();
});
handle('connect:remove', async id => {
  if (MAS) throw new Error(MANUAL);
  if (id === 'claudeCode') { const bin = await findClaude(); if (!bin) throw new Error('Wit could not find the claude command. Run: claude mcp remove --scope user wit'); await new Promise((res, rej) => execFile(bin, connect.claudeCodeArgs(spec()).remove, { timeout: 20000 }, e => e ? rej(new Error('claude could not remove it')) : res())); }
  else connect.remove(id, spec());
  return clientsStatus();
});
handle('connect:snippet', id => connect.snippet(id, spec()));
handle('connect:http', on => setHttp(on));
handle('connect:reveal', id => { if (MAS) return false; const L = connect.locations()[id]; if (L && fs.existsSync(L.file)) shell.showItemInFolder(L.file); return true; });

/* ---------- asking an AI, only when switched on ---------- */
function keyFor(p) { const k = S.ai.keys[p]; if (!k) return sessionKeys[p] || ''; try { return safeStorage.decryptString(Buffer.from(k, 'base64')); } catch (e) { return ''; } }
const sessionKeys = {};
function aiConfig() { return { provider: S.ai.provider, models: Object.assign({ anthropic: ai.PROVIDERS.anthropic.model, openai: ai.PROVIDERS.openai.model, local: ai.PROVIDERS.local.model }, S.ai.models), localBase: S.ai.localBase, hasKey: { anthropic: !!keyFor('anthropic'), openai: !!keyFor('openai'), local: !!keyFor('local') }, consent: !!S.ai.consent, keyStorage: safeStorage.isEncryptionAvailable() ? 'keychain' : 'session', providers: ai.PROVIDERS }; }
handle('ai:config', () => aiConfig());
handle('ai:save', c => {
  c = c || {};
  if (c.provider !== undefined) { if (c.provider !== 'off' && !ai.PROVIDERS[c.provider]) throw new Error('unknown provider'); S.ai.provider = c.provider; }
  if (c.model && c.forProvider && ai.PROVIDERS[c.forProvider]) S.ai.models[c.forProvider] = String(c.model).slice(0, 120);
  if (c.localBase !== undefined) { if (!ai.allowedBase('local', c.localBase)) throw new Error('A local model must be on this computer: http://localhost:…'); S.ai.localBase = c.localBase; }
  if (c.consent !== undefined) S.ai.consent = !!c.consent;
  saveSettings(); return aiConfig();
});
handle('ai:key', (p, key) => {
  if (!ai.PROVIDERS[p]) throw new Error('unknown provider');
  if (!key) { delete S.ai.keys[p]; delete sessionKeys[p]; }
  else if (safeStorage.isEncryptionAvailable()) { S.ai.keys[p] = safeStorage.encryptString(String(key).trim()).toString('base64'); }
  else sessionKeys[p] = String(key).trim();                    // no keychain on this system: kept until Wit closes
  saveSettings(); return aiConfig();
});
const asks = new Map();
handle('ai:ask', req => {
  const p = S.ai.provider; if (!ai.PROVIDERS[p]) throw new Error('Ask is off. Choose an AI first.');
  const id = String(req && req.id || crypto.randomUUID()), ctl = new AbortController(); asks.set(id, ctl);
  ai.ask({ provider: p, base: p === 'local' ? S.ai.localBase : undefined, model: S.ai.models[p] || ai.PROVIDERS[p].model, key: keyFor(p), system: String(req.system || ''), messages: Array.isArray(req.messages) ? req.messages : [], maxTokens: 1400, signal: ctl.signal, onText: t => send('ai:event', { id, type: 'text', text: t }) })
    .then(text => send('ai:event', { id, type: 'done', text }))
    .catch(e => send('ai:event', { id, type: ctl.signal.aborted ? 'stopped' : 'error', message: e && e.message || String(e) }))
    .finally(() => asks.delete(id));
  return id;
});
handle('ai:cancel', id => { const c = asks.get(id); if (c) c.abort(); return true; });
handle('open:external', url => { if (typeof url === 'string' && /^https:\/\//.test(url)) { shell.openExternal(url); return true; } return false; });

/* ---------- start ---------- */
app.whenReady().then(() => {
  loadSettings(); loadSeen();
  if (MAC && app.dock && !app.isPackaged) try { app.dock.setIcon(path.join(__dirname, 'build', 'icon.png')); } catch (e) { /* the packaged app has its own icon */ }
  // The page needs no network. Refuse every request it makes so nothing can leave this computer from it.
  // (The interface falls back to the system typefaces; everything else is inside the app.)
  session.defaultSession.webRequest.onBeforeRequest(
    { urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] },
    (details, callback) => callback({ cancel: true })
  );
  createWindow();
  if (MAS) for (const id of Object.keys(S.folders || {})) openFolder(id);
  watchSources(); watchDownloads();
  try { fs.mkdirSync(DATA(), { recursive: true }); fs.watch(DATA(), (ev, name) => { if (name === 'inbox.jsonl') { clearTimeout(watchSources.ib); watchSources.ib = setTimeout(checkInbox, 800); } }); } catch (e) { /* the timer below covers it */ }
  setInterval(checkInbox, 30000);
  if (S.http.on) setHttp(true).catch(() => { /* reported when the Connect page opens */ });
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
