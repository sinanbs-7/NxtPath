import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { BookmarkCheck, Check, ChevronDown, ChevronUp, MapPin, Trash2, X } from 'lucide-react';
import { NxtMap, type LiveVehicleMarker } from '../map/NxtMap';
import type { OsrmRouteResult } from '../map/osrm';
import type { PlaceResult } from '../map/photon';
import type { UseGeolocationResult } from '../map/useGeolocation';
import { evaluateTripDisruption, findPlanBAlternatives } from '../matching/disruption';
import {
  isLivePositionFresh,
  matchAndRankRides,
  parseArriveByEpochMs,
} from '../matching/matchRides';
import { ActiveTripPanel, ActiveTripStrip } from '../driver/ActiveTripPanel';
import { StartTripSheet } from '../driver/StartTripSheet';
import { StudentSheet } from '../student/StudentSheet';
import { useDriverTrip } from '../trips/useDriverTrip';
import { useStudentRides } from '../trips/useStudentRides';
import type { LatLngPoint } from '../types/firestore';
import { BottomSheet } from '../ui/BottomSheet';
import type { SheetSnap } from '../ui/bottomSheet';
import { PlaceSearchInput } from '../ui/PlaceSearchInput';
import { OfflineBadge } from '../ui/OfflineBadge';
import { StatusChips } from '../ui/StatusChips';
import { getVehicleLabel, VEHICLE_TYPES, VehicleIcon } from '../ui/VehicleIcons';
import { Wordmark } from '../ui/Wordmark';
import { useAuth } from '../auth/AuthContext';
import { useUserNotifications } from '../crisis/useUserNotifications';
import { useI18n } from '../i18n/I18nContext';

interface MapScreenProps {
  geo: UseGeolocationResult;
}

export function MapScreen({ geo }: MapScreenProps) {
  const { t } = useI18n();
  const { firebaseUser, role, isOnline, retryConnection, savedSchool } = useAuth();
  const [snap, setSnap] = useState<SheetSnap>('half');
  const [selectedPlace, setSelectedPlace] = useState<PlaceResult | null>(() =>
    savedSchool
      ? {
          id: 'saved-school',
          name: savedSchool.name,
          subtitle: savedSchool.address,
          lat: savedSchool.lat,
          lng: savedSchool.lng,
        }
      : null,
  );
  const [customPickup, setCustomPickup] = useState<LatLngPoint | null>(null);
  const [arriveByHHmm, setArriveByHHmm] = useState(() => {
    try {
      return window.sessionStorage.getItem('nxtpath_arrive_by_v1') ?? '';
    } catch {
      return '';
    }
  });
  const handleArriveByChange = useCallback((hhmm: string) => {
    setArriveByHHmm(hhmm);
    try {
      window.sessionStorage.setItem('nxtpath_arrive_by_v1', hhmm);
    } catch {
      // ignore storage errors
    }
  }, []);
  const [selectedStudentTripId, setSelectedStudentTripId] = useState<string | null>(null);
  const [selectedBackupTripId, setSelectedBackupTripId] = useState<string | null>(null);
  const [hasExam, setHasExam] = useState(false);
  const [showLegend, setShowLegend] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 15_000);
    return () => window.clearInterval(id);
  }, []);

  const [previewRoute, setPreviewRoute] = useState<OsrmRouteResult | null>(null);
  const [previewDest, setPreviewDest] = useState<PlaceResult | null>(null);

  const isDriver = role === 'driver';
  const isStudent = role === 'student';

  const driver = useDriverTrip(geo, isDriver);
  const student = useStudentRides(isStudent);
  const { activeReallocations, respondingId, respondToReallocation } = useUserNotifications(
    isDriver,
  );

  const handlePreviewRouteChange = useCallback(
    (route: OsrmRouteResult | null, destPlace: PlaceResult | null) => {
      setPreviewRoute(route);
      setPreviewDest(destPlace);
    },
    [],
  );

  const handleRoutePreviewReady = useCallback(() => {
    if (window.innerWidth < 768) {
      setSnap('half');
    }
  }, []);

  const studentPickupPoint = useMemo<LatLngPoint | null>(() => {
    if (customPickup) return customPickup;
    if (geo.position) return { lat: geo.position.lat, lng: geo.position.lng };
    return null;
  }, [customPickup, geo.position]);

  const studentDestination = useMemo<PlaceResult | null>(() => {
    if (selectedPlace) return selectedPlace;
    if (savedSchool) {
      return {
        id: 'saved-school',
        name: savedSchool.name,
        subtitle: savedSchool.address,
        lat: savedSchool.lat,
        lng: savedSchool.lng,
      };
    }
    return null;
  }, [selectedPlace, savedSchool]);

  const matchResult = useMemo(
    () =>
      matchAndRankRides({
        trips: student.trips,
        livePositionsByTripId: student.livePositionsByTripId,
        pickup: studentPickupPoint,
        destination: studentDestination
          ? { lat: studentDestination.lat, lng: studentDestination.lng }
          : null,
        arriveByHHmm,
      }),
    [
      student.trips,
      student.livePositionsByTripId,
      studentPickupPoint,
      studentDestination,
      arriveByHHmm,
    ],
  );

  const highlightedStudentOption = useMemo(() => {
    if (matchResult.options.length === 0) return null;
    if (selectedStudentTripId) {
      const exact = matchResult.options.find((o) => o.trip.id === selectedStudentTripId);
      if (exact) return exact;
    }
    return matchResult.options[0];
  }, [matchResult.options, selectedStudentTripId]);

  const studentDisruption = useMemo(() => {
    if (!isStudent || !student.activeRequest) {
      return { disrupted: false, trigger: null, lateMinutes: null, noShowReportCount: 0 };
    }
    return evaluateTripDisruption({
      trip: student.trackedTrip,
      livePos: student.trackedLivePos,
      reports: student.tripReports,
      stopPoint: {
        lat: student.activeRequest.pickupLat,
        lng: student.activeRequest.pickupLng,
      },
      nowMs,
    });
  }, [isStudent, student.activeRequest, student.trackedTrip, student.trackedLivePos, student.tripReports, nowMs]);

  const planBDestinationPoint = useMemo<LatLngPoint | null>(() => {
    if (student.trackedTrip) {
      return {
        lat: student.trackedTrip.destinationLat,
        lng: student.trackedTrip.destinationLng,
      };
    }
    if (studentDestination) {
      return { lat: studentDestination.lat, lng: studentDestination.lng };
    }
    return null;
  }, [student.trackedTrip, studentDestination]);

  const planBResult = useMemo(() => {
    if (!isStudent || !student.activeRequest || !studentDisruption.disrupted) {
      return { options: [], nearbyLiveDriversCount: 0 };
    }
    return findPlanBAlternatives({
      disruptedTripId: student.activeRequest.tripId,
      trips: student.trips,
      livePositionsByTripId: student.livePositionsByTripId,
      reports: student.tripReports,
      pickup: {
        lat: student.activeRequest.pickupLat,
        lng: student.activeRequest.pickupLng,
      },
      destination: planBDestinationPoint,
      arriveByHHmm,
      nowMs,
    });
  }, [
    isStudent,
    student.activeRequest,
    studentDisruption.disrupted,
    student.trips,
    student.livePositionsByTripId,
    student.tripReports,
    planBDestinationPoint,
    arriveByHHmm,
    nowMs,
  ]);

  const selectedPlanBBackup = useMemo(() => {
    if (planBResult.options.length === 0) return null;
    if (selectedBackupTripId) {
      const exact = planBResult.options.find((o) => o.trip.id === selectedBackupTripId);
      if (exact) return exact;
    }
    return planBResult.options[0];
  }, [planBResult.options, selectedBackupTripId]);

  const hasReportedNoShow = useMemo(() => {
    if (!firebaseUser || !student.activeRequest) return false;
    return student.tripReports.some(
      (r) =>
        r.tripId === student.activeRequest?.tripId &&
        r.reporterId === firebaseUser.uid &&
        r.reason === 'bus_no_show',
    );
  }, [firebaseUser, student.activeRequest, student.tripReports]);

  const studentLiveVehicles = useMemo<LiveVehicleMarker[]>(() => {
    if (!isStudent) return [];

    if (student.activeRequest && student.trackedTrip) {
      const markers: LiveVehicleMarker[] = [];
      const tr = student.trackedTrip;
      const lp = student.trackedLivePos;
      if (lp) {
        markers.push({
          tripId: tr.id,
          vehicleType: tr.vehicleType,
          driverName: tr.driverName,
          driverVerified: tr.driverVerified,
          seatsFree: tr.seatsFree,
          lat: lp.lat,
          lng: lp.lng,
          isOffline: tr.status === 'live' && !isLivePositionFresh(lp, nowMs),
          isSelected: !studentDisruption.disrupted,
        });
      } else if (tr.status === 'live' || tr.status === 'scheduled') {
        markers.push({
          tripId: tr.id,
          vehicleType: tr.vehicleType,
          driverName: tr.driverName,
          driverVerified: tr.driverVerified,
          seatsFree: tr.seatsFree,
          lat: tr.originLat,
          lng: tr.originLng,
          isOffline: tr.status === 'live',
          isSelected: !studentDisruption.disrupted,
        });
      }

      if (studentDisruption.disrupted) {
        for (const alt of planBResult.options) {
          const altLp = alt.livePosition;
          markers.push({
            tripId: alt.trip.id,
            vehicleType: alt.trip.vehicleType,
            driverName: alt.trip.driverName,
            driverVerified: alt.trip.driverVerified,
            seatsFree: alt.trip.seatsFree,
            lat: altLp ? altLp.lat : alt.trip.originLat,
            lng: altLp ? altLp.lng : alt.trip.originLng,
            isOffline: alt.isVehicleOffline,
            isSelected: selectedPlanBBackup?.trip.id === alt.trip.id,
          });
        }
      }
      return markers;
    }

    return matchResult.options.map((opt) => {
      const lp = opt.livePosition;
      return {
        tripId: opt.trip.id,
        vehicleType: opt.trip.vehicleType,
        driverName: opt.trip.driverName,
        driverVerified: opt.trip.driverVerified,
        seatsFree: opt.trip.seatsFree,
        lat: lp ? lp.lat : opt.trip.originLat,
        lng: lp ? lp.lng : opt.trip.originLng,
        isOffline: opt.isVehicleOffline,
        isSelected: highlightedStudentOption?.trip.id === opt.trip.id,
      };
    });
  }, [
    isStudent,
    nowMs,
    student.activeRequest,
    student.trackedTrip,
    student.trackedLivePos,
    studentDisruption.disrupted,
    planBResult.options,
    selectedPlanBBackup,
    matchResult.options,
    highlightedStudentOption,
  ]);

  const roleText =
    role === 'driver'
      ? t.roleDriverTitle
      : role === 'teacher'
        ? t.roleTeacherTitle
        : t.roleStudentTitle;

  const activePlace = isDriver
    ? driver.activeTrip
      ? {
          id: 'driver-dest',
          name: driver.activeTrip.destinationName,
          subtitle: '',
          lat: driver.activeTrip.destinationLat,
          lng: driver.activeTrip.destinationLng,
        }
      : previewDest
    : studentDestination;

  const isDisruptedStudentActive = Boolean(
    isStudent && student.activeRequest && studentDisruption.disrupted,
  );

  const disruptedPolyline =
    isDisruptedStudentActive && student.trackedTrip ? student.trackedTrip.routeGeometry : null;

  const activePolyline = isDriver
    ? driver.activeTrip
      ? driver.activeTrip.routeGeometry
      : previewRoute?.routeGeometry ?? null
    : isStudent
      ? student.activeRequest && student.trackedTrip
        ? studentDisruption.disrupted
          ? selectedPlanBBackup?.trip.routeGeometry ?? null
          : student.trackedTrip.routeGeometry
        : highlightedStudentOption?.trip.routeGeometry ?? null
      : null;

  const animateRecovery = Boolean(isDisruptedStudentActive && selectedPlanBBackup);

  const showActiveTripStrip = Boolean(isDriver && driver.activeTrip);

  return (
    <div className="relative w-full h-full pb-16 overflow-hidden">
      <div className="absolute top-0 left-0 right-0 z-[500]">
        <header className="h-14 px-4 bg-white border-b-2 border-[#1F2A2E] flex items-center justify-between gap-2">
          <Wordmark size="sm" />
          <div className="flex items-center gap-2 text-sm text-[#1F2A2E] min-w-0">
            {!isOnline && <OfflineBadge compact />}
            {geo.position?.isSimulated && (
              <span className="px-2 py-0.5 rounded bg-[#FFC20E] text-[#1F2A2E] font-sign font-extrabold text-xs shrink-0">
                {t.simulatedBadge}
              </span>
            )}
            <span className={`font-bold truncate ${!isOnline ? 'hidden sm:inline' : ''}`}>
              {roleText}
            </span>
          </div>
        </header>

        {showActiveTripStrip && driver.activeTrip && (
          <ActiveTripStrip
            trip={driver.activeTrip}
            wakeLockActive={driver.wakeLockActive}
            busyAction={driver.busyAction}
            onAdjustSeats={driver.adjustSeatsFree}
          />
        )}
      </div>

      <div className={`w-full h-full ${showActiveTripStrip ? 'pt-[110px]' : 'pt-14'}`}>
        <NxtMap
          position={geo.position}
          selectedPlace={activePlace}
          pickupPin={isStudent && !student.activeRequest ? studentPickupPoint : null}
          onPickupDragEnd={
            isStudent && !student.activeRequest ? (pt) => setCustomPickup(pt) : undefined
          }
          routePolyline={activePolyline}
          disruptedPolyline={disruptedPolyline}
          animateRecovery={animateRecovery}
          blockedZones={isStudent ? student.blockedZones : []}
          activeVehicleType={isDriver && driver.activeTrip ? driver.activeTrip.vehicleType : null}
          liveVehicles={studentLiveVehicles}
          onSelectVehicleTrip={
            isStudent
              ? (tripId) => {
                  if (isDisruptedStudentActive) {
                    setSelectedBackupTripId(tripId);
                  } else {
                    setSelectedStudentTripId(tripId);
                  }
                }
              : undefined
          }
          demandClusters={isDriver ? driver.demandClusters : []}
          onOfferDemandCluster={
            isDriver && driver.activeTrip
              ? (cluster) => {
                  if (cluster.pins[0]) {
                    void driver.offerRideToDemandPin(cluster.pins[0]);
                  }
                }
              : undefined
          }
        />
      </div>

      <BottomSheet snap={snap} onSnapChange={setSnap} title={roleText} scrollResetKey={role ?? 'guest'}>
        <StatusChips
          isOnline={isOnline}
          onRetryConnection={() => void retryConnection()}
          permissionState={geo.permissionState}
          position={geo.position}
          gpsError={geo.errorMessage}
          onRequestLocation={geo.requestLocation}
        />

        {isDriver && activeReallocations.length > 0 && (
          <div className="space-y-2">
            {activeReallocations.map((notif) => (
              <div
                key={notif.id}
                role="alert"
                className="p-3 rounded-xl bg-[#FFC20E]/20 border-2 border-[#1F2A2E] space-y-2"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-sign font-bold text-xs text-[#1F2A2E]">
                      {t.crisisDriverAlertTitle}
                    </p>
                    <p className="text-sm font-medium text-[#1F2A2E]">{notif.body}</p>
                  </div>
                  {notif.isDrill && (
                    <span className="px-1.5 py-0.5 rounded bg-[#1F2A2E] text-[#FFC20E] font-sign font-extrabold text-[10px] shrink-0">
                      {t.crisisDrillBadge}
                    </span>
                  )}
                </div>

                {notif.actionStatus === 'accepted' ? (
                  <p className="text-xs font-extrabold text-[#0E6B4E]">
                    {t.crisisDriverAcceptedLabel}
                  </p>
                ) : notif.actionStatus === 'declined' ? (
                  <p className="text-xs font-extrabold text-[#D7352B]">
                    {t.crisisDriverDeclinedLabel}
                  </p>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      disabled={respondingId === notif.id}
                      onClick={() => void respondToReallocation(notif.id, 'accepted')}
                      className="min-h-[40px] px-3 rounded-lg bg-[#0E6B4E] text-white text-xs font-bold inline-flex items-center justify-center gap-1 disabled:opacity-50"
                    >
                      <Check className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>{t.crisisAcceptReallocBtn}</span>
                    </button>
                    <button
                      type="button"
                      disabled={respondingId === notif.id}
                      onClick={() => void respondToReallocation(notif.id, 'declined')}
                      className="min-h-[40px] px-3 rounded-lg bg-white border border-[#1F2A2E] text-xs font-bold text-[#1F2A2E] inline-flex items-center justify-center gap-1 disabled:opacity-50"
                    >
                      <X className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>{t.crisisDeclineReallocBtn}</span>
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {isDriver ? (
          driver.activeTrip ? (
            <ActiveTripPanel
              trip={driver.activeTrip}
              geo={geo}
              pendingRequests={driver.pendingRequests}
              acceptedRequests={driver.acceptedRequests}
              demandClusters={driver.demandClusters}
              busyAction={driver.busyAction}
              onAcceptRequest={driver.acceptSeatRequest}
              onDeclineRequest={driver.declineSeatRequest}
              onOfferDemandPin={driver.offerRideToDemandPin}
              onEndTrip={driver.endTrip}
              onReportBreakdown={driver.reportBreakdown}
            />
          ) : (
            <StartTripSheet
              geo={geo}
              scheduledTrips={driver.scheduledTrips}
              busyAction={driver.busyAction}
              tripError={driver.tripError}
              onClearTripError={driver.clearTripError}
              onPreviewRouteChange={handlePreviewRouteChange}
              onStartTrip={driver.startTrip}
              onActivateScheduled={driver.activateScheduledTrip}
              onExpandSheet={() => setSnap('expanded')}
              onRoutePreviewReady={handleRoutePreviewReady}
            />
          )
        ) : isStudent ? (
          <StudentSheet
            geo={geo}
            pickupPoint={studentPickupPoint}
            isCustomPickup={Boolean(customPickup)}
            onSelectCustomPickup={(place) => setCustomPickup({ lat: place.lat, lng: place.lng })}
            onResetPickupToGps={() => setCustomPickup(null)}
            destination={studentDestination}
            onSelectDestination={(place) => {
              setSelectedPlace(place);
              setSelectedStudentTripId(null);
              if (place) setSnap('half');
            }}
            arriveByHHmm={arriveByHHmm}
            onArriveByChange={handleArriveByChange}
            hasExam={hasExam}
            onToggleExam={setHasExam}
            matchResult={matchResult}
            selectedTripId={highlightedStudentOption?.trip.id ?? null}
            onSelectTripOption={(opt) => setSelectedStudentTripId(opt.trip.id)}
            activeRequest={student.activeRequest}
            trackedTrip={student.trackedTrip}
            trackedLivePos={student.trackedLivePos}
            disruption={studentDisruption}
            planBResult={planBResult}
            selectedBackupTripId={selectedPlanBBackup?.trip.id ?? null}
            onSelectBackupOption={(opt) => setSelectedBackupTripId(opt.trip.id)}
            onSwitchToBackup={async (opt) => {
              if (!student.activeRequest) return;
              const pickup = {
                lat: student.activeRequest.pickupLat,
                lng: student.activeRequest.pickupLng,
              };
              const dest =
                student.activeRequest.destinationName ||
                studentDestination?.name ||
                opt.trip.destinationName;
              const ok = await student.switchToBackupRide(
                student.activeRequest,
                opt,
                pickup,
                dest,
              );
              if (ok) {
                setSelectedBackupTripId(null);
              }
            }}
            hasReportedNoShow={hasReportedNoShow}
            onReportNoShow={async () => {
              if (!student.activeRequest) return;
              await student.reportBusNoShow(student.activeRequest.tripId, {
                lat: student.activeRequest.pickupLat,
                lng: student.activeRequest.pickupLng,
              });
            }}
            activeDemandPin={student.activeDemandPin}
            busyAction={student.busyAction}
            actionError={student.actionError}
            onClearActionError={student.clearActionError}
            onAskForSeat={(opt) => {
              if (!studentPickupPoint || !studentDestination) return Promise.resolve(false);
              const examAtMs = hasExam
                ? parseArriveByEpochMs(arriveByHHmm, nowMs) ?? nowMs + 90 * 60_000
                : null;
              return student.askForSeat(opt, studentPickupPoint, studentDestination.name, {
                examAtMs,
                arriveBy: arriveByHHmm || undefined,
                destinationLat: studentDestination.lat,
                destinationLng: studentDestination.lng,
              });
            }}
            onCancelRequest={student.cancelSeatRequest}
            onMarkReached={student.markReachedSchool}
            onDismissTicket={student.dismissTicket}
            onCreateDemandPin={() => {
              if (!studentPickupPoint || !studentDestination) return Promise.resolve(false);
              const examAtMs = hasExam
                ? parseArriveByEpochMs(arriveByHHmm, nowMs) ?? nowMs + 90 * 60_000
                : null;
              return student.createDemandPin(studentPickupPoint, studentDestination.name, {
                examAtMs,
                arriveBy: arriveByHHmm || undefined,
                destinationLat: studentDestination.lat,
                destinationLng: studentDestination.lng,
              });
            }}
            onCancelDemandPin={student.cancelDemandPin}
            onFocusSearch={() => {
              if (snap === 'collapsed') setSnap('half');
            }}
            onExpandSheet={() => {
              if (window.innerWidth < 768) setSnap('expanded');
            }}
            loading={student.loading}
          />
        ) : (
          <>
            <PlaceSearchInput
              label={t.searchLabelTeacher}
              biasLat={geo.position?.lat}
              biasLng={geo.position?.lng}
              onFocusInput={() => {
                if (snap === 'collapsed') setSnap('half');
              }}
              onSelectPlace={(place) => {
                setSelectedPlace(place);
                setSnap('half');
              }}
            />

            {selectedPlace && (
              <div className="p-3.5 rounded-xl bg-[#F2F5F3] border-2 border-[#1F2A2E] flex items-start justify-between gap-2.5">
                <div className="flex items-start gap-2.5 min-w-0">
                  <MapPin className="w-5 h-5 text-[#0E6B4E] mt-0.5 shrink-0" aria-hidden="true" />
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-[#0E6B4E]">{t.selectedPlaceLabel}</p>
                    <p className="font-sign font-bold text-base text-[#1F2A2E] break-words">
                      {selectedPlace.name}
                    </p>
                    {selectedPlace.subtitle && (
                      <p className="text-sm text-[#526066] break-words">
                        {selectedPlace.subtitle}
                      </p>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedPlace(null)}
                  aria-label={`${t.clearSavedSchool} ${selectedPlace.name}`}
                  className="min-h-[40px] px-2.5 rounded-lg border border-[#D5DDD8] bg-white text-xs font-bold text-[#1F2A2E] inline-flex items-center gap-1 shrink-0"
                >
                  <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>{t.clearSavedSchool}</span>
                </button>
              </div>
            )}

            <div className="pt-2 border-t border-[#D5DDD8] space-y-2">
              <h2 className="font-sign font-bold text-base text-[#1F2A2E]">{t.liveRidesTitle}</h2>
              <p className="text-sm text-[#526066]">{t.liveRidesEmpty}</p>
            </div>

            <div className="pt-1 border-t border-[#D5DDD8]">
              <button
                type="button"
                onClick={() => setShowLegend((v) => !v)}
                aria-expanded={showLegend}
                className="w-full min-h-[48px] flex items-center justify-between text-left text-sm font-bold text-[#1F2A2E]"
              >
                <span>{t.vehicleLegendToggle}</span>
                {showLegend ? (
                  <ChevronUp className="w-4 h-4" aria-hidden="true" />
                ) : (
                  <ChevronDown className="w-4 h-4" aria-hidden="true" />
                )}
              </button>

              {showLegend && (
                <div className="grid grid-cols-2 gap-2 pt-2 pb-1">
                  {VEHICLE_TYPES.map((vt) => (
                    <div
                      key={vt}
                      className="flex items-center gap-2.5 p-2 rounded-lg bg-[#F2F5F3] border border-[#D5DDD8]"
                    >
                      <VehicleIcon type={vt} />
                      <span className="text-sm font-medium text-[#1F2A2E] truncate">
                        {getVehicleLabel(vt, t)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </BottomSheet>
    </div>
  );
}
