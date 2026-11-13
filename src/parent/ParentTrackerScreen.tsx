import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { AlertTriangle, Clock, ShieldAlert, ShieldCheck, ShieldOff } from 'lucide-react';
import { db, isFirestoreOfflineError, testFirestoreConnection } from '../firebase/config';
import { useI18n } from '../i18n/I18nContext';
import { NxtMap, type LiveVehicleMarker } from '../map/NxtMap';
import { isLivePositionFresh } from '../matching/matchRides';
import { formatDuration, haversineDistanceMeters } from '../trips/tripLogic';
import type { Language, LatLngPoint, LivePosition, Trip } from '../types/firestore';
import { SkeletonCard } from '../ui/LoadingSkeleton';
import { OfflineBadge, OfflineLocalBanner } from '../ui/OfflineBadge';
import { getVehicleLabel, VehicleIcon } from '../ui/VehicleIcons';
import { Wordmark } from '../ui/Wordmark';

interface ParentTrackerScreenProps {
  tripId: string;
  studentLabel?: string;
  destLabel?: string;
  pickupPoint?: LatLngPoint | null;
  rideCode?: string;
  onExitToApp: () => void;
}

const LANG_OPTIONS: Array<{ id: Language; short: string }> = [
  { id: 'en', short: 'EN' },
  { id: 'kn', short: 'ಕನ್ನಡ' },
  { id: 'hi', short: 'हिन्दी' },
];

export function ParentTrackerScreen({
  tripId,
  studentLabel,
  destLabel,
  pickupPoint = null,
  rideCode,
  onExitToApp,
}: ParentTrackerScreenProps) {
  const { t, language, setLanguage } = useI18n();
  const [trip, setTrip] = useState<Trip | null>(null);
  const [livePos, setLivePos] = useState<LivePosition | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [browserOnline, setBrowserOnline] = useState(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  );
  const [firestoreOffline, setFirestoreOffline] = useState(false);

  const retryConnection = useCallback(async () => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setBrowserOnline(false);
      setFirestoreOffline(true);
      return;
    }
    setBrowserOnline(true);
    const probe = await testFirestoreConnection();
    setFirestoreOffline(probe.offline);
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 10_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const handleOnline = () => {
      setBrowserOnline(true);
      void retryConnection();
    };
    const handleOffline = () => {
      setBrowserOnline(false);
      setFirestoreOffline(true);
    };
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [retryConnection]);

  useEffect(() => {
    setLoaded(false);
    setNotFound(false);

    const unsubTrip = onSnapshot(
      doc(db, 'trips', tripId),
      { includeMetadataChanges: true },
      (snap) => {
        if (!snap.metadata.fromCache) {
          setFirestoreOffline(false);
        } else if (typeof navigator !== 'undefined' && !navigator.onLine) {
          setFirestoreOffline(true);
        }
        if (snap.exists()) {
          setTrip({ id: snap.id, ...(snap.data() as Omit<Trip, 'id'>) });
          setNotFound(false);
        } else {
          setTrip(null);
          setNotFound(!snap.metadata.fromCache);
        }
        setLoaded(true);
      },
      (err) => {
        if (isFirestoreOfflineError(err)) {
          setFirestoreOffline(true);
        } else {
          setNotFound(true);
        }
        setLoaded(true);
      },
    );

    const unsubLive = onSnapshot(
      doc(db, 'livePositions', tripId),
      (snap) => {
        if (snap.exists()) {
          const data = snap.data() as LivePosition;
          setLivePos({ ...data, tripId: data.tripId || snap.id });
        } else {
          setLivePos(null);
        }
      },
      () => {
        setLivePos(null);
      },
    );

    return () => {
      unsubTrip();
      unsubLive();
    };
  }, [tripId]);

  const isOnline = browserOnline && !firestoreOffline;

  const liveVehicles = useMemo<LiveVehicleMarker[]>(() => {
    if (!trip) return [];
    const fresh = isLivePositionFresh(livePos, nowMs);
    const lat = livePos ? livePos.lat : trip.originLat;
    const lng = livePos ? livePos.lng : trip.originLng;
    return [
      {
        tripId: trip.id,
        vehicleType: trip.vehicleType,
        driverName: trip.driverName,
        driverVerified: trip.driverVerified,
        seatsFree: trip.seatsFree,
        lat,
        lng,
        isOffline: trip.status === 'live' && !fresh,
        isSelected: true,
      },
    ];
  }, [trip, livePos, nowMs]);

  const destPlace = useMemo(() => {
    if (!trip) return null;
    return {
      id: 'parent-dest',
      name: trip.destinationName,
      subtitle: '',
      lat: trip.destinationLat,
      lng: trip.destinationLng,
    };
  }, [trip]);

  const remainingEtaText = useMemo(() => {
    if (!trip) return null;
    if (trip.status === 'completed') return t.ticketStageReachedSchool;
    if (trip.status === 'disrupted') return t.tripStatusDisrupted;
    const target = { lat: trip.destinationLat, lng: trip.destinationLng };
    const current = livePos ? { lat: livePos.lat, lng: livePos.lng } : { lat: trip.originLat, lng: trip.originLng };
    const meters = haversineDistanceMeters(current, target);
    const speedMps =
      trip.durationSeconds > 0 && trip.distanceMeters > 0
        ? Math.max(4, Math.min(16, trip.distanceMeters / trip.durationSeconds))
        : 7.5;
    const seconds = Math.max(60, Math.round(meters / speedMps));
    return formatDuration(seconds);
  }, [trip, livePos, t.ticketStageReachedSchool, t.tripStatusDisrupted]);

  const statusText = (status: Trip['status']) => {
    if (status === 'live') return t.tripStatusLive;
    if (status === 'scheduled') return t.tripStatusScheduled;
    if (status === 'disrupted') return t.tripStatusDisrupted;
    return t.tripStatusCompleted;
  };

  const isVehicleOffline = Boolean(
    trip && trip.status === 'live' && !isLivePositionFresh(livePos, nowMs),
  );

  return (
    <div className="relative h-dvh w-full flex flex-col bg-[#F2F5F3] text-[#1F2A2E] overflow-hidden">
      <header className="h-14 px-3 sm:px-4 bg-white border-b-2 border-[#1F2A2E] flex items-center justify-between gap-2 z-[500] shrink-0">
        <Wordmark size="sm" />
        <div className="flex items-center gap-2 min-w-0">
          {!isOnline && <OfflineBadge compact />}

          <div className="flex items-center rounded-lg border border-[#1F2A2E] overflow-hidden shrink-0">
            {LANG_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setLanguage(opt.id)}
                className={`px-2 py-1 text-xs font-bold ${
                  language === opt.id
                    ? 'bg-[#FFC20E] text-[#1F2A2E]'
                    : 'bg-white text-[#526066]'
                }`}
              >
                {opt.short}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={onExitToApp}
            className="min-h-[38px] px-2.5 sm:px-3 rounded-lg bg-[#0E6B4E] text-white font-bold text-xs shrink-0 whitespace-nowrap"
          >
            {t.parentTrackOpenAppBtn}
          </button>
        </div>
      </header>

      <div className="relative flex-1 min-h-0">
        <NxtMap
          position={null}
          selectedPlace={destPlace}
          pickupPin={pickupPoint}
          routePolyline={trip && trip.status !== 'disrupted' ? trip.routeGeometry : null}
          disruptedPolyline={trip && trip.status === 'disrupted' ? trip.routeGeometry : null}
          liveVehicles={liveVehicles}
        />

        <div className="absolute bottom-7 left-3 right-3 md:left-4 md:right-auto md:w-[400px] z-[500]">
          <section
            aria-label={t.parentTrackTitle}
            className="bg-white border-2 border-[#1F2A2E] rounded-2xl overflow-hidden shadow-lg"
          >
            <div className="h-2.5 ticket-perforation bg-[#FFC20E] border-b border-[#1F2A2E]" aria-hidden="true" />

            <div className="p-4 space-y-3">
              {!isOnline && <OfflineLocalBanner onRetry={() => void retryConnection()} />}

              <div>
                <p className="text-xs font-extrabold uppercase tracking-wide text-[#0E6B4E]">
                  {t.parentTrackTitle}
                </p>
                <p className="text-xs text-[#526066]">{t.parentTrackSubtitle}</p>
              </div>

              {!loaded ? (
                <SkeletonCard lines={4} />
              ) : notFound || !trip ? (
                <div className="p-3 rounded-xl bg-[#F2F5F3] border border-[#D5DDD8] space-y-2">
                  <p className="text-sm font-medium text-[#1F2A2E]">{t.parentTrackNotFound}</p>
                  {destLabel && (
                    <p className="text-xs text-[#526066]">
                      {t.parentTrackDestination}: {destLabel}
                    </p>
                  )}
                </div>
              ) : (
                <div className="space-y-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <VehicleIcon type={trip.vehicleType} />
                      <div className="min-w-0">
                        <p className="font-sign font-bold text-base text-[#1F2A2E] truncate">
                          {getVehicleLabel(trip.vehicleType, t)} · {trip.driverName}
                        </p>
                        <p className="text-xs text-[#526066] truncate">
                          {t.parentTrackDestination}: {trip.destinationName || destLabel}
                        </p>
                      </div>
                    </div>

                    <span
                      className={`px-2.5 py-1 rounded-lg text-xs font-extrabold border shrink-0 ${
                        trip.status === 'disrupted'
                          ? 'bg-[#D7352B] text-white border-[#1F2A2E]'
                          : trip.status === 'completed'
                            ? 'bg-[#0E6B4E] text-white border-[#1F2A2E]'
                            : 'bg-[#FFC20E] text-[#1F2A2E] border-[#1F2A2E]'
                      }`}
                    >
                      {statusText(trip.status)}
                    </span>
                  </div>

                  {!trip.driverVerified && (
                    <div
                      role="alert"
                      data-testid="unverified-driver-warning"
                      className="p-2.5 rounded-xl bg-[#D7352B]/10 border-2 border-[#D7352B] flex items-start gap-2 text-xs font-bold text-[#1F2A2E]"
                    >
                      <ShieldAlert className="w-4 h-4 text-[#D7352B] mt-0.5 shrink-0" aria-hidden="true" />
                      <span className="break-words">{t.unverifiedDriverWarningParent}</span>
                    </div>
                  )}

                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    {studentLabel && (
                      <span className="px-2 py-1 rounded bg-[#F2F5F3] border border-[#D5DDD8] font-bold text-[#1F2A2E]">
                        {t.parentTrackForStudent}: {studentLabel}
                      </span>
                    )}
                    {rideCode && (
                      <span className="px-2 py-1 rounded bg-[#1F2A2E] text-[#FFC20E] font-sign font-extrabold tabular-nums">
                        {t.parentTrackRideCode}: {rideCode}
                      </span>
                    )}
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-1 rounded font-bold ${
                        trip.driverVerified
                          ? 'bg-[#0E6B4E] text-white'
                          : 'bg-[#D7352B]/10 text-[#D7352B] border border-[#D7352B]'
                      }`}
                    >
                      {trip.driverVerified ? (
                        <ShieldCheck className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                      ) : (
                        <ShieldOff className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                      )}
                      <span>{trip.driverVerified ? t.badgeVerified : t.badgeNotVerified}</span>
                    </span>
                  </div>

                  {trip.status === 'disrupted' ? (
                    <div role="alert" className="p-2.5 rounded-xl bg-[#D7352B]/10 border border-[#D7352B] flex items-center gap-2 text-xs font-bold text-[#D7352B]">
                      <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
                      <span>{t.ticketDisruptedNote}</span>
                    </div>
                  ) : (
                    remainingEtaText && (
                      <div className="p-2.5 rounded-xl bg-[#0E6B4E]/10 border border-[#0E6B4E] flex items-center justify-between gap-2 text-xs font-bold text-[#1F2A2E] tabular-nums">
                        <span className="inline-flex items-center gap-1.5">
                          <Clock className="w-4 h-4 text-[#0E6B4E]" aria-hidden="true" />
                          <span>{remainingEtaText}</span>
                        </span>
                        {isVehicleOffline && (
                          <span className="text-[#D7352B]">{t.vehicleOfflineBadge}</span>
                        )}
                      </div>
                    )
                  )}
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
