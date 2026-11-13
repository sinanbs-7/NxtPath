import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import {
  clampSheetHeightVh,
  resolveNextSnap,
  SNAP_HEIGHT_VH,
  toggleSheetSnap,
  type SheetSnap,
} from './bottomSheet';
import { useI18n } from '../i18n/I18nContext';

interface BottomSheetProps {
  snap: SheetSnap;
  onSnapChange: (snap: SheetSnap) => void;
  title?: string;
  header?: React.ReactNode;
  scrollResetKey?: string | number;
  children: React.ReactNode;
}

export function BottomSheet({
  snap,
  onSnapChange,
  title,
  header,
  scrollResetKey,
  children,
}: BottomSheetProps) {
  const { t } = useI18n();
  const [dragHeightVh, setDragHeightVh] = useState<number | null>(null);
  const scrollBodyRef = useRef<HTMLDivElement | null>(null);
  const prevSnapRef = useRef<SheetSnap>(snap);
  const dragStartRef = useRef<{ y: number; vh: number; lastY: number; lastTime: number } | null>(
    null,
  );

  // Ensure the sheet always opens scrolled to the very top so headings are never clipped
  useLayoutEffect(() => {
    if (scrollBodyRef.current) {
      scrollBodyRef.current.scrollTop = 0;
    }
  }, [scrollResetKey]);

  useEffect(() => {
    const prev = prevSnapRef.current;
    prevSnapRef.current = snap;
    if (prev === 'collapsed' && snap !== 'collapsed' && scrollBodyRef.current) {
      scrollBodyRef.current.scrollTop = 0;
    }
  }, [snap]);

  const activeVh = dragHeightVh ?? SNAP_HEIGHT_VH[snap];

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const now = performance.now();
    dragStartRef.current = {
      y: e.clientY,
      vh: SNAP_HEIGHT_VH[snap],
      lastY: e.clientY,
      lastTime: now,
    };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const start = dragStartRef.current;
    if (!start) return;
    const viewportH = window.innerHeight || 800;
    const deltaPx = start.y - e.clientY;
    const deltaVh = (deltaPx / viewportH) * 100;
    setDragHeightVh(clampSheetHeightVh(start.vh + deltaVh));
    start.lastY = e.clientY;
    start.lastTime = performance.now();
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const start = dragStartRef.current;
    if (!start) return;
    dragStartRef.current = null;
    const dt = Math.max(16, performance.now() - start.lastTime);
    const velocityY = (e.clientY - start.lastY) / dt;
    const currentVh = dragHeightVh ?? SNAP_HEIGHT_VH[snap];
    setDragHeightVh(null);
    onSnapChange(resolveNextSnap(currentVh, velocityY));
  };

  const isExpanded = snap === 'expanded';

  return (
    <section
      aria-label={title || 'Route and search panel'}
      data-testid="bottom-sheet"
      style={{ height: `${activeVh}vh` }}
      className={`fixed bottom-[64px] left-0 right-0 md:left-4 md:right-auto md:bottom-[80px] md:w-[430px] max-h-[calc(100dvh-144px)] md:max-h-[calc(100dvh-176px)] z-[600] bg-white border-t-2 md:border-2 border-[#1F2A2E] rounded-t-2xl md:rounded-2xl shadow-lg flex flex-col overflow-hidden ${
        dragHeightVh === null ? 'transition-[height] duration-200 ease-out' : ''
      }`}
    >
      <div className="shrink-0 bg-[#F2F5F3] border-b border-[#D5DDD8]">
        <div
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          className="flex items-center justify-between gap-2 px-4 pt-2 pb-1.5 touch-none select-none cursor-grab active:cursor-grabbing"
        >
          <div className="min-w-0 flex-1 flex items-center gap-2">
            {title && (
              <span className="font-sign font-bold text-xs uppercase tracking-wide text-[#1F2A2E] truncate">
                {title}
              </span>
            )}
          </div>
          <div className="w-12 h-1.5 rounded-full bg-[#1F2A2E]/30 shrink-0" aria-hidden="true" />
          <div className="flex-1 flex items-center justify-end">
            <button
              type="button"
              onClick={() => onSnapChange(toggleSheetSnap(snap))}
              aria-label={isExpanded ? t.sheetCollapse : t.sheetExpand}
              aria-expanded={snap !== 'collapsed'}
              className="min-h-[40px] min-w-[40px] -my-1 flex items-center justify-end text-[#1F2A2E] font-bold text-sm"
            >
              {isExpanded ? (
                <ChevronDown className="w-5 h-5" aria-hidden="true" />
              ) : (
                <ChevronUp className="w-5 h-5" aria-hidden="true" />
              )}
            </button>
          </div>
        </div>
        {header && <div className="px-4 pb-2">{header}</div>}
      </div>

      <div
        ref={scrollBodyRef}
        data-testid="bottom-sheet-body"
        className="flex-1 min-h-0 overflow-y-auto px-4 pt-3 pb-6 space-y-3"
      >
        {children}
      </div>
    </section>
  );
}
