import React, { useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  MapPin,
  ShieldAlert,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { useAdminDashboard } from '../admin/useAdminDashboard';
import { useAuth } from '../auth/AuthContext';
import { CrisisBoard } from '../crisis/CrisisBoard';
import { CrisisDebugPanel } from '../crisis/CrisisDebugPanel';
import { useI18n } from '../i18n/I18nContext';
import { SkeletonList, SkeletonMetricGrid } from '../ui/LoadingSkeleton';
import { OfflineBadge, OfflineLocalBanner } from '../ui/OfflineBadge';
import { getVehicleLabel, VehicleIcon } from '../ui/VehicleIcons';
import { Wordmark } from '../ui/Wordmark';

interface AdminScreenProps {
  onBack: () => void;
}

export function AdminScreen({ onBack }: AdminScreenProps) {
  const { isAdmin, isOnline, retryConnection } = useAuth();
  const { t } = useI18n();
  const [boardOpen, setBoardOpen] = useState(false);
  const {
    loading,
    stats,
    trips,
    seatRequests,
    demandPins,
    busyUid,
    adminError,
    toggleDriverVerification,
  } = useAdminDashboard(isAdmin);

  if (isAdmin && boardOpen) {
    return (
      <CrisisBoard
        trips={trips}
        seatRequests={seatRequests}
        demandPins={demandPins}
        onBack={() => setBoardOpen(false)}
      />
    );
  }

  return (
    <div className="min-h-full pb-24 bg-[#F2F5F3]">
      <header className="sticky top-0 z-30 h-14 px-4 bg-white border-b-2 border-[#1F2A2E] flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Wordmark size="sm" />
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {!isOnline && <OfflineBadge compact />}
          <button
            type="button"
            onClick={onBack}
            className="min-h-[44px] px-3 rounded-xl bg-[#F2F5F3] border-2 border-[#1F2A2E] text-xs font-bold text-[#1F2A2E] inline-flex items-center gap-1.5"
          >
            <ArrowLeft className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span className="whitespace-nowrap">{t.adminBackBtn}</span>
          </button>
        </div>
      </header>

      <main className="max-w-5xl mx-auto p-4 sm:p-6 space-y-5">
        {!isOnline && <OfflineLocalBanner onRetry={() => void retryConnection()} />}

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="space-y-1">
            <h1 className="font-sign text-2xl font-bold text-[#1F2A2E]">{t.adminTitle}</h1>
            <p className="text-sm text-[#526066]">{t.adminSubtitle}</p>
          </div>

          {isAdmin && (
            <button
              type="button"
              onClick={() => setBoardOpen(true)}
              data-testid="open-crisis-board-btn"
              className="min-h-[48px] px-4 rounded-xl bg-[#D7352B] hover:bg-[#b82a21] text-white border-2 border-[#1F2A2E] font-sign font-bold text-sm inline-flex items-center justify-center gap-2 shrink-0"
            >
              <ShieldAlert className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>{t.crisisBoardOpenBtn}</span>
            </button>
          )}
        </div>

        {!isAdmin ? (
          <section className="bg-white border-2 border-[#D7352B] rounded-2xl p-5 space-y-2">
            <div className="flex items-center gap-2 text-[#D7352B]">
              <ShieldAlert className="w-5 h-5 shrink-0" aria-hidden="true" />
              <h2 className="font-sign font-bold text-lg text-[#1F2A2E]">{t.adminDeniedTitle}</h2>
            </div>
            <p className="text-sm text-[#526066]">{t.adminDeniedBody}</p>
          </section>
        ) : loading ? (
          <div className="space-y-5">
            <SkeletonMetricGrid count={4} />
            <SkeletonList count={3} />
          </div>
        ) : (
          <>
            {adminError && (
              <div
                role="alert"
                className="p-3.5 rounded-xl bg-[#D7352B]/10 border-2 border-[#D7352B] text-sm font-medium text-[#1F2A2E]"
              >
                {adminError}
              </div>
            )}

            <section aria-label={t.adminTitle} className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="bg-white border-2 border-[#1F2A2E] rounded-2xl p-4 space-y-1">
                <p className="text-xs font-bold text-[#526066]">{t.adminMetricLiveTrips}</p>
                <p className="font-sign font-extrabold text-3xl text-[#0E6B4E] tabular-nums">
                  {stats.liveTripsCount}
                </p>
                <p className="text-xs text-[#526066] tabular-nums">
                  {stats.scheduledTripsCount} {t.adminMetricScheduledTrips} ·{' '}
                  {stats.completedTripsCount} {t.adminMetricCompletedTrips}
                </p>
              </div>

              <div className="bg-white border-2 border-[#1F2A2E] rounded-2xl p-4 space-y-1">
                <p className="text-xs font-bold text-[#526066]">{t.adminMetricSeatsFree}</p>
                <p className="font-sign font-extrabold text-3xl text-[#1F2A2E] tabular-nums">
                  {stats.activeSeatsFree}
                  <span className="text-base font-bold text-[#526066]">
                    /{stats.activeSeatsTotal}
                  </span>
                </p>
                <p className="text-xs text-[#526066] tabular-nums">
                  {stats.verifiedDriversCount} {t.adminVerifiedCountSuffix} ·{' '}
                  {stats.unverifiedDriversCount} {t.adminPendingCountSuffix}
                </p>
              </div>

              <div className="bg-white border-2 border-[#1F2A2E] rounded-2xl p-4 space-y-1">
                <p className="text-xs font-bold text-[#526066]">{t.adminMetricSeatRequests}</p>
                <p className="font-sign font-extrabold text-3xl text-[#1F2A2E] tabular-nums">
                  {stats.totalRequestsCount}
                </p>
                <p className="text-xs text-[#526066] tabular-nums">
                  {stats.pendingRequestsCount} {t.adminMetricPendingRequests} ·{' '}
                  {stats.acceptedRequestsCount} {t.adminMetricAcceptedRequests}
                </p>
              </div>

              <div className="bg-white border-2 border-[#1F2A2E] rounded-2xl p-4 space-y-1">
                <p className="text-xs font-bold text-[#526066]">{t.adminMetricDisruptedTrips}</p>
                <p
                  className={`font-sign font-extrabold text-3xl tabular-nums ${
                    stats.disruptedTripsCount > 0 ? 'text-[#D7352B]' : 'text-[#1F2A2E]'
                  }`}
                >
                  {stats.disruptedTripsCount}
                </p>
                <p className="text-xs text-[#526066] tabular-nums">
                  {stats.activeDemandPinsCount} {t.adminMetricDemandPins} · {stats.reportsCount}{' '}
                  {t.adminMetricReports}
                </p>
              </div>
            </section>

            <section className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <div className="bg-white border-2 border-[#1F2A2E] rounded-2xl p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <Users className="w-5 h-5 text-[#0E6B4E]" aria-hidden="true" />
                  <h2 className="font-sign font-bold text-base text-[#1F2A2E]">
                    {t.adminUsersSummaryLabel}
                  </h2>
                </div>
                <p className="font-sign font-extrabold text-2xl text-[#1F2A2E] tabular-nums">
                  {stats.totalUsers}
                </p>
                <div className="grid grid-cols-3 gap-2 pt-1 text-xs">
                  <div className="p-2.5 rounded-xl bg-[#F2F5F3] border border-[#D5DDD8]">
                    <p className="text-[#526066] truncate">{t.roleStudentTitle}</p>
                    <p className="font-sign font-bold text-base text-[#1F2A2E] tabular-nums">
                      {stats.studentCount}
                    </p>
                  </div>
                  <div className="p-2.5 rounded-xl bg-[#F2F5F3] border border-[#D5DDD8]">
                    <p className="text-[#526066] truncate">{t.roleDriverTitle}</p>
                    <p className="font-sign font-bold text-base text-[#1F2A2E] tabular-nums">
                      {stats.driverCount}
                    </p>
                  </div>
                  <div className="p-2.5 rounded-xl bg-[#F2F5F3] border border-[#D5DDD8]">
                    <p className="text-[#526066] truncate">{t.roleTeacherTitle}</p>
                    <p className="font-sign font-bold text-base text-[#1F2A2E] tabular-nums">
                      {stats.teacherCount}
                    </p>
                  </div>
                </div>
              </div>

              <div className="lg:col-span-2 bg-white border-2 border-[#1F2A2E] rounded-2xl p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <MapPin className="w-5 h-5 text-[#0E6B4E]" aria-hidden="true" />
                  <h2 className="font-sign font-bold text-base text-[#1F2A2E]">
                    {t.adminVehicleMixTitle}
                  </h2>
                </div>

                {stats.activeVehicleBreakdown.length === 0 ? (
                  <p className="text-sm text-[#526066]">{t.adminVehicleMixEmpty}</p>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {stats.activeVehicleBreakdown.map((item) => (
                      <div
                        key={item.vehicleType}
                        className="p-2.5 rounded-xl bg-[#F2F5F3] border border-[#D5DDD8] flex items-center justify-between gap-2"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <VehicleIcon type={item.vehicleType} />
                          <span className="font-bold text-sm text-[#1F2A2E] truncate">
                            {getVehicleLabel(item.vehicleType, t)}
                          </span>
                        </div>
                        <span className="font-sign font-extrabold text-base text-[#0E6B4E] tabular-nums shrink-0">
                          {item.count}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>

            <CrisisDebugPanel
              trips={trips}
              seatRequests={seatRequests}
              demandPins={demandPins}
            />

            <section
              aria-label={t.adminVerificationTitle}
              className="bg-white border-2 border-[#1F2A2E] rounded-2xl overflow-hidden"
            >
              <div className="h-2 ticket-perforation bg-[#FFC20E] border-b border-[#1F2A2E]" aria-hidden="true" />
              <div className="p-4 sm:p-5 space-y-4">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="w-5 h-5 text-[#0E6B4E]" aria-hidden="true" />
                    <h2 className="font-sign font-bold text-lg text-[#1F2A2E]">
                      {t.adminVerificationTitle}
                    </h2>
                  </div>
                  <span className="text-xs font-bold text-[#526066] tabular-nums">
                    {stats.verifiedDriversCount} {t.adminVerifiedCountSuffix} ·{' '}
                    {stats.unverifiedDriversCount} {t.adminPendingCountSuffix}
                  </span>
                </div>

                {stats.driverQueue.length === 0 ? (
                  <p className="text-sm text-[#526066] py-2">{t.adminVerificationEmpty}</p>
                ) : (
                  <div className="divide-y divide-[#D5DDD8]">
                    {stats.driverQueue.map((driver) => {
                      const isBusy = busyUid === driver.uid;
                      return (
                        <div
                          key={driver.uid}
                          className="py-3 first:pt-0 last:pb-0 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                        >
                          <div className="flex items-start gap-2.5 min-w-0">
                            {driver.verifiedDriver ? (
                              <CheckCircle2
                                className="w-5 h-5 text-[#0E6B4E] mt-0.5 shrink-0"
                                aria-hidden="true"
                              />
                            ) : (
                              <AlertTriangle
                                className="w-5 h-5 text-[#D7352B] mt-0.5 shrink-0"
                                aria-hidden="true"
                              />
                            )}
                            <div className="min-w-0">
                              <p className="font-sign font-bold text-base text-[#1F2A2E] truncate">
                                {driver.displayName}
                              </p>
                              <p className="text-xs text-[#526066] flex items-center gap-1.5 flex-wrap">
                                <span>
                                  {driver.verifiedDriver ? t.badgeVerified : t.badgeNotVerified}
                                </span>
                                <span aria-hidden="true">·</span>
                                <span className="uppercase font-mono">{driver.language}</span>
                              </p>
                            </div>
                          </div>

                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => void toggleDriverVerification(driver)}
                            className={`min-h-[48px] px-4 rounded-xl font-bold text-sm inline-flex items-center justify-center gap-1.5 shrink-0 transition-colors disabled:opacity-50 ${
                              driver.verifiedDriver
                                ? 'bg-white border-2 border-[#1F2A2E] text-[#1F2A2E] hover:bg-[#F2F5F3]'
                                : 'bg-[#0E6B4E] hover:bg-[#0A523B] text-white border-2 border-[#1F2A2E]'
                            }`}
                          >
                            {driver.verifiedDriver ? (
                              <>
                                <ShieldAlert className="w-4 h-4 shrink-0" aria-hidden="true" />
                                <span>{t.adminRevokeDriverBtn}</span>
                              </>
                            ) : (
                              <>
                                <ShieldCheck className="w-4 h-4 shrink-0" aria-hidden="true" />
                                <span>{t.adminVerifyDriverBtn}</span>
                              </>
                            )}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  );
}
