import test from 'node:test';
import assert from 'node:assert/strict';
import { translations } from './translations';

test('all three languages define identical non-empty translation keys', () => {
  const enKeys = Object.keys(translations.en).sort();
  const knKeys = Object.keys(translations.kn).sort();
  const hiKeys = Object.keys(translations.hi).sort();

  assert.deepEqual(knKeys, enKeys);
  assert.deepEqual(hiKeys, enKeys);

  for (const lang of ['en', 'kn', 'hi'] as const) {
    for (const key of enKeys) {
      const value = translations[lang][key as keyof typeof translations.en];
      assert.equal(typeof value, 'string');
      assert.ok(value.trim().length > 0, `${lang}.${key} should be non-empty`);
    }
  }
});
