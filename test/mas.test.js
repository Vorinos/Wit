/* The Mac App Store build: main.js in sandbox mode, against a stand-in for Electron. It never writes other apps'
   settings, and it reads Claude Code sessions only from the folder the person picked. */
'use strict';
const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), os = require('os'), path = require('path'), Module = require('module');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'wit-mas-')), userData = path.join(home, 'userData'), picked = path.join(home, 'elsewhere', '.claude');
process.env.WIT_MAS = '1'; process.env.HOME = home; process.resourcesPath = path.join(home, 'Wit.app', 'Contents', 'Resources'); delete process.env.CLAUDE_CONFIG_DIR; delete process.env.CODEX_HOME;
const handlers = {}, sent = [], dialogs = [], accessed = [];
const fakeElectron = {
  app: { whenReady: () => Promise.resolve(), getPath: k => k === 'userData' ? userData : k === 'downloads' ? path.join(home, 'Downloads') : home, isPackaged: true, getVersion: () => '0.4.0', on() {}, startAccessingSecurityScopedResource: b => { accessed.push(b); return () => {}; } },
  nativeTheme: { themeSource: 'system' },
  dialog: { showOpenDialog: async (w, o) => { dialogs.push(o); return { canceled: false, filePaths: [path.join(picked, 'projects')], bookmarks: ['bookmark-data'] }; } },
  BrowserWindow: class { setVibrancy() {} constructor() { this.webContents = { setWindowOpenHandler() {}, on() {}, send: (ch, d) => sent.push([ch, d]) }; } once() {} on() {} loadFile() {} isDestroyed() { return false; } static getAllWindows() { return [1]; } },
  shell: { openExternal() {}, showItemInFolder() { throw new Error('the App Store build should not reveal other apps’ files'); } },
  session: { defaultSession: { webRequest: { onBeforeRequest() {} } } },
  ipcMain: { handle: (ch, fn) => { handlers[ch] = fn; } },
  safeStorage: { isEncryptionAvailable: () => true, encryptString: s => Buffer.from(s), decryptString: b => b.toString() }
};
const orig = Module._load; Module._load = function (req, ...a) { return req === 'electron' ? fakeElectron : orig.call(this, req, ...a); };
const call = (ch, ...a) => handlers[ch]({ senderFrame: { url: 'file:///app/index.html' } }, ...a);
const until = async (fn, ms = 4000) => { const t = Date.now(); while (Date.now() - t < ms) { const v = fn(); if (v) return v; await new Promise(r => setTimeout(r, 25)); } throw new Error('timed out'); };

test('the App Store build stays inside its sandbox', async () => {
  try { await run(); } catch (e) { console.error(e); setTimeout(() => process.exit(1), 50); throw e; }   // main.js keeps timers running, so a failure must end the process itself
});
async function run() {
  require('../main.js'); await new Promise(r => setTimeout(r, 50));
  assert.equal((await call('app:info')).mas, true);

  // connecting apps: the setup to paste, never a write to another app's files
  fs.mkdirSync(path.join(home, '.cursor'), { recursive: true });
  const cs = await call('connect:status');
  assert.equal(cs.mas, true); assert.ok(cs.clients.every(c => c.manual)); assert.equal(cs.clients.length, 4);
  await assert.rejects(async () => call('connect:install', 'cursor'), /paste it in yourself/);
  await assert.rejects(async () => call('connect:remove', 'cursor'), /paste it in yourself/);
  assert.ok(!fs.existsSync(path.join(home, '.cursor', 'mcp.json')), 'nothing written');
  assert.equal(await call('connect:reveal', 'cursor'), false);
  assert.match(await call('connect:snippet', 'claudeDesktop'), /"mcpServers"/);

  // sessions: nothing is read until a folder is picked, then only from there
  const proj = path.join(picked, 'projects', '-x-demo'); fs.mkdirSync(proj, { recursive: true });
  fs.writeFileSync(path.join(proj, 'bbbb.jsonl'), JSON.stringify({ type: 'user', sessionId: 'bbbb', cwd: '/x/demo', timestamp: '2026-02-02T00:00:00Z', message: { role: 'user', content: 'ship it' } }) + '\n');
  fs.mkdirSync(path.join(home, '.claude', 'projects', '-y'), { recursive: true });
  fs.writeFileSync(path.join(home, '.claude', 'projects', '-y', 'cccc.jsonl'), JSON.stringify({ type: 'user', sessionId: 'cccc', message: { role: 'user', content: 'not this one' } }) + '\n');
  await call('app:ready');
  let st = await call('sources:status');
  assert.equal(st.claudeCode.pick, true); assert.equal(st.claudeCode.picked, false); assert.equal(st.claudeCode.exists, false, 'the home folder is not read without a pick');
  st = await call('sources:pick', 'claudeCode');
  assert.equal(dialogs[0].securityScopedBookmarks, true); assert.match(dialogs[0].defaultPath, /\.claude$/);
  assert.equal(st.claudeCode.picked, true); assert.equal(st.claudeCode.on, true); assert.equal(st.claudeCode.sessions, 1);
  assert.deepEqual(accessed, ['bookmark-data'], 'the bookmark is opened');
  const batch = await until(() => sent.find(s => s[0] === 'sources:items'));
  assert.deepEqual(batch[1].items.map(i => i.wit_id), ['claude-code:bbbb']);
  const saved = JSON.parse(fs.readFileSync(path.join(userData, 'settings.json'), 'utf8'));
  assert.equal(saved.folders.claudeCode.bookmark, 'bookmark-data'); assert.equal(saved.folders.claudeCode.home, picked);
  setTimeout(() => process.exit(0), 100);
}
