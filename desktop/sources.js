/* Chats that coding agents keep as files on this computer: Claude Code and Codex.
   Read in place, turned into the same shape the page's Reader already understands ({ title, create_time, messages }),
   with a stable id so a session that keeps growing is updated rather than added twice. Nothing here touches the network. */
'use strict';
const fs = require('fs'), path = require('path'), os = require('os'), zlib = require('zlib');

const SOURCES = {
  claudeCode: { id: 'claudeCode', label: 'Claude Code', src: 4, dir: (env = process.env) => path.join(env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'projects') },
  codex: { id: 'codex', label: 'Codex', src: 5, dir: (env = process.env) => path.join(env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'sessions') }
};
const MAX_FILE = 64 * 1024 * 1024, MAX_TEXT = 60000;

/* what the agents inject around the conversation: instructions, environment, slash-command plumbing, reminders */
const NOISE = /<(system-reminder|environment_context|user_instructions|command-name|command-message|command-args|local-command-stdout|local-command-stderr|local-command-caveat|user-prompt-submit-hook|ide_selection|ide_opened_file)>[\s\S]*?<\/\1>/g;
const clean = t => String(t || '').replace(NOISE, '').replace(/\n{3,}/g, '\n\n').trim();
function textOf(c) {
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map(b => typeof b === 'string' ? b : (b && (b.type === 'text' || b.type === 'input_text' || b.type === 'output_text') && typeof b.text === 'string') ? b.text : '').filter(Boolean).join('\n');
  if (c && typeof c.text === 'string') return c.text;
  return '';
}
const folderName = s => String(s || '').replace(/[\\/]+$/, '').split(/[\\/]/).pop().replace(/[^\p{L}\p{N} ._-]+/gu, ' ').trim().slice(0, 60) || 'Sessions';
const firstLine = t => t.split('\n').map(x => x.trim()).find(Boolean) || '';

function lines(text) { const out = []; for (const ln of text.split('\n')) { const s = ln.trim(); if (!s) continue; try { out.push(JSON.parse(s)); } catch (e) { /* a torn last line while the agent is still writing */ } } return out; }

/* ---------- Claude Code: ~/.claude/projects/<encoded cwd>/<session id>.jsonl ---------- */
function parseClaudeCode(text, file, mtimeMs) {
  let sid = path.basename(file).replace(/\.jsonl$/, ''), cwd = '', summary = '', first = NaN, size = 0;
  const msgs = [];
  for (const o of lines(text)) {
    if (o.type === 'summary' && typeof o.summary === 'string' && !summary) { summary = o.summary; continue; }
    if (o.type !== 'user' && o.type !== 'assistant') continue;
    if (o.isSidechain || o.isMeta || o.isCompactSummary) continue;
    if (o.cwd && !cwd) cwd = o.cwd; if (o.sessionId) sid = o.sessionId;
    const t = Date.parse(o.timestamp); if (!isNaN(t) && isNaN(first)) first = t;
    const m = o.message || {}, role = (m.role || o.type) === 'assistant' ? 'assistant' : 'user';
    const txt = clean(textOf(m.content)); if (!txt) continue;
    if (role === 'user' && /^(Caveat: The messages below|\[Request interrupted|This session is being continued from a previous conversation)/.test(txt)) continue;
    if (size > MAX_TEXT) continue; size += txt.length;
    msgs.push({ role, content: txt });
  }
  const you = msgs.find(m => m.role === 'user'); if (!you) return null;
  const project = cwd ? folderName(cwd) : folderName(path.basename(path.dirname(file)).replace(/^-/, '').split('-').pop());
  return { title: (summary || firstLine(you.content)).slice(0, 140), create_time: isNaN(first) ? mtimeMs : first, messages: msgs,
    wit_source: SOURCES.claudeCode.src, wit_id: 'claude-code:' + sid, wit_folder: 'Claude Code/' + project };
}

/* ---------- Codex: ~/.codex/sessions/YYYY/MM/DD/rollout-<time>-<uuid>.jsonl (older: one .json file) ---------- */
function parseCodex(text, file, mtimeMs) {
  let id = (path.basename(file).match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i) || [])[1] || path.basename(file).replace(/\.(jsonl|json)(\.zst)?$/, ''), cwd = '', first = NaN, size = 0;
  const msgs = [];
  let rows;
  const trimmed = text.trim();
  if (/\.json$/i.test(file) && trimmed.startsWith('{')) {            // the old single-file layout: { session: {...}, items: [...] }
    try { const o = JSON.parse(trimmed); rows = (o.items || []).map(x => ({ type: 'message_item', payload: x })); if (o.session) { if (o.session.id) id = o.session.id; first = Date.parse(o.session.timestamp); } } catch (e) { rows = lines(text); }
  } else rows = lines(text);
  for (const o of rows) {
    const t = Date.parse(o.timestamp); if (!isNaN(t) && isNaN(first)) first = t;
    if (o.type === 'session_meta' && o.payload) { if (o.payload.cwd) cwd = o.payload.cwd; if (o.payload.id) id = o.payload.id; const ts = Date.parse(o.payload.timestamp); if (!isNaN(ts)) first = ts; continue; }
    const item = (o.type === 'response_item' || o.type === 'message_item') ? o.payload : (o.type === 'message' ? o : null);
    if (!item || item.type !== 'message' || (item.role !== 'user' && item.role !== 'assistant')) continue;
    const txt = clean(textOf(item.content)); if (!txt) continue;
    if (size > MAX_TEXT) continue; size += txt.length;
    msgs.push({ role: item.role, content: txt });
  }
  const you = msgs.find(m => m.role === 'user'); if (!you) return null;
  return { title: firstLine(you.content).slice(0, 140), create_time: isNaN(first) ? mtimeMs : first, messages: msgs,
    wit_source: SOURCES.codex.src, wit_id: 'codex:' + id, wit_folder: 'Codex/' + (cwd ? folderName(cwd) : 'Sessions') };
}

/* ---------- finding the files ---------- */
function listClaudeCode(env) {
  const root = SOURCES.claudeCode.dir(env), out = [];
  let dirs; try { dirs = fs.readdirSync(root, { withFileTypes: true }); } catch (e) { return { root, exists: false, files: out }; }
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    let fl; try { fl = fs.readdirSync(path.join(root, d.name), { withFileTypes: true }); } catch (e) { continue; }
    for (const f of fl) if (f.isFile() && /\.jsonl$/.test(f.name) && !/^agent-/.test(f.name)) out.push(path.join(root, d.name, f.name));   // sub-agent transcripts are part of their parent session
  }
  return { root, exists: true, files: out };
}
function listCodex(env) {
  const root = SOURCES.codex.dir(env), out = [];
  if (!fs.existsSync(root)) return { root, exists: false, files: out };
  const walk = (dir, depth) => {
    let es; try { es = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
    for (const e of es) {
      const p = path.join(dir, e.name);
      if (e.isDirectory() && depth < 4) walk(p, depth + 1);
      else if (e.isFile() && /^rollout-.*\.(jsonl|json|jsonl\.zst)$/.test(e.name)) out.push(p);
    }
  };
  walk(root, 0);
  return { root, exists: true, files: out };
}
const LIST = { claudeCode: listClaudeCode, codex: listCodex }, PARSE = { claudeCode: parseClaudeCode, codex: parseCodex };

function readText(file) {
  const buf = fs.readFileSync(file);
  if (/\.zst$/.test(file)) { if (typeof zlib.zstdDecompressSync !== 'function') throw new Error('zstd'); return zlib.zstdDecompressSync(buf).toString('utf8'); }
  return buf.toString('utf8');
}

/* Look over one source. seen: { [file]: 'mtime:size' } of what the page has already filed.
   Returns the sessions that are new or have grown, and the stamps to hand back once they are filed. */
function scan(id, seen = {}, env = process.env, limit = 400) {
  const L = LIST[id](env), items = [], stamps = {}; let skipped = 0, changed = 0;
  for (const file of L.files) {
    let st; try { st = fs.statSync(file); } catch (e) { continue; }
    const stamp = st.mtimeMs + ':' + st.size;
    if (seen[file] === stamp) continue;
    if (st.size > MAX_FILE) { skipped++; stamps[file] = stamp; continue; }
    if (items.length >= limit) { changed++; continue; }        // the rest come in the next round
    changed++;
    let it = null;
    try { it = PARSE[id](readText(file), file, st.mtimeMs); } catch (e) { skipped++; }
    stamps[file] = stamp;
    if (it) items.push(it);
  }
  return { id, label: SOURCES[id].label, root: L.root, exists: L.exists, total: L.files.length, changed, items, stamps, skipped };
}
function count(id, env = process.env) { const L = LIST[id](env); return { id, label: SOURCES[id].label, root: L.root, exists: L.exists, sessions: L.files.length }; }

module.exports = { SOURCES, scan, count, parseClaudeCode, parseCodex, clean, textOf };
