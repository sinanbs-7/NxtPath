import type { Language } from '../types/firestore';

export type DisruptionTriggerKind = 'driver_breakdown' | 'scheduled_late' | 'student_no_show';

export interface ParsedRideRequest {
  destination: string | null;
  arriveBy: string | null;
  language: Language;
  usedFallback: boolean;
}

export interface PlanBAlternativeInput {
  tripId: string;
  vehicleLabel: string;
  driverName: string;
  driverVerified: boolean;
  etaPickupMin: number;
  walkMin: number;
  arrivalTime: string;
  seatsLeft: number;
}

export interface PlanBRequestInput {
  language: Language;
  triggerReason: DisruptionTriggerKind;
  disruptedVehicleLabel: string;
  disruptedDriverName: string;
  destinationName: string;
  nearbyLiveDriversCount: number;
  alternatives: PlanBAlternativeInput[];
}

export interface PlanBResponse {
  headline: string;
  summary: string;
  recommendedTripId: string | null;
  actionPrompt: string;
  usedFallback: boolean;
}

export interface ParentMessageInput {
  language: Language;
  studentName: string;
  destinationName: string;
  vehicleLabel: string;
  driverName: string;
  driverVerified: boolean;
  rideCode?: string;
  stage: string;
  etaMinutes: number | null;
  liveLink: string;
}

export interface ParentMessageResponse {
  message: string;
  usedFallback: boolean;
}

export function detectLanguageFromText(text: string, fallback: Language = 'en'): Language {
  if (/[\u0C80-\u0CFF]/.test(text)) return 'kn';
  if (/[\u0900-\u097F]/.test(text)) return 'hi';
  return fallback;
}

export function normalizeHHmm(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  const m = trimmed.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (!m) return null;
  return `${m[1].padStart(2, '0')}:${m[2]}`;
}

export function extractTimeFromText(text: string): string | null {
  const match = text.match(/\b(\d{1,2})[:.](\d{2})\s*(am|pm|a\.m\.|p\.m\.)?\b/i);
  if (match) {
    let hour = Number(match[1]);
    const minute = Number(match[2]);
    if (minute >= 0 && minute <= 59 && hour >= 0 && hour <= 23) {
      const meridiem = (match[3] || '').toLowerCase();
      if (meridiem.startsWith('p') && hour < 12) hour += 12;
      if (meridiem.startsWith('a') && hour === 12) hour = 0;
      return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    }
  }

  const amPmOnly = text.match(/\b(\d{1,2})\s*(am|pm)\b/i);
  if (amPmOnly) {
    let hour = Number(amPmOnly[1]);
    if (hour >= 1 && hour <= 12) {
      if (amPmOnly[2].toLowerCase() === 'pm' && hour < 12) hour += 12;
      if (amPmOnly[2].toLowerCase() === 'am' && hour === 12) hour = 0;
      return `${String(hour).padStart(2, '0')}:00`;
    }
  }

  return null;
}

export function looksLikeNaturalLanguageRequest(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 6) return false;
  if (extractTimeFromText(trimmed) !== null) return true;
  if (
    /\b(i need|need to|reach|going to|want to|by\s+\d|before\s+\d|drop me|take me|school by|college by)\b/i.test(
      trimmed,
    )
  ) {
    return true;
  }
  if (/(ಹೋಗಬೇಕು|ತಲುಪಬೇಕು|ಬೆಳಿಗ್ಗೆ|ಶಾಲೆಗೆ|ಗಂಟೆಗೆ)/.test(trimmed)) return true;
  if (/(जाना है|पहुँचना|पहुंचना|स्कूल|बजे तक|सुबह)/.test(trimmed)) return true;
  return trimmed.split(/\s+/).length >= 5;
}

export function validateParsedRequest(raw: unknown): ParsedRideRequest | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;

  const lang = obj.language;
  if (lang !== 'en' && lang !== 'kn' && lang !== 'hi') return null;

  let destination: string | null = null;
  if (obj.destination !== null && obj.destination !== undefined) {
    if (typeof obj.destination !== 'string') return null;
    const clean = obj.destination.trim().slice(0, 140);
    destination = clean.length > 0 ? clean : null;
  }

  let arriveBy: string | null = null;
  if (obj.arriveBy !== null && obj.arriveBy !== undefined) {
    if (typeof obj.arriveBy !== 'string') return null;
    const normalized = normalizeHHmm(obj.arriveBy);
    if (!normalized) return null;
    arriveBy = normalized;
  }

  if (!destination && !arriveBy) return null;

  return {
    destination,
    arriveBy,
    language: lang,
    usedFallback: false,
  };
}

export function fallbackParseRequest(text: string, preferredLanguage: Language = 'en'): ParsedRideRequest {
  const trimmed = text.trim();
  const language = detectLanguageFromText(trimmed, preferredLanguage);
  const arriveBy = extractTimeFromText(trimmed);

  let cleaned = trimmed
    // remove time expressions
    .replace(/\b(by|before|at|around|until|till|ಕ್ಕೆ|ಒಳಗೆ|बजे|तक)\b/gi, ' ')
    .replace(/\b\d{1,2}[:.]\d{2}\s*(am|pm|a\.m\.|p\.m\.)?\b/gi, ' ')
    .replace(/\b\d{1,2}\s*(am|pm)\b/gi, ' ')
    // remove common English intent prefixes
    .replace(/\b(i need to reach|i want to go to|need to reach|take me to|going to|reach|get to)\b/gi, ' ')
    // remove common Hindi intent words
    .replace(/(मुझे|सुबह|जाना है|पहुँचना है|पहुंचना है|पहुँचना|पहुंचना|तक)/g, ' ')
    // remove common Kannada intent words
    .replace(/(ನಾನು|ಬೆಳಿಗ್ಗೆ|ಹೋಗಬೇಕು|ತಲುಪಬೇಕು|ಗೆ)/g, ' ')
    .replace(/[.,!?]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (cleaned.length < 2) {
    cleaned = '';
  }

  return {
    destination: cleaned ? cleaned.slice(0, 140) : null,
    arriveBy,
    language,
    usedFallback: true,
  };
}

export function validatePlanBResponse(
  raw: unknown,
  allowedTripIds: string[],
): PlanBResponse | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;

  if (typeof obj.headline !== 'string' || typeof obj.summary !== 'string' || typeof obj.actionPrompt !== 'string') {
    return null;
  }

  const headline = obj.headline.trim();
  const summary = obj.summary.trim();
  const actionPrompt = obj.actionPrompt.trim();

  if (headline.length < 3 || headline.length > 140) return null;
  if (summary.length < 8 || summary.length > 360) return null;
  if (actionPrompt.length < 2 || actionPrompt.length > 120) return null;

  // Reject unfilled template placeholders
  if (/\[[^\]]+\]/.test(headline) || /\[[^\]]+\]/.test(summary)) return null;

  let recommendedTripId: string | null = null;
  if (obj.recommendedTripId !== null && obj.recommendedTripId !== undefined && obj.recommendedTripId !== '') {
    if (typeof obj.recommendedTripId !== 'string') return null;
    if (!allowedTripIds.includes(obj.recommendedTripId)) return null;
    recommendedTripId = obj.recommendedTripId;
  } else if (allowedTripIds.length > 0) {
    recommendedTripId = allowedTripIds[0];
  }

  return {
    headline,
    summary,
    recommendedTripId,
    actionPrompt,
    usedFallback: false,
  };
}

export function fallbackPlanB(input: PlanBRequestInput): PlanBResponse {
  const best = input.alternatives[0] ?? null;

  if (input.language === 'kn') {
    if (best) {
      return {
        headline: `${input.disruptedVehicleLabel} ನಿಂತಿದೆ — ಬದಲಿ ಸವಾರಿ ಸಿದ್ಧವಾಗಿದೆ`,
        summary: `${best.vehicleLabel} (${best.driverName}) ${best.etaPickupMin} ನಿಮಿಷದಲ್ಲಿ ನಿಮ್ಮ ನಿಲ್ದಾಣಕ್ಕೆ ಬರುತ್ತದೆ, ${best.arrivalTime} ಕ್ಕೆ ${input.destinationName} ತಲುಪುತ್ತದೆ. ${best.seatsLeft} ಸೀಟು ಖಾಲಿ ಇದೆ.`,
        recommendedTripId: best.tripId,
        actionPrompt: 'ಈ ಸವಾರಿಗೆ ಬದಲಿಸಿ',
        usedFallback: true,
      };
    }
    return {
      headline: `${input.disruptedVehicleLabel} ಸ್ಥಗಿತಗೊಂಡಿದೆ`,
      summary: `ಈಗ ಹತ್ತಿರದಲ್ಲಿ ${input.nearbyLiveDriversCount} ಲೈವ್ ಚಾಲಕರಿದ್ದಾರೆ. ಹತ್ತಿರದ ಚಾಲಕರಿಗೆ ತಿಳಿಸಲು ಪಿನ್ ಹಾಕಿ.`,
      recommendedTripId: null,
      actionPrompt: 'ಚಾಲಕರಿಗೆ ತಿಳಿಸಿ',
      usedFallback: true,
    };
  }

  if (input.language === 'hi') {
    if (best) {
      return {
        headline: `${input.disruptedVehicleLabel} रुक गई — वैकल्पिक सवारी तैयार है`,
        summary: `${best.vehicleLabel} (${best.driverName}) ${best.etaPickupMin} मिनट में आपके स्टॉप पर पहुँचेगी और ${best.arrivalTime} तक ${input.destinationName} पहुँचाएगी। ${best.seatsLeft} सीट खाली है।`,
        recommendedTripId: best.tripId,
        actionPrompt: 'इस सवारी पर जाएँ',
        usedFallback: true,
      };
    }
    return {
      headline: `${input.disruptedVehicleLabel} बाधित हुई`,
      summary: `अभी पास में ${input.nearbyLiveDriversCount} लाइव वाहन हैं, जो इस रूट पर नहीं हैं। पास के ड्राइवरों को पिन भेजें।`,
      recommendedTripId: null,
      actionPrompt: 'ड्राइवरों को बताएँ',
      usedFallback: true,
    };
  }

  if (best) {
    return {
      headline: `${input.disruptedVehicleLabel} disrupted — Plan B ride ready`,
      summary: `${best.vehicleLabel} with ${best.driverName} reaches your stop in ${best.etaPickupMin} min and gets to ${input.destinationName} by ${best.arrivalTime} (${best.seatsLeft} seats left).`,
      recommendedTripId: best.tripId,
      actionPrompt: 'Switch to backup ride',
      usedFallback: true,
    };
  }

  return {
    headline: `${input.disruptedVehicleLabel} disrupted — no match yet`,
    summary: `There are ${input.nearbyLiveDriversCount} live drivers nearby, none matching ${input.destinationName} right now. Post a waiting pin to alert drivers on the road.`,
    recommendedTripId: null,
    actionPrompt: 'Tell drivers I need a ride',
    usedFallback: true,
  };
}

export function validateParentMessageResponse(
  raw: unknown,
  liveLink: string,
): ParentMessageResponse | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.message !== 'string') return null;
  let message = obj.message.trim();
  if (message.length < 10 || message.length > 550) return null;
  if (/\[[^\]]+\]/.test(message)) return null;
  if (liveLink && !message.includes(liveLink)) {
    message = `${message}\n${liveLink}`;
  }
  return {
    message,
    usedFallback: false,
  };
}

export function fallbackParentMessage(input: ParentMessageInput): ParentMessageResponse {
  const codeText = input.rideCode ? ` (Code: ${input.rideCode})` : '';
  const etaText =
    input.etaMinutes !== null && input.etaMinutes > 0 ? ` (~${input.etaMinutes} min)` : '';

  if (input.language === 'kn') {
    return {
      message: `${input.studentName} ${input.destinationName} ಗೆ ${input.vehicleLabel} (${input.driverName})${codeText} ನಲ್ಲಿ ಪ್ರಯಾಣಿಸುತ್ತಿದ್ದಾರೆ${etaText}. ಲೈವ್ ಟ್ರಿಪ್ ನೋಡಿ: ${input.liveLink}`,
      usedFallback: true,
    };
  }

  if (input.language === 'hi') {
    return {
      message: `${input.studentName} ${input.destinationName} के लिए ${input.vehicleLabel} (${input.driverName})${codeText} से जा रहे हैं${etaText}। लाइव लोकेशन देखें: ${input.liveLink}`,
      usedFallback: true,
    };
  }

  return {
    message: `${input.studentName} is heading to ${input.destinationName} in ${input.vehicleLabel} with ${input.driverName}${codeText}${etaText}. Track live: ${input.liveLink}`,
    usedFallback: true,
  };
}

export function buildParentTrackUrl(
  origin: string,
  params: {
    tripId: string;
    studentName?: string;
    dest?: string;
    pickupLat?: number;
    pickupLng?: number;
    rideCode?: string;
  },
): string {
  const url = new URL(origin);
  url.searchParams.set('track', params.tripId);
  if (params.studentName) url.searchParams.set('student', params.studentName.slice(0, 40));
  if (params.dest) url.searchParams.set('dest', params.dest.slice(0, 80));
  if (typeof params.pickupLat === 'number' && typeof params.pickupLng === 'number') {
    url.searchParams.set('plat', params.pickupLat.toFixed(5));
    url.searchParams.set('plng', params.pickupLng.toFixed(5));
  }
  if (params.rideCode) url.searchParams.set('code', params.rideCode);
  return url.toString();
}

export function buildWhatsAppShareUrl(message: string): string {
  return `https://wa.me/?text=${encodeURIComponent(message)}`;
}

// === Exam Day Crisis Gemini Contracts ===

export interface AdminBriefingInput {
  language: Language;
  kpis: {
    totalStudents: number;
    examStudents: number;
    onTime: number;
    atRisk: number;
    cannotReach: number;
    vehiclesReallocated: number;
  };
  fcfsOnTime: number;
  blockedZoneLabels: string[];
  topProposals: Array<{ driverName: string; clusterPlace: string; studentCount: number; detourMinutes: number }>;
}

export interface AdminBriefingResponse {
  headline: string;
  actions: [string, string, string];
  usedFallback: boolean;
}

export interface CannotReachMessageInput {
  language: Language;
  studentName: string;
  destinationName: string;
  examTimeText?: string;
  reason: 'no_seat' | 'road_blocked' | 'no_vehicle_in_range';
  detail: string;
}

export interface CannotReachMessageResponse {
  message: string;
  usedFallback: boolean;
}

export interface VoicePlanBInput {
  language: Language;
  studentName: string;
  destinationName: string;
  departureTimeText: string;
  vehicleLabel: string;
  driverName: string;
  etaPickupMin: number;
}

export interface VoicePlanBResponse {
  spokenMessage: string;
  usedFallback: boolean;
}

export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function validateAdminBriefingResponse(raw: unknown): AdminBriefingResponse | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.headline !== 'string' || !Array.isArray(obj.actions)) return null;

  const headline = obj.headline.trim();
  const actions = obj.actions
    .filter((a): a is string => typeof a === 'string')
    .map((a) => a.trim())
    .filter(Boolean);

  if (headline.length < 4 || actions.length !== 3) return null;
  if (/\[[^\]]+\]/.test(headline) || actions.some((a) => /\[[^\]]+\]/.test(a))) return null;

  const totalWords = countWords(`${headline} ${actions.join(' ')}`);
  if (totalWords > 60) return null;

  return {
    headline,
    actions: [actions[0], actions[1], actions[2]],
    usedFallback: false,
  };
}

export function fallbackAdminBriefing(input: AdminBriefingInput): AdminBriefingResponse {
  const top = input.topProposals[0];
  const zoneText = input.blockedZoneLabels[0] ? ` (${input.blockedZoneLabels[0]})` : '';

  if (input.language === 'kn') {
    const headline = `${input.kpis.onTime}/${input.kpis.totalStudents} ವಿದ್ಯಾರ್ಥಿಗಳು ಸಮಯಕ್ಕೆ ತಲುಪುತ್ತಾರೆ (${input.kpis.cannotReach} ಬಾಕಿ).`;
    const a1 = top
      ? `${top.driverName} ರವರನ್ನು ${top.clusterPlace} ಕಡೆಗೆ ಕಳುಹಿಸಿ (${top.studentCount} ವಿದ್ಯಾರ್ಥಿಗಳು).`
      : 'ಲಭ್ಯವಿರುವ ವಾಹನಗಳಿಗೆ ತುರ್ತು ಆದೇಶ ಕಳುಹಿಸಿ.';
    const a2 = `ತಡೆದ ರಸ್ತೆ${zoneText} ದೂರವಿಟ್ಟು ಬದಲಿ ಮಾರ್ಗ ಬಳಸಿ.`;
    const a3 = `${input.kpis.cannotReach} ವಿದ್ಯಾರ್ಥಿಗಳ ಪೋಷಕರಿಗೆ ಮತ್ತು ಶಾಲೆಗೆ ತಕ್ಷಣ ಸಂದೇಶ ಕಳುಹಿಸಿ.`;
    return { headline, actions: [a1, a2, a3], usedFallback: true };
  }

  if (input.language === 'hi') {
    const headline = `${input.kpis.onTime}/${input.kpis.totalStudents} छात्र समय पर पहुँचेंगे (${input.kpis.cannotReach} शेष).`;
    const a1 = top
      ? `${top.driverName} को ${top.clusterPlace} भेजें (${top.studentCount} छात्र).`
      : 'उपलब्ध वाहनों को तुरंत रवाना करें.';
    const a2 = `बंद सड़क${zoneText} से बचकर वैकल्पिक रास्ता चुनें.`;
    const a3 = `${input.kpis.cannotReach} छात्रों के स्कूल और माता-पिता को सूचना भेजें.`;
    return { headline, actions: [a1, a2, a3], usedFallback: true };
  }

  const headline = `${input.kpis.onTime} of ${input.kpis.totalStudents} students on time (FCFS: ${input.fcfsOnTime}); ${input.kpis.atRisk} at risk.`;
  const a1 = top
    ? `Approve ${top.driverName} to ${top.clusterPlace} for ${top.studentCount} exam students.`
    : 'Keep Tier 1 exam pickups first on active vehicles.';
  const a2 = zoneText
    ? `Reroute active trips around blocked zone${zoneText}.`
    : 'Monitor live GPS gaps and hold spare van seats for Tier 1.';
  const a3 =
    input.kpis.cannotReach > 0
      ? `Alert school & parents for ${input.kpis.cannotReach} unreachable students.`
      : 'Confirm all exam arrivals with school gates.';

  return {
    headline,
    actions: [a1, a2, a3],
    usedFallback: true,
  };
}

export function validateCannotReachMessageResponse(raw: unknown): CannotReachMessageResponse | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.message !== 'string') return null;
  const message = obj.message.trim();
  if (message.length < 15 || message.length > 420) return null;
  if (/\[[^\]]+\]/.test(message)) return null;
  return { message, usedFallback: false };
}

export function fallbackCannotReachMessage(
  input: CannotReachMessageInput,
): CannotReachMessageResponse {
  const reasonPhraseEn =
    input.reason === 'road_blocked'
      ? 'flooded/blocked road'
      : input.reason === 'no_seat'
        ? 'full vehicles on the route'
        : 'no vehicles in range';
  const examPartEn = input.examTimeText ? ` (exam at ${input.examTimeText})` : '';

  if (input.language === 'kn') {
    const reasonKn =
      input.reason === 'road_blocked'
        ? 'ರಸ್ತೆ ಮುಚ್ಚಿರುವುದರಿಂದ'
        : input.reason === 'no_seat'
          ? 'ವಾಹನಗಳಲ್ಲಿ ಸೀಟು ಖಾಲಿ ಇಲ್ಲದಿರುವುದರಿಂದ'
          : 'ಹತ್ತಿರದಲ್ಲಿ ವಾಹನ ಲಭ್ಯವಿಲ್ಲದಿರುವುದರಿಂದ';
    return {
      message: `${input.studentName} ಅವರಿಗೆ ${reasonKn} ${input.destinationName} ಗೆ ಸಮಯಕ್ಕೆ ತಲುಪಲು ಸಾಧ್ಯವಾಗುತ್ತಿಲ್ಲ. ದಯವಿಟ್ಟು ಪರೀಕ್ಷೆಗೆ ತಡವಾಗಿ ಪ್ರವೇಶ ಅಥವಾ ಸ್ಥಳೀಯ ಪರ್ಯಾಯ ವಾಹನಕ್ಕೆ ಸಹಕರಿಸಿ.`,
      usedFallback: true,
    };
  }

  if (input.language === 'hi') {
    const reasonHi =
      input.reason === 'road_blocked'
        ? 'सड़क बंद होने के कारण'
        : input.reason === 'no_seat'
          ? 'वाहनों में सीट न होने के कारण'
          : 'आस-पास वाहन न मिलने के कारण';
    return {
      message: `${input.studentName} ${reasonHi} समय पर ${input.destinationName} नहीं पहुँच पा रहे हैं। कृपया परीक्षा में देर से प्रवेश या स्थानीय वैकल्पिक व्यवस्था में सहायता करें।`,
      usedFallback: true,
    };
  }

  return {
    message: `Urgent notice for ${input.studentName}: Unable to reach ${input.destinationName}${examPartEn} on time due to ${reasonPhraseEn}. Please allow late exam entry or arrange alternate local transport.`,
    usedFallback: true,
  };
}

export function validateVoicePlanBResponse(raw: unknown): VoicePlanBResponse | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.spokenMessage !== 'string') return null;
  const spokenMessage = obj.spokenMessage.trim();
  if (spokenMessage.length < 10 || spokenMessage.length > 260) return null;
  if (/\[[^\]]+\]|https?:\/\//i.test(spokenMessage)) return null;
  return { spokenMessage, usedFallback: false };
}

export function fallbackVoicePlanB(input: VoicePlanBInput): VoicePlanBResponse {
  if (input.language === 'kn') {
    return {
      spokenMessage: `${input.studentName}, ನಿಮ್ಮ ಪರೀಕ್ಷಾ ಬದಲಿ ಸವಾರಿ: ${input.vehicleLabel} (${input.driverName}) ${input.departureTimeText} ಕ್ಕೆ ಹೊರಡುತ್ತದೆ. ಸುಮಾರು ${input.etaPickupMin} ನಿಮಿಷದಲ್ಲಿ ನಿಲ್ದಾಣಕ್ಕೆ ಬರುತ್ತದೆ.`,
      usedFallback: true,
    };
  }
  if (input.language === 'hi') {
    return {
      spokenMessage: `${input.studentName}, आपकी परीक्षा के लिए प्लान बी: ${input.vehicleLabel} (${input.driverName}) ${input.departureTimeText} पर निकलेगी और लगभग ${input.etaPickupMin} मिनट में स्टॉप पर पहुँचेगी।`,
      usedFallback: true,
    };
  }
  return {
    spokenMessage: `${input.studentName}, urgent Plan B for ${input.destinationName}: leave your stop by ${input.departureTimeText} on ${input.vehicleLabel} with ${input.driverName}, arriving in ${input.etaPickupMin} minutes.`,
    usedFallback: true,
  };
}
