export type SheetSnap = 'collapsed' | 'half' | 'expanded';

export const SNAP_HEIGHT_VH: Record<SheetSnap, number> = {
  collapsed: 26,
  half: 52,
  expanded: 82,
};

export function clampSheetHeightVh(heightVh: number): number {
  return Math.max(SNAP_HEIGHT_VH.collapsed, Math.min(SNAP_HEIGHT_VH.expanded, heightVh));
}

export function resolveNextSnap(
  currentVh: number,
  velocityY: number,
): SheetSnap {
  if (velocityY < -0.4) {
    return currentVh > SNAP_HEIGHT_VH.half - 6 ? 'expanded' : 'half';
  }
  if (velocityY > 0.4) {
    return currentVh < SNAP_HEIGHT_VH.half + 6 ? 'collapsed' : 'half';
  }

  const entries: Array<[SheetSnap, number]> = [
    ['collapsed', SNAP_HEIGHT_VH.collapsed],
    ['half', SNAP_HEIGHT_VH.half],
    ['expanded', SNAP_HEIGHT_VH.expanded],
  ];

  let best: SheetSnap = 'collapsed';
  let minDist = Infinity;
  for (const [snap, target] of entries) {
    const dist = Math.abs(currentVh - target);
    if (dist < minDist) {
      minDist = dist;
      best = snap;
    }
  }
  return best;
}

export function toggleSheetSnap(current: SheetSnap): SheetSnap {
  if (current === 'collapsed') return 'half';
  if (current === 'half') return 'expanded';
  return 'collapsed';
}
