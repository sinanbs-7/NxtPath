import { haversineDistanceMeters } from '../trips/tripLogic';
import type {
  LatLngPoint,
  LivePosition,
  SeatRequest,
  Trip,
} from '../types/firestore';

export const LIVE_POSITION_STALE_MS = 90_000;
export const MAX_PICKUP_WALK_METERS = 1200;
export const MAX_DROPOFF_METERS = 1500;
export const WALK_SPEED_METERS_PER_MIN = 75;
export const NEARBY_DRIVER_RADIUS_METERS = 25_000;

export type RankingReasonCode =
  | 'live_online'
  | 'scheduled_upcoming'
  | 'vehicle_offline'
  | 'closest_stop'
  | 'soonest_pickup'
  | 'before_bell'
  | 'after_bell'
  | 'verified_driver'
  | 'extra_seats';

export interface RankingReason {
  code: RankingReasonCode;
  minutes?: number;
  meters?: number;
  seats?: number;
}

export interface RouteProjection {
  distanceMeters: number;
  snappedPoint: LatLngPoint;
  progress: number; // continuous vertex index [0 .. N-1]
  timeSeconds: number;
}

export interface MatchedRideOption {
  trip: Trip;
  livePosition: LivePosition | null;
  rank: number;
  score: number;
  isVehicleLive: boolean;
  isVehicleOffline: boolean;
  pickupPoint: LatLngPoint;
  dropoffPoint: LatLngPoint;
  walkDistanceMeters: number;
  walkMinutes: number;
  dropoffDistanceMeters: number;
  etaToPickupSeconds: number;
  etaToPickupMinutes: number;
  rideSeconds: number;
  rideMinutes: number;
  arrivalEpochMs: number;
  minutesBeforeBell: number | null;
  rankingReasons: RankingReason[];
}

export interface MatchRidesInput {
  trips: Trip[];
  livePositionsByTripId: Record<string, LivePosition | undefined>;
  pickup: LatLngPoint | null;
  destination: LatLngPoint | null;
  arriveByHHmm?: string;
  nowMs?: number;
}

export interface MatchRidesResult {
  options: MatchedRideOption[];
  nearbyLiveDriversCount: number;
}

export type TicketStage =
  | 'waiting'
  | 'accepted'
  | 'arriving'
  | 'on_the_way'
  | 'reached_school'
  | 'declined'
  | 'disrupted';

export interface TicketProgressInfo {
  stage: TicketStage;
  countdownSeconds: number | null;
  countdownMinutes: number | null;
  isVehicleOffline: boolean;
}

export function timestampToMillis(ts: unknown): number | null {
  if (!ts || typeof ts !== 'object') return null;
  const maybe = ts as { toMillis?: () => number; seconds?: number };
  if (typeof maybe.toMillis === 'function') return maybe.toMillis();
  if (typeof maybe.seconds === 'number') return maybe.seconds * 1000;
  return null;
}

export function isLivePositionFresh(
  livePos: LivePosition | null | undefined,
  nowMs: number,
  maxAgeMs = LIVE_POSITION_STALE_MS,
): boolean {
  if (!livePos) return false;
  const updatedMs = timestampToMillis(livePos.updatedAt);
  if (updatedMs === null) return false;
  return nowMs - updatedMs <= maxAgeMs;
}

export function parseArriveByEpochMs(hhmm: string | undefined, nowMs: number): number | null {
  if (!hhmm || !hhmm.trim()) return null;
  const parts = hhmm.trim().split(':');
  if (parts.length !== 2) return null;
  const h = Number(parts[0]);
  const m = Number(parts[1]);
  if (!Number.isInteger(h) || !Number.isInteger(m) || h < 0 || h > 23 || m < 0 || m > 59) {
    return null;
  }
  const d = new Date(nowMs);
  d.setHours(h, m, 0, 0);
  return d.getTime();
}

export function formatClockTime(epochMs: number): string {
  const d = new Date(epochMs);
  const hours = d.getHours();
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const suffix = hours >= 12 ? 'PM' : 'AM';
  const h12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${h12}:${minutes} ${suffix}`;
}

export function projectPointToRoute(
  point: LatLngPoint,
  routeGeometry: LatLngPoint[],
  cumulativeDurations: number[],
): RouteProjection | null {
  if (routeGeometry.length < 2 || cumulativeDurations.length !== routeGeometry.length) {
    return null;
  }

  const refLatRad = (point.lat * Math.PI) / 180;
  const metersPerDegLat = 111_320;
  const metersPerDegLng = Math.max(1000, 111_320 * Math.cos(refLatRad));

  const toXY = (pt: LatLngPoint): [number, number] => [
    (pt.lng - point.lng) * metersPerDegLng,
    (pt.lat - point.lat) * metersPerDegLat,
  ];

  let bestDistSq = Infinity;
  let bestT = 0;
  let bestIdx = 0;
  let bestSnapped: LatLngPoint = routeGeometry[0];

  for (let i = 0; i < routeGeometry.length - 1; i += 1) {
    const a = routeGeometry[i];
    const b = routeGeometry[i + 1];
    const [ax, ay] = toXY(a);
    const [bx, by] = toXY(b);
    const abx = bx - ax;
    const aby = by - ay;
    const abLenSq = abx * abx + aby * aby;

    let t = 0;
    if (abLenSq > 1e-6) {
      t = Math.max(0, Math.min(1, (-ax * abx - ay * aby) / abLenSq));
    }

    const px = ax + t * abx;
    const py = ay + t * aby;
    const distSq = px * px + py * py;

    if (distSq < bestDistSq) {
      bestDistSq = distSq;
      bestT = t;
      bestIdx = i;
      bestSnapped = {
        lat: a.lat + t * (b.lat - a.lat),
        lng: a.lng + t * (b.lng - a.lng),
      };
    }
  }

  const d0 = cumulativeDurations[bestIdx] ?? 0;
  const d1 = cumulativeDurations[bestIdx + 1] ?? d0;
  const timeSeconds = d0 + bestT * (d1 - d0);

  return {
    distanceMeters: haversineDistanceMeters(point, bestSnapped),
    snappedPoint: bestSnapped,
    progress: bestIdx + bestT,
    timeSeconds,
  };
}

export function matchAndRankRides(input: MatchRidesInput): MatchRidesResult {
  const nowMs = input.nowMs ?? Date.now();
  const arriveByMs = parseArriveByEpochMs(input.arriveByHHmm, nowMs);

  let nearbyLiveDriversCount = 0;
  const candidates: MatchedRideOption[] = [];

  for (const trip of input.trips) {
    if (trip.status !== 'live' && trip.status !== 'scheduled') continue;

    const livePos = input.livePositionsByTripId[trip.id] ?? null;
    const freshLive = trip.status === 'live' && isLivePositionFresh(livePos, nowMs);

    if (trip.status === 'live' && input.pickup) {
      const refPoint = livePos
        ? { lat: livePos.lat, lng: livePos.lng }
        : { lat: trip.originLat, lng: trip.originLng };
      if (haversineDistanceMeters(input.pickup, refPoint) <= NEARBY_DRIVER_RADIUS_METERS) {
        nearbyLiveDriversCount += 1;
      }
    }

    if (!input.pickup || !input.destination || trip.seatsFree <= 0) {
      continue;
    }

    const pickupProj = projectPointToRoute(
      input.pickup,
      trip.routeGeometry,
      trip.cumulativeDurations,
    );
    const destProj = projectPointToRoute(
      input.destination,
      trip.routeGeometry,
      trip.cumulativeDurations,
    );

    if (!pickupProj || !destProj) continue;
    if (pickupProj.distanceMeters > MAX_PICKUP_WALK_METERS) continue;
    if (destProj.distanceMeters > MAX_DROPOFF_METERS) continue;

    // Must travel toward school: pickup comes strictly before destination along the route
    if (pickupProj.progress >= destProj.progress - 0.01) continue;
    if (destProj.timeSeconds <= pickupProj.timeSeconds) continue;

    let etaToPickupSeconds = 0;
    let isVehicleOffline = false;

    if (trip.status === 'live') {
      if (livePos) {
        isVehicleOffline = !freshLive;
        const vehicleProj = projectPointToRoute(
          { lat: livePos.lat, lng: livePos.lng },
          trip.routeGeometry,
          trip.cumulativeDurations,
        );
        if (vehicleProj) {
          // Skip vehicles that have clearly driven past the student's boarding stop
          const distPastStopMeters =
            vehicleProj.progress > pickupProj.progress
              ? haversineDistanceMeters(vehicleProj.snappedPoint, pickupProj.snappedPoint)
              : 0;
          if (vehicleProj.progress > pickupProj.progress + 0.05 && distPastStopMeters > 150) {
            continue;
          }
          etaToPickupSeconds = Math.max(0, Math.round(pickupProj.timeSeconds - vehicleProj.timeSeconds));
        } else {
          etaToPickupSeconds = Math.max(0, Math.round(pickupProj.timeSeconds));
        }
      } else {
        const createdMs = timestampToMillis(trip.createdAt) ?? nowMs;
        isVehicleOffline = nowMs - createdMs > LIVE_POSITION_STALE_MS;
        etaToPickupSeconds = Math.max(0, Math.round(pickupProj.timeSeconds));
      }
    } else {
      const depMs = Math.max(nowMs, timestampToMillis(trip.departureTime) ?? nowMs);
      etaToPickupSeconds = Math.max(
        0,
        Math.round((depMs - nowMs) / 1000 + pickupProj.timeSeconds),
      );
    }

    const walkDistanceMeters = Math.round(pickupProj.distanceMeters);
    const walkMinutes =
      walkDistanceMeters < 40 ? 0 : Math.max(1, Math.round(walkDistanceMeters / WALK_SPEED_METERS_PER_MIN));
    const etaToPickupMinutes = Math.max(0, Math.round(etaToPickupSeconds / 60));
    const rideSeconds = Math.max(60, Math.round(destProj.timeSeconds - pickupProj.timeSeconds));
    const rideMinutes = Math.max(1, Math.round(rideSeconds / 60));
    const arrivalEpochMs = nowMs + (etaToPickupSeconds + rideSeconds) * 1000;

    let minutesBeforeBell: number | null = null;
    if (arriveByMs !== null) {
      minutesBeforeBell = Math.round((arriveByMs - arrivalEpochMs) / 60_000);
      // Exclude vehicles arriving more than 30 min past the target bell
      if (minutesBeforeBell < -30) continue;
    }

    // Score calculation: lower total cost is better, converted into 0-100+ rank score
    let score = 100;
    if (trip.status === 'live' && !isVehicleOffline) {
      score += 20;
    } else if (trip.status === 'scheduled') {
      score += 5;
    } else {
      score -= 35;
    }

    if (minutesBeforeBell !== null) {
      if (minutesBeforeBell >= 0) {
        // On-time bonus; gently prefer ~10-25 min margin rather than 3 hours early
        score += 25 - Math.min(10, Math.max(0, minutesBeforeBell - 30) * 0.1);
      } else {
        score -= 40 + Math.abs(minutesBeforeBell) * 2;
      }
    }

    score -= (walkDistanceMeters / MAX_PICKUP_WALK_METERS) * 22;
    score -= Math.min(30, etaToPickupMinutes * 0.7);
    score += trip.driverVerified ? 10 : 0;
    score += Math.min(4, trip.seatsFree);

    const rankingReasons: RankingReason[] = [];
    if (trip.status === 'live' && !isVehicleOffline) {
      rankingReasons.push({ code: 'live_online' });
    } else if (trip.status === 'live' && isVehicleOffline) {
      rankingReasons.push({ code: 'vehicle_offline' });
    } else {
      rankingReasons.push({ code: 'scheduled_upcoming' });
    }

    if (minutesBeforeBell !== null) {
      if (minutesBeforeBell >= 0) {
        rankingReasons.push({ code: 'before_bell', minutes: minutesBeforeBell });
      } else {
        rankingReasons.push({ code: 'after_bell', minutes: Math.abs(minutesBeforeBell) });
      }
    }

    rankingReasons.push({
      code: 'closest_stop',
      meters: walkDistanceMeters,
      minutes: walkMinutes,
    });

    rankingReasons.push({
      code: 'soonest_pickup',
      minutes: etaToPickupMinutes,
    });

    if (trip.driverVerified) {
      rankingReasons.push({ code: 'verified_driver' });
    } else if (trip.seatsFree >= 3) {
      rankingReasons.push({ code: 'extra_seats', seats: trip.seatsFree });
    }

    candidates.push({
      trip,
      livePosition: livePos,
      rank: 0,
      score: Number(score.toFixed(2)),
      isVehicleLive: trip.status === 'live',
      isVehicleOffline,
      pickupPoint: pickupProj.snappedPoint,
      dropoffPoint: destProj.snappedPoint,
      walkDistanceMeters,
      walkMinutes,
      dropoffDistanceMeters: Math.round(destProj.distanceMeters),
      etaToPickupSeconds,
      etaToPickupMinutes,
      rideSeconds,
      rideMinutes,
      arrivalEpochMs,
      minutesBeforeBell,
      rankingReasons,
    });
  }

  candidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.etaToPickupSeconds !== b.etaToPickupSeconds) {
      return a.etaToPickupSeconds - b.etaToPickupSeconds;
    }
    return a.walkDistanceMeters - b.walkDistanceMeters;
  });

  candidates.forEach((opt, idx) => {
    opt.rank = idx + 1;
  });

  return {
    options: candidates,
    nearbyLiveDriversCount,
  };
}

export function computeTicketProgress(
  req: SeatRequest,
  trip: Trip | null,
  livePos: LivePosition | null,
  nowMs: number = Date.now(),
): TicketProgressInfo {
  if (req.status === 'declined') {
    return {
      stage: 'declined',
      countdownSeconds: null,
      countdownMinutes: null,
      isVehicleOffline: false,
    };
  }

  if (req.status === 'completed' || trip?.status === 'completed') {
    return {
      stage: 'reached_school',
      countdownSeconds: 0,
      countdownMinutes: 0,
      isVehicleOffline: false,
    };
  }

  if (trip?.status === 'disrupted') {
    return {
      stage: 'disrupted',
      countdownSeconds: null,
      countdownMinutes: null,
      isVehicleOffline: false,
    };
  }

  if (req.status === 'pending') {
    return {
      stage: 'waiting',
      countdownSeconds: null,
      countdownMinutes: null,
      isVehicleOffline: false,
    };
  }

  // Accepted request: track live position against pickup stop and destination
  if (!trip) {
    return {
      stage: 'accepted',
      countdownSeconds: null,
      countdownMinutes: null,
      isVehicleOffline: false,
    };
  }

  const isOffline =
    trip.status === 'live' &&
    (livePos
      ? !isLivePositionFresh(livePos, nowMs)
      : nowMs - (timestampToMillis(trip.createdAt) ?? nowMs) > LIVE_POSITION_STALE_MS);

  const pickupProj = projectPointToRoute(
    { lat: req.pickupLat, lng: req.pickupLng },
    trip.routeGeometry,
    trip.cumulativeDurations,
  );
  const destProj = projectPointToRoute(
    { lat: trip.destinationLat, lng: trip.destinationLng },
    trip.routeGeometry,
    trip.cumulativeDurations,
  );

  if (trip.status === 'scheduled') {
    const depMs = Math.max(nowMs, timestampToMillis(trip.departureTime) ?? nowMs);
    const secToPickup = Math.max(
      0,
      Math.round((depMs - nowMs) / 1000 + (pickupProj?.timeSeconds ?? 0)),
    );
    return {
      stage: 'accepted',
      countdownSeconds: secToPickup,
      countdownMinutes: Math.max(0, Math.round(secToPickup / 60)),
      isVehicleOffline: false,
    };
  }

  if (!livePos || !pickupProj) {
    return {
      stage: 'arriving',
      countdownSeconds: pickupProj ? Math.round(pickupProj.timeSeconds) : null,
      countdownMinutes: pickupProj ? Math.max(0, Math.round(pickupProj.timeSeconds / 60)) : null,
      isVehicleOffline: isOffline,
    };
  }

  const vehicleProj = projectPointToRoute(
    { lat: livePos.lat, lng: livePos.lng },
    trip.routeGeometry,
    trip.cumulativeDurations,
  );

  if (!vehicleProj) {
    return {
      stage: 'arriving',
      countdownSeconds: null,
      countdownMinutes: null,
      isVehicleOffline: isOffline,
    };
  }

  const distToDest = haversineDistanceMeters(
    { lat: livePos.lat, lng: livePos.lng },
    { lat: trip.destinationLat, lng: trip.destinationLng },
  );

  if (vehicleProj.progress > pickupProj.progress + 0.08 && distToDest <= 150) {
    return {
      stage: 'reached_school',
      countdownSeconds: 0,
      countdownMinutes: 0,
      isVehicleOffline: isOffline,
    };
  }

  const distFromPickup = haversineDistanceMeters(
    { lat: livePos.lat, lng: livePos.lng },
    pickupProj.snappedPoint,
  );

  if (vehicleProj.progress > pickupProj.progress + 0.08 && distFromPickup > 120) {
    const destTime = destProj?.timeSeconds ?? trip.durationSeconds;
    const secRemaining = Math.max(0, Math.round(destTime - vehicleProj.timeSeconds));
    return {
      stage: 'on_the_way',
      countdownSeconds: secRemaining,
      countdownMinutes: Math.max(0, Math.round(secRemaining / 60)),
      isVehicleOffline: isOffline,
    };
  }

  const secToPickup = Math.max(0, Math.round(pickupProj.timeSeconds - vehicleProj.timeSeconds));
  return {
    stage: 'arriving',
    countdownSeconds: secToPickup,
    countdownMinutes: Math.max(0, Math.round(secToPickup / 60)),
    isVehicleOffline: isOffline,
  };
}
