import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock,
  Radio,
  ShieldCheck,
  ShieldOff,
  Square,
  Volume2,
} from 'lucide-react';
import { composeVoicePlanB, explainPlanB } from '../ai/geminiClient';
import {
  fallbackPlanB,
  type PlanBAlternativeInput,
  type PlanBResponse,
} from '../ai/geminiSchemas';
import { useI18n } from '../i18n/I18nContext';
import type { DisruptionEvaluation } from '../matching/disruption';
import { formatClockTime, type MatchedRideOption } from '../matching/matchRides';
import type { DemandPin, Language, Trip } from '../types/firestore';
import { getVehicleLabel, VehicleIcon } from '../ui/VehicleIcons';

interface DisruptionPlanBCardProps {
  evaluation: DisruptionEvaluation;
  disruptedTrip: Trip | null;
  destinationName: string;
  studentName?: string;
  hasExam?: boolean;
  alternatives: MatchedRideOption[];
  nearbyLiveDriversCount: number;
  selectedBackupTripId: string | null;
  activeDemandPin: DemandPin | null;
  busyAction: string | null;
  onSelectBackupOption: (opt: MatchedRideOption) => void;
  onSwitchRide: (opt: MatchedRideOption) => Promise<void>;
  onCreateDemandPin: () => Promise<boolean>;
}

function getSpeechLang(lang: Language): string {
  if (lang === 'kn') return 'kn-IN';
  if (lang === 'hi') return 'hi-IN';
  return 'en-IN';
}

export function DisruptionPlanBCard({
  evaluation,
  disruptedTrip,
  destinationName,
  studentName = 'Student',
  hasExam = false,
  alternatives,
  nearbyLiveDriversCount,
  selectedBackupTripId,
  activeDemandPin,
  busyAction,
  onSelectBackupOption,
  onSwitchRide,
  onCreateDemandPin,
}: DisruptionPlanBCardProps) {
  const { t, language } = useI18n();

  const triggerText = useMemo(() => {
    if (evaluation.trigger === 'scheduled_late') {
      const mins = evaluation.lateMinutes ?? 11;
      return `${t.disruptionTriggerLate} (${mins} min)`;
    }
    if (evaluation.trigger === 'student_no_show') {
      return `${t.disruptionTriggerNoShow} (${evaluation.noShowReportCount})`;
    }
    return t.disruptionTriggerBreakdown;
  }, [evaluation, t]);

  const disruptedVehicleLabel = disruptedTrip
    ? getVehicleLabel(disruptedTrip.vehicleType, t)
    : t.vehicleOther;
  const disruptedDriverName = disruptedTrip?.driverName ?? '';

  const altInputs = useMemo<PlanBAlternativeInput[]>(
    () =>
      alternatives.slice(0, 3).map((opt) => ({
        tripId: opt.trip.id,
        vehicleLabel: getVehicleLabel(opt.trip.vehicleType, t),
        driverName: opt.trip.driverName,
        driverVerified: opt.trip.driverVerified,
        etaPickupMin: opt.etaToPickupMinutes,
        walkMin: opt.walkMinutes,
        arrivalTime: formatClockTime(opt.arrivalEpochMs),
        seatsLeft: opt.trip.seatsFree,
      })),
    [alternatives, t],
  );

  const planBRequestKey = useMemo(
    () =>
      JSON.stringify({
        language,
        trigger: evaluation.trigger ?? 'driver_breakdown',
        disruptedTripId: disruptedTrip?.id ?? '',
        nearbyLiveDriversCount,
        altIds: altInputs.map((a) => `${a.tripId}:${a.etaPickupMin}:${a.seatsLeft}`),
      }),
    [language, evaluation.trigger, disruptedTrip?.id, nearbyLiveDriversCount, altInputs],
  );

  const [planB, setPlanB] = useState<PlanBResponse>(() =>
    fallbackPlanB({
      language,
      triggerReason: evaluation.trigger ?? 'driver_breakdown',
      disruptedVehicleLabel,
      disruptedDriverName,
      destinationName,
      nearbyLiveDriversCount,
      alternatives: altInputs,
    }),
  );
  const [explaining, setExplaining] = useState(false);
  const [speaking, setSpeaking] = useState(false);

  useEffect(() => {
    return () => {
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const input = {
      language,
      triggerReason: evaluation.trigger ?? 'driver_breakdown',
      disruptedVehicleLabel,
      disruptedDriverName,
      destinationName,
      nearbyLiveDriversCount,
      alternatives: altInputs,
    };

    // Show deterministic grounded text right away while Gemini refines phrasing
    setPlanB(fallbackPlanB(input));
    setExplaining(true);

    void explainPlanB(input).then((res) => {
      if (!cancelled) {
        setPlanB(res);
        setExplaining(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [planBRequestKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const topAlternatives = alternatives.slice(0, 2);
  const bestOption = alternatives[0] ?? null;
  const departureTimeText = bestOption
    ? formatClockTime(Date.now() + Math.max(0, bestOption.etaToPickupMinutes - 2) * 60_000)
    : formatClockTime(Date.now());

  const handleToggleVoice = async () => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    if (speaking) {
      window.speechSynthesis.cancel();
      setSpeaking(false);
      return;
    }
    setSpeaking(true);
    try {
      const voiceRes = await composeVoicePlanB({
        language,
        studentName,
        destinationName,
        departureTimeText,
        vehicleLabel: bestOption
          ? getVehicleLabel(bestOption.trip.vehicleType, t)
          : disruptedVehicleLabel,
        driverName: bestOption?.trip.driverName || disruptedDriverName || 'driver',
        etaPickupMin: bestOption?.etaToPickupMinutes ?? 5,
      });
      const utterance = new SpeechSynthesisUtterance(voiceRes.spokenMessage);
      utterance.lang = getSpeechLang(language);
      utterance.onend = () => setSpeaking(false);
      utterance.onerror = () => setSpeaking(false);
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utterance);
    } catch {
      setSpeaking(false);
    }
  };

  return (
    <section
      aria-label={t.disruptionAlertTitle}
      className="bg-white border-2 border-[#D7352B] rounded-2xl overflow-hidden shadow-sm"
    >
      <div className="bg-[#D7352B] text-white px-4 py-3 flex items-start justify-between gap-2.5">
        <div className="flex items-start gap-2.5 min-w-0">
          <AlertTriangle className="w-5 h-5 mt-0.5 shrink-0" aria-hidden="true" />
          <div className="min-w-0">
            <h2 className="font-sign font-extrabold text-base leading-tight">
              {hasExam ? t.crisisStudentUrgentPlanBTitle : t.disruptionAlertTitle}
            </h2>
            <p className="text-xs font-medium text-white/95 mt-0.5">{triggerText}</p>
          </div>
        </div>
        {hasExam && (
          <span className="px-2 py-0.5 rounded bg-[#FFC20E] text-[#1F2A2E] border border-[#1F2A2E] font-sign font-extrabold text-[10px] shrink-0">
            {t.crisisStudentExamBadge}
          </span>
        )}
      </div>

      <div className="p-4 space-y-3">
        <div className="p-3 rounded-xl bg-[#0E6B4E]/10 border-2 border-[#0E6B4E] space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-extrabold uppercase tracking-wide text-[#0E6B4E]">
              {t.disruptionPlanBLabel}
            </span>
            {explaining && (
              <span className="text-[11px] font-bold text-[#0E6B4E]">{t.disruptionExplaining}</span>
            )}
          </div>
          <p className="font-sign font-bold text-base text-[#1F2A2E]">{planB.headline}</p>
          <p className="text-sm text-[#1F2A2E]">{planB.summary}</p>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-[#0E6B4E]/30">
            {bestOption && (
              <span className="inline-flex items-center gap-1 text-xs font-extrabold text-[#1F2A2E] tabular-nums">
                <Clock className="w-3.5 h-3.5 text-[#D7352B]" aria-hidden="true" />
                <span>
                  {t.crisisStudentDepartByLabel}: {departureTimeText}
                </span>
              </span>
            )}
            <button
              type="button"
              onClick={() => void handleToggleVoice()}
              className="min-h-[36px] px-2.5 rounded-lg bg-white border border-[#1F2A2E] text-xs font-bold text-[#1F2A2E] inline-flex items-center gap-1.5"
            >
              {speaking ? (
                <Square className="w-3.5 h-3.5 text-[#D7352B]" aria-hidden="true" />
              ) : (
                <Volume2 className="w-3.5 h-3.5 text-[#0E6B4E]" aria-hidden="true" />
              )}
              <span>
                {speaking ? t.crisisStudentVoiceStopBtn : t.crisisStudentVoiceListenBtn}
              </span>
            </button>
          </div>
        </div>

        {topAlternatives.length > 0 ? (
          <div className="space-y-2.5">
            {topAlternatives.map((opt, idx) => {
              const isSelected =
                selectedBackupTripId === opt.trip.id ||
                (!selectedBackupTripId && idx === 0);
              const isSwitching = busyAction === `switch:${opt.trip.id}`;
              return (
                <div
                  key={opt.trip.id}
                  onClick={() => onSelectBackupOption(opt)}
                  className={`p-3 rounded-xl border-2 cursor-pointer space-y-2.5 transition-colors ${
                    isSelected
                      ? 'bg-[#0E6B4E]/5 border-[#0E6B4E]'
                      : 'bg-white border-[#1F2A2E]'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <VehicleIcon type={opt.trip.vehicleType} />
                      <div className="min-w-0">
                        <p className="font-sign font-bold text-base text-[#1F2A2E] truncate">
                          {getVehicleLabel(opt.trip.vehicleType, t)} · {opt.trip.driverName}
                        </p>
                        <p className="text-xs text-[#526066] tabular-nums">
                          {opt.etaToPickupMinutes <= 1
                            ? t.reachesStopNow
                            : `${t.reachesStopIn} ${opt.etaToPickupMinutes} min`}{' '}
                          · {t.reachesSchoolAt} {formatClockTime(opt.arrivalEpochMs)} ·{' '}
                          {opt.trip.seatsFree} {t.seatsLeftSuffix}
                        </p>
                      </div>
                    </div>

                    <span
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-bold shrink-0 ${
                        opt.trip.driverVerified
                          ? 'bg-[#0E6B4E] text-white'
                          : 'bg-[#FFC20E]/30 text-[#1F2A2E] border border-[#1F2A2E]'
                      }`}
                    >
                      {opt.trip.driverVerified ? (
                        <ShieldCheck className="w-3.5 h-3.5" aria-hidden="true" />
                      ) : (
                        <ShieldOff className="w-3.5 h-3.5 text-[#D7352B]" aria-hidden="true" />
                      )}
                      <span>{opt.trip.driverVerified ? t.badgeVerified : t.badgeNotVerified}</span>
                    </span>
                  </div>

                  {!opt.trip.driverVerified && (
                    <p className="text-xs font-bold text-[#D7352B] flex items-center gap-1.5 break-words">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                      <span>{t.unverifiedDriverWarningShort}</span>
                    </p>
                  )}

                  <button
                    type="button"
                    disabled={Boolean(busyAction)}
                    onClick={(e) => {
                      e.stopPropagation();
                      void onSwitchRide(opt);
                    }}
                    className="w-full min-h-[48px] px-4 rounded-xl bg-[#0E6B4E] hover:bg-[#0A523B] text-white font-sign font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-60"
                  >
                    <span>
                      {isSwitching ? t.disruptionSwitchingBtn : t.disruptionSwitchRideBtn}
                    </span>
                    <ArrowRight className="w-4 h-4" aria-hidden="true" />
                  </button>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="p-3 rounded-xl bg-[#F2F5F3] border border-[#D5DDD8] space-y-2.5">
            <p className="text-sm text-[#1F2A2E]">{t.disruptionNoBackupNote}</p>
            {activeDemandPin ? (
              <div className="p-2.5 rounded-xl bg-[#FFC20E]/25 border border-[#1F2A2E] flex items-center gap-2 text-xs font-bold text-[#1F2A2E]">
                <Radio className="w-4 h-4 text-[#0E6B4E] shrink-0" aria-hidden="true" />
                <span>
                  {activeDemandPin.offeredByDriverName
                    ? `${t.studentDemandOfferedBy} ${activeDemandPin.offeredByDriverName}`
                    : t.studentDemandActiveTitle}
                </span>
                <CheckCircle2 className="w-4 h-4 text-[#0E6B4E] ml-auto shrink-0" aria-hidden="true" />
              </div>
            ) : (
              <button
                type="button"
                disabled={busyAction === 'demand:create'}
                onClick={() => void onCreateDemandPin()}
                className="w-full min-h-[52px] px-4 rounded-xl bg-[#FFC20E] hover:bg-[#e5ae0b] text-[#1F2A2E] font-sign font-bold text-sm border-2 border-[#1F2A2E]"
              >
                {busyAction === 'demand:create'
                  ? t.studentPostingDemandBtn
                  : t.studentTellDriversBtn}
              </button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
