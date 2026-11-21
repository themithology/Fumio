/*
 * The "Something went wrong" screen, checked without a device. Runs in jsdom
 * from whatever directory has the dependency installed (docs/tv-ui.test.cjs does
 * the same): `npm i --prefix /tmp/tvtest jsdom` then NODE_PATH=/tmp/tvtest/node_modules.
 */
const fs = require('fs');
const path = require('path');
function loadJsdom() {
  for (const candidate of ['jsdom', '/tmp/tvtest/node_modules/jsdom', path.join(__dirname, '..', 'node_modules', 'jsdom')]) {
    try {
      return require(candidate);
    } catch (e) {
      /* next */
    }
  }
  console.error('jsdom is missing: npm i --no-save jsdom');
  process.exit(2);
}
const { JSDOM } = loadJsdom();
const html = fs.readFileSync(require('path').join(__dirname, '..', 'android/app/src/main/assets/offline.html'), 'utf8');
const calls = [];
const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  beforeParse(window) {
    window.FumioOffline = {
      open: (u) => calls.push(['open', u]),
      retry: () => calls.push(['retry']),
      browse: () => calls.push(['browse']),
      canBrowse: () => true,
    };
  },
});
const d = dom.window.document;
const tiles = [...d.querySelectorAll('.tile')];
console.log('tiles', tiles.length, tiles.map((t) => t.getAttribute('data-url')));
console.log('paths', [...d.querySelectorAll('.badge svg path')].map((p) => p.getAttribute('d').slice(0, 18) + '…'));
console.log('h1', d.querySelector('h1').textContent);
tiles[0].dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
d.getElementById('retry').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
d.getElementById('browse').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
console.log('calls', JSON.stringify(calls));
if (tiles.length !== 3) throw new Error('expected 3 social cards');
if (calls.length !== 3) throw new Error('expected 3 bridge calls, got ' + calls.length);
if (calls[0][1] !== 'https://discord.gg/t6tjszp5eb') throw new Error('discord url');
// The diagnosis line: a screenshot must be a usable bug report.
const reasonEl = d.getElementById('reason');
if (!reasonEl) throw new Error('no #reason element');
if (!reasonEl.hidden) throw new Error('#reason must start hidden');
dom.window.FumioOfflineReason('DNS lookup failed - the domain did not resolve');
if (reasonEl.hidden) throw new Error('#reason did not appear');
if (!/Reason: DNS lookup failed/.test(reasonEl.textContent)) {
  throw new Error('reason text wrong: ' + reasonEl.textContent);
}
console.log('reason line:', reasonEl.textContent);

console.log('offline.html OK');
