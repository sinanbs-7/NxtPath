import {
  fallbackAdminBriefing,
  fallbackCannotReachMessage,
  fallbackParseRequest,
  fallbackParentMessage,
  fallbackPlanB,
  fallbackVoicePlanB,
  validateAdminBriefingResponse,
  validateCannotReachMessageResponse,
  validateParsedRequest,
  validateParentMessageResponse,
  validatePlanBResponse,
  validateVoicePlanBResponse,
  type AdminBriefingInput,
  type AdminBriefingResponse,
  type CannotReachMessageInput,
  type CannotReachMessageResponse,
  type ParentMessageInput,
  type ParentMessageResponse,
  type ParsedRideRequest,
  type PlanBRequestInput,
  type PlanBResponse,
  type VoicePlanBInput,
  type VoicePlanBResponse,
} from './geminiSchemas';
import type { Language } from '../types/firestore';

async function postJsonWithTimeout(url: string, body: unknown, timeoutMs = 7000): Promise<unknown> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    return await res.json();
  } finally {
    window.clearTimeout(timer);
  }
}

export async function parseRideRequest(
  text: string,
  preferredLanguage: Language,
): Promise<ParsedRideRequest> {
  try {
    const raw = await postJsonWithTimeout('/api/gemini/parse-request', {
      text,
      preferredLanguage,
    });
    const validated = validateParsedRequest(raw);
    if (validated) {
      return {
        ...validated,
        usedFallback: Boolean((raw as { usedFallback?: boolean })?.usedFallback),
      };
    }
  } catch {
    // Offline or server error -> deterministic local parser
  }
  return fallbackParseRequest(text, preferredLanguage);
}

export async function explainPlanB(input: PlanBRequestInput): Promise<PlanBResponse> {
  const allowedTripIds = input.alternatives.map((a) => a.tripId);
  try {
    const raw = await postJsonWithTimeout('/api/gemini/plan-b', input);
    const validated = validatePlanBResponse(raw, allowedTripIds);
    if (validated) {
      return {
        ...validated,
        usedFallback: Boolean((raw as { usedFallback?: boolean })?.usedFallback),
      };
    }
  } catch {
    // Offline or server error -> deterministic local template
  }
  return fallbackPlanB(input);
}

export async function composeParentMessage(
  input: ParentMessageInput,
): Promise<ParentMessageResponse> {
  try {
    const raw = await postJsonWithTimeout('/api/gemini/parent-message', input);
    const validated = validateParentMessageResponse(raw, input.liveLink);
    if (validated) {
      return {
        ...validated,
        usedFallback: Boolean((raw as { usedFallback?: boolean })?.usedFallback),
      };
    }
  } catch {
    // Offline or server error -> deterministic local template
  }
  return fallbackParentMessage(input);
}

export async function fetchCrisisBriefing(
  input: AdminBriefingInput,
): Promise<AdminBriefingResponse> {
  try {
    const raw = await postJsonWithTimeout('/api/gemini/crisis-briefing', input);
    const validated = validateAdminBriefingResponse(raw);
    if (validated) {
      return {
        ...validated,
        usedFallback: Boolean((raw as { usedFallback?: boolean })?.usedFallback),
      };
    }
  } catch {
    // Fallback cleanly
  }
  return fallbackAdminBriefing(input);
}

export async function composeCannotReachMessage(
  input: CannotReachMessageInput,
): Promise<CannotReachMessageResponse> {
  try {
    const raw = await postJsonWithTimeout('/api/gemini/cannot-reach-message', input);
    const validated = validateCannotReachMessageResponse(raw);
    if (validated) {
      return {
        ...validated,
        usedFallback: Boolean((raw as { usedFallback?: boolean })?.usedFallback),
      };
    }
  } catch {
    // Fallback cleanly
  }
  return fallbackCannotReachMessage(input);
}

export async function composeVoicePlanB(
  input: VoicePlanBInput,
): Promise<VoicePlanBResponse> {
  try {
    const raw = await postJsonWithTimeout('/api/gemini/voice-plan-b', input);
    const validated = validateVoicePlanBResponse(raw);
    if (validated) {
      return {
        ...validated,
        usedFallback: Boolean((raw as { usedFallback?: boolean })?.usedFallback),
      };
    }
  } catch {
    // Fallback cleanly
  }
  return fallbackVoicePlanB(input);
}
