import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clampSheetHeightVh,
  resolveNextSnap,
  SNAP_HEIGHT_VH,
  toggleSheetSnap,
} from './bottomSheet';

test('clampSheetHeightVh constrains drag heights between collapsed and expanded bounds', () => {
  assert.equal(clampSheetHeightVh(10), SNAP_HEIGHT_VH.collapsed);
  assert.equal(clampSheetHeightVh(98), SNAP_HEIGHT_VH.expanded);
  assert.equal(clampSheetHeightVh(50), 50);
});

test('resolveNextSnap snaps cleanly by distance and flick velocity', () => {
  assert.equal(resolveNextSnap(28, 0), 'collapsed');
  assert.equal(resolveNextSnap(50, 0), 'half');
  assert.equal(resolveNextSnap(78, 0), 'expanded');
  assert.equal(resolveNextSnap(30, -0.8), 'half');
  assert.equal(resolveNextSnap(55, 0.8), 'collapsed');
});

test('toggleSheetSnap cycles collapsed -> half -> expanded -> collapsed', () => {
  assert.equal(toggleSheetSnap('collapsed'), 'half');
  assert.equal(toggleSheetSnap('half'), 'expanded');
  assert.equal(toggleSheetSnap('expanded'), 'collapsed');
});
