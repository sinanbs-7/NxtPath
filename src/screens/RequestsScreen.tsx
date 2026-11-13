import React, { useEffect, useState } from 'react';
import { Bell, Check, Map as MapIcon, X } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { useUserNotifications } from '../crisis/useUserNotifications';
import { useI18n } from '../i18n/I18nContext';
import { useGeolocation } from '../map/useGeolocation';
import { TicketStubCard } from '../student/TicketStubCard';
import { useDriverTrip } from '../trips/useDriverTrip';
import { useStudentRides } from '../trips/useStudentRides';
import { SkeletonList } from '../ui/LoadingSkeleton';
import { OfflineBadge, OfflineLocalBanner } from '../ui/OfflineBadge';
import { Wordmark } from '../ui/Wordmark';

export function RequestsScreen({ onGoToMap }: { onGoToMap: () => void }) {
  const { displayName, role, isOnline, retryConnection } = useAuth();
  const { t } = useI18n();
  const geo = useGeolocation();
  const driver = useDriverTrip(geo, role === 'driver');
  const student = useStudentRides(role === 'student');
  const { activeReallocations, respondingId, respondToReallocation } = useUserNotifications(
    role === 'driver',
  );
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 10_000);
    return () => window.clearInterval(id);
  }, []);

  const emptyMessage =
    role === 'driver'
      ? t.requestsEmptyDriver
      : role === 'teacher'
        ? t.requestsEmptyTeacher
        : t.requestsEmptyStudent;

  const requestStatusLabel = (status: string) => {
    if (status === 'accepted') return t.requestStatusAccepted;
    if (status === 'declined') return t.requestStatusDeclined;
    if (status === 'completed') return t.requestStatusCompleted;
    return t.requestStatusPending;
  };

  return (
    <div className="min-h-full pb-24 bg-[#F2F5F3]">
      <header className="h-14 px-4 bg-white border-b-2 border-[#1F2A2E] flex items-center justify-between gap-2">
        <Wordmark size="sm" />
        {!isOnline && <OfflineBadge compact />}
      </header>

      <main className="max-w-2xl mx-auto p-4 sm:p-6 space-y-5">
        {!isOnline && <OfflineLocalBanner onRetry={() => void retryConnection()} />}

        <h1 className="font-sign text-2xl font-bold text-[#1F2A2E]">{t.requestsTitle}</h1>

        {role === 'driver' && activeReallocations.length > 0 && (
          <div className="space-y-2">
            {activeReallocations.map((notif) => (
              <div
                key={notif.id}
                role="alert"
                className="p-4 rounded-2xl bg-[#FFC20E]/20 border-2 border-[#1F2A2E] space-y-2.5"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 space-y-0.5">
                    <p className="font-sign font-bold text-sm text-[#1F2A2E]">
                      {t.crisisDriverAlertTitle}
                    </p>
                    <p className="text-sm font-medium text-[#1F2A2E]">{notif.body}</p>
                  </div>
                  {notif.isDrill && (
                    <span className="px-2 py-0.5 rounded bg-[#1F2A2E] text-[#FFC20E] font-sign font-extrabold text-[10px] shrink-0">
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
                      className="min-h-[44px] px-3 rounded-xl bg-[#0E6B4E] text-white text-xs font-bold inline-flex items-center justify-center gap-1.5 disabled:opacity-50"
                    >
                      <Check className="w-4 h-4" aria-hidden="true" />
                      <span>{t.crisisAcceptReallocBtn}</span>
                    </button>
                    <button
                      type="button"
                      disabled={respondingId === notif.id}
                      onClick={() => void respondToReallocation(notif.id, 'declined')}
                      className="min-h-[44px] px-3 rounded-xl bg-white border-2 border-[#1F2A2E] text-xs font-bold text-[#1F2A2E] inline-flex items-center justify-center gap-1.5 disabled:opacity-50"
                    >
                      <X className="w-4 h-4" aria-hidden="true" />
                      <span>{t.crisisDeclineReallocBtn}</span>
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {(role === 'driver' && driver.loading) || (role === 'student' && student.loading) ? (
          <SkeletonList count={2} />
        ) : role === 'driver' && driver.seatRequests.length > 0 ? (
          <div className="space-y-3">
            {driver.seatRequests.map((req) => (
              <div
                key={req.id}
                className="bg-white border-2 border-[#1F2A2E] rounded-2xl p-4 space-y-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-sign font-bold text-lg text-[#1F2A2E] truncate">
                      {req.studentName}
                    </p>
                    <p className="text-sm text-[#526066] truncate">{req.destinationName}</p>
                  </div>
                  <span className="text-sm font-bold text-[#1F2A2E] shrink-0">
                    {requestStatusLabel(req.status)}
                    {req.rideCode ? ` · ${t.driverRideCodeLabel} ${req.rideCode}` : ''}
                  </span>
                </div>

                {req.status === 'pending' && driver.activeTrip && (
                  <div className="grid grid-cols-2 gap-2.5">
                    <button
                      type="button"
                      disabled={driver.activeTrip.seatsFree <= 0}
                      onClick={() => void driver.acceptSeatRequest(req)}
                      className="min-h-[56px] px-3 rounded-xl bg-[#0E6B4E] text-white font-bold text-base flex items-center justify-center gap-1.5 disabled:opacity-50"
                    >
                      <Check className="w-5 h-5" aria-hidden="true" />
                      <span>{t.driverAcceptBtn}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => void driver.declineSeatRequest(req)}
                      className="min-h-[56px] px-3 rounded-xl bg-white border-2 border-[#1F2A2E] text-[#1F2A2E] font-bold text-base flex items-center justify-center gap-1.5"
                    >
                      <X className="w-5 h-5" aria-hidden="true" />
                      <span>{t.driverDeclineBtn}</span>
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : role === 'student' && student.studentRequests.length > 0 ? (
          <div className="space-y-4">
            {student.studentRequests.map((req) => (
              <TicketStubCard
                key={req.id}
                request={req}
                trip={req.tripId === student.trackedTrip?.id ? student.trackedTrip : null}
                livePos={
                  req.tripId === student.trackedLivePos?.tripId ? student.trackedLivePos : null
                }
                nowMs={nowMs}
                busyAction={student.busyAction}
                studentName={displayName}
                onCancelRequest={student.cancelSeatRequest}
                onMarkReached={student.markReachedSchool}
                onFindAnother={() => onGoToMap()}
              />
            ))}
          </div>
        ) : (
          <div className="bg-white border-2 border-[#1F2A2E] rounded-2xl overflow-hidden">
            <div className="h-2 ticket-perforation bg-[#FFC20E]" aria-hidden="true" />
            <div className="p-6 space-y-4">
              <div className="w-12 h-12 rounded-xl bg-[#F2F5F3] border-2 border-[#1F2A2E] flex items-center justify-center">
                <Bell className="w-6 h-6 text-[#0E6B4E]" aria-hidden="true" />
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
