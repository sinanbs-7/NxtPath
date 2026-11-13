import React, { useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  MessageCircle,
  Share2,
  ShieldAlert,
  XCircle,
} from 'lucide-react';
import { composeParentMessage } from '../ai/geminiClient';
import { buildParentTrackUrl, buildWhatsAppShareUrl } from '../ai/geminiSchemas';
import { useI18n } from '../i18n/I18nContext';
import {
  isRequestEligibleForNoShowReport,
  type DisruptionEvaluation,
} from '../matching/disruption';
import { computeTicketProgress, type TicketStage } from '../matching/matchRides';
import type { LivePosition, SeatRequest, Trip } from '../types/firestore';
import { getVehicleLabel, VehicleIcon } from '../ui/VehicleIcons';

interface TicketStubCardProps {
  request: SeatRequest;
  trip: Trip | null;
  livePos: LivePosition | null;
  nowMs: number;
  busyAction: string | null;
  studentName?: string;
  disruption?: DisruptionEvaluation;
  hasReportedNoShow?: boolean;
  onReportNoShow?: () => Promise<void>;
  onCancelRequest: (req: SeatRequest) => Promise<void>;
  onMarkReached: (req: SeatRequest) => Promise<void>;
  onFindAnother: (reqId: string) => void;
}

const ORDERED_STAGES: TicketStage[] = [
  'waiting',
  'accepted',
  'arriving',
  'on_the_way',
  'reached_school',
];

export function TicketStubCard({
  request,
  trip,
  livePos,
  nowMs,
  busyAction,
  studentName,
  disruption,
  hasReportedNoShow = false,
  onReportNoShow,
  onCancelRequest,
  onMarkReached,
  onFindAnother,
}: TicketStubCardProps) {
  const { t, language } = useI18n();
  const progress = computeTicketProgress(request, trip, livePos, nowMs);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareBusy, setShareBusy] = useState(false);
  const [shareMessage, setShareMessage] = useState('');
  const [shareLiveLink, setShareLiveLink] = useState('');
  const [copiedLink, setCopiedLink] = useState(false);

  const effectiveStage: TicketStage =
    disruption?.disrupted && progress.stage !== 'declined' && progress.stage !== 'reached_school'
      ? 'disrupted'
      : progress.stage;

  const stageLabel = (stage: TicketStage) => {
    switch (stage) {
      case 'waiting':
        return t.ticketStageWaiting;
      case 'accepted':
        return t.ticketStageAccepted;
      case 'arriving':
        return t.ticketStageArriving;
      case 'on_the_way':
        return t.ticketStageOnTheWay;
      case 'reached_school':
        return t.ticketStageReachedSchool;
      case 'declined':
        return t.ticketStageDeclined;
      case 'disrupted':
        return t.ticketStageDisrupted;
    }
  };

  const currentIdx = ORDERED_STAGES.indexOf(effectiveStage);
  const canShareWithParent =
    effectiveStage !== 'declined' && effectiveStage !== 'disrupted';
  const canReportNoShow =
    Boolean(onReportNoShow) &&
    !disruption?.disrupted &&
    isRequestEligibleForNoShowReport(request, trip);

  const handleShareParent = async () => {
    const liveLink = buildParentTrackUrl(window.location.origin, {
      tripId: request.tripId,
      studentName: studentName || request.studentName,
      dest: request.destinationName,
      pickupLat: request.pickupLat,
      pickupLng: request.pickupLng,
      rideCode: request.rideCode,
    });
    setShareLiveLink(liveLink);
    setShareOpen(true);
    setCopiedLink(false);
    setShareBusy(true);
    try {
      const res = await composeParentMessage({
        language,
        studentName: studentName || request.studentName || 'Student',
        destinationName: request.destinationName,
        vehicleLabel: trip ? getVehicleLabel(trip.vehicleType, t) : t.vehicleOther,
        driverName: trip?.driverName || '',
        driverVerified: Boolean(trip?.driverVerified),
        rideCode: request.rideCode,
        stage: stageLabel(effectiveStage),
        etaMinutes: progress.countdownMinutes,
        liveLink,
      });
      setShareMessage(res.message);
    } finally {
      setShareBusy(false);
    }
  };

  const handleCopyLink = async () => {
    if (!shareLiveLink) return;
    try {
      await navigator.clipboard.writeText(shareLiveLink);
      setCopiedLink(true);
      window.setTimeout(() => setCopiedLink(false), 2500);
    } catch {
      // Clipboard may be unavailable in restricted contexts
    }
  };

  return (
    <section
      aria-label={t.ticketTitle}
      className="bg-white border-2 border-[#1F2A2E] rounded-2xl overflow-hidden shadow-sm"
    >
      <div className="h-2.5 ticket-perforation bg-[#FFC20E] border-b border-[#1F2A2E]" aria-hidden="true" />

      <div className="p-4 space-y-3.5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            {trip && <VehicleIcon type={trip.vehicleType} />}
            <div className="min-w-0">
              <p className="text-xs font-bold text-[#0E6B4E]">{t.ticketTitle}</p>
              <p className="font-sign font-bold text-base text-[#1F2A2E] truncate">
                {trip
                  ? `${getVehicleLabel(trip.vehicleType, t)} · ${trip.driverName}`
                  : request.destinationName}
              </p>
              <p className="text-xs text-[#526066] truncate">{request.destinationName}</p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 flex-wrap justify-end shrink-0">
            {request.examAt && (
              <span className="px-2 py-1 rounded-lg bg-[#FFC20E] text-[#1F2A2E] border border-[#1F2A2E] font-sign font-extrabold text-[11px]">
                {t.crisisStudentExamBadge}
              </span>
            )}
            {request.isDrill && (
              <span className="px-2 py-1 rounded-lg bg-[#1F2A2E] text-[#FFC20E] font-sign font-extrabold text-[11px]">
                {t.crisisDrillBadge}
              </span>
            )}
            <span
              className={`px-2.5 py-1 rounded-lg text-xs font-extrabold border shrink-0 ${
                effectiveStage === 'disrupted' || effectiveStage === 'declined'
                  ? 'bg-[#D7352B] text-white border-[#1F2A2E]'
                  : effectiveStage === 'reached_school'
                    ? 'bg-[#0E6B4E] text-white border-[#1F2A2E]'
                    : 'bg-[#FFC20E] text-[#1F2A2E] border-[#1F2A2E]'
              }`}
            >
              {stageLabel(effectiveStage)}
            </span>
          </div>
        </div>

        {effectiveStage !== 'declined' && effectiveStage !== 'disrupted' && (
          <div className="grid grid-cols-5 gap-1 pt-1" aria-label="Ride progress">
            {ORDERED_STAGES.map((st, idx) => {
              const reached = currentIdx >= idx;
              return (
                <div key={st} className="space-y-1">
                  <div
                    className={`h-2 rounded-full ${
                      reached ? 'bg-[#0E6B4E]' : 'bg-[#D5DDD8]'
                    }`}
                  />
                  <p
                    className={`text-[11px] leading-tight text-center ${
                      reached ? 'font-bold text-[#1F2A2E]' : 'text-[#526066]'
                    }`}
                  >
                    {stageLabel(st)}
                  </p>
                </div>
              );
            })}
          </div>
        )}

        {trip && !trip.driverVerified && effectiveStage !== 'declined' && effectiveStage !== 'reached_school' && (
          <div
            role="note"
            className="p-2.5 rounded-xl bg-[#FFC20E]/20 border border-[#1F2A2E] flex items-start gap-2 text-xs font-bold text-[#1F2A2E]"
          >
            <ShieldAlert className="w-4 h-4 text-[#D7352B] mt-0.5 shrink-0" aria-hidden="true" />
            <span className="break-words">{t.unverifiedDriverWarning}</span>
          </div>
        )}

        {request.rideCode && effectiveStage !== 'declined' && effectiveStage !== 'disrupted' && (
          <div className="p-3 rounded-xl bg-[#FFC20E]/25 border-2 border-dashed border-[#1F2A2E] flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-bold text-[#1F2A2E]">{t.ticketRideCodeTitle}</p>
              <p className="text-xs text-[#526066]">{t.ticketRideCodeHint}</p>
            </div>
            <span className="px-3 py-1.5 rounded-lg bg-[#1F2A2E] text-[#FFC20E] font-sign font-extrabold text-2xl tracking-widest tabular-nums shrink-0">
              {request.rideCode}
            </span>
          </div>
        )}

        {effectiveStage === 'waiting' && (
          <p className="text-sm text-[#1F2A2E] bg-[#F2F5F3] p-3 rounded-xl border border-[#D5DDD8]">
            {t.ticketWaitingDriver}
          </p>
        )}

        {(effectiveStage === 'accepted' || effectiveStage === 'arriving') && (
          <div className="p-3 rounded-xl bg-[#0E6B4E]/10 border border-[#0E6B4E] flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-bold text-[#1F2A2E] tabular-nums">
              <Clock className="w-4 h-4 text-[#0E6B4E] shrink-0" aria-hidden="true" />
              <span>
                {progress.countdownMinutes !== null && progress.countdownMinutes <= 0
                  ? t.ticketArrivingNow
                  : progress.countdownMinutes !== null
                    ? `${t.ticketArrivingCountdown} ${progress.countdownMinutes} min`
                    : t.ticketStageArriving}
              </span>
            </div>
            {progress.isVehicleOffline && (
              <span className="text-xs font-bold text-[#D7352B]">{t.vehicleOfflineBadge}</span>
            )}
          </div>
        )}

        {effectiveStage === 'on_the_way' && (
          <div className="p-3 rounded-xl bg-[#0E6B4E]/10 border border-[#0E6B4E] flex items-center justify-between gap-2">
            <span className="text-sm font-bold text-[#0E6B4E] tabular-nums">
              {t.ticketOnTheWayEta} {Math.max(1, progress.countdownMinutes ?? 1)} min
            </span>
            {progress.isVehicleOffline && (
              <span className="text-xs font-bold text-[#D7352B]">{t.vehicleOfflineBadge}</span>
            )}
          </div>
        )}

        {effectiveStage === 'reached_school' && (
          <div className="p-3 rounded-xl bg-[#0E6B4E]/10 border border-[#0E6B4E] flex items-center gap-2 text-sm font-bold text-[#0E6B4E]">
            <CheckCircle2 className="w-5 h-5 shrink-0" aria-hidden="true" />
            <span>{t.ticketStageReachedSchool}</span>
          </div>
        )}

        {effectiveStage === 'disrupted' && (
          <div role="alert" className="p-3 rounded-xl bg-[#D7352B]/10 border-2 border-[#D7352B] flex items-start gap-2">
            <AlertTriangle className="w-5 h-5 text-[#D7352B] mt-0.5 shrink-0" aria-hidden="true" />
            <p className="text-sm font-medium text-[#1F2A2E]">{t.ticketDisruptedNote}</p>
          </div>
        )}

        {effectiveStage === 'declined' && (
          <div className="p-3 rounded-xl bg-[#F2F5F3] border border-[#D5DDD8] flex items-start gap-2">
            <XCircle className="w-5 h-5 text-[#526066] mt-0.5 shrink-0" aria-hidden="true" />
            <p className="text-sm text-[#1F2A2E]">{t.ticketDeclinedNote}</p>
          </div>
        )}

        {canReportNoShow && onReportNoShow && (
          <div>
            {hasReportedNoShow ? (
              <p className="text-xs font-bold text-[#D7352B] bg-[#D7352B]/10 border border-[#D7352B] rounded-xl px-3 py-2 tabular-nums">
                {t.reportNoShowSubmitted} ({Math.max(1, disruption?.noShowReportCount ?? 1)}/2)
              </p>
            ) : (
              <button
                type="button"
                disabled={busyAction === `noshow:${request.tripId}`}
                onClick={() => void onReportNoShow()}
                className="w-full min-h-[44px] px-3 rounded-xl bg-[#F2F5F3] hover:bg-[#FFC20E]/25 border border-[#1F2A2E] text-xs font-bold text-[#1F2A2E] flex items-center justify-center gap-1.5"
              >
                <AlertTriangle className="w-4 h-4 text-[#D7352B] shrink-0" aria-hidden="true" />
                <span>
                  {busyAction === `noshow:${request.tripId}`
                    ? t.reportNoShowSubmitting
                    : t.reportNoShowBtn}
                </span>
              </button>
            )}
          </div>
        )}

        {canShareWithParent && (
          <div className="space-y-2">
            <button
              type="button"
              disabled={shareBusy}
              onClick={() => void handleShareParent()}
              className="w-full min-h-[48px] px-4 rounded-xl bg-[#FFC20E] hover:bg-[#e5ae0b] text-[#1F2A2E] font-sign font-bold text-sm border-2 border-[#1F2A2E] flex items-center justify-center gap-2 transition-colors"
            >
              <Share2 className="w-4 h-4" aria-hidden="true" />
              <span>{shareBusy ? t.shareGenerating : t.shareWithParentBtn}</span>
            </button>

            {shareOpen && shareMessage && (
              <div className="p-3 rounded-xl bg-[#F2F5F3] border-2 border-[#1F2A2E] space-y-2.5">
                <p className="text-xs font-bold text-[#0E6B4E]">{t.sharePreviewLabel}</p>
                <p className="text-sm text-[#1F2A2E] whitespace-pre-wrap break-words bg-white p-2.5 rounded-lg border border-[#D5DDD8]">
                  {shareMessage}
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <a
                    href={buildWhatsAppShareUrl(shareMessage)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="min-h-[48px] px-3 rounded-xl bg-[#0E6B4E] hover:bg-[#0A523B] text-white font-bold text-sm flex items-center justify-center gap-2"
                  >
                    <MessageCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
                    <span>{t.shareOpenWhatsAppBtn}</span>
                  </a>
                  <button
                    type="button"
                    onClick={() => void handleCopyLink()}
                    className="min-h-[48px] px-3 rounded-xl bg-white border-2 border-[#1F2A2E] text-[#1F2A2E] font-bold text-sm flex items-center justify-center gap-2"
                  >
                    {copiedLink ? (
                      <Check className="w-4 h-4 text-[#0E6B4E] shrink-0" aria-hidden="true" />
                    ) : (
                      <Copy className="w-4 h-4 shrink-0" aria-hidden="true" />
                    )}
                    <span>{copiedLink ? t.shareCopiedBadge : t.shareCopyLinkBtn}</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        <div className="flex flex-wrap gap-2 pt-1">
          {effectiveStage === 'waiting' && (
            <button
              type="button"
              disabled={busyAction === `cancel:${request.id}`}
              onClick={() => void onCancelRequest(request)}
              className="flex-1 min-h-[48px] px-4 rounded-xl bg-white border-2 border-[#1F2A2E] text-[#1F2A2E] font-bold text-sm"
            >
              {t.ticketCancelBtn}
            </button>
          )}

          {(effectiveStage === 'accepted' ||
            effectiveStage === 'arriving' ||
            effectiveStage === 'on_the_way') && (
            <button
              type="button"
              disabled={busyAction === `complete:${request.id}`}
              onClick={() => void onMarkReached(request)}
              className="flex-1 min-h-[48px] px-4 rounded-xl bg-[#0E6B4E] text-white font-bold text-sm"
            >
              {t.ticketReachedBtn}
            </button>
          )}

          {(effectiveStage === 'declined' ||
            effectiveStage === 'disrupted' ||
            effectiveStage === 'reached_school') && (
            <button
              type="button"
              onClick={() => onFindAnother(request.id)}
              className="flex-1 min-h-[48px] px-4 rounded-xl bg-[#1F2A2E] text-white font-bold text-sm"
            >
              {t.ticketFindAnotherBtn}
            </button>
          )}
        </div>
      </div>

      <div className="h-2.5 ticket-perforation bg-[#F2F5F3] border-t border-[#D5DDD8]" aria-hidden="true" />
    </section>
  );
}
