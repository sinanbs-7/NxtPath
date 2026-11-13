import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  BookmarkCheck,
  ChevronDown,
  ChevronUp,
  Clock,
  Crosshair,
  MapPin,
  Radio,
  Sparkles,
  Square,
  Trash2,
  Volume2,
} from 'lucide-react';
import { composeVoicePlanB, parseRideRequest } from '../ai/geminiClient';
import { useAuth } from '../auth/AuthContext';
import { useI18n } from '../i18n/I18nContext';
import { searchPhotonPlaces, type PlaceResult } from '../map/photon';
import type { UseGeolocationResult } from '../map/useGeolocation';
import type { DisruptionEvaluation } from '../matching/disruption';
import { formatClockTime, type MatchedRideOption, type MatchRidesResult } from '../matching/matchRides';
import type {
  DemandPin,
  Language,
  LatLngPoint,
  LivePosition,
  SeatRequest,
  Trip,
} from '../types/firestore';
import { PlaceSearchInput } from '../ui/PlaceSearchInput';
import { SkeletonList } from '../ui/LoadingSkeleton';
import { getVehicleLabel, VEHICLE_TYPES, VehicleIcon } from '../ui/VehicleIcons';
import { DisruptionPlanBCard } from './DisruptionPlanBCard';
import { RideOptionCard } from './RideOptionCard';
import { TicketStubCard } from './TicketStubCard';

interface ParsedRequestDraft {
  destination: string;
  arriveBy: string;
  detectedLanguage: Language;
  rawText: string;
}

interface StudentSheetProps {
  geo: UseGeolocationResult;
  pickupPoint: LatLngPoint | null;
  isCustomPickup: boolean;
  onSelectCustomPickup: (place: PlaceResult) => void;
  onResetPickupToGps: () => void;
  destination: PlaceResult | null;
  onSelectDestination: (place: PlaceResult | null) => void;
  arriveByHHmm: string;
  onArriveByChange: (hhmm: string) => void;
  hasExam: boolean;
  onToggleExam: (next: boolean) => void;
  matchResult: MatchRidesResult;
  selectedTripId: string | null;
  onSelectTripOption: (option: MatchedRideOption) => void;
  activeRequest: SeatRequest | null;
  trackedTrip: Trip | null;
  trackedLivePos: LivePosition | null;
  disruption: DisruptionEvaluation;
  planBResult: MatchRidesResult;
  selectedBackupTripId: string | null;
  onSelectBackupOption: (option: MatchedRideOption) => void;
  onSwitchToBackup: (option: MatchedRideOption) => Promise<void>;
  hasReportedNoShow: boolean;
  onReportNoShow: () => Promise<void>;
  activeDemandPin: DemandPin | null;
  busyAction: string | null;
  actionError: string | null;
  onClearActionError: () => void;
  onAskForSeat: (option: MatchedRideOption) => Promise<boolean>;
  onCancelRequest: (req: SeatRequest) => Promise<void>;
  onMarkReached: (req: SeatRequest) => Promise<void>;
  onDismissTicket: (reqId: string) => void;
  onCreateDemandPin: () => Promise<boolean>;
  onCancelDemandPin: (pin: DemandPin) => Promise<void>;
  onFocusSearch: () => void;
  onExpandSheet?: () => void;
  loading?: boolean;
}

function getLanguageDisplay(lang: Language): string {
  if (lang === 'kn') return 'ಕನ್ನಡ';
  if (lang === 'hi') return 'हिन्दी';
  return 'English';
}

export function StudentSheet({
  geo,
  pickupPoint,
  isCustomPickup,
  onSelectCustomPickup,
  onResetPickupToGps,
  destination,
  onSelectDestination,
  arriveByHHmm,
  onArriveByChange,
  hasExam,
  onToggleExam,
  matchResult,
  selectedTripId,
  onSelectTripOption,
  activeRequest,
  trackedTrip,
  trackedLivePos,
  disruption,
  planBResult,
  selectedBackupTripId,
  onSelectBackupOption,
  onSwitchToBackup,
  hasReportedNoShow,
  onReportNoShow,
  activeDemandPin,
  busyAction,
  actionError,
  onClearActionError,
  onAskForSeat,
  onCancelRequest,
  onMarkReached,
  onDismissTicket,
  onCreateDemandPin,
  onCancelDemandPin,
  onFocusSearch,
  onExpandSheet,
  loading = false,
}: StudentSheetProps) {
  const { t, language } = useI18n();
  const {
    firebaseUser,
    displayName,
    savedSchool,
    saveSchool,
    signInWithGoogle,
    completeOnboarding,
    authBusy,
    authError,
    clearAuthError,
  } = useAuth();

  const [schoolSavedNote, setSchoolSavedNote] = useState(false);
  const [showLegend, setShowLegend] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [parsingRequest, setParsingRequest] = useState(false);
  const [parsedDraft, setParsedDraft] = useState<ParsedRequestDraft | null>(null);
  const [resolvingDraftPlace, setResolvingDraftPlace] = useState(false);
  const [draftPlaceError, setDraftPlaceError] = useState<string | null>(null);
  const [speakingPlanB, setSpeakingPlanB] = useState(false);

  useEffect(() => {
    return () => {
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 10_000);
    return () => window.clearInterval(id);
  }, []);

  const isSameAsSavedSchool =
    Boolean(destination && savedSchool) &&
    Math.abs((destination?.lat ?? 0) - (savedSchool?.lat ?? 0)) < 0.0001 &&
    Math.abs((destination?.lng ?? 0) - (savedSchool?.lng ?? 0)) < 0.0001;

  const handleSaveSchool = async () => {
    if (!destination) return;
    await saveSchool({
      name: destination.name,
      address: destination.subtitle || destination.name,
      lat: destination.lat,
      lng: destination.lng,
    });
    setSchoolSavedNote(true);
  };

  const handleNaturalLanguageRequest = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setParsingRequest(true);
    setDraftPlaceError(null);
    onExpandSheet?.();
    try {
      const parsed = await parseRideRequest(trimmed, language);
      setParsedDraft({
        destination: parsed.destination ?? '',
        arriveBy: parsed.arriveBy ?? arriveByHHmm,
        detectedLanguage: parsed.language,
        rawText: trimmed,
      });
    } finally {
      setParsingRequest(false);
    }
  };

  const handleConfirmParsedDraft = async () => {
    if (!parsedDraft) return;
    setDraftPlaceError(null);

    if (parsedDraft.arriveBy) {
      onArriveByChange(parsedDraft.arriveBy);
    }

    const destText = parsedDraft.destination.trim();
    if (!destText) {
      if (savedSchool) {
        onSelectDestination({
          id: 'saved-school',
          name: savedSchool.name,
          subtitle: savedSchool.address,
          lat: savedSchool.lat,
          lng: savedSchool.lng,
        });
      }
      setParsedDraft(null);
      return;
    }

    setResolvingDraftPlace(true);
    try {
      const { results } = await searchPhotonPlaces(destText, {
        biasLat: pickupPoint?.lat ?? geo.position?.lat,
        biasLng: pickupPoint?.lng ?? geo.position?.lng,
        limit: 3,
      });
      if (results.length > 0) {
        setSchoolSavedNote(false);
        onSelectDestination(results[0]);
        setParsedDraft(null);
      } else {
        setDraftPlaceError(t.searchEmpty);
      }
    } catch {
      setDraftPlaceError(t.searchError);
    } finally {
      setResolvingDraftPlace(false);
    }
  };

  const nearbyCount = matchResult.nearbyLiveDriversCount;
  const nearbyText =
    nearbyCount === 0
      ? t.studentNearbyDriversZero
      : nearbyCount === 1
        ? t.studentNearbyDriversSingle
        : `${nearbyCount} ${t.studentNearbyDriversPlural}`;

  const authErrorMessage =
    authError === 'guest_unavailable'
      ? t.authGuestUnavailable
      : authError === 'popup_closed'
        ? t.authPopupClosed
        : authError === 'network_error'
          ? t.authNetworkError
          : null;

  return (
    <div className="space-y-3">
      {activeRequest ? (
        <div className="space-y-3">
          {disruption.disrupted && (
            <DisruptionPlanBCard
              evaluation={disruption}
              disruptedTrip={trackedTrip}
              destinationName={activeRequest.destinationName}
              studentName={displayName}
              hasExam={Boolean(activeRequest.examAt) || hasExam}
              alternatives={planBResult.options}
              nearbyLiveDriversCount={planBResult.nearbyLiveDriversCount}
              selectedBackupTripId={selectedBackupTripId}
              activeDemandPin={activeDemandPin}
              busyAction={busyAction}
              onSelectBackupOption={onSelectBackupOption}
              onSwitchRide={onSwitchToBackup}
              onCreateDemandPin={onCreateDemandPin}
            />
          )}

          <TicketStubCard
            request={activeRequest}
            trip={trackedTrip}
            livePos={trackedLivePos}
            nowMs={nowMs}
            busyAction={busyAction}
            studentName={displayName}
            disruption={disruption}
            hasReportedNoShow={hasReportedNoShow}
            onReportNoShow={onReportNoShow}
            onCancelRequest={onCancelRequest}
            onMarkReached={onMarkReached}
            onFindAnother={onDismissTicket}
          />
        </div>
      ) : (
        <>
          {!destination ? (
            <div className="space-y-3">
              <PlaceSearchInput
                label={t.searchLabelStudent}
                biasLat={pickupPoint?.lat ?? geo.position?.lat}
                biasLng={pickupPoint?.lng ?? geo.position?.lng}
                onFocusInput={onFocusSearch}
                onNaturalLanguageRequest={handleNaturalLanguageRequest}
                parsingRequest={parsingRequest}
                onSelectPlace={(place) => {
                  setSchoolSavedNote(false);
                  setParsedDraft(null);
                  onSelectDestination(place);
                }}
              />

              {parsedDraft && (
                <section
                  aria-label={t.parsedRequestTitle}
                  className="p-3 rounded-2xl bg-[#FFC20E]/20 border-2 border-[#1F2A2E] space-y-2.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      <Sparkles className="w-4 h-4 text-[#0E6B4E]" aria-hidden="true" />
                      <h3 className="font-sign font-bold text-sm text-[#1F2A2E]">
                        {t.parsedRequestTitle}
                      </h3>
                    </div>
                    <span className="px-2 py-0.5 rounded bg-white border border-[#1F2A2E] text-xs font-bold text-[#1F2A2E]">
                      {t.parsedLanguageLabel}: {getLanguageDisplay(parsedDraft.detectedLanguage)}
                    </span>
                  </div>

                  <label className="block space-y-1">
                    <span className="text-xs font-bold text-[#1F2A2E]">
                      {t.parsedDestinationLabel}
                    </span>
                    <input
                      type="text"
                      value={parsedDraft.destination}
                      onChange={(e) => {
                        setDraftPlaceError(null);
                        setParsedDraft((prev) =>
                          prev ? { ...prev, destination: e.target.value } : prev,
                        );
                      }}
                      className="w-full min-h-[44px] px-3 rounded-xl bg-white border-2 border-[#1F2A2E] text-sm font-bold text-[#1F2A2E]"
                    />
                  </label>

                  <label className="flex items-center justify-between gap-3">
                    <span className="text-xs font-bold text-[#1F2A2E]">
                      {t.parsedArriveByLabel}
                    </span>
                    <input
                      type="time"
                      value={parsedDraft.arriveBy}
                      onChange={(e) =>
                        setParsedDraft((prev) =>
                          prev ? { ...prev, arriveBy: e.target.value } : prev,
                        )
                      }
                      className="px-3 py-1.5 rounded-xl bg-white border-2 border-[#1F2A2E] text-sm font-bold tabular-nums"
                    />
                  </label>

                  {draftPlaceError && (
                    <p role="alert" className="text-xs font-bold text-[#D7352B]">
                      {draftPlaceError}
                    </p>
                  )}

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      disabled={resolvingDraftPlace}
                      onClick={() => void handleConfirmParsedDraft()}
                      className="min-h-[48px] px-3 rounded-xl bg-[#0E6B4E] hover:bg-[#0A523B] text-white font-sign font-bold text-sm disabled:opacity-60"
                    >
                      {resolvingDraftPlace ? t.parsedFindingSchool : t.parsedSearchBtn}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setParsedDraft(null);
                        setDraftPlaceError(null);
                      }}
                      className="min-h-[48px] px-3 rounded-xl bg-white border-2 border-[#1F2A2E] text-[#1F2A2E] font-bold text-sm"
                    >
                      {t.parsedCancelBtn}
                    </button>
                  </div>
                </section>
              )}
            </div>
          ) : (
            <div className="p-3 rounded-xl bg-[#F2F5F3] border-2 border-[#1F2A2E] space-y-2.5">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-start gap-2 min-w-0">
                  <MapPin className="w-5 h-5 text-[#0E6B4E] mt-0.5 shrink-0" aria-hidden="true" />
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-[#0E6B4E]">
                      {isSameAsSavedSchool ? t.savedSchoolLabel : t.selectedPlaceLabel}
                    </p>
                    <p className="font-sign font-bold text-base text-[#1F2A2E] break-words">
                      {destination.name}
                    </p>
                    {destination.subtitle && destination.subtitle !== destination.name && (
                      <p className="text-xs text-[#526066] break-words">{destination.subtitle}</p>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      onSelectDestination(null);
                      setSchoolSavedNote(false);
                    }}
                    className="min-h-[40px] px-2.5 rounded-lg bg-white border border-[#1F2A2E] text-xs font-bold text-[#1F2A2E]"
                  >
                    {t.studentChangeDestination}
                  </button>
                  {isSameAsSavedSchool && (
                    <button
                      type="button"
                      onClick={() => {
                        void saveSchool(null);
                        onSelectDestination(null);
                      }}
                      aria-label={`${t.clearSavedSchool} ${destination.name}`}
                      title={t.clearSavedSchool}
                      className="min-h-[40px] min-w-[40px] rounded-lg border border-[#D5DDD8] bg-white text-[#1F2A2E] flex items-center justify-center"
                    >
                      <Trash2 className="w-4 h-4" aria-hidden="true" />
                    </button>
                  )}
                </div>
              </div>

              {!isSameAsSavedSchool && (
                <button
                  type="button"
                  onClick={() => void handleSaveSchool()}
                  className="w-full min-h-[48px] px-4 rounded-xl bg-[#0E6B4E] hover:bg-[#0A523B] text-white font-bold text-sm flex items-center justify-center gap-2 transition-colors"
                >
                  <BookmarkCheck className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span>{schoolSavedNote ? t.schoolSavedConfirm : t.saveAsSchoolBtn}</span>
                </button>
              )}
            </div>
          )}

          {/* Pickup spot status + drag hint or manual search when GPS is unavailable */}
          {pickupPoint ? (
            <div className="p-2.5 rounded-xl bg-white border border-[#D5DDD8] flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-xs font-bold text-[#1F2A2E]">
                  {t.studentPickupLabel}:{' '}
                  <span className="text-[#0E6B4E]">
                    {isCustomPickup ? t.studentPickupCustom : t.studentPickupGps}
                  </span>
                </p>
                <p className="text-xs text-[#526066] mt-0.5">{t.studentPickupDragHint}</p>
              </div>
              {isCustomPickup && geo.position && (
                <button
                  type="button"
                  onClick={onResetPickupToGps}
                  className="min-h-[40px] px-2.5 rounded-lg bg-[#F2F5F3] border border-[#1F2A2E] text-xs font-bold text-[#1F2A2E] inline-flex items-center gap-1 shrink-0"
                >
                  <Crosshair className="w-3.5 h-3.5 text-[#2F6FDE]" aria-hidden="true" />
                  <span>{t.studentPickupResetGps}</span>
                </button>
              )}
            </div>
          ) : (
            <PlaceSearchInput
              label={t.studentPickupSearchLabel}
              biasLat={destination?.lat}
              biasLng={destination?.lng}
              onFocusInput={onFocusSearch}
              onSelectPlace={onSelectCustomPickup}
            />
          )}

          {destination && (
            <div className="space-y-2">
              <label className="flex items-center justify-between gap-3 p-2.5 rounded-xl bg-[#F2F5F3] border border-[#D5DDD8]">
                <span className="text-xs font-bold text-[#1F2A2E] inline-flex items-center gap-1.5">
                  <Clock className="w-4 h-4 text-[#0E6B4E]" aria-hidden="true" />
                  <span>{t.studentReachByLabel}</span>
                </span>
                <input
                  type="time"
                  value={arriveByHHmm}
                  onChange={(e) => onArriveByChange(e.target.value)}
                  className="px-2.5 py-1.5 rounded-lg bg-white border border-[#1F2A2E] text-sm font-bold tabular-nums"
                />
              </label>

              <label
                className={`flex items-center justify-between gap-3 p-2.5 rounded-xl border-2 cursor-pointer transition-colors ${
                  hasExam
                    ? 'bg-[#FFC20E]/25 border-[#1F2A2E]'
                    : 'bg-white border-[#D5DDD8]'
                }`}
              >
                <span className="text-xs font-bold text-[#1F2A2E] inline-flex items-center gap-2">
                  {hasExam && (
                    <span className="px-1.5 py-0.5 rounded bg-[#FFC20E] border border-[#1F2A2E] font-sign font-extrabold text-[10px]">
                      {t.crisisStudentExamBadge}
                    </span>
                  )}
                  <span>{t.crisisStudentExamToggle}</span>
                </span>
                <input
                  type="checkbox"
                  checked={hasExam}
                  onChange={(e) => onToggleExam(e.target.checked)}
                  className="w-4 h-4 accent-[#D7352B]"
                />
              </label>
            </div>
          )}

          {/* Sign-in prompt when needed for live rides or actions */}
          {(!firebaseUser || actionError === 'sign_in_required') && destination && (
            <div className="p-3.5 rounded-xl bg-[#FFC20E]/20 border-2 border-[#1F2A2E] space-y-2.5">
              <p className="text-sm font-bold text-[#1F2A2E]">{t.studentSignInToSeeRides}</p>
              {authErrorMessage && (
                <p role="alert" className="text-xs font-medium text-[#D7352B]">
                  {authErrorMessage}
                </p>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <button
                  type="button"
                  disabled={authBusy}
                  onClick={() => {
                    clearAuthError();
                    onClearActionError();
                    void signInWithGoogle();
                  }}
                  className="min-h-[48px] px-3 rounded-xl bg-[#0E6B4E] text-white font-bold text-sm"
                >
                  {t.continueWithGoogle}
                </button>
                <button
                  type="button"
                  disabled={authBusy}
                  onClick={() => {
                    clearAuthError();
                    onClearActionError();
                    void completeOnboarding('guest', 'student');
                  }}
                  className="min-h-[48px] px-3 rounded-xl bg-white border-2 border-[#1F2A2E] text-[#1F2A2E] font-bold text-sm"
                >
                  {t.continueAsGuest}
                </button>
              </div>
            </div>
          )}

          {/* Ride options or honest empty + demandPin */}
          {firebaseUser && destination && pickupPoint && (
            <div className="pt-2 border-t border-[#D5DDD8] space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h2 className="font-sign font-bold text-base text-[#1F2A2E]">{t.liveRidesTitle}</h2>
                {matchResult.options.length > 0 && (
                  <span className="text-xs font-bold text-[#0E6B4E] tabular-nums">
                    {matchResult.options.length}
                  </span>
                )}
              </div>

              {hasExam && matchResult.options[0] && (() => {
                const best = matchResult.options[0];
                const depText = formatClockTime(
                  nowMs + Math.max(0, best.etaToPickupMinutes - 2) * 60_000,
                );
                const speechLang =
                  language === 'kn' ? 'kn-IN' : language === 'hi' ? 'hi-IN' : 'en-IN';
                return (
                  <div className="p-3 rounded-2xl bg-[#FFC20E]/20 border-2 border-[#D7352B] space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="inline-flex items-center gap-1.5 font-sign font-bold text-xs text-[#D7352B]">
                        <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
                        <span>{t.crisisStudentUrgentPlanBTitle}</span>
                      </span>
                      <span className="px-1.5 py-0.5 rounded bg-[#FFC20E] border border-[#1F2A2E] font-sign font-extrabold text-[10px]">
                        {t.crisisStudentExamBadge}
                      </span>
                    </div>
                    <p className="text-xs font-bold text-[#1F2A2E] tabular-nums">
                      {t.crisisStudentDepartByLabel}: {depText} ·{' '}
                      {getVehicleLabel(best.trip.vehicleType, t)} ({best.trip.driverName})
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <button
                        type="button"
                        disabled={busyAction === `ask:${best.trip.id}`}
                        onClick={() => void onAskForSeat(best)}
                        className="min-h-[44px] px-3 rounded-xl bg-[#0E6B4E] hover:bg-[#0A523B] text-white font-sign font-bold text-xs"
                      >
                        {busyAction === `ask:${best.trip.id}`
                          ? t.askingSeatBtn
                          : t.askForSeatBtn}
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
                          if (speakingPlanB) {
                            window.speechSynthesis.cancel();
                            setSpeakingPlanB(false);
                            return;
                          }
                          setSpeakingPlanB(true);
                          const voiceRes = await composeVoicePlanB({
                            language,
                            studentName: displayName || 'Student',
                            destinationName: destination.name,
                            departureTimeText: depText,
                            vehicleLabel: getVehicleLabel(best.trip.vehicleType, t),
                            driverName: best.trip.driverName,
                            etaPickupMin: best.etaToPickupMinutes,
                          });
                          const u = new SpeechSynthesisUtterance(voiceRes.spokenMessage);
                          u.lang = speechLang;
                          u.onend = () => setSpeakingPlanB(false);
                          u.onerror = () => setSpeakingPlanB(false);
                          window.speechSynthesis.cancel();
                          window.speechSynthesis.speak(u);
                        }}
                        className="min-h-[44px] px-3 rounded-xl bg-white border-2 border-[#1F2A2E] text-xs font-bold text-[#1F2A2E] inline-flex items-center justify-center gap-1.5"
                      >
                        {speakingPlanB ? (
                          <Square className="w-3.5 h-3.5 text-[#D7352B]" aria-hidden="true" />
                        ) : (
                          <Volume2 className="w-3.5 h-3.5 text-[#0E6B4E]" aria-hidden="true" />
                        )}
                        <span>
                          {speakingPlanB
                            ? t.crisisStudentVoiceStopBtn
                            : t.crisisStudentVoiceListenBtn}
                        </span>
                      </button>
                    </div>
                  </div>
                );
              })()}

              {loading ? (
                <SkeletonList count={2} />
              ) : matchResult.options.length > 0 ? (
                <div className="space-y-3">
                  {matchResult.options.map((opt) => (
                    <RideOptionCard
                      key={opt.trip.id}
                      option={opt}
                      selected={selectedTripId === opt.trip.id}
                      busy={busyAction === `ask:${opt.trip.id}`}
                      onSelect={() => onSelectTripOption(opt)}
                      onAskSeat={() => void onAskForSeat(opt)}
                    />
                  ))}
                </div>
              ) : (
                <div className="p-3.5 rounded-2xl bg-[#F2F5F3] border-2 border-[#1F2A2E] space-y-3">
                  <div className="space-y-1">
                    <p className="font-sign font-bold text-base text-[#1F2A2E]">
                      {t.studentNoMatchTitle}
                    </p>
                    <p className="text-sm text-[#526066] tabular-nums">{nearbyText}</p>
                  </div>

                  {activeDemandPin ? (
                    <div className="p-3 rounded-xl bg-[#FFC20E]/25 border border-[#1F2A2E] space-y-2">
                      <div className="flex items-center gap-2 text-sm font-bold text-[#1F2A2E]">
                        <Radio className="w-4 h-4 text-[#0E6B4E]" aria-hidden="true" />
                        <span>{t.studentDemandActiveTitle}</span>
                      </div>
                      <p className="text-xs text-[#1F2A2E]">{t.studentDemandActiveBody}</p>
                      {activeDemandPin.offeredByDriverName && (
                        <p className="text-sm font-bold text-[#0E6B4E]">
                          {t.studentDemandOfferedBy} {activeDemandPin.offeredByDriverName}
                        </p>
                      )}
                      <button
                        type="button"
                        disabled={busyAction === `demand:cancel:${activeDemandPin.id}`}
                        onClick={() => void onCancelDemandPin(activeDemandPin)}
                        className="min-h-[44px] px-3 rounded-lg bg-white border border-[#1F2A2E] text-xs font-bold text-[#1F2A2E]"
                      >
                        {t.studentDemandCancelBtn}
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      disabled={busyAction === 'demand:create'}
                      onClick={() => void onCreateDemandPin()}
                      className="w-full min-h-[56px] px-4 rounded-xl bg-[#FFC20E] hover:bg-[#e5ae0b] text-[#1F2A2E] font-sign font-bold text-base border-2 border-[#1F2A2E] transition-colors"
                    >
                      {busyAction === 'demand:create'
                        ? t.studentPostingDemandBtn
                        : t.studentTellDriversBtn}
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {(!destination || !pickupPoint) && (
            <div className="pt-2 border-t border-[#D5DDD8] space-y-2">
              <h2 className="font-sign font-bold text-base text-[#1F2A2E]">{t.liveRidesTitle}</h2>
              <p className="text-sm text-[#526066]">{t.liveRidesEmpty}</p>
            </div>
          )}

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
    </div>
  );
}
