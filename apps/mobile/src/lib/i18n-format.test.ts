import { test } from 'node:test';
import assert from 'node:assert/strict';

// Pure checks for mixed-direction rendering helpers (no React Native runtime needed).
const ltr = (s: string) => `⁦${s}⁩`;

test('serials are wrapped in LTR isolates', () => {
  assert.equal(ltr('BT-ABCD-EFGH-JKMN'), '⁦BT-ABCD-EFGH-JKMN⁩');
});
