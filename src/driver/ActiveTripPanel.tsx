import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Check,
  Clock,
  Minus,
  Plus,
  ShieldAlert,
  Users,
  X,
} from 'lucide-react';
import { useI18n } from '../i18n/I18nContext';
import type { UseGeolocationResult } from '../map/useGeolocation';
import { formatElapsed, type DemandCluster } from '../trips/tripLogic';
import type { DemandPin, SeatRequest, Trip } from '../types/firestore';
import { getVehicleLabel, VehicleIcon } from '../ui/VehicleIcons';

interface ActiveTripStripProps {
  trip: Trip;
  wakeLockActive: boolean;
  busyAction: string | null;
  onAdjustSeats: (delta: number) => Promise<void>;
}

export function ActiveTripStrip({
  trip,
  wakeLockActive,
  busyAction,
  onAdjustSeats,
}: ActiveTripStripProps) {
  const { t } = useI18n();
  const [elapsedSec, setElapsedSec] = useState(() => {
    const startMs = trip.createdAt?.toMillis?.() ?? Date.now();
    return Math.max(0, Math.floor((Date.now() - startMs) / 1000));
  });

  useEffect(() => {
    const startMs = trip.createdAt?.toMillis?.() ?? Date.now();
    const tick = () => {
      setElapsedSec(Math.max(0, Math.floor((Date.now() - startMs) / 1000)));
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [trip.id, trip.createdAt]);

  return (
    <div
      aria-label="Active trip strip"
      className="bg-[#1F2A2E] text-white px-3 py-2 flex items-center justify-between gap-3 border-b-2 border-[#FFC20E]"
    >
      <div className="flex items-center gap-2 min-w-0">
        <button
          type="button"
          disabled={busyAction === 'seats' || trip.seatsFree <= 0}
          onClick={() => void onAdjustSeats(-1)}
          aria-label={t.driverSeatsDecrease}
          className="h-10 w-10 rounded-lg bg-white/15 hover:bg-white/25 flex items-center justify-center disabled:opacity-40"
        >
          <Minus className="w-4 h-4" aria-hidden="true" />
        </button>

        <div className="px-2 text-center">
          <span className="font-sign font-extrabold text-lg text-[#FFC20E] tabular-nums">
            {trip.seatsFree}
          </span>
          <span className="ml-1.5 text-xs font-bold text-white/90">
            {t.driverSeatsFreeSuffix}
          </span>
        </div>

        <button
          type="button"
          disabled={busyAction === 'seats' || trip.seatsFree >= trip.seatsTotal}
          onClick={() => void onAdjustSeats(1)}
          aria-label={t.driverSeatsIncrease}
          className="h-10 w-10 rounded-lg bg-white/15 hover:bg-white/25 flex items-center justify-center disabled:opacity-40"
        >
          <Plus className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>

      <div className="flex items-center gap-3 shrink-0">
        {wakeLockActive && (
          <span className="hidden sm:inline text-xs font-medium text-[#FFC20E]">
            {t.driverScreenAwake}
          </span>
        )}
        <div className="inline-flex items-center gap-1.5 text-sm font-bold tabular-nums">
          <Clock className="w-4 h-4 text-[#FFC20E]" aria-hidden="true" />
          <span>{formatElapsed(elapsedSec)}</span>
        </div>
      </div>
    </div>
  );
}

interface ActiveTripPanelProps {
  trip: Trip;
  geo: UseGeolocationResult;
  pendingRequests: SeatRequest[];
  acceptedRequests: SeatRequest[];
  demandClusters: DemandCluster[];
  busyAction: string | null;
  onAcceptRequest: (req: SeatRequest) => Promise<void>;
  onDeclineRequest: (req: SeatRequest) => Promise<void>;
  onOfferDemandPin: (pin: DemandPin) => Promise<void>;
  onEndTrip: () => Promise<void>;
  onReportBreakdown: () => Promise<void>;
}

export function ActiveTripPanel({
  trip,
  geo,
  pendingRequests,
  acceptedRequests,
  demandClusters,
  busyAction,
  onAcceptRequest,
  onDeclineRequest,
  onOfferDemandPin,
  onEndTrip,
  onReportBreakdown,
}: ActiveTripPanelProps) {
  const { t } = useI18n();
  const [confirmBreakdown, setConfirmBreakdown] = useState(false);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <VehicleIcon type={trip.vehicleType} />
          <div className="min-w-0">
            <p className="text-xs font-bold text-[#0E6B4E]">
              {getVehicleLabel(trip.vehicleType, t)}
            </p>
            <p className="font-sign font-bold text-base text-[#1F2A2E] truncate">
              {trip.destinationName}
            </p>
          </div>
        </div>
      </div>

      {!geo.position && (
        <div
          role="alert"
          className="p-3 rounded-xl bg-[#FFC20E]/20 border-2 border-[#1F2A2E] flex items-center justify-between gap-3"
        >
          <p className="text-sm font-medium text-[#1F2A2E]">{t.driverGpsMissingBanner}</p>
          <button
            type="button"
            onClick={geo.requestLocation}
            className="min-h-[44px] px-3 rounded-lg bg-[#1F2A2E] text-white text-xs font-bold shrink-0"
          >
            {t.gpsRetryBtn}
          </button>
        </div>
      )}

      <section aria-label={t.driverSeatRequestsTitle} className="space-y-2">
        <h2 className="font-sign font-bold text-base text-[#1F2A2E]">
          {t.driverSeatRequestsTitle}
        </h2>

        {pendingRequests.length === 0 ? (
          <p className="text-sm text-[#526066]">{t.driverSeatRequestsEmpty}</p>
        ) : (
          <div className="space-y-2.5">
            {pendingRequests.map((req) => (
              <div
                key={req.id}
                className="p-3.5 rounded-xl bg-[#FFC20E]/20 border-2 border-[#1F2A2E] space-y-3"
              >
                <div>
                  <p className="font-sign font-bold text-lg text-[#1F2A2E]">{req.studentName}</p>
                  <p className="text-sm text-[#526066]">{req.destinationName}</p>
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    disabled={busyAction === `accept:${req.id}` || trip.seatsFree <= 0}
                    onClick={() => void onAcceptRequest(req)}
                    className="min-h-[56px] px-3 rounded-xl bg-[#0E6B4E] hover:bg-[#0A523B] text-white font-bold text-base flex items-center justify-center gap-1.5 disabled:opacity-50"
                  >
                    <Check className="w-5 h-5" aria-hidden="true" />
                    <span>{t.driverAcceptBtn}</span>
                  </button>

                  <button
                    type="button"
                    disabled={busyAction === `decline:${req.id}`}
                    onClick={() => void onDeclineRequest(req)}
                    className="min-h-[56px] px-3 rounded-xl bg-white border-2 border-[#1F2A2E] text-[#1F2A2E] font-bold text-base flex items-center justify-center gap-1.5"
                  >
                    <X className="w-5 h-5" aria-hidden="true" />
                    <span>{t.driverDeclineBtn}</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {acceptedRequests.length > 0 && (
        <section aria-label={t.driverAcceptedRidersTitle} className="space-y-2 pt-2 border-t border-[#D5DDD8]">
          <h3 className="font-sign font-bold text-sm text-[#1F2A2E]">
            {t.driverAcceptedRidersTitle} ({acceptedRequests.length})
          </h3>
          <div className="space-y-1.5">
            {acceptedRequests.map((req) => (
              <div
                key={req.id}
                className="px-3 py-2.5 rounded-xl bg-[#F2F5F3] border border-[#D5DDD8] flex items-center justify-between gap-3"
              >
                <span className="font-bold text-base text-[#1F2A2E] truncate">
                  {req.studentName}
                </span>
                {req.rideCode && (
                  <span className="px-2.5 py-1 rounded bg-[#FFC20E] text-[#1F2A2E] font-sign font-extrabold text-sm tabular-nums border border-[#1F2A2E]">
                    {t.driverRideCodeLabel} {req.rideCode}
                  </span>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {demandClusters.length > 0 && (
        <section aria-label={t.driverDemandPinsTitle} className="space-y-2 pt-2 border-t border-[#D5DDD8]">
          <h3 className="font-sign font-bold text-sm text-[#1F2A2E] flex items-center gap-1.5">
            <Users className="w-4 h-4 text-[#0E6B4E]" aria-hidden="true" />
            <span>{t.driverDemandPinsTitle}</span>
          </h3>
          <div className="space-y-2">
            {demandClusters.map((cluster) => {
              const firstPin = cluster.pins[0];
              const alreadyOffered = cluster.pins.some((p) => p.offeredTripId === trip.id);
              return (
                <div
                  key={cluster.id}
                  className="p-3 rounded-xl bg-[#F2F5F3] border border-[#1F2A2E] flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <p className="font-bold text-sm text-[#1F2A2E]">
                      {cluster.count === 1
                        ? t.driverDemandWaitingSingle
                        : `${cluster.count} ${t.driverDemandWaitingPlural}`}
                    </p>
                    <p className="text-xs text-[#526066] truncate">{cluster.primaryDestination}</p>
                  </div>
                  <button
                    type="button"
                    disabled={alreadyOffered || busyAction === `pin:${firstPin.id}`}
                    onClick={() => void onOfferDemandPin(firstPin)}
                    className="min-h-[44px] px-3 rounded-lg bg-[#0E6B4E] text-white text-xs font-bold shrink-0 disabled:opacity-60"
                  >
                    {alreadyOffered ? t.driverOfferSent : t.driverTakeThemBtn}
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <div className="pt-3 border-t border-[#D5DDD8] space-y-2.5">
        {confirmBreakdown ? (
          <div
            role="alertdialog"
            aria-label={t.driverBreakdownConfirmTitle}
            className="p-3.5 rounded-xl bg-[#D7352B]/10 border-2 border-[#D7352B] space-y-3"
          >
            <div className="flex items-start gap-2.5">
              <ShieldAlert className="w-5 h-5 text-[#D7352B] mt-0.5 shrink-0" aria-hidden="true" />
              <div>
                <p className="font-sign font-bold text-base text-[#1F2A2E]">
                  {t.driverBreakdownConfirmTitle}
                </p>
                <p className="text-sm text-[#1F2A2E] mt-0.5">{t.driverBreakdownConfirmBody}</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                disabled={busyAction === 'disrupted'}
                onClick={() => {
                  setConfirmBreakdown(false);
                  void onReportBreakdown();
                }}
                className="min-w-0 min-h-[56px] px-3 py-2 rounded-xl bg-[#D7352B] text-white font-bold text-sm leading-tight break-words"
              >
                {t.driverBreakdownConfirmYes}
              </button>
              <button
                type="button"
                onClick={() => setConfirmBreakdown(false)}
                className="min-w-0 min-h-[56px] px-3 py-2 rounded-xl bg-white border-2 border-[#1F2A2E] text-[#1F2A2E] font-bold text-sm leading-tight break-words"
              >
                {t.driverBreakdownConfirmNo}
              </button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2.5">
            <button
              type="button"
              disabled={busyAction === 'completed'}
              onClick={() => void onEndTrip()}
              className="min-w-0 min-h-[56px] px-3 py-2 rounded-xl bg-[#1F2A2E] text-white font-sign font-bold text-sm sm:text-base leading-tight text-center"
            >
              {t.driverEndTripBtn}
            </button>

            <button
              type="button"
              onClick={() => setConfirmBreakdown(true)}
              className="min-w-0 min-h-[56px] px-3 py-2 rounded-xl bg-[#D7352B] text-white font-sign font-bold text-sm sm:text-base leading-tight inline-flex items-center justify-center gap-1.5 text-center"
            >
              <AlertTriangle className="w-5 h-5 shrink-0" aria-hidden="true" />
              <span className="min-w-0 break-words">{t.driverCantContinueBtn}</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
