/* ChatGPT and Claude.ai do not let other apps read your chats, but both will email you a full export.
   This spots that export when it lands in Downloads, by reading only the zip's table of contents. */
'use strict';
const fs = require('fs'), path = require('path');

const PAGES = {
  chatgpt: { label: 'ChatGPT', url: 'https://chatgpt.com/#settings/DataControls', steps: ['Open ChatGPT settings, then Data controls.', 'Under Export data, choose Export, then Confirm export.', 'OpenAI emails a download link (it can take from minutes to a few days, and the link lasts 24 hours).', 'Download the .zip. Wit picks it up from Downloads, or drop it on Add notes.'] },
  claude: { label: 'Claude', url: 'https://claude.ai/settings/data-privacy-controls', steps: ['Open Claude settings, then Privacy.', 'Choose Export data.', 'Anthropic emails a download link (the link lasts 24 hours).', 'Download the file. Wit picks it up from Downloads, or drop it on Add notes. If it arrives as .dms, Wit opens it all the same.'] }
};

function isZip(file) {
  let fd; try { fd = fs.openSync(file, 'r'); const b = Buffer.alloc(4); fs.readSync(fd, b, 0, 4, 0); return b.readUInt32LE(0) === 0x04034b50; } catch (e) { return false; } finally { if (fd != null) try { fs.closeSync(fd); } catch (e) { /* closed */ } }
}
/* the names inside a zip, from its central directory only */
function zipNames(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size, tl = Math.min(size, 66000), tail = Buffer.alloc(tl);
    fs.readSync(fd, tail, 0, tl, size - tl);
    let e = -1; for (let i = tl - 22; i >= 0; i--) if (tail.readUInt32LE(i) === 0x06054b50) { e = i; break; }
    if (e < 0) throw new Error('not a zip');
    let count = tail.readUInt16LE(e + 10), cdSize = tail.readUInt32LE(e + 12), cdOff = tail.readUInt32LE(e + 16);
    if (count === 0xFFFF || cdSize === 0xFFFFFFFF || cdOff === 0xFFFFFFFF) {
      const l = e - 20;
      if (l >= 0 && tail.readUInt32LE(l) === 0x07064b50) { const off = Number(tail.readBigUInt64LE(l + 8)), z = Buffer.alloc(56); fs.readSync(fd, z, 0, 56, off); if (z.readUInt32LE(0) === 0x06064b50) { count = Number(z.readBigUInt64LE(32)); cdSize = Number(z.readBigUInt64LE(40)); cdOff = Number(z.readBigUInt64LE(48)); } }
    }
    if (cdSize > 64 * 1024 * 1024) throw new Error('directory too large');
    const cd = Buffer.alloc(cdSize); fs.readSync(fd, cd, 0, cdSize, cdOff);
    const names = []; let p = 0;
    for (let i = 0; i < count && p + 46 <= cd.length; i++) {
      if (cd.readUInt32LE(p) !== 0x02014b50) break;
      const nl = cd.readUInt16LE(p + 28), xl = cd.readUInt16LE(p + 30), cl = cd.readUInt16LE(p + 32);
      names.push(cd.toString('utf8', p + 46, p + 46 + nl)); p += 46 + nl + xl + cl;
    }
    return names;
  } finally { fs.closeSync(fd); }
}
/* which service an export came from, or null if it is not a chat export */
function classify(names) {
  const base = names.map(n => n.split('/').pop().toLowerCase());
  if (!base.some(b => /^conversations(-\d+)?\.json$/.test(b))) return null;
  if (base.includes('users.json') || base.includes('projects.json')) return 'claude';
  if (base.includes('chat.html') || base.includes('message_feedback.json') || base.includes('user.json') || base.includes('shared_conversations.json') || names.some(n => /^personal\//.test(n))) return 'chatgpt';
  return 'chats';
}
/* is this file a chat export we have not offered yet? */
function inspect(file) {
  if (!/\.(zip|dms)$/i.test(file)) return null;
  let st; try { st = fs.statSync(file); } catch (e) { return null; }
  if (!st.isFile() || st.size < 100 || st.size > 4 * 1024 * 1024 * 1024) return null;
  if (!isZip(file)) return null;
  let kind; try { kind = classify(zipNames(file)); } catch (e) { return null; }
  if (!kind) return null;
  return { path: file, name: path.basename(file), kind, label: kind === 'chats' ? 'chat' : PAGES[kind].label, size: st.size, mtimeMs: st.mtimeMs };
}
/* recent exports already sitting in a folder (for when watching is switched on) */
function recent(dir, sinceMs) {
  let es; try { es = fs.readdirSync(dir); } catch (e) { return []; }
  const out = [];
  for (const n of es) { if (!/\.(zip|dms)$/i.test(n)) continue; const p = path.join(dir, n); let st; try { st = fs.statSync(p); } catch (e) { continue; } if (st.mtimeMs < sinceMs) continue; const it = inspect(p); if (it) out.push(it); }
  return out.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

module.exports = { PAGES, isZip, zipNames, classify, inspect, recent };
