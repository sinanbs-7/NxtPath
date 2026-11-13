import React, { useEffect, useMemo, useState } from 'react';
import { Map as MapIcon, Route } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { useI18n } from '../i18n/I18nContext';
import { useGeolocation } from '../map/useGeolocation';
import { evaluateTripDisruption } from '../matching/disruption';
import { TicketStubCard } from '../student/TicketStubCard';
import { formatDistance, formatDuration } from '../trips/tripLogic';
import { useDriverTrip } from '../trips/useDriverTrip';
import { useStudentRides } from '../trips/useStudentRides';
import { SkeletonList } from '../ui/LoadingSkeleton';
import { OfflineBadge, OfflineLocalBanner } from '../ui/OfflineBadge';
import { getVehicleLabel, VehicleIcon } from '../ui/VehicleIcons';
import { Wordmark } from '../ui/Wordmark';

export function TripsScreen({ onGoToMap }: { onGoToMap: () => void }) {
  const { firebaseUser, displayName, role, isOnline, retryConnection } = useAuth();
  const { t } = useI18n();
  const geo = useGeolocation();
  const driver = useDriverTrip(geo, role === 'driver');
  const student = useStudentRides(role === 'student');
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 10_000);
    return () => window.clearInterval(id);
  }, []);

  const studentDisruption = useMemo(() => {
    if (!student.activeRequest) {
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
  }, [student.activeRequest, student.trackedTrip, student.trackedLivePos, student.tripReports, nowMs]);

  const hasReportedNoShow = Boolean(
    firebaseUser &&
      student.activeRequest &&
      student.tripReports.some(
        (r) =>
          r.tripId === student.activeRequest?.tripId &&
          r.reporterId === firebaseUser.uid &&
          r.reason === 'bus_no_show',
      ),
  );

  const emptyMessage =
    role === 'driver'
      ? t.tripsEmptyDriver
      : role === 'teacher'
        ? t.tripsEmptyTeacher
        : t.tripsEmptyStudent;

  const statusLabel = (status: string) => {
    if (status === 'live') return t.tripStatusLive;
    if (status === 'scheduled') return t.tripStatusScheduled;
    if (status === 'disrupted') return t.tripStatusDisrupted;
    if (status === 'unavailable') return t.tripStatusUnavailable;
    return t.tripStatusCompleted;
  };

  return (
    <div className="min-h-full pb-24 bg-[#F2F5F3]">
      <header className="h-14 px-4 bg-white border-b-2 border-[#1F2A2E] flex items-center justify-between gap-2">
        <Wordmark size="sm" />
        {!isOnline && <OfflineBadge compact />}
      </header>

      <main className="max-w-2xl mx-auto p-4 sm:p-6 space-y-5">
        {!isOnline && <OfflineLocalBanner onRetry={() => void retryConnection()} />}

        <h1 className="font-sign text-2xl font-bold text-[#1F2A2E]">{t.tripsTitle}</h1>

        {(role === 'driver' && driver.loading) || (role === 'student' && student.loading) ? (
          <SkeletonList count={2} />
        ) : role === 'driver' && driver.driverTrips.length > 0 ? (
          <div className="space-y-3">
            {driver.driverTrips.map((tr) => (
              <div
                key={tr.id}
                className="bg-white border-2 border-[#1F2A2E] rounded-2xl overflow-hidden"
              >
                <div className="h-2 ticket-perforation bg-[#FFC20E]" aria-hidden="true" />
                <div className="p-4 flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 min-w-0">
                    <VehicleIcon type={tr.vehicleType} />
                    <div className="min-w-0">
                      <p className="font-sign font-bold text-lg text-[#1F2A2E] truncate">
                        {tr.destinationName}
                      </p>
                      <p className="text-sm text-[#526066]">
                        {getVehicleLabel(tr.vehicleType, t)} · {statusLabel(tr.status)}
                      </p>
                      <p className="text-sm text-[#1F2A2E] mt-1 tabular-nums">
                        {tr.seatsFree}/{tr.seatsTotal} {t.driverSeatsFreeSuffix} ·{' '}
                        {formatDistance(tr.distanceMeters)} · {formatDuration(tr.durationSeconds)}
                      </p>
                    </div>
                  </div>

                  {tr.status === 'scheduled' && (
                    <button
                      type="button"
                      onClick={() => void driver.activateScheduledTrip(tr.id)}
                      className="min-h-[44px] px-3.5 rounded-xl bg-[#0E6B4E] text-white text-sm font-bold shrink-0"
                    >
                      {t.driverGoLiveNowBtn}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : role === 'student' && student.activeRequest ? (
          <TicketStubCard
            request={student.activeRequest}
            trip={student.trackedTrip}
            livePos={student.trackedLivePos}
            nowMs={nowMs}
            busyAction={student.busyAction}
            studentName={displayName}
            disruption={studentDisruption}
            hasReportedNoShow={hasReportedNoShow}
            onReportNoShow={async () => {
              if (!student.activeRequest) return;
              await student.reportBusNoShow(student.activeRequest.tripId, {
                lat: student.activeRequest.pickupLat,
                lng: student.activeRequest.pickupLng,
              });
            }}
            onCancelRequest={student.cancelSeatRequest}
            onMarkReached={student.markReachedSchool}
            onFindAnother={() => onGoToMap()}
          />
        ) : (
          <div className="bg-white border-2 border-[#1F2A2E] rounded-2xl overflow-hidden">
            <div className="h-2 ticket-perforation bg-[#FFC20E]" aria-hidden="true" />
            <div className="p-6 space-y-4">
              <div className="w-12 h-12 rounded-xl bg-[#F2F5F3] border-2 border-[#1F2A2E] flex items-center justify-center">
                <Route className="w-6 h-6 text-[#0E6B4E]" aria-hidden="true" />
              </div>
              <p className="text-base text-[#1F2A2E]">{emptyMessage}</p>
              <button
                type="button"
                onClick={onGoToMap}
                className="min-h-[56px] px-5 rounded-xl bg-[#0E6B4E] hover:bg-[#0A523B] text-white font-sign font-bold text-base inline-flex items-center gap-2 transition-colors"
              >
                <MapIcon className="w-5 h-5" aria-hidden="true" />
                <span>{t.goToMapBtn}</span>
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
