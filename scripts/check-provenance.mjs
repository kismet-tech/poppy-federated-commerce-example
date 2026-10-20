import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const root = new URL('../', import.meta.url);
const provenance = JSON.parse(readFileSync(new URL('upstream.json', root), 'utf8'));
for (const [path, expected] of Object.entries(provenance.files)) {
  const actual = createHash('sha256').update(readFileSync(new URL(path, root))).digest('hex');
  assert.equal(actual, expected, `Vendored upstream file changed: ${path}`);
}
console.log(`Verified ${Object.keys(provenance.files).length} upstream files at ${provenance.revision}.`);
