// The bridge between the page and the desktop app. The page gets these functions and nothing else: no Node, no files, no network.
'use strict';
const { contextBridge, ipcRenderer } = require('electron');
const call = (ch, ...a) => ipcRenderer.invoke(ch, ...a);
const listen = ch => fn => { const h = (_e, d) => fn(d); ipcRenderer.on(ch, h); return () => ipcRenderer.removeListener(ch, h); };

contextBridge.exposeInMainWorld('witDesktop', {
  info: () => call('app:info'),
  ready: () => call('app:ready'),
  theme: v => call('app:theme', v),
  glass: v => call('app:glass', v),
  record: { save: json => call('record:save', json), clear: () => call('record:clear') },
  inbox: { take: () => call('inbox:take'), ack: token => call('inbox:ack', token), onReady: listen('inbox:ready') },
  sources: { status: () => call('sources:status'), set: (id, on) => call('sources:set', id, on), sync: () => call('sources:sync'), ack: (id, stamps) => call('sources:ack', id, stamps), forget: id => call('sources:forget', id), onItems: listen('sources:items') },
  exports: { status: () => call('exports:status'), watch: on => call('exports:watch', on), open: kind => call('exports:open', kind), read: p => call('exports:read', p), done: p => call('exports:done', p), onFound: listen('exports:found') },
  connect: { status: () => call('connect:status'), install: id => call('connect:install', id), remove: id => call('connect:remove', id), snippet: id => call('connect:snippet', id), http: on => call('connect:http', on), reveal: id => call('connect:reveal', id) },
  ai: { config: () => call('ai:config'), save: c => call('ai:save', c), key: (p, k) => call('ai:key', p, k), ask: req => call('ai:ask', req), cancel: id => call('ai:cancel', id), onEvent: listen('ai:event') },
  openExternal: url => call('open:external', url)
});
