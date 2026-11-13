import React from 'react';
import { ShieldCheck, ShieldAlert } from 'lucide-react';
import { useI18n } from '../i18n/I18nContext';
import type { TranslationStrings } from '../i18n/types';
import { formatClockTime, type MatchedRideOption, type RankingReason } from '../matching/matchRides';
import { getVehicleLabel, VehicleIcon } from '../ui/VehicleIcons';

function formatRankingReason(reason: RankingReason, t: TranslationStrings): string {
  switch (reason.code) {
    case 'live_online':
      return t.reasonLiveOnline;
    case 'scheduled_upcoming':
      return t.reasonScheduledUpcoming;
    case 'vehicle_offline':
      return t.reasonVehicleOffline;
    case 'before_bell':
      return `${reason.minutes ?? 0} min ${t.reasonBeforeBell}`;
    case 'after_bell':
      return `${reason.minutes ?? 0} min ${t.reasonAfterBell}`;
    case 'closest_stop':
      if ((reason.meters ?? 0) < 40) return t.reasonClosestStopHere;
      return `${reason.minutes ?? 1} min ${t.reasonClosestStopMeters} (${reason.meters ?? 0} m)`;
    case 'soonest_pickup':
      if ((reason.minutes ?? 0) <= 0) return t.reasonSoonestPickupNow;
      return `${t.reasonSoonestPickupMin} ${reason.minutes} min`;
    case 'verified_driver':
      return t.reasonVerifiedDriver;
    case 'extra_seats':
      return `${reason.seats ?? 0} ${t.reasonExtraSeats}`;
  }
}

interface RideOptionCardProps {
  option: MatchedRideOption;
  selected: boolean;
  busy: boolean;
  onSelect: () => void;
  onAskSeat: () => void;
}

export function RideOptionCard({
  option,
  selected,
  busy,
  onSelect,
  onAskSeat,
}: RideOptionCardProps) {
  const { t } = useI18n();
  const { trip } = option;

  const vehicleName = getVehicleLabel(trip.vehicleType, t);
  const arrivalStr = formatClockTime(option.arrivalEpochMs);
  const stopEtaText =
    option.etaToPickupMinutes <= 0
      ? t.reachesStopNow
      : `${t.reachesStopIn} ${option.etaToPickupMinutes} min`;
  const walkText =
    option.walkMinutes <= 0
      ? t.walkAtStop
      : `${t.walkMin} ${option.walkMinutes} min`;

  const reasonText = option.rankingReasons
    .slice(0, 3)
    .map((r) => formatRankingReason(r, t))
    .join(' · ');

  return (
    <article
      className={`rounded-2xl border-2 transition-colors overflow-hidden ${
        selected ? 'border-[#0E6B4E] bg-[#0E6B4E]/5' : 'border-[#1F2A2E] bg-white'
      }`}
    >
      <button
        type="button"
        onClick={onSelect}
        className="w-full p-3.5 text-left space-y-2.5 focus-visible:outline-2 focus-visible:outline-[#1F2A2E]"
      >
        <div className="flex items-start justify-between gap-2.5">
          <div className="flex items-center gap-2.5 min-w-0">
            <VehicleIcon type={trip.vehicleType} />
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-sign font-bold text-base text-[#1F2A2E]">
                  {vehicleName}
                </span>
                <span className="text-sm text-[#526066]" aria-hidden="true">
                  ·
                </span>
                <span className="text-sm font-bold text-[#1F2A2E] truncate">
                  {trip.driverName}
                </span>
              </div>
              <p className="text-xs text-[#526066] truncate">
                {trip.originName} → {trip.destinationName}
              </p>
            </div>
          </div>

          <div className="flex flex-col items-end shrink-0 gap-1">
            <span className="inline-flex items-center gap-1 text-xs font-bold text-[#1F2A2E]">
              {trip.driverVerified ? (
                <>
                  <ShieldCheck className="w-4 h-4 text-[#0E6B4E]" aria-hidden="true" />
                  <span className="text-[#0E6B4E]">{t.badgeVerified}</span>
                </>
              ) : (
                <>
                  <ShieldAlert className="w-4 h-4 text-[#526066]" aria-hidden="true" />
                  <span className="text-[#526066]">{t.badgeNotVerified}</span>
                </>
              )}
            </span>
            {option.isVehicleOffline && (
              <span className="text-xs font-bold text-[#D7352B]">{t.vehicleOfflineBadge}</span>
            )}
          </div>
        </div>

        <div className="text-sm text-[#1F2A2E] font-medium tabular-nums space-y-0.5">
          <p className="font-bold text-[#0E6B4E]">
            {stopEtaText} · {walkText}
          </p>
          <p>
            {t.reachesSchoolAt} {arrivalStr}
            {option.minutesBeforeBell !== null && (
              <>
                {', '}
                {option.minutesBeforeBell >= 0 ? (
                  <span className="font-bold text-[#0E6B4E]">
                    {option.minutesBeforeBell} min {t.beforeBellSuffix}
                  </span>
                ) : (
                  <span className="font-bold text-[#D7352B]">
                    {Math.abs(option.minutesBeforeBell)} min {t.afterBellSuffix}
                  </span>
                )}
              </>
            )}
          </p>
          <p className="text-xs text-[#526066]">
            {trip.seatsFree} {t.seatsLeftSuffix}
            {selected ? ` · ${t.selectedRideBadge}` : ''}
          </p>
        </div>

        <p className="text-xs text-[#1F2A2E] bg-[#F2F5F3] px-2.5 py-2 rounded-lg border border-[#D5DDD8] break-words">
          <span className="font-bold">
            #{option.rank} {t.reasonWhyPrefix}:
          </span>{' '}
          {reasonText}
        </p>

        {!trip.driverVerified && (
          <div
            role="note"
            className="flex items-start gap-2 px-2.5 py-2 rounded-lg bg-[#FFC20E]/20 border border-[#1F2A2E] text-xs font-bold text-[#1F2A2E]"
          >
            <ShieldAlert className="w-4 h-4 text-[#D7352B] mt-0.5 shrink-0" aria-hidden="true" />
            <span className="break-words">{t.unverifiedDriverWarning}</span>
          </div>
        )}
      </button>

      <div className="px-3.5 pb-3.5">
        <button
          type="button"
          disabled={busy || trip.seatsFree <= 0}
          onClick={onAskSeat}
          className="w-full min-h-[56px] px-4 rounded-xl bg-[#0E6B4E] hover:bg-[#0A523B] text-white font-sign font-bold text-base border-2 border-[#1F2A2E] disabled:opacity-50 transition-colors"
        >
          {busy ? t.askingSeatBtn : t.askForSeatBtn}
        </button>
      </div>
    </article>
  );
}
