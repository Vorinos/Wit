/* Loads main.js against a stand-in for Electron and drives it through its IPC handlers, the way the page would. */
'use strict';
const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), os = require('os'), path = require('path'), http = require('http'), Module = require('module');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'wit-main-')), userData = path.join(home, 'userData'), downloads = path.join(home, 'Downloads');
fs.mkdirSync(downloads, { recursive: true });
process.env.HOME = home; process.env.USERPROFILE = home; process.env.CLAUDE_CONFIG_DIR = path.join(home, '.claude'); process.env.CODEX_HOME = path.join(home, '.codex'); process.env.XDG_CONFIG_HOME = path.join(home, '.config');
const handlers = {}, sent = [], opened = [];
const fakeElectron = {
  app: { whenReady: () => Promise.resolve(), getPath: k => k === 'userData' ? userData : k === 'downloads' ? downloads : home, isPackaged: false, getVersion: () => '0.4.0', on() {} },
  nativeTheme: { themeSource: 'system' },
  BrowserWindow: class { setVibrancy(v) { fakeElectron._vib = v; } constructor(o) { this.o = o; this.webContents = { setWindowOpenHandler() {}, on() {}, send: (ch, d) => sent.push([ch, d]) }; } once() {} on() {} loadFile() {} isDestroyed() { return false; } static getAllWindows() { return [1]; } },
  shell: { openExternal: u => opened.push(u), showItemInFolder() {} },
  session: { defaultSession: { webRequest: { onBeforeRequest(f, cb) { fakeElectron._blocked = cb; } } } },
  ipcMain: { handle: (ch, fn) => { handlers[ch] = fn; } },
  safeStorage: { isEncryptionAvailable: () => true, encryptString: s => Buffer.from('enc:' + s), decryptString: b => b.toString().replace(/^enc:/, '') }
};
const orig = Module._load; Module._load = function (req, ...a) { return req === 'electron' ? fakeElectron : orig.call(this, req, ...a); };
const ev = { senderFrame: { url: 'file:///app/index.html' } };
const call = (ch, ...a) => handlers[ch](ev, ...a);
const until = async (fn, ms = 4000) => { const t = Date.now(); while (Date.now() - t < ms) { const v = fn(); if (v) return v; await new Promise(r => setTimeout(r, 25)); } throw new Error('timed out'); };

test('main.js wires the page to everything', async () => {
  require('../main.js'); await new Promise(r => setTimeout(r, 50));
  assert.ok(handlers['record:save'] && handlers['ai:ask'] && handlers['connect:install']);
  await assert.rejects(async () => handlers['app:info']({ senderFrame: { url: 'https://evil.example' } }), /refused/);
  assert.equal(await call('app:theme', 'light'), 'light'); assert.equal(fakeElectron.nativeTheme.themeSource, 'light');
  assert.equal(await call('app:theme', 'anything else'), 'dark');
  assert.equal(await call('app:glass'), 'clear'); assert.equal(await call('app:glass', 'bogus'), 'clear');
  assert.equal(await call('app:glass', 'frosted'), 'frosted'); assert.equal(await call('app:glass', 'solid'), 'solid');
  // the page itself still has no network
  let cancelled; fakeElectron._blocked({ url: 'https://example.com' }, r => { cancelled = r.cancel; }); assert.equal(cancelled, true);

  // the record mirror that MCP reads
  await call('record:save', JSON.stringify({ name: 'Your record', entries: [{ id: 'e1', title: 'Hello', date: '2026-01-01', text: 'hi there' }] }));
  assert.equal(JSON.parse(fs.readFileSync(path.join(userData, 'record.json'), 'utf8')).entries[0].id, 'e1');

  // Claude Code sessions flow to the page once switched on, and not again once filed
  const proj = path.join(home, '.claude', 'projects', '-x-demo'); fs.mkdirSync(proj, { recursive: true });
  fs.writeFileSync(path.join(proj, 'aaaa.jsonl'), JSON.stringify({ type: 'user', sessionId: 'aaaa', cwd: '/x/demo', timestamp: '2026-02-02T00:00:00Z', message: { role: 'user', content: 'how do I deploy' } }) + '\n');
  await call('app:ready');
  const st = await call('sources:set', 'claudeCode', true); assert.equal(st.claudeCode.on, true); assert.equal(st.claudeCode.sessions, 1);
  const batch = await until(() => sent.find(s => s[0] === 'sources:items'));
  assert.equal(batch[1].items[0].wit_id, 'claude-code:aaaa');
  await call('sources:ack', 'claudeCode', batch[1].stamps);
  sent.length = 0; assert.equal(await call('sources:sync'), 0, 'nothing new after filing');

  // an export landing in Downloads is offered, can be read, and is not offered twice
  const { execFileSync } = require('child_process'), zip = path.join(downloads, 'chatgpt-export.zip');
  execFileSync('python3', ['-I', '-c', 'import sys,zipfile\nz=zipfile.ZipFile(sys.argv[1],"w")\nz.writestr("conversations.json","[]")\nz.writestr("chat.html","x")\nz.close()', zip]);
  const w = await call('exports:open', 'chatgpt'); assert.equal(w.watching, true); assert.match(opened.pop(), /chatgpt\.com/);
  const found = await until(() => sent.find(s => s[0] === 'exports:found')); assert.equal(found[1].kind, 'chatgpt');
  assert.ok((await call('exports:read', zip)).length > 20);
  await assert.rejects(async () => call('exports:read', '/etc/passwd'), /only opens exports/);
  await call('exports:done', zip); assert.equal((await call('exports:status')).found.length, 0);

  // connecting apps writes their config files
  fs.mkdirSync(path.join(home, '.config', 'Claude'), { recursive: true }); fs.mkdirSync(path.join(home, '.cursor'), { recursive: true });
  let cs = await call('connect:install', process.platform === 'darwin' ? 'cursor' : 'claudeDesktop');
  assert.ok(cs.clients.find(c => c.connected && c.current));
  cs = await call('connect:install', 'codex'); assert.ok(cs.clients.find(c => c.id === 'codex').connected);
  assert.match(await call('connect:snippet', 'claudeCode'), /^claude mcp add-json --scope user wit /);
  const hs = await call('connect:http', true); assert.match(hs.url, /^http:\/\/127\.0\.0\.1:\d+\/mcp\/[0-9a-f]{36}$/);
  const r = await fetch(hs.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'search', arguments: { query: 'hello' } } }) });
  assert.equal((await r.json()).result.structuredContent.results[0].title, 'Hello');
  await call('connect:http', false);

  // Ask: off until chosen, then streams from the chosen provider only
  await assert.rejects(async () => call('ai:ask', { id: 'q0', system: 's', messages: [] }), /Ask is off/);
  const srv = await new Promise(res => { const s = http.createServer((req, rs) => { rs.writeHead(200, { 'content-type': 'text/event-stream' }); rs.write('data: {"choices":[{"delta":{"content":"From your notes: deploy with fly [1]."}}]}\n\ndata: [DONE]\n\n'); rs.end(); }); s.listen(0, '127.0.0.1', () => res(s)); });
  await assert.rejects(async () => call('ai:save', { localBase: 'http://example.com/v1' }), /this computer/);
  let cfg = await call('ai:save', { provider: 'local', localBase: 'http://127.0.0.1:' + srv.address().port + '/v1', model: 'qwen3', forProvider: 'local' });
  assert.equal(cfg.provider, 'local'); assert.equal(cfg.models.local, 'qwen3');
  cfg = await call('ai:key', 'anthropic', 'sk-ant-123'); assert.equal(cfg.hasKey.anthropic, true);
  assert.ok(!fs.readFileSync(path.join(userData, 'settings.json'), 'utf8').includes('sk-ant-123') || fs.readFileSync(path.join(userData, 'settings.json'), 'utf8').includes(Buffer.from('enc:sk-ant-123').toString('base64')), 'key stored encrypted');
  sent.length = 0; const id = await call('ai:ask', { id: 'q1', system: 's', messages: [{ role: 'user', content: 'how did I deploy?' }] });
  const done = await until(() => sent.find(s => s[0] === 'ai:event' && s[1].type === 'done' && s[1].id === id));
  assert.equal(done[1].text, 'From your notes: deploy with fly [1].');
  srv.close();

  // notes added by a connected app are handed to the page, then cleared once filed
  fs.appendFileSync(path.join(userData, 'inbox.jsonl'), JSON.stringify({ title: 'From Claude', text: 'Bake on Sundays.' }) + '\n');
  const ib = await call('inbox:take'); assert.equal(ib.notes[0].text, 'Bake on Sundays.');
  const again = await call('inbox:take'); assert.equal(again.notes.length, 1, 'still there until acknowledged');
  await call('inbox:ack', ib.token); assert.equal((await call('inbox:take')).notes.length, 0);
  setTimeout(() => process.exit(0), 100);
});
