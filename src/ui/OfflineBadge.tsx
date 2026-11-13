import React from 'react';
import { RotateCcw, WifiOff } from 'lucide-react';
import { useI18n } from '../i18n/I18nContext';

export function OfflineBadge({ compact = false }: { compact?: boolean }) {
  const { t } = useI18n();
  return (
    <span
      role="status"
      data-testid="offline-badge"
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#FFC20E] text-[#1F2A2E] border-2 border-[#1F2A2E] text-xs font-extrabold whitespace-nowrap shrink-0"
    >
      <WifiOff className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
      <span>{compact ? t.offlineChip : t.offlineLocalBadge}</span>
    </span>
  );
}

export function OfflineLocalBanner({ onRetry }: { onRetry?: () => void }) {
  const { t } = useI18n();
  return (
    <div
      role="status"
      data-testid="offline-local-banner"
      className="p-3 rounded-xl bg-[#FFC20E] text-[#1F2A2E] border-2 border-[#1F2A2E] flex flex-col sm:flex-row sm:items-center justify-between gap-2.5"
    >
      <div className="flex items-start gap-2 min-w-0">
        <WifiOff className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
        <div className="min-w-0">
          <p className="font-sign font-bold text-sm leading-tight">{t.offlineLocalBadge}</p>
          <p className="text-xs font-medium mt-0.5 break-words">{t.offlineLocalBanner}</p>
        </div>
      </div>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="min-h-[40px] px-3 rounded-lg bg-[#1F2A2E] text-white text-xs font-bold inline-flex items-center justify-center gap-1.5 shrink-0 self-start sm:self-center"
        >
          <RotateCcw className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          <span>{t.offlineRetryBtn}</span>
        </button>
      )}
    </div>
  );
}
