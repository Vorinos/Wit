/* Asking an AI about your record. Off until you switch it on and give it a key (or point it at a model on this computer).
   Claude speaks the Anthropic Messages API; OpenAI, Ollama, LM Studio and other compatible servers speak Chat Completions.
   Answers stream back a piece at a time. */
'use strict';

const PROVIDERS = {
  anthropic: { label: 'Claude (Anthropic)', base: 'https://api.anthropic.com', model: 'claude-sonnet-5-5', needsKey: true, keyHint: 'sk-ant-…', keyUrl: 'https://platform.claude.com/settings/keys' },
  openai: { label: 'ChatGPT models (OpenAI)', base: 'https://api.openai.com/v1', model: 'chat-latest', needsKey: true, keyHint: 'sk-…', keyUrl: 'https://platform.openai.com/api-keys' },
  local: { label: 'A model on this computer', base: 'http://localhost:11434/v1', model: 'llama3.2', needsKey: false, keyHint: 'optional', keyUrl: 'https://ollama.com/download' }
};
const ANTHROPIC_VERSION = '2026-10-21';

/* which addresses each provider may reach. Cloud providers: their own API only. Local: this computer only. */
function allowedBase(provider, base) {
  let u; try { u = new URL(base); } catch (e) { return false; }
  if (provider === 'anthropic') return u.protocol === 'https:' && u.hostname === 'api.anthropic.com';
  if (provider === 'openai') return u.protocol === 'https:' && u.hostname === 'api.openai.com';
  if (provider === 'local') return /^https?:$/.test(u.protocol) && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(u.hostname);
  return false;
}

async function* events(body) {
  const reader = body.getReader(), dec = new TextDecoder(); let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (value) buf += dec.decode(value, { stream: true });
    let cut;
    while ((cut = buf.search(/\r?\n\r?\n/)) >= 0) {
      const raw = buf.slice(0, cut), m = buf.slice(cut).match(/^\r?\n\r?\n/); buf = buf.slice(cut + m[0].length);
      let ev = 'message', data = [];
      for (const l of raw.split(/\r?\n/)) { if (l.startsWith('event:')) ev = l.slice(6).trim(); else if (l.startsWith('data:')) data.push(l.slice(5).replace(/^ /, '')); }
      if (data.length) yield { event: ev, data: data.join('\n') };
    }
    if (done) { if (buf.trim()) { const d = buf.split(/\r?\n/).filter(l => l.startsWith('data:')).map(l => l.slice(5).trim()).join('\n'); if (d) yield { event: 'message', data: d }; } return; }
  }
}
async function failure(res, label) {
  let msg = ''; try { const j = await res.json(); msg = (j.error && (j.error.message || j.error.type)) || j.message || ''; } catch (e) { /* no body */ }
  const hint = res.status === 401 || res.status === 403 ? ' Check the key.' : res.status === 404 ? ' Check the model name.' : res.status === 429 ? ' The provider is limiting requests; try again shortly.' : '';
  const err = new Error(label + ' said ' + res.status + (msg ? ': ' + msg : '') + '.' + hint); err.status = res.status; return err;
}

/* ask({ provider, base, model, key, system, messages:[{role,content}], maxTokens, signal, onText }) -> full answer */
async function ask(o) {
  const P = PROVIDERS[o.provider]; if (!P) throw new Error('Choose an AI provider first.');
  const base = String(o.base || P.base).replace(/\/+$/, ''), model = o.model || P.model;
  if (!allowedBase(o.provider, base)) throw new Error('Wit only sends questions to ' + (o.provider === 'local' ? 'a model on this computer (localhost)' : new URL(P.base).hostname) + '.');
  if (P.needsKey && !o.key) throw new Error('Add your ' + P.label + ' API key first.');
  const fetchFn = o.fetch || fetch; let text = '';
  const emit = t => { if (!t) return; text += t; if (o.onText) o.onText(t); };
  if (o.provider === 'anthropic') {
    const res = await fetchFn(base + '/v1/messages', { method: 'POST', signal: o.signal, headers: Object.assign({ 'content-type': 'application/json', 'x-api-key': o.key, 'anthropic-version': ANTHROPIC_VERSION }, o.browser ? { 'anthropic-dangerous-direct-browser-access': 'true' } : {}),
      body: JSON.stringify({ model, max_tokens: o.maxTokens || 1200, system: o.system, messages: o.messages, stream: true }) });
    if (!res.ok) throw await failure(res, 'Anthropic');
    for await (const ev of events(res.body)) {
      let j; try { j = JSON.parse(ev.data); } catch (e) { continue; }
      if (j.type === 'content_block_delta' && j.delta && j.delta.type === 'text_delta') emit(j.delta.text);
      else if (j.type === 'error') throw new Error('Anthropic: ' + ((j.error && j.error.message) || 'error'));
      else if (j.type === 'message_stop') break;
    }
    return text;
  }
  const headers = { 'content-type': 'application/json' }; if (o.key) headers.authorization = 'Bearer ' + o.key;
  const res = await fetchFn(base + '/chat/completions', { method: 'POST', signal: o.signal, headers,
    body: JSON.stringify({ model, stream: true, messages: [{ role: 'system', content: o.system }].concat(o.messages) }) });
  if (!res.ok) throw await failure(res, o.provider === 'openai' ? 'OpenAI' : 'The local model');
  for await (const ev of events(res.body)) {
    if (ev.data === '[DONE]') break;
    let j; try { j = JSON.parse(ev.data); } catch (e) { continue; }
    if (j.error) throw new Error((j.error.message || 'error'));
    const d = j.choices && j.choices[0] && (j.choices[0].delta || j.choices[0].message); if (d && typeof d.content === 'string') emit(d.content);
  }
  return text;
}

module.exports = { PROVIDERS, ANTHROPIC_VERSION, allowedBase, ask, events };
