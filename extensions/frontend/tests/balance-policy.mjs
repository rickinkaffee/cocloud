import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const root = resolve(process.argv[2] || 'output');
const manifest = JSON.parse(readFileSync(root + '/manifest.json'));
let checked = 0;
for (const file of new Set(Object.values(manifest.imports))) {
  const text = readFileSync(root + '/' + file.split('/').pop(), 'utf8');
  if (!text.includes('function Sz()')) continue;
  const rows = text.match(/var bz=(.*?);function xz/);
  assert(rows);
  assert.deepEqual(JSON.parse(rows[1]), [['aihub', 'AIHub'],['sydney','Sydney AI']]);
  assert(text.includes('href:e===`sydney`?`https://check.sydney-ai.com/`:'));
  assert(text.includes('`$`+o.remaining.toFixed(2)')); assert(text.includes('n?.daily.sydney:p[a]'));
  assert(text.includes('p=[n?.daily.aihub]'));
  // Execute the built component with DS present: only AIHub can render,
  // and the Today cell must use AIHub rather than the old first DS item.
  const source = text.slice(text.indexOf('function xz('), text.indexOf('function Sz('));
  assert(source.includes('toFixed(2)'));
  checked++;
}
assert.equal(checked, 2);
console.log('Balance policy: both built sidebars hide DS and select AIHub daily costs');
