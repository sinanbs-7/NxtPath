import { haversineDistanceMeters } from '../trips/tripLogic';
import type {
  LatLngPoint,
  LivePosition,
  SeatRequest,
  Trip,
  TripReport,
} from '../types/firestore';
import type { DisruptionTriggerKind } from '../ai/geminiSchemas';
import {
  isLivePositionFresh,
  matchAndRankRides,
  timestampToMillis,
  type MatchRidesResult,
} from './matchRides';

export const SCHEDULED_LATE_THRESHOLD_MS = 10 * 60_000;
export const NO_SHOW_THRESHOLD_REPORTS = 2;
export const NO_SHOW_RADIUS_METERS = 500;
export const NO_SHOW_WINDOW_MS = 60 * 60_000;

export interface DisruptionEvaluation {
  disrupted: boolean;
  trigger: DisruptionTriggerKind | null;
  lateMinutes: number | null;
  noShowReportCount: number;
}

export function evaluateTripDisruption(params: {
  trip: Trip | null;
  livePos: LivePosition | null | undefined;
  reports: TripReport[];
  stopPoint: LatLngPoint | null;
  nowMs?: number;
}): DisruptionEvaluation {
  const nowMs = params.nowMs ?? Date.now();
  const { trip, livePos, reports, stopPoint } = params;

  if (!trip) {
    return {
      disrupted: false,
      trigger: null,
      lateMinutes: null,
      noShowReportCount: 0,
    };
  }

  // Trigger 3 count: distinct students reporting "bus_no_show" near this stop in the last hour
  const distinctReporters = new Set<string>();
  for (const r of reports) {
    if (r.tripId !== trip.id || r.reason !== 'bus_no_show') continue;
    const createdMs = timestampToMillis(r.createdAt);
    if (createdMs !== null && nowMs - createdMs > NO_SHOW_WINDOW_MS) continue;
    if (stopPoint) {
      const dist = haversineDistanceMeters(stopPoint, { lat: r.stopLat, lng: r.stopLng });
      if (dist > NO_SHOW_RADIUS_METERS) continue;
    }
    distinctReporters.add(r.reporterId);
  }
  const noShowReportCount = distinctReporters.size;

  // Trigger 1: Driver tapped "Can't continue"
  if (trip.status === 'disrupted') {
    return {
      disrupted: true,
      trigger: 'driver_breakdown',
      lateMinutes: null,
      noShowReportCount,
    };
  }

  // Trigger 2: Scheduled vehicle is > 10 min past departureTime with no fresh live GPS ping
  if (trip.status === 'scheduled') {
    const depMs = timestampToMillis(trip.departureTime);
    if (depMs !== null) {
      const lateMs = nowMs - depMs;
      if (lateMs > SCHEDULED_LATE_THRESHOLD_MS && !isLivePositionFresh(livePos, nowMs)) {
        return {
          disrupted: true,
          trigger: 'scheduled_late',
          lateMinutes: Math.max(11, Math.round(lateMs / 60_000)),
          noShowReportCount,
        };
      }
    }
  }

  // Trigger 3: 2+ students at the stop tapped "Bus didn't come"
  if (noShowReportCount >= NO_SHOW_THRESHOLD_REPORTS) {
    return {
      disrupted: true,
      trigger: 'student_no_show',
      lateMinutes: null,
      noShowReportCount,
    };
  }

  return {
    disrupted: false,
    trigger: null,
    lateMinutes: null,
    noShowReportCount,
  };
}

export function findPlanBAlternatives(params: {
  disruptedTripId: string;
  trips: Trip[];
  livePositionsByTripId: Record<string, LivePosition | undefined>;
  reports: TripReport[];
  pickup: LatLngPoint | null;
  destination: LatLngPoint | null;
  arriveByHHmm?: string;
  nowMs?: number;
}): MatchRidesResult {
  const nowMs = params.nowMs ?? Date.now();
  const healthyTrips = params.trips.filter((t) => {
    if (t.id === params.disruptedTripId) return false;
    const ev = evaluateTripDisruption({
      trip: t,
      livePos: params.livePositionsByTripId[t.id],
      reports: params.reports,
      stopPoint: params.pickup,
      nowMs,
    });
    return !ev.disrupted;
  });

  return matchAndRankRides({
    trips: healthyTrips,
    livePositionsByTripId: params.livePositionsByTripId,
    pickup: params.pickup,
    destination: params.destination,
    arriveByHHmm: params.arriveByHHmm,
    nowMs,
  });
}

export function isRequestEligibleForNoShowReport(req: SeatRequest | null, trip: Trip | null): boolean {
  if (!req || !trip) return false;
  if (req.status === 'declined' || req.status === 'completed') return false;
  if (trip.status === 'completed' || trip.status === 'disrupted') return false;
  return true;
}
