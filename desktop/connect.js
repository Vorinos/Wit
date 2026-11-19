/* Putting Wit into other apps' MCP settings, and taking it out again.
   Each app keeps a config file; we add one entry named "wit", keep a backup of the file as it was, and never touch anything else. */
'use strict';
const fs = require('fs'), path = require('path'), os = require('os');

function locations(home = os.homedir(), env = process.env, platform = process.platform) {
  const appData = env.APPDATA || path.join(home, 'AppData', 'Roaming');
  const claudeDir = platform === 'darwin' ? path.join(home, 'Library', 'Application Support', 'Claude') : platform === 'win32' ? path.join(appData, 'Claude') : path.join(env.XDG_CONFIG_HOME || path.join(home, '.config'), 'Claude');
  const codexHome = env.CODEX_HOME || path.join(home, '.codex');
  return {
    claudeDesktop: { dir: claudeDir, file: path.join(claudeDir, 'claude_desktop_config.json') },
    cursor: { dir: path.join(home, '.cursor'), file: path.join(home, '.cursor', 'mcp.json') },
    codex: { dir: codexHome, file: path.join(codexHome, 'config.toml') },
    claudeCode: { dir: path.join(home, '.claude'), file: path.join(home, '.claude.json') }
  };
}
const CLIENTS = {
  claudeDesktop: { label: 'Claude Desktop', kind: 'json', restart: 'Quit and reopen Claude Desktop. Wit appears under the tools button in a new chat.' },
  claudeCode: { label: 'Claude Code', kind: 'cli', restart: 'Start a new Claude Code session, then type /mcp to see Wit.' },
  codex: { label: 'Codex', kind: 'toml', restart: 'Start a new Codex session (CLI, IDE extension or app), then type /mcp to see Wit.' },
  cursor: { label: 'Cursor', kind: 'json', restart: 'Open Cursor Settings, then MCP, and switch Wit on if it is off.' }
};

/* how to start the server: Wit's own binary, run as plain Node, so nobody needs Node installed */
function serverSpec({ execPath, mcpPath, dataDir, runAsNode = true }) {
  const env = { WIT_DATA: dataDir }; if (runAsNode) env.ELECTRON_RUN_AS_NODE = '1';
  return { command: execPath, args: [mcpPath], env };
}

function readJSON(file) {
  if (!fs.existsSync(file)) return {};
  const raw = fs.readFileSync(file, 'utf8'); if (!raw.trim()) return {};
  try { const o = JSON.parse(raw); if (!o || typeof o !== 'object' || Array.isArray(o)) throw new Error('not an object'); return o; }
  catch (e) { const err = new Error(path.basename(file) + ' is not valid JSON, so Wit left it alone. Fix or remove it, then try again.'); err.code = 'BADCONFIG'; throw err; }
}
function backup(file) { if (fs.existsSync(file)) { const b = file + '.wit-backup'; if (!fs.existsSync(b)) fs.copyFileSync(file, b); } }
function writeAtomic(file, text) { fs.mkdirSync(path.dirname(file), { recursive: true }); const tmp = file + '.wit-tmp'; fs.writeFileSync(tmp, text); fs.renameSync(tmp, file); }

/* ---------- JSON configs: Claude Desktop and Cursor ---------- */
function jsonInstall(file, spec) { const cfg = readJSON(file); cfg.mcpServers = cfg.mcpServers && typeof cfg.mcpServers === 'object' ? cfg.mcpServers : {}; cfg.mcpServers.wit = spec; backup(file); writeAtomic(file, JSON.stringify(cfg, null, 2) + '\n'); }
function jsonRemove(file) { if (!fs.existsSync(file)) return false; const cfg = readJSON(file); if (!cfg.mcpServers || !cfg.mcpServers.wit) return false; delete cfg.mcpServers.wit; backup(file); writeAtomic(file, JSON.stringify(cfg, null, 2) + '\n'); return true; }
function jsonEntry(file) { try { const cfg = readJSON(file); return cfg.mcpServers && cfg.mcpServers.wit || null; } catch (e) { return null; } }

/* ---------- TOML config: Codex ---------- */
const tomlStr = s => (!/['\r\n]/.test(s) ? "'" + s + "'" : JSON.stringify(s));
function tomlBlock(spec) {
  const env = Object.entries(spec.env || {}).map(([k, v]) => k + ' = ' + tomlStr(String(v))).join(', ');
  return '[mcp_servers.wit]\ncommand = ' + tomlStr(spec.command) + '\nargs = [' + spec.args.map(tomlStr).join(', ') + ']\n' + (env ? 'env = { ' + env + ' }\n' : '');
}
const isWitHeader = l => /^\s*\[\s*mcp_servers\s*\.\s*("wit"|'wit'|wit)\s*\]\s*(#.*)?$/.test(l);
const isWitSub = l => /^\s*\[{1,2}\s*mcp_servers\s*\.\s*("wit"|'wit'|wit)\s*\./.test(l);
function tomlStrip(text) {
  const out = []; let skipping = false;
  for (const l of text.split(/\r?\n/)) {
    if (isWitHeader(l) || isWitSub(l)) { skipping = true; continue; }
    if (skipping && /^\s*\[/.test(l)) skipping = false;
    if (!skipping) out.push(l);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '');
}
function tomlInstall(file, spec) { const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''; const kept = tomlStrip(text); backup(file); writeAtomic(file, (kept ? kept + '\n\n' : '') + tomlBlock(spec)); }
function tomlRemove(file) { if (!fs.existsSync(file)) return false; const text = fs.readFileSync(file, 'utf8'); const kept = tomlStrip(text); if (kept === text.replace(/\s+$/, '')) return false; backup(file); writeAtomic(file, kept ? kept + '\n' : ''); return true; }
function tomlEntry(file) {
  if (!fs.existsSync(file)) return null; const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  const i = lines.findIndex(isWitHeader); if (i < 0) return null;
  const body = []; for (let j = i + 1; j < lines.length && !/^\s*\[/.test(lines[j]); j++) body.push(lines[j]);
  const cmd = (body.join('\n').match(/^\s*command\s*=\s*(?:'([^']*)'|"((?:[^"\\]|\\.)*)")/m) || []);
  const args = body.join('\n').match(/^\s*args\s*=\s*\[([^\]]*)\]/m);
  return { command: cmd[1] != null ? cmd[1] : cmd[2] ? JSON.parse('"' + cmd[2] + '"') : undefined, args: args ? (args[1].match(/'[^']*'|"(?:[^"\\]|\\.)*"/g) || []).map(s => s[0] === "'" ? s.slice(1, -1) : JSON.parse(s)) : [] };
}

/* ---------- Claude Code: through its own CLI, so its state file is never written behind its back ---------- */
function claudeCodeArgs(spec) { return { add: ['mcp', 'add-json', '--scope', 'user', 'wit', JSON.stringify({ type: 'stdio', command: spec.command, args: spec.args, env: spec.env })], remove: ['mcp', 'remove', '--scope', 'user', 'wit'] }; }
const shQuote = s => /^[\w@%+=:,./-]+$/.test(s) ? s : "'" + String(s).replace(/'/g, "'\\''") + "'";
function claudeCodeCommand(spec) { return 'claude ' + claudeCodeArgs(spec).add.map(shQuote).join(' '); }
function claudeCodeEntry(file) { try { const cfg = readJSON(file); return cfg.mcpServers && cfg.mcpServers.wit || null; } catch (e) { return null; } }

/* ---------- one place to ask about any client ---------- */
function entryFor(id, loc) { const f = loc[id].file; return id === 'codex' ? tomlEntry(f) : id === 'claudeCode' ? claudeCodeEntry(f) : jsonEntry(f); }
function status(id, spec, loc = locations()) {
  const c = CLIENTS[id], L = loc[id], e = entryFor(id, loc);
  const current = !!e && e.command === spec.command && Array.isArray(e.args) && e.args[0] === spec.args[0];
  return { id, label: c.label, kind: c.kind, file: L.file, appFound: fs.existsSync(L.dir), connected: !!e, current, restart: c.restart };
}
function install(id, spec, loc = locations()) { const f = loc[id].file; if (id === 'codex') tomlInstall(f, spec); else if (id === 'claudeCode') throw new Error('Claude Code is connected through its own command'); else jsonInstall(f, spec); return status(id, spec, loc); }
function remove(id, spec, loc = locations()) { const f = loc[id].file; if (id === 'codex') tomlRemove(f); else if (id === 'claudeCode') throw new Error('Claude Code is disconnected through its own command'); else jsonRemove(f); return status(id, spec, loc); }

/* text to copy, for anyone who would rather paste it in themselves */
function snippet(id, spec) {
  if (id === 'codex') return tomlBlock(spec);
  if (id === 'claudeCode') return claudeCodeCommand(spec);
  return JSON.stringify({ mcpServers: { wit: spec } }, null, 2);
}

module.exports = { CLIENTS, locations, serverSpec, status, install, remove, snippet, claudeCodeArgs, claudeCodeCommand, tomlBlock, tomlStrip, tomlEntry, jsonEntry };
