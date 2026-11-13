import React, { useEffect, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Clock,
  MapPin,
  Minus,
  Navigation,
  Plus,
  RotateCcw,
} from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { useI18n } from '../i18n/I18nContext';
import { fetchOsrmRoute, type OsrmRouteResult } from '../map/osrm';
import type { PlaceResult } from '../map/photon';
import type { UseGeolocationResult } from '../map/useGeolocation';
import { formatDistance, formatDuration, resolveDepartureDate } from '../trips/tripLogic';
import type { StartTripInput } from '../trips/useDriverTrip';
import type { Trip, VehicleType } from '../types/firestore';
import { PlaceSearchInput } from '../ui/PlaceSearchInput';
import { getVehicleLabel, VEHICLE_TYPES, VehicleIcon } from '../ui/VehicleIcons';

interface StartTripSheetProps {
  geo: UseGeolocationResult;
  scheduledTrips: Trip[];
  busyAction: string | null;
  tripError: string | null;
  onClearTripError: () => void;
  onPreviewRouteChange: (route: OsrmRouteResult | null, destPlace: PlaceResult | null) => void;
  onStartTrip: (input: StartTripInput) => Promise<boolean>;
  onActivateScheduled: (tripId: string) => Promise<void>;
  onExpandSheet: () => void;
  onRoutePreviewReady?: () => void;
}

export function StartTripSheet({
  geo,
  scheduledTrips,
  busyAction,
  tripError,
  onClearTripError,
  onPreviewRouteChange,
  onStartTrip,
  onActivateScheduled,
  onExpandSheet,
  onRoutePreviewReady,
}: StartTripSheetProps) {
  const { t } = useI18n();
  const { firebaseUser, completeOnboarding, signInWithGoogle, authBusy } = useAuth();

  const [wizardOpen, setWizardOpen] = useState(false);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [vehicleType, setVehicleType] = useState<VehicleType>('milk_van');
  const [seatsTotal, setSeatsTotal] = useState<number>(4);

  const [manualOrigin, setManualOrigin] = useState<PlaceResult | null>(null);
  const [editingOrigin, setEditingOrigin] = useState(false);
  const [destination, setDestination] = useState<PlaceResult | null>(null);
  const [departureMode, setDepartureMode] = useState<'now' | 'later'>('now');
  const [departureTimeStr, setDepartureTimeStr] = useState(() => {
    const d = new Date(Date.now() + 30 * 60000);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  });

  const [routeResult, setRouteResult] = useState<OsrmRouteResult | null>(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [routeRetryCount, setRouteRetryCount] = useState(0);

  const effectiveOrigin =
    manualOrigin ??
    (geo.position
      ? {
          id: 'current-gps',
          name: 'Current GPS',
          subtitle: `${geo.position.lat.toFixed(4)}, ${geo.position.lng.toFixed(4)}`,
          lat: geo.position.lat,
          lng: geo.position.lng,
        }
      : null);

  useEffect(() => {
    if (!wizardOpen || step !== 3 || !effectiveOrigin || !destination) {
      setRouteResult(null);
      setRouteError(null);
      setRouteLoading(false);
      onPreviewRouteChange(null, destination);
      return;
    }

    const controller = new AbortController();
    setRouteLoading(true);
    setRouteError(null);

    fetchOsrmRoute(
      { lat: effectiveOrigin.lat, lng: effectiveOrigin.lng },
      { lat: destination.lat, lng: destination.lng },
      { signal: controller.signal },
    )
      .then(({ route }) => {
        if (controller.signal.aborted) return;
        setRouteResult(route);
        setRouteLoading(false);
        onPreviewRouteChange(route, destination);
        onRoutePreviewReady?.();
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setRouteLoading(false);
        setRouteResult(null);
        setRouteError(t.driverRouteError);
        onPreviewRouteChange(null, destination);
      });

    return () => controller.abort();
  }, [
    wizardOpen,
    step,
    effectiveOrigin?.lat,
    effectiveOrigin?.lng,
    destination?.lat,
    destination?.lng,
    routeRetryCount,
    t.driverRouteError,
    onPreviewRouteChange,
  ]);

  const handleCloseWizard = () => {
    setWizardOpen(false);
    setStep(1);
    setRouteResult(null);
    setRouteError(null);
    onPreviewRouteChange(null, null);
    onClearTripError();
  };

  const handleGo = async () => {
    if (!effectiveOrigin || !destination || !routeResult) return;
    const departureDate = resolveDepartureDate(departureMode, departureTimeStr);
    const ok = await onStartTrip({
      vehicleType,
      seatsTotal,
      originName: effectiveOrigin.name,
      origin: { lat: effectiveOrigin.lat, lng: effectiveOrigin.lng },
      destinationName: destination.name,
      destination: { lat: destination.lat, lng: destination.lng },
      departureMode,
      departureDate,
      route: routeResult,
    });
    if (ok) {
      handleCloseWizard();
    }
  };

  if (!wizardOpen) {
    return (
      <div className="space-y-3">
        <p className="text-base text-[#1F2A2E]">{t.driverHomePrompt}</p>

        <button
          type="button"
          onClick={() => {
            setWizardOpen(true);
            setStep(1);
            onExpandSheet();
          }}
          className="w-full min-h-[56px] px-5 rounded-xl bg-[#0E6B4E] hover:bg-[#0A523B] text-white font-sign font-bold text-lg border-2 border-[#1F2A2E] flex items-center justify-center gap-2.5 transition-colors"
        >
          <Navigation className="w-5 h-5" aria-hidden="true" />
          <span>{t.driverStartTripBtn}</span>
        </button>

        {scheduledTrips.length > 0 && (
          <div className="space-y-2 pt-2 border-t border-[#D5DDD8]">
            <p className="text-sm font-bold text-[#1F2A2E]">{t.driverScheduledReady}</p>
            {scheduledTrips.map((tr) => (
              <div
                key={tr.id}
                className="p-3 rounded-xl bg-[#F2F5F3] border-2 border-[#1F2A2E] flex items-center justify-between gap-3"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <VehicleIcon type={tr.vehicleType} />
                  <div className="min-w-0">
                    <p className="font-bold text-base text-[#1F2A2E] truncate">
                      {tr.destinationName}
                    </p>
                    <p className="text-sm text-[#526066] tabular-nums">
                      {tr.seatsFree} {t.driverSeatsFreeSuffix} ·{' '}
                      {formatDistance(tr.distanceMeters)}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  disabled={busyAction === `activate:${tr.id}`}
                  onClick={() => void onActivateScheduled(tr.id)}
                  className="min-h-[48px] px-4 rounded-xl bg-[#0E6B4E] text-white font-bold text-sm shrink-0"
                >
                  {t.driverGoLiveNowBtn}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 pb-2 border-b border-[#D5DDD8]">
        <button
          type="button"
          onClick={() => {
            if (step === 1) {
              handleCloseWizard();
            } else {
              setStep((s) => (s === 3 ? 2 : 1));
            }
          }}
          className="min-h-[44px] px-3 rounded-lg border border-[#D5DDD8] text-sm font-bold text-[#1F2A2E] inline-flex items-center gap-1.5"
        >
          <ArrowLeft className="w-4 h-4" aria-hidden="true" />
          <span>{t.driverBackBtn}</span>
        </button>

        <span className="text-sm font-bold text-[#526066] tabular-nums">
          {t.driverStepLabel} {step} / 3
        </span>
      </div>

      {step === 1 && (
        <div className="space-y-3">
          <h2 className="font-sign font-bold text-lg text-[#1F2A2E]">{t.driverStep1Title}</h2>

          <div className="grid grid-cols-2 gap-2.5">
            {VEHICLE_TYPES.map((vt) => {
              const active = vehicleType === vt;
              return (
                <button
                  key={vt}
                  type="button"
                  onClick={() => setVehicleType(vt)}
                  aria-pressed={active}
                  className={`min-h-[64px] p-3 rounded-xl border-2 text-left flex items-center gap-2.5 transition-colors ${
                    active
                      ? 'bg-[#FFC20E]/25 border-[#1F2A2E]'
                      : 'bg-white border-[#D5DDD8] hover:border-[#1F2A2E]'
                  }`}
                >
                  <VehicleIcon type={vt} />
                  <span className="font-bold text-sm text-[#1F2A2E] leading-tight">
                    {getVehicleLabel(vt, t)}
                  </span>
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={() => setStep(2)}
            className="w-full min-h-[56px] px-5 rounded-xl bg-[#0E6B4E] hover:bg-[#0A523B] text-white font-sign font-bold text-lg flex items-center justify-center gap-2"
          >
            <span>{t.driverNextBtn}</span>
            <ArrowRight className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4">
          <div>
            <h2 className="font-sign font-bold text-lg text-[#1F2A2E]">{t.driverStep2Title}</h2>
            <p className="text-sm text-[#526066] mt-0.5">{t.driverStep2Hint}</p>
          </div>

          <div className="flex items-center justify-between gap-4 p-4 rounded-2xl bg-[#F2F5F3] border-2 border-[#1F2A2E]">
            <button
              type="button"
              onClick={() => setSeatsTotal((n) => Math.max(1, n - 1))}
              aria-label={t.driverSeatsDecrease}
              className="h-14 w-14 rounded-xl bg-white border-2 border-[#1F2A2E] text-[#1F2A2E] flex items-center justify-center active:scale-95"
            >
              <Minus className="w-6 h-6" aria-hidden="true" />
            </button>

            <div className="text-center">
              <span className="block font-sign font-extrabold text-4xl text-[#1F2A2E] tabular-nums">
                {seatsTotal}
              </span>
              <span className="block text-sm font-bold text-[#526066]">
                {t.driverSeatsFreeSuffix}
              </span>
            </div>

            <button
              type="button"
              onClick={() => setSeatsTotal((n) => Math.min(40, n + 1))}
              aria-label={t.driverSeatsIncrease}
              className="h-14 w-14 rounded-xl bg-white border-2 border-[#1F2A2E] text-[#1F2A2E] flex items-center justify-center active:scale-95"
            >
              <Plus className="w-6 h-6" aria-hidden="true" />
            </button>
          </div>

          <button
            type="button"
            onClick={() => setStep(3)}
            className="w-full min-h-[56px] px-5 rounded-xl bg-[#0E6B4E] hover:bg-[#0A523B] text-white font-sign font-bold text-lg flex items-center justify-center gap-2"
          >
            <span>{t.driverNextBtn}</span>
            <ArrowRight className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-3">
          <h2 className="font-sign font-bold text-lg text-[#1F2A2E]">{t.driverStep3Title}</h2>

          {effectiveOrigin && !editingOrigin ? (
            <div className="p-2.5 rounded-xl bg-[#F2F5F3] border border-[#D5DDD8] flex items-center justify-between gap-2">
              <div className="min-w-0">
                {effectiveOrigin.id === 'current-gps' ? (
                  <>
                    <p className="text-xs font-bold text-[#0E6B4E]">{effectiveOrigin.name}</p>
                    <p className="text-sm font-medium text-[#526066] tabular-nums truncate">
                      {effectiveOrigin.subtitle}
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-xs font-bold text-[#0E6B4E]">{t.driverOriginManualLabel}</p>
                    <p className="text-sm font-bold text-[#1F2A2E] truncate">
                      {effectiveOrigin.name}
                    </p>
                  </>
                )}
              </div>
              <button
                type="button"
                onClick={() => setEditingOrigin(true)}
                className="min-h-[44px] px-3 rounded-lg bg-white border border-[#1F2A2E] text-xs font-bold text-[#1F2A2E] shrink-0"
              >
                {t.driverOriginChangeBtn}
              </button>
            </div>
          ) : (
            <PlaceSearchInput
              label={t.driverOriginManualLabel}
              biasLat={geo.position?.lat}
              biasLng={geo.position?.lng}
              onSelectPlace={(place) => {
                setManualOrigin(place);
                setEditingOrigin(false);
              }}
            />
          )}

          {!destination ? (
            <PlaceSearchInput
              label={t.searchLabelDriver}
              biasLat={effectiveOrigin?.lat ?? geo.position?.lat}
              biasLng={effectiveOrigin?.lng ?? geo.position?.lng}
              onSelectPlace={(place) => setDestination(place)}
            />
          ) : (
            <div className="p-2.5 rounded-xl bg-[#F2F5F3] border-2 border-[#1F2A2E] flex items-center justify-between gap-2">
              <div className="flex items-start gap-2 min-w-0">
                <MapPin className="w-5 h-5 text-[#0E6B4E] mt-0.5 shrink-0" aria-hidden="true" />
                <div className="min-w-0">
                  <p className="font-bold text-base text-[#1F2A2E] truncate">{destination.name}</p>
                  {destination.subtitle && (
                    <p className="text-sm text-[#526066] truncate">{destination.subtitle}</p>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setDestination(null);
                  setRouteResult(null);
                  onPreviewRouteChange(null, null);
                }}
                className="min-h-[44px] px-3 rounded-lg bg-white border border-[#1F2A2E] text-xs font-bold text-[#1F2A2E] shrink-0"
              >
                {t.clearSavedSchool}
              </button>
            </div>
          )}

          <div className="space-y-2">
            <p className="text-sm font-bold text-[#1F2A2E]">{t.driverLeavingLabel}</p>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setDepartureMode('now')}
                aria-pressed={departureMode === 'now'}
                className={`min-h-[48px] px-3 rounded-xl border-2 font-bold text-sm ${
                  departureMode === 'now'
                    ? 'bg-[#FFC20E] text-[#1F2A2E] border-[#1F2A2E]'
                    : 'bg-white text-[#1F2A2E] border-[#D5DDD8]'
                }`}
              >
                {t.driverLeaveNow}
              </button>
              <button
                type="button"
                onClick={() => setDepartureMode('later')}
                aria-pressed={departureMode === 'later'}
                className={`min-h-[48px] px-3 rounded-xl border-2 font-bold text-sm ${
                  departureMode === 'later'
                    ? 'bg-[#FFC20E] text-[#1F2A2E] border-[#1F2A2E]'
                    : 'bg-white text-[#1F2A2E] border-[#D5DDD8]'
                }`}
              >
                {t.driverLeaveLater}
              </button>
            </div>

            {departureMode === 'later' && (
              <label className="flex items-center justify-between gap-3 p-3 rounded-xl bg-[#F2F5F3] border border-[#D5DDD8]">
                <span className="text-sm font-bold text-[#1F2A2E] inline-flex items-center gap-1.5">
                  <Clock className="w-4 h-4" aria-hidden="true" />
                  <span>{t.driverDepartureTimeLabel}</span>
                </span>
                <input
                  type="time"
                  value={departureTimeStr}
                  onChange={(e) => setDepartureTimeStr(e.target.value)}
                  className="px-3 py-2 rounded-lg bg-white border-2 border-[#1F2A2E] text-base font-bold tabular-nums"
                />
              </label>
            )}
          </div>

          {routeLoading && (
            <p role="status" className="text-sm font-bold text-[#0E6B4E]">
              {t.driverRouteLoading}
            </p>
          )}

          {routeError && (
            <div
              role="alert"
              className="p-3 rounded-xl bg-[#D7352B]/10 border-2 border-[#D7352B] flex items-center justify-between gap-3"
            >
              <p className="text-sm font-medium text-[#1F2A2E]">{routeError}</p>
              <button
                type="button"
                onClick={() => setRouteRetryCount((c) => c + 1)}
                className="min-h-[44px] px-3 rounded-lg bg-[#1F2A2E] text-white text-sm font-bold inline-flex items-center gap-1.5 shrink-0"
              >
                <RotateCcw className="w-4 h-4" aria-hidden="true" />
                <span>{t.retry}</span>
              </button>
            </div>
          )}

          {routeResult && (
            <div className="p-3.5 rounded-xl bg-[#0E6B4E]/10 border-2 border-[#0E6B4E] flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-bold text-[#0E6B4E]">{t.driverRoutePreviewTitle}</p>
                <p className="font-sign font-bold text-lg text-[#1F2A2E] tabular-nums">
                  {formatDistance(routeResult.distanceMeters)} ·{' '}
                  {formatDuration(routeResult.durationSeconds)}
                </p>
              </div>
              <VehicleIcon type={vehicleType} />
            </div>
          )}

          {tripError === 'sign_in_required' && !firebaseUser && (
            <div className="p-3.5 rounded-xl bg-[#FFC20E]/20 border-2 border-[#1F2A2E] space-y-2.5">
              <p className="text-sm font-bold text-[#1F2A2E]">{t.driverSignInNeeded}</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <button
                  type="button"
                  disabled={authBusy}
                  onClick={() => void signInWithGoogle()}
                  className="min-h-[48px] px-3 rounded-xl bg-[#0E6B4E] text-white font-bold text-sm"
                >
                  {t.continueWithGoogle}
                </button>
                <button
                  type="button"
                  disabled={authBusy}
                  onClick={() => void completeOnboarding('guest', 'driver')}
                  className="min-h-[48px] px-3 rounded-xl bg-white border-2 border-[#1F2A2E] text-[#1F2A2E] font-bold text-sm"
                >
                  {t.continueAsGuest}
                </button>
              </div>
            </div>
          )}

          <button
            type="button"
            disabled={!routeResult || routeLoading || busyAction === 'start'}
            onClick={() => void handleGo()}
            className="w-full min-h-[56px] px-5 rounded-xl bg-[#0E6B4E] hover:bg-[#0A523B] text-white font-sign font-bold text-lg border-2 border-[#1F2A2E] disabled:opacity-50 transition-colors"
          >
            {busyAction === 'start' ? t.driverPublishing : t.driverGoBtn}
          </button>
        </div>
      )}
    </div>
  );
}
