#!/usr/bin/env node
/* Wit as an MCP server: lets Claude, ChatGPT, Codex, Cursor and any other MCP client read your Wit record and add notes to it.
   No dependencies. Speaks MCP over stdio (what Claude Desktop, Claude Code, Codex and Cursor launch) and over Streamable HTTP
   (what ChatGPT needs, through a tunnel you run).

   It reads the copy of the record that the Wit desktop app keeps in its own folder (record.json), and writes new notes to
   inbox.jsonl in the same folder. Wit files them the next time it is open. It never changes the record itself.

   Run it:
     node wit-mcp.js                          stdio
     node wit-mcp.js --http 8765 --token ...  HTTP on 127.0.0.1:8765, served at /mcp/<token>
   Where the record is: WIT_DATA (a folder), or WIT_RECORD (a record.json file), or the Wit app's own folder. */
'use strict';
const fs = require('fs'), path = require('path'), os = require('os'), http = require('http'), crypto = require('crypto');

const VERSION = '0.3.1';
const PROTOCOLS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];

/* ---------- where the record lives ---------- */
function dataDir(env = process.env) {
  if (env.WIT_DATA) return env.WIT_DATA;
  if (env.WIT_RECORD) return path.dirname(env.WIT_RECORD);
  const home = os.homedir();
  if (process.platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'Wit');
  if (process.platform === 'win32') return path.join(env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Wit');
  return path.join(env.XDG_CONFIG_HOME || path.join(home, '.config'), 'Wit');
}
const recordFile = (dir, env = process.env) => env.WIT_RECORD || path.join(dir, 'record.json');

/* ---------- reading the record, kept warm while it does not change ---------- */
const STOP = new Set('a an the and or but if of to in on at by for with from as is are was were be been being it its this that these those i you he she we they me my your our their not no do does did have has had will would can could should may might just so than too very into about what which who how when where why there here also'.split(' '));
const tok = s => (String(s || '').toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'’+#.-]*/gu) || []).map(w => w.replace(/[.'’-]+$/, '')).filter(w => w.length > 1 && !STOP.has(w));
let cache = null;
function load(dir, env) {
  const p = recordFile(dir, env); let st;
  try { st = fs.statSync(p); } catch (e) { return null; }
  if (cache && cache.path === p && cache.mtime === st.mtimeMs && cache.size === st.size) return cache;
  let rec;
  try { rec = JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return cache && cache.path === p ? cache : null; }   // caught mid-write: keep the last good copy
  const entries = Array.isArray(rec.entries) ? rec.entries.filter(e => e && typeof e.title === 'string') : [];
  entries.forEach((e, i) => { if (!e.id) e.id = 'n' + i; e._t = Date.parse(e.date) || 0; });
  const byId = new Map(entries.map((e, i) => [e.id, i]));
  const docs = entries.map(e => {
    const tf = new Map(), add = (s, w) => { for (const t of tok(s)) tf.set(t, (tf.get(t) || 0) + w); };
    add(e.title, 3); add((e.tags || []).join(' '), 2); add(e.folder, 1); add(e.text, 1);
    let len = 0; tf.forEach(v => { len += v; }); return { tf, len };
  });
  const df = new Map(); for (const d of docs) for (const t of d.tf.keys()) df.set(t, (df.get(t) || 0) + 1);
  const avg = docs.reduce((s, d) => s + d.len, 0) / (docs.length || 1);
  cache = { path: p, mtime: st.mtimeMs, size: st.size, rec, entries, byId, docs, df, avg };
  return cache;
}

/* ---------- search: BM25 over title, tags, folder and text ---------- */
function matches(e, o) {
  if (o.source && !String(e.source || '').toLowerCase().includes(String(o.source).toLowerCase())) return false;
  if (o.folder && !String(e.folder || '').toLowerCase().includes(String(o.folder).toLowerCase())) return false;
  if (o.kind && String(e.kind || '').toLowerCase() !== String(o.kind).toLowerCase()) return false;
  if (o.since) { const t = Date.parse(o.since); if (!isNaN(t) && e._t < t) return false; }
  if (o.until) { const t = Date.parse(o.until); if (!isNaN(t) && e._t > t + 864e5 - 1) return false; }
  return true;
}
function snippet(text, terms, n = 280) {
  const t = String(text || '').replace(/\s+/g, ' ').trim(); if (t.length <= n) return t;
  const low = t.toLowerCase(); let at = -1;
  for (const w of terms) { const i = low.indexOf(w); if (i >= 0 && (at < 0 || i < at)) at = i; }
  const start = Math.max(0, (at < 0 ? 0 : at) - Math.floor(n / 3));
  return (start ? '… ' : '') + t.slice(start, start + n).replace(/\s+\S*$/, '') + ' …';
}
function rank(c, query, o = {}) {
  const terms = tok(query), out = [];
  if (!terms.length) { c.entries.forEach((e, i) => { if (matches(e, o)) out.push([i, e._t]); }); out.sort((a, b) => b[1] - a[1]); return { terms, hits: out }; }
  const N = c.entries.length, k1 = 1.2, b = 0.75, phrase = String(query).toLowerCase().trim();
  c.docs.forEach((d, i) => {
    const e = c.entries[i]; if (!matches(e, o)) return;
    let s = 0;
    for (const w of terms) { const f = d.tf.get(w); if (!f) continue; const n = c.df.get(w) || 0, idf = Math.log(1 + (N - n + 0.5) / (n + 0.5)); s += idf * f * (k1 + 1) / (f + k1 * (1 - b + b * d.len / (c.avg || 1))); }
    if (s > 0 && phrase.length > 3 && String(e.title).toLowerCase().includes(phrase)) s *= 1.6;
    if (s > 0) out.push([i, s]);
  });
  out.sort((a, b2) => b2[1] - a[1]);
  return { terms, hits: out };
}
const pub = (e, terms) => ({ id: e.id, title: e.title, date: e.date ? String(e.date).slice(0, 10) : undefined, folder: e.folder || undefined, source: e.source || undefined, kind: e.kind || undefined, snippet: snippet(e.text, terms), url: 'wit://entry/' + encodeURIComponent(e.id) });

/* ---------- the tools ---------- */
const RO = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
const TOOLS = [
  { name: 'search', title: 'Search my Wit record',
    description: 'Search the user\'s own notes and AI chat history kept in Wit (Markdown notes, Obsidian vaults, ChatGPT, Claude, Claude Code and Codex conversations). Returns the best-matching entries with an id, title, date, folder, source and a snippet. Use fetch with an id to read an entry in full. An empty query lists the newest entries.',
    inputSchema: { type: 'object', properties: {
      query: { type: 'string', description: 'Words to look for. Leave empty for the newest entries.' },
      limit: { type: 'integer', minimum: 1, maximum: 25, description: 'How many results (default 8).' },
      source: { type: 'string', description: 'Only this source, e.g. "ChatGPT", "Claude", "Claude Code", "Codex", "Your notes".' },
      folder: { type: 'string', description: 'Only entries whose folder contains this text.' },
      since: { type: 'string', description: 'Only entries on or after this date (YYYY-MM-DD).' },
      until: { type: 'string', description: 'Only entries on or before this date (YYYY-MM-DD).' } } },
    annotations: RO },
  { name: 'fetch', title: 'Read one entry',
    description: 'Read one entry from the user\'s Wit record in full: its text, date, folder, source, tags and the titles of entries linked to it. Takes an id from search.',
    inputSchema: { type: 'object', properties: { id: { type: 'string', description: 'The entry id, from search.' } }, required: ['id'] },
    annotations: RO },
  { name: 'overview', title: 'Overview of my record',
    description: 'A summary of the user\'s whole Wit record: how many entries, the date range, counts by source, by top-level space and by year, the most common tags, and the newest titles. Good for questions about the shape of their thinking over time.',
    inputSchema: { type: 'object', properties: {} }, annotations: RO },
  { name: 'timeline', title: 'When I wrote about something',
    description: 'Count the user\'s entries over time, optionally only those matching a query, source or folder. Answers questions like "when was I most into X" or "how has my use of ChatGPT changed".',
    inputSchema: { type: 'object', properties: {
      query: { type: 'string', description: 'Only entries matching these words.' },
      by: { type: 'string', enum: ['year', 'month', 'week'], description: 'Bucket size (default month).' },
      source: { type: 'string' }, folder: { type: 'string' } } },
    annotations: RO },
  { name: 'add_note', title: 'Add a note to Wit',
    description: 'Save a new note into the user\'s Wit record, for example a summary of this conversation or a decision they made. Wit dates, tags and files it the next time it is open. Only do this when the user asks you to save something to Wit.',
    inputSchema: { type: 'object', properties: {
      title: { type: 'string', description: 'A short title.' },
      text: { type: 'string', description: 'The note, in Markdown.' },
      folder: { type: 'string', description: 'Optional folder, like "Projects/Wit". Leave empty to let Wit file it.' } }, required: ['text'] },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false } }
];

function bucket(t, by) {
  const d = new Date(t); if (isNaN(d)) return 'unknown';
  if (by === 'year') return String(d.getUTCFullYear());
  if (by === 'week') { const day = (d.getUTCDay() + 6) % 7, m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day)); return m.toISOString().slice(0, 10); }
  return d.toISOString().slice(0, 7);
}
const countBy = (arr, key, top) => { const m = new Map(); for (const x of arr) { const k = key(x); if (k == null || k === '') continue; m.set(k, (m.get(k) || 0) + 1); } const out = Array.from(m, ([k, n]) => ({ name: k, entries: n })).sort((a, b) => b.entries - a.entries); return top ? out.slice(0, top) : out; };

const NO_RECORD = 'Wit has no record to read yet. Open the Wit desktop app and add notes or connect your chats; it keeps a copy here for connected apps.';
function callTool(name, args, ctx) {
  args = args || {};
  const dir = ctx.dir, env = ctx.env || process.env;
  if (name === 'add_note') {
    const text = String(args.text || '').trim(); if (!text) throw new Error('A note needs some text.');
    const note = { title: String(args.title || '').trim().slice(0, 200), text: text.slice(0, 100000), folder: String(args.folder || '').trim().slice(0, 200) || undefined, at: new Date().toISOString(), from: ctx.client || 'an MCP client' };
    fs.mkdirSync(dir, { recursive: true }); fs.appendFileSync(path.join(dir, 'inbox.jsonl'), JSON.stringify(note) + '\n');
    return { saved: true, message: 'Saved to Wit\'s inbox. Wit will date, tag and file it the next time it is open.' };
  }
  const c = load(dir, env); if (!c) throw new Error(NO_RECORD);
  if (name === 'search') {
    const limit = Math.max(1, Math.min(25, parseInt(args.limit, 10) || 8));
    const { terms, hits } = rank(c, args.query || '', args);
    return { total: hits.length, results: hits.slice(0, limit).map(([i]) => pub(c.entries[i], terms)) };
  }
  if (name === 'fetch') {
    const id = String(args.id || '').replace(/^wit:\/\/entry\//, ''), i = c.byId.get(decodeURIComponent(id));
    if (i == null) throw new Error('No entry with id ' + id + '. Use search to find ids.');
    const e = c.entries[i];
    return { id: e.id, title: e.title, text: e.text || '', url: 'wit://entry/' + encodeURIComponent(e.id),
      metadata: { date: e.date, folder: e.folder, source: e.source, kind: e.kind, tags: e.tags || [], words: e.words, links: (e.links || []).map(l => { const j = c.byId.get(l); return j == null ? null : { id: l, title: c.entries[j].title }; }).filter(Boolean) } };
  }
  if (name === 'overview') {
    const E = c.entries, ts = E.map(e => e._t).filter(Boolean).sort((a, b) => a - b), tags = [];
    for (const e of E) for (const t of e.tags || []) tags.push(t);
    return { name: c.rec.name || 'Your record', entries: E.length, savedAt: c.rec.savedAt, first: ts.length ? new Date(ts[0]).toISOString().slice(0, 10) : null, latest: ts.length ? new Date(ts[ts.length - 1]).toISOString().slice(0, 10) : null,
      bySource: countBy(E, e => e.source || 'Your notes'), bySpace: countBy(E, e => String(e.folder || 'Inbox').split('/')[0], 16), byYear: countBy(E, e => e._t ? new Date(e._t).getUTCFullYear() : null).sort((a, b) => a.name - b.name),
      topTags: countBy(tags.map(t => ({ t })), x => x.t, 20), newest: E.slice().sort((a, b) => b._t - a._t).slice(0, 8).map(e => ({ id: e.id, title: e.title, date: String(e.date || '').slice(0, 10) })) };
  }
  if (name === 'timeline') {
    const by = ['year', 'month', 'week'].includes(args.by) ? args.by : 'month';
    const { hits } = rank(c, args.query || '', args), m = new Map();
    for (const [i] of hits) { const k = bucket(c.entries[i]._t, by); m.set(k, (m.get(k) || 0) + 1); }
    const series = Array.from(m, ([period, entries]) => ({ period, entries })).sort((a, b) => a.period < b.period ? -1 : 1);
    const peak = series.reduce((p, x) => (!p || x.entries > p.entries ? x : p), null);
    return { by, query: args.query || null, matching: hits.length, peak, series };
  }
  throw new Error('Unknown tool ' + name);
}

/* ---------- JSON-RPC ---------- */
const INSTRUCTIONS = 'Wit holds this user\'s own notes and AI chat history. Use search, then fetch, to ground answers in what they actually wrote; cite entry titles and dates. Use overview and timeline for questions about patterns over time. Only use add_note when the user asks to save something to Wit.';
function handle(msg, ctx) {
  if (!msg || typeof msg !== 'object' || msg.jsonrpc !== '2.0') return { jsonrpc: '2.0', id: msg && msg.id != null ? msg.id : null, error: { code: -32600, message: 'Invalid request' } };
  const isNote = msg.id === undefined || msg.id === null; if (!msg.method) return null;          // a response from the client, or a stray note
  const ok = result => isNote ? null : { jsonrpc: '2.0', id: msg.id, result }, fail = (code, message) => isNote ? null : { jsonrpc: '2.0', id: msg.id, error: { code, message } };
  const p = msg.params || {};
  switch (msg.method) {
    case 'initialize':
      ctx.client = p.clientInfo && p.clientInfo.name || ctx.client;
      ctx.protocol = PROTOCOLS.includes(p.protocolVersion) ? p.protocolVersion : PROTOCOLS[0];
      return ok({ protocolVersion: ctx.protocol, capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'wit', title: 'Wit', version: VERSION }, instructions: INSTRUCTIONS });
    case 'ping': return ok({});
    case 'tools/list': return ok({ tools: TOOLS });
    case 'resources/list': return ok({ resources: [] });
    case 'resources/templates/list': return ok({ resourceTemplates: [] });
    case 'prompts/list': return ok({ prompts: [] });
    case 'tools/call': {
      const t = TOOLS.find(x => x.name === p.name); if (!t) return fail(-32602, 'Unknown tool: ' + p.name);
      try { const out = callTool(p.name, p.arguments, ctx); return ok({ content: [{ type: 'text', text: JSON.stringify(out, null, 1) }], structuredContent: out, isError: false }); }
      catch (e) { return ok({ content: [{ type: 'text', text: String(e && e.message || e) }], isError: true }); }
    }
    default:
      if (isNote) return null;
      return fail(-32601, 'Method not found: ' + msg.method);
  }
}
function handleBody(body, ctx) {
  if (Array.isArray(body)) { const out = body.map(m => handle(m, ctx)).filter(Boolean); return out.length ? out : null; }
  return handle(body, ctx);
}

/* ---------- stdio ---------- */
function serveStdio(opts = {}) {
  const ctx = { dir: opts.dir || dataDir(), env: process.env, client: null }, input = opts.input || process.stdin, output = opts.output || process.stdout;
  let buf = '';
  input.setEncoding && input.setEncoding('utf8');
  input.on('data', chunk => {
    buf += chunk; let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (!line) continue;
      let msg; try { msg = JSON.parse(line); } catch (e) { output.write(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }) + '\n'); continue; }
      const res = handleBody(msg, ctx); if (res) output.write(JSON.stringify(res) + '\n');
    }
  });
  input.on('end', () => { if (!opts.keepAlive) process.exit(0); });
  return ctx;
}

/* ---------- Streamable HTTP, for ChatGPT through a tunnel ---------- */
function startHttp(opts = {}) {
  const host = opts.host || '127.0.0.1', port = opts.port || 8765, token = opts.token || crypto.randomBytes(18).toString('hex'), base = '/mcp/' + token;
  const sessions = new Map();
  const server = http.createServer((req, res) => {
    const send = (code, body, headers) => { res.writeHead(code, Object.assign({ 'Cache-Control': 'no-store' }, body ? { 'Content-Type': 'application/json' } : {}, headers || {})); res.end(body ? JSON.stringify(body) : undefined); };
    const url = (req.url || '').split('?')[0], auth = req.headers.authorization || '';
    const authed = url === base || url === base + '/' || (url === '/mcp' && auth === 'Bearer ' + token);
    if (!authed) return send(404, { error: 'Not found' });
    const origin = req.headers.origin;                          // browsers must not be able to reach this from other sites
    if (origin && !/^https:\/\/(chatgpt\.com|chat\.openai\.com)$/.test(origin)) return send(403, { error: 'Origin not allowed' });
    if (req.method === 'GET') return send(405, null, { Allow: 'POST, DELETE' });
    if (req.method === 'DELETE') { sessions.delete(req.headers['mcp-session-id']); return send(200, {}); }
    if (req.method !== 'POST') return send(405, null, { Allow: 'POST, DELETE' });
    let raw = ''; req.setEncoding('utf8');
    req.on('data', d => { raw += d; if (raw.length > 2e6) { req.destroy(); } });
    req.on('end', () => {
      let body; try { body = JSON.parse(raw); } catch (e) { return send(400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); }
      const sid = req.headers['mcp-session-id'];
      let ctx = sid && sessions.get(sid);
      const init = (Array.isArray(body) ? body : [body]).some(m => m && m.method === 'initialize');
      let newSid = null;
      if (!ctx) { ctx = { dir: opts.dir || dataDir(), env: process.env, client: null }; if (init) { newSid = crypto.randomUUID(); sessions.set(newSid, ctx); if (sessions.size > 200) sessions.delete(sessions.keys().next().value); } }
      const out = handleBody(body, ctx);
      if (!out) return send(202, null, newSid ? { 'Mcp-Session-Id': newSid } : null);
      send(200, out, newSid ? { 'Mcp-Session-Id': newSid } : null);
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => { server.removeListener('error', reject); resolve({ server, port: server.address().port, token, url: 'http://' + host + ':' + server.address().port + base, close: () => new Promise(r => server.close(() => r())) }); });
  });
}

module.exports = { VERSION, TOOLS, dataDir, handle, handleBody, callTool, serveStdio, startHttp, _tok: tok };

if (require.main === module) {
  const a = process.argv.slice(2), arg = k => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : undefined; };
  if (a.includes('--help')) { process.stderr.write('wit-mcp ' + VERSION + '\n  stdio:  node wit-mcp.js\n  http:   node wit-mcp.js --http [port] [--token T]\nRecord folder: ' + dataDir() + '\n'); process.exit(0); }
  if (a.includes('--http')) {
    const port = parseInt(arg('--http'), 10) || 8765;
    startHttp({ port, token: arg('--token') || process.env.WIT_MCP_TOKEN }).then(s => process.stderr.write('Wit MCP server on ' + s.url + '\n'), e => { process.stderr.write('Could not start: ' + e.message + '\n'); process.exit(1); });
  } else serveStdio();
}
