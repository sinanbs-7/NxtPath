import React from 'react';
import { AlertTriangle } from 'lucide-react';
import type { GpsPermissionState, GpsReading } from '../map/useGeolocation';
import { useI18n } from '../i18n/I18nContext';
import { OfflineLocalBanner } from './OfflineBadge';

interface StatusChipsProps {
  isOnline: boolean;
  onRetryConnection?: () => void;
  permissionState: GpsPermissionState;
  position: GpsReading | null;
  gpsError: string | null;
  onRequestLocation: () => void;
}

export function StatusChips({
  isOnline,
  onRetryConnection,
  permissionState,
  position,
  gpsError,
  onRequestLocation,
}: StatusChipsProps) {
  const { t } = useI18n();

  const showGpsDenied = permissionState === 'denied' && !position;
  const showWeakAccuracy = Boolean(position && position.accuracy > 100);
  const showGpsPrompt = permissionState === 'prompt' && !position;

  return (
    <div className="space-y-2">
      {!isOnline && <OfflineLocalBanner onRetry={onRetryConnection} />}

      {showGpsPrompt && (
        <div className="p-3 rounded-xl bg-white border-2 border-[#1F2A2E] flex items-center justify-between gap-3">
          <p className="text-sm text-[#1F2A2E]">{t.locationNoticeBody}</p>
          <button
            type="button"
            onClick={onRequestLocation}
            className="min-h-[44px] px-3.5 rounded-lg bg-[#0E6B4E] text-white text-sm font-bold whitespace-nowrap shrink-0"
          >
            {t.gpsAllowBtn}
          </button>
        </div>
      )}

      {showGpsDenied && (
        <div
          role="alert"
          className="p-3 rounded-xl bg-white border-2 border-[#D7352B] flex flex-col sm:flex-row sm:items-center justify-between gap-2"
        >
          <div>
            <p className="text-sm font-bold text-[#1F2A2E]">{t.gpsDeniedTitle}</p>
            <p className="text-sm text-[#526066]">{t.gpsDeniedBody}</p>
          </div>
          <button
            type="button"
            onClick={onRequestLocation}
            className="min-h-[44px] px-3.5 rounded-lg bg-[#1F2A2E] text-white text-sm font-bold whitespace-nowrap shrink-0 self-start sm:self-center"
          >
            {t.gpsRetryBtn}
          </button>
        </div>
      )}

      {gpsError && permissionState !== 'denied' && !position && (
        <div
          role="alert"
          className="p-3 rounded-xl bg-white border-2 border-[#1F2A2E] flex items-center justify-between gap-3"
        >
          <p className="text-sm text-[#1F2A2E]">{gpsError}</p>
          <button
            type="button"
            onClick={onRequestLocation}
            className="min-h-[44px] px-3 rounded-lg bg-[#1F2A2E] text-white text-sm font-bold shrink-0"
          >
            {t.gpsRetryBtn}
          </button>
        </div>
      )}

      {showWeakAccuracy && position && (
        <div
          role="status"
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white border-2 border-[#1F2A2E] text-sm text-[#1F2A2E]"
        >
          <AlertTriangle className="w-4 h-4 text-[#FFC20E] shrink-0" aria-hidden="true" />
          <span className="tabular-nums">
            {t.gpsAccuracyWarning} {Math.round(position.accuracy)} m
          </span>
        </div>
      )}
    </div>
  );
}
