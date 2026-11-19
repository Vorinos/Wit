"""Wit's symbols, drawn by hand on a 24px grid after Apple's SF Symbols: an outline set at regular weight (the toolbar,
the buttons, a plain sidebar) and a solid set that sits white on a coloured rounded square (the sidebar, as in System
Settings). Writes set.json (symbol markup by id) and sheet2.html (a sheet to look at)."""
import json

SW = 1.85   # regular weight at sidebar size

# ---------- outline: one stroke weight, round caps and joins ----------
O = {
  # the record as connected points (point.3.connected.trianglepath.dotted)
  'brain': '<circle cx="12" cy="5.6" r="2.35"/><circle cx="5.4" cy="17.4" r="2.35"/><circle cx="18.6" cy="17.4" r="2.35"/>'
           '<path d="M10.85 7.65L6.55 15.35M13.15 7.65L17.45 15.35M7.75 17.4H16.25"/>',
  # bubble.left
  'ask': '<path d="M12 4.25C7.03 4.25 3.5 7.43 3.5 11.3C3.5 13.42 4.56 15.32 6.32 16.6C6.22 17.8 5.74 18.9 4.95 19.75C6.68 19.82 8.24 19.2 9.4 18.1'
         'C10.22 18.27 11.09 18.35 12 18.35C16.97 18.35 20.5 15.17 20.5 11.3C20.5 7.43 16.97 4.25 12 4.25Z"/>',
  # doc.text
  'notes': '<path d="M7.6 3.5H13.3L18.5 8.7V18.4A2.1 2.1 0 0 1 16.4 20.5H7.6A2.1 2.1 0 0 1 5.5 18.4V5.6A2.1 2.1 0 0 1 7.6 3.5Z"/>'
           '<path d="M13.2 3.65V7.2A1.5 1.5 0 0 0 14.7 8.7H18.35M8.75 12.6H15.25M8.75 15.95H12.75"/>',
  # doc.on.doc, with text on the front page
  'living': '<path d="M8.6 3.5H16.6A2.4 2.4 0 0 1 19 5.9V15.3"/>'
            '<rect x="5" y="7.1" width="11.2" height="13.4" rx="2.4"/><path d="M8 11.75H13.2M8 15.1H11.4"/>',
  # square.and.pencil
  'write': '<path d="M11.4 4.75H7.4A2.65 2.65 0 0 0 4.75 7.4V16.6A2.65 2.65 0 0 0 7.4 19.25H16.6A2.65 2.65 0 0 0 19.25 16.6V12.6"/>'
           '<path d="M17.55 3.95A1.6 1.6 0 0 1 19.8 3.95L20.05 4.2A1.6 1.6 0 0 1 20.05 6.45L12.6 13.9L9.6 14.4L10.1 11.4Z"/>',
  # chart.bar
  'numbers': '<rect x="4" y="12.6" width="4" height="7.4" rx="1.3"/><rect x="10" y="4" width="4" height="16" rx="1.3"/><rect x="16" y="8.4" width="4" height="11.6" rx="1.3"/>',
  # book
  'learn': '<path d="M12 6.6C10.2 5.15 7.85 4.6 4.85 4.6A1.1 1.1 0 0 0 3.75 5.7V16.85A1.1 1.1 0 0 0 4.85 17.95C7.85 17.95 10.2 18.5 12 19.95'
           'C13.8 18.5 16.15 17.95 19.15 17.95A1.1 1.1 0 0 0 20.25 16.85V5.7A1.1 1.1 0 0 0 19.15 4.6C16.15 4.6 13.8 5.15 12 6.6Z"/><path d="M12 6.6V19.95"/>',
  'add': '<path d="M12 5V19M5 12H19"/>',
  # powerplug
  'connect': '<path d="M9.5 3.6V7.4M14.5 3.6V7.4"/><path d="M6.6 7.4H17.4V10.85A5.4 5.4 0 0 1 6.6 10.85Z"/><path d="M12 16.25V18.4A2.1 2.1 0 0 0 14.1 20.5H15.6"/>',
  # circle.lefthalf.filled
  'look': '<circle cx="12" cy="12" r="8.4"/><path d="M12 3.6A8.4 8.4 0 0 0 12 20.4Z" fill="currentColor" stroke="none"/>',
  # power
  'close': '<path d="M12 3.6V11.2"/><path d="M7.2 6.85A7.55 7.55 0 1 0 16.8 6.85"/>',
  # the rest of the app
  'search': '<circle cx="10.6" cy="10.6" r="6.35"/><path d="M15.2 15.2L19.9 19.9"/>',
  'x': '<path d="M6 6L18 18M18 6L6 18"/>',
  'reset': '<path d="M4.9 12A7.1 7.1 0 1 0 7.05 6.9"/><path d="M6.6 3.4V7.3H10.5"/>',
  'random': '<path d="M3.75 16.75H6.6C8.1 16.75 9.45 16 10.25 14.75L13.75 9.25C14.55 8 15.9 7.25 17.4 7.25H20"/>'
            '<path d="M3.75 7.25H6.6C8.1 7.25 9.45 8 10.25 9.25L10.85 10.2M13.15 13.8L13.75 14.75C14.55 16 15.9 16.75 17.4 16.75H20"/>'
            '<path d="M17.6 4.85L20 7.25L17.6 9.65M17.6 14.35L20 16.75L17.6 19.15"/>',
  'save': '<path d="M12 3.9V14.6M7.7 10.3L12 14.6L16.3 10.3"/><path d="M4.75 15.5V17.4A2.6 2.6 0 0 0 7.35 20H16.65A2.6 2.6 0 0 0 19.25 17.4V15.5"/>',
  'tune': '<path d="M4 7H13.3M17.7 7H20M4 17H6.3M10.7 17H20"/><circle cx="15.5" cy="7" r="2.2"/><circle cx="8.5" cy="17" r="2.2"/>',
  'menu': '<path d="M4.5 6.75H19.5M4.5 12H19.5M4.5 17.25H19.5"/>',
  'plus': '<path d="M12 5V19M5 12H19"/>',
  'minus': '<path d="M5 12H19"/>',
  # arrow.up.left.and.arrow.down.right: fit everything
  'fit': '<path d="M9.75 4.5H4.5V9.75M4.5 4.5L10.4 10.4M14.25 19.5H19.5V14.25M19.5 19.5L13.6 13.6"/>',
  # command
  'cmd': '<path d="M9 9H15V15H9ZM9 9V6.6A2.4 2.4 0 1 0 6.6 9H9ZM15 9H17.4A2.4 2.4 0 1 0 15 6.6V9ZM15 15V17.4A2.4 2.4 0 1 0 17.4 15H15ZM9 15H6.6A2.4 2.4 0 1 0 9 17.4V15Z"/>',
  'chev': '<path d="M6 9.5L12 15L18 9.5"/>',
  'full': '<path d="M4.5 9.5V7.1A2.6 2.6 0 0 1 7.1 4.5H9.5M14.5 4.5H16.9A2.6 2.6 0 0 1 19.5 7.1V9.5M19.5 14.5V16.9A2.6 2.6 0 0 1 16.9 19.5H14.5M9.5 19.5H7.1A2.6 2.6 0 0 1 4.5 16.9V14.5"/>',
  # sidebar.left
  'side': '<rect x="3.25" y="4.75" width="17.5" height="14.5" rx="3.2"/><path d="M9.4 4.9V19.1M5.7 8.6H7.1M5.7 11.3H7.1M5.7 14H7.1"/>',
  'prev': '<path d="M14.75 5.5L8.75 12L14.75 18.5"/>',
  'next': '<path d="M9.25 5.5L15.25 12L9.25 18.5"/>',
}
FILLED_O = {  # these two are solid shapes even in the outline set, as Apple draws play and pause
  'play': '<path d="M8.6 4.9L18.6 10.75A1.45 1.45 0 0 1 18.6 13.25L8.6 19.1A1.45 1.45 0 0 1 6.4 17.85V6.15A1.45 1.45 0 0 1 8.6 4.9Z"/>',
  'pause': '<rect x="6.2" y="4.75" width="4" height="14.5" rx="1.4"/><rect x="13.8" y="4.75" width="4" height="14.5" rx="1.4"/>',
}

# ---------- solid: white on a coloured square; lines inside are cut out in the square's colour (--cut) ----------
CUT = 'style="stroke:var(--cut,#000)"'
F = {
  'brain': '<g fill="currentColor"><circle cx="12" cy="5.4" r="3.1"/><circle cx="5.2" cy="17.6" r="3.1"/><circle cx="18.8" cy="17.6" r="3.1"/></g>'
           '<path d="M10.9 8.1L6.6 15.1M13.1 8.1L17.4 15.1M8.2 17.6H15.8" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round"/>',
  'ask': '<path fill="currentColor" d="M12 3.9C6.86 3.9 3.1 7.22 3.1 11.3C3.1 13.52 4.2 15.5 6.03 16.85C5.92 18.05 5.42 19.2 4.6 20.1C6.45 20.2 8.15 19.55 9.4 18.42'
         'C10.24 18.6 11.1 18.7 12 18.7C17.14 18.7 20.9 15.38 20.9 11.3C20.9 7.22 17.14 3.9 12 3.9Z"/>',
  'notes': '<path fill="currentColor" d="M7.7 3H13.5L19 8.5V18.7A2.3 2.3 0 0 1 16.7 21H7.7A2.3 2.3 0 0 1 5.4 18.7V5.3A2.3 2.3 0 0 1 7.7 3Z"/>'
           '<path d="M13.4 3.2V7.1A1.4 1.4 0 0 0 14.8 8.5H18.8" fill="none" stroke-width="1.5" stroke-linejoin="round" ' + CUT + '/>'
           '<path d="M8.6 12.6H15.6M8.6 16.1H13.1" fill="none" stroke-width="1.7" stroke-linecap="round" ' + CUT + '/>',
  'living': '<rect x="8.1" y="3" width="11.9" height="13.4" rx="2.5" fill="currentColor" opacity=".55"/>'
            '<rect x="4.6" y="7" width="11.9" height="14" rx="2.5" fill="currentColor" stroke-width="1.6" ' + CUT + '/>'
            '<path d="M7.7 12H13.4M7.7 15.5H11.4" fill="none" stroke-width="1.7" stroke-linecap="round" ' + CUT + '/>',
  'write': '<path d="M11.2 4.6H7.5A2.8 2.8 0 0 0 4.7 7.4V16.6A2.8 2.8 0 0 0 7.5 19.4H16.7A2.8 2.8 0 0 0 19.5 16.6V12.9" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round"/>'
           '<path fill="currentColor" d="M17.35 3.55A1.9 1.9 0 0 1 20.05 3.55L20.45 3.95A1.9 1.9 0 0 1 20.45 6.65L12.75 14.35L9 15L9.65 11.25Z"/>',
  'numbers': '<g fill="currentColor"><rect x="3.8" y="12.2" width="4.4" height="8.3" rx="1.4"/><rect x="9.8" y="3.5" width="4.4" height="17" rx="1.4"/><rect x="15.8" y="8" width="4.4" height="12.5" rx="1.4"/></g>',
  'learn': '<path fill="currentColor" d="M11.25 6.05C9.5 4.75 7.3 4.2 4.65 4.15A1.25 1.25 0 0 0 3.4 5.4V16.95A1.25 1.25 0 0 0 4.6 18.2C7.15 18.27 9.35 18.8 11.25 20.05Z"/>'
           '<path fill="currentColor" d="M12.75 6.05C14.5 4.75 16.7 4.2 19.35 4.15A1.25 1.25 0 0 1 20.6 5.4V16.95A1.25 1.25 0 0 1 19.4 18.2C16.85 18.27 14.65 18.8 12.75 20.05Z"/>',
  'add': '<path d="M12 4.6V19.4M4.6 12H19.4" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>',
  'connect': '<path d="M9.5 3V7M14.5 3V7" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round"/>'
             '<path fill="currentColor" d="M6.4 6.5H17.6A.9.9 0 0 1 18.5 7.4V10.6A6.5 6.5 0 0 1 5.5 10.6V7.4A.9.9 0 0 1 6.4 6.5Z"/>'
             '<path d="M12 16.5V18.6A2.2 2.2 0 0 0 14.2 20.8H15.8" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
  'look': '<circle cx="12" cy="12" r="8.2" fill="none" stroke="currentColor" stroke-width="2.1"/><path fill="currentColor" d="M12 3.8A8.2 8.2 0 0 0 12 20.2Z"/>',
  'close': '<path d="M12 3.4V11.3" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><path d="M7.1 6.75A7.7 7.7 0 1 0 16.9 6.75" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>',
}

def osym(i, body, filled=False):
    g = '<g fill="currentColor">' if filled else '<g fill="none" stroke="currentColor" stroke-width="%s" stroke-linecap="round" stroke-linejoin="round">' % SW
    return '<symbol id="%s" viewBox="0 0 24 24">%s%s</g></symbol>' % (i, g, body)

SET = {}
for k in ['brain', 'ask', 'notes', 'living', 'write', 'numbers', 'learn', 'add', 'connect', 'look', 'close']:
    SET['n-' + k] = osym('n-' + k, O[k])
    SET['n-' + k + '-f'] = '<symbol id="n-%s-f" viewBox="0 0 24 24">%s</symbol>' % (k, F[k])
for k in ['search', 'x', 'reset', 'random', 'save', 'tune', 'menu', 'plus', 'minus', 'fit', 'cmd', 'chev', 'full', 'prev', 'next', 'side']:
    SET['i-' + k] = osym('i-' + k, O[k])
for k, b in FILLED_O.items():
    SET['i-' + k] = osym('i-' + k, b, filled=True)
json.dump(SET, open('set.json', 'w'), indent=0)

# the sidebar colours: Apple's system colours (dark), one per item, as in System Settings
TILE = {'brain': '#5e5ce6', 'ask': '#0a84ff', 'notes': '#ff9f0a', 'living': '#32ade6', 'write': '#ff375f', 'numbers': '#30d158',
        'learn': '#bf5af2', 'add': '#8e8e93', 'connect': '#40c8e0', 'look': '#3a3a3c', 'close': '#636366'}
json.dump(TILE, open('tiles.json', 'w'))

names = ['brain', 'ask', 'notes', 'living', 'write', 'numbers', 'learn', 'add', 'connect', 'look', 'close']
rows = ''.join('<div class="r"><span class="t" style="--c:%s;--cut:%s"><svg><use href="#n-%s-f"/></svg></span><svg class="o"><use href="#n-%s"/></svg>'
               '<span class="tb" style="--c:%s;--cut:%s"><svg><use href="#n-%s-f"/></svg></span><svg class="ob"><use href="#n-%s"/></svg><b>%s</b></div>'
               % (TILE[n], TILE[n], n, n, TILE[n], TILE[n], n, n, n) for n in names)
small = ''.join('<svg class="ob"><use href="#%s"/></svg>' % k for k in SET if k.startswith('i-'))
css = ('body{margin:0;background:#0a0b20;color:#f2f2f4;font:13px -apple-system,system-ui,sans-serif;padding:18px;display:grid;grid-template-columns:auto auto;gap:24px;align-items:start}'
       '.r{display:flex;align-items:center;gap:14px;height:44px}.t{width:22px;height:22px;border-radius:6px;display:grid;place-items:center;color:#fff;'
       'background:linear-gradient(180deg,color-mix(in srgb,var(--c) 78%,#fff),var(--c))}.t svg{width:15px;height:15px}'
       '.o{width:18px;height:18px;color:#b4b6c8}.tb{width:64px;height:64px;border-radius:15px;display:grid;place-items:center;color:#fff;'
       'background:linear-gradient(180deg,color-mix(in srgb,var(--c) 78%,#fff),var(--c))}.tb svg{width:44px;height:44px}.ob{width:52px;height:52px;color:#f2f2f4}'
       '.small{display:grid;grid-template-columns:repeat(4,64px);gap:14px}b{font-weight:500;width:70px}.r{height:76px}')
html = '<!DOCTYPE html><html><head><style>%s</style></head><body><svg width="0" height="0" style="position:absolute">%s</svg><div>%s</div><div class="small">%s</div></body></html>' % (css, ''.join(SET.values()), rows, small)
open('sheet2.html', 'w').write(html)
print(len(SET), 'symbols')
