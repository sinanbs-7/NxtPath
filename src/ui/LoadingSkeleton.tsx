import React from 'react';
import { useI18n } from '../i18n/I18nContext';

export function SkeletonCard({ lines = 3 }: { lines?: number }) {
  const { t } = useI18n();
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label={t.loadingLabel}
      className="bg-white border-2 border-[#D5DDD8] rounded-2xl p-4 space-y-3 animate-pulse"
    >
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-[#D5DDD8]" />
        <div className="flex-1 space-y-2 min-w-0">
          <div className="h-4 w-2/3 rounded bg-[#D5DDD8]" />
          <div className="h-3 w-1/2 rounded bg-[#E4EAE6]" />
        </div>
      </div>
      {Array.from({ length: Math.max(1, lines - 1) }).map((_, idx) => (
        <div
          key={idx}
          className={`h-3 rounded bg-[#E4EAE6] ${idx === lines - 2 ? 'w-3/4' : 'w-full'}`}
        />
      ))}
      <span className="sr-only">{t.loadingLabel}</span>
    </div>
  );
}

export function SkeletonList({ count = 2 }: { count?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: count }).map((_, idx) => (
        <SkeletonCard key={idx} />
      ))}
    </div>
  );
}

export function SkeletonMetricGrid({ count = 4 }: { count?: number }) {
  const { t } = useI18n();
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label={t.loadingLabel}
      className="grid grid-cols-2 sm:grid-cols-4 gap-3 animate-pulse"
    >
      {Array.from({ length: count }).map((_, idx) => (
        <div
          key={idx}
          className="bg-white border-2 border-[#D5DDD8] rounded-2xl p-3.5 space-y-2"
        >
          <div className="h-3 w-2/3 rounded bg-[#E4EAE6]" />
          <div className="h-7 w-1/2 rounded bg-[#D5DDD8]" />
          <div className="h-2.5 w-3/4 rounded bg-[#E4EAE6]" />
        </div>
      ))}
      <span className="sr-only">{t.loadingLabel}</span>
    </div>
  );
}
