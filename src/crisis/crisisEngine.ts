import {
  MAX_DROPOFF_METERS,
  MAX_PICKUP_WALK_METERS,
  parseArriveByEpochMs,
  projectPointToRoute,
  timestampToMillis,
} from '../matching/matchRides';
import { haversineDistanceMeters } from '../trips/tripLogic';
import type {
  BlockedZone,
  CrisisAssignmentRecord,
  CrisisKpiSummary,
  CrisisReallocationRecord,
  CrisisUnreachableRecord,
  DemandPin,
  LatLngPoint,
  LivePosition,
  SeatRequest,
  Trip,
} from '../types/firestore';
import { resolveBlockedZoneRoute, routeIntersectsBlockedZone } from './blockedRouting';
import type {
  BlockedZoneRouteOutcome,
  CrisisBlockedZone,
  CrisisEngineInput,
  CrisisPlanResult,
  CrisisRouteResolver,
  CrisisStudentDemand,
  CrisisVehicle,
  TieredStudent,
} from './types';

export const TIER_1_EXAM_WINDOW_MS = 2 * 60 * 60 * 1000;
export const EXAM_SAFETY_BUFFER_MS = 10 * 60 * 1000;
export const AT_RISK_MARGIN_MS = 10 * 60 * 1000;
export const MAX_LEVEL2_DETOUR_SECONDS = 600;
export const LEVEL2_CORRIDOR_SEARCH_METERS = 6000;
export const LEVEL2_BOARDING_DWELL_SECONDS = 60;
export const REALLOCATION_CLUSTER_RADIUS_METERS = 800;
export const SCHEDULED_LATER_THRESHOLD_MS = 25 * 60 * 1000;

export function buildCrisisChangeSignature(input: {
  trips: Trip[];
  livePositionsByTripId: Record<string, LivePosition | undefined>;
  seatRequests: SeatRequest[];
  demandPins: DemandPin[];
  blockedZones: BlockedZone[];
}): string {
  const tripSig = input.trips
    .map((t) => {
      const lp = input.livePositionsByTripId[t.id];
      const lpSig = lp ? `${lp.lat.toFixed(3)},${lp.lng.toFixed(3)}` : 'no-lp';
      return `${t.id}:${t.status}:${t.seatsFree}:${lpSig}`;
    })
    .sort()
    .join('|');

  const reqSig = input.seatRequests
    .filter((r) => r.status === 'pending' || r.status === 'accepted')
    .map(
      (r) =>
        `${r.id}:${r.status}:${r.tripId}:${timestampToMillis(r.examAt) ?? 'none'}:${r.arriveBy ?? ''}`,
    )
    .sort()
    .join('|');

  const pinSig = input.demandPins
    .filter((p) => p.active)
    .map(
      (p) =>
        `${p.id}:${p.lat.toFixed(3)},${p.lng.toFixed(3)}:${timestampToMillis(p.examAt) ?? 'none'}:${p.arriveBy ?? ''}`,
    )
    .sort()
    .join('|');

  const zoneSig = input.blockedZones
    .map(
      (z) =>
        `${z.id}:${z.active ? 1 : 0}:${z.radiusMeters}:${z.center.lat.toFixed(4)},${z.center.lng.toFixed(4)}`,
    )
    .sort()
    .join('|');

  return `${tripSig}##${reqSig}##${pinSig}##${zoneSig}`;
}

function isValidLatLng(pt: LatLngPoint | null | undefined): boolean {
  if (!pt || typeof pt.lat !== 'number' || typeof pt.lng !== 'number') return false;
  return (
    Number.isFinite(pt.lat) &&
    Number.isFinite(pt.lng) &&
    pt.lat >= -90 &&
    pt.lat <= 90 &&
    pt.lng >= -180 &&
    pt.lng <= 180
  );
}

export function normalizeBlockedZones(
  zones: Array<CrisisBlockedZone | BlockedZone>,
): CrisisBlockedZone[] {
  return zones.map((z) => ({
    id: z.id,
    center: z.center,
    radiusMeters: z.radiusMeters,
    label: z.label,
    active: z.active,
  }));
}

export function validateCrisisInputs(input: {
  vehicles: CrisisVehicle[];
  students: CrisisStudentDemand[];
  blockedZones: CrisisBlockedZone[];
  nowMs: number;
}): string[] {
  const errors: string[] = [];

  if (!Number.isFinite(input.nowMs) || input.nowMs <= 0) {
    errors.push('Invalid reference clock (nowMs).');
  }

  const seenTrips = new Set<string>();
  for (const v of input.vehicles) {
    if (!v.tripId) {
      errors.push('Vehicle entry missing tripId.');
      continue;
    }
    if (seenTrips.has(v.tripId)) {
      errors.push(`Duplicate vehicle tripId: ${v.tripId}`);
    }
    seenTrips.add(v.tripId);

    if (!isValidLatLng(v.origin) || !isValidLatLng(v.destination)) {
      errors.push(`Vehicle ${v.tripId} has invalid origin or destination coordinates.`);
    }
    if (!Number.isFinite(v.seatsTotal) || v.seatsTotal < 1) {
      errors.push(`Vehicle ${v.tripId} has invalid seatsTotal (${v.seatsTotal}).`);
    }
    if (!Number.isFinite(v.seatsFree) || v.seatsFree < 0 || v.seatsFree > v.seatsTotal) {
      errors.push(`Vehicle ${v.tripId} has invalid seatsFree (${v.seatsFree}/${v.seatsTotal}).`);
    }
    if (
      v.routeGeometry.length < 2 ||
      v.cumulativeDurations.length !== v.routeGeometry.length
    ) {
      errors.push(`Vehicle ${v.tripId} routeGeometry/cumulativeDurations length mismatch.`);
    }
  }

  const seenStudents = new Set<string>();
  for (const s of input.students) {
    if (!s.studentId) {
      errors.push('Student demand entry missing studentId.');
      continue;
    }
    if (seenStudents.has(s.studentId)) {
      errors.push(`Duplicate studentId in demand list: ${s.studentId}`);
    }
    seenStudents.add(s.studentId);

    if (!isValidLatLng(s.pickup) || !isValidLatLng(s.destination)) {
      errors.push(`Student ${s.studentId} has invalid pickup or destination coordinates.`);
    }
    if (s.examAtMs !== null && !Number.isFinite(s.examAtMs)) {
      errors.push(`Student ${s.studentId} has invalid examAt timestamp.`);
    }
    if (s.arriveByMs !== null && !Number.isFinite(s.arriveByMs)) {
      errors.push(`Student ${s.studentId} has invalid arriveBy timestamp.`);
    }
  }

  for (const z of input.blockedZones) {
    if (!isValidLatLng(z.center)) {
      errors.push(`Blocked zone "${z.label || z.id}" has invalid center coordinates.`);
    }
    if (!Number.isFinite(z.radiusMeters) || z.radiusMeters <= 0) {
      errors.push(`Blocked zone "${z.label || z.id}" radius must be positive.`);
    }
  }

  return errors;
}

export function buildCrisisInputsFromFirestore(input: {
  trips: Trip[];
  livePositionsByTripId: Record<string, LivePosition | undefined>;
  seatRequests: SeatRequest[];
  demandPins: DemandPin[];
  nowMs?: number;
}): { vehicles: CrisisVehicle[]; students: CrisisStudentDemand[] } {
  const nowMs = input.nowMs ?? Date.now();
  const tripsById = new Map<string, Trip>();
  const vehicles: CrisisVehicle[] = [];

  for (const trip of input.trips) {
    tripsById.set(trip.id, trip);
    const livePos = input.livePositionsByTripId[trip.id];
    const depMs = timestampToMillis(trip.departureTime) ?? nowMs;
    vehicles.push({
      tripId: trip.id,
      driverId: trip.driverId,
      driverName: trip.driverName,
      driverVerified: trip.driverVerified,
      vehicleType: trip.vehicleType,
      status: trip.status,
      seatsFree: trip.seatsFree,
      seatsTotal: trip.seatsTotal,
      origin: { lat: trip.originLat, lng: trip.originLng },
      destination: { lat: trip.destinationLat, lng: trip.destinationLng },
      destinationName: trip.destinationName,
      currentPosition: livePos ? { lat: livePos.lat, lng: livePos.lng } : null,
      departureTimeMs: depMs,
      durationSeconds: trip.durationSeconds,
      routeGeometry: trip.routeGeometry,
      cumulativeDurations: trip.cumulativeDurations,
      isDrill: trip.isDrill,
    });
  }

  // Deduplicate by studentId so a student with both a seatRequest and a demandPin is planned once.
  const studentMap = new Map<string, CrisisStudentDemand>();

  for (const req of input.seatRequests) {
    if (req.status !== 'pending' && req.status !== 'accepted') continue;
    const refTrip = tripsById.get(req.tripId);
    const destLat = req.destinationLat ?? refTrip?.destinationLat;
    const destLng = req.destinationLng ?? refTrip?.destinationLng;
    if (typeof destLat !== 'number' || typeof destLng !== 'number') continue;

    const examAtMs = timestampToMillis(req.examAt);
    const arriveByMs = parseArriveByEpochMs(req.arriveBy, nowMs);
    const createdAtMs = timestampToMillis(req.createdAt) ?? nowMs;

    studentMap.set(req.studentId, {
      studentId: req.studentId,
      requestId: req.id,
      studentName: req.studentName,
      pickup: { lat: req.pickupLat, lng: req.pickupLng },
      destination: { lat: destLat, lng: destLng },
      destinationName: req.destinationName,
      arriveByMs,
      examAtMs,
      createdAtMs,
      isDrill: req.isDrill,
      source: 'seat_request',
    });
  }

  for (const pin of input.demandPins) {
    if (!pin.active) continue;
    if (studentMap.has(pin.studentId)) continue;
    if (typeof pin.destinationLat !== 'number' || typeof pin.destinationLng !== 'number') continue;

    const examAtMs = timestampToMillis(pin.examAt);
    const arriveByMs = parseArriveByEpochMs(pin.arriveBy, nowMs);
    const createdAtMs = timestampToMillis(pin.createdAt) ?? nowMs;

    studentMap.set(pin.studentId, {
      studentId: pin.studentId,
      requestId: pin.id,
      studentName: `Student ${pin.studentId.slice(0, 6)}`,
      pickup: { lat: pin.lat, lng: pin.lng },
      destination: { lat: pin.destinationLat, lng: pin.destinationLng },
      destinationName: pin.destinationName,
      arriveByMs,
      examAtMs,
      createdAtMs,
      isDrill: pin.isDrill,
      source: 'demand_pin',
    });
  }

  return {
    vehicles,
    students: Array.from(studentMap.values()),
  };
}

function sliceRouteBetweenProgress(
  geometry: LatLngPoint[],
  startProgress: number,
  endProgress: number,
  startSnap: LatLngPoint,
  endSnap: LatLngPoint,
): LatLngPoint[] {
  const fromIdx = Math.max(0, Math.min(geometry.length - 1, Math.floor(startProgress) + 1));
  const toIdx = Math.max(0, Math.min(geometry.length - 1, Math.floor(endProgress)));
  const points: LatLngPoint[] = [startSnap];
  for (let i = fromIdx; i <= toIdx; i += 1) {
    points.push(geometry[i]);
  }
  points.push(endSnap);
  return points;
}

function getVehicleStartTimeOnRoute(
  vehicle: CrisisVehicle,
  nowMs: number,
): { startEpochMs: number; vehicleTimeOffsetSec: number; vehicleProgress: number } {
  if (vehicle.status === 'live') {
    if (vehicle.currentPosition) {
      const proj = projectPointToRoute(
        vehicle.currentPosition,
        vehicle.routeGeometry,
        vehicle.cumulativeDurations,
      );
      if (proj) {
        return {
          startEpochMs: nowMs,
          vehicleTimeOffsetSec: proj.timeSeconds,
          vehicleProgress: proj.progress,
        };
      }
    }
    return {
      startEpochMs: nowMs,
      vehicleTimeOffsetSec: 0,
      vehicleProgress: 0,
    };
  }

  return {
    startEpochMs: Math.max(nowMs, vehicle.departureTimeMs),
    vehicleTimeOffsetSec: 0,
    vehicleProgress: 0,
  };
}

interface CandidateAssignmentOption {
  vehicle: CrisisVehicle;
  assignmentLevel: 1 | 2;
  etaArrivalMs: number;
  detourSeconds: number;
  routeStatus: 'clear' | 'detoured';
}

function computeKpis(input: {
  tieredStudents: TieredStudent[];
  assignments: CrisisAssignmentRecord[];
  unreachable: CrisisUnreachableRecord[];
  reallocations: CrisisReallocationRecord[];
  vehicles: CrisisVehicle[];
}): CrisisKpiSummary {
  const totalStudents = input.tieredStudents.length;
  const examStudents = input.tieredStudents.filter((s) => s.student.examAtMs !== null).length;

  let onTime = 0;
  let atRisk = 0;
  let slackSum = 0;
  let slackCount = 0;

  for (const a of input.assignments) {
    const withinDeadline = a.deadlineMs === null || a.etaArrivalMs <= a.deadlineMs;
    if (withinDeadline) {
      onTime += 1;
    }
    if (a.atRisk) {
      atRisk += 1;
    }
    if (a.slackAtArrivalMinutes !== null) {
      slackSum += a.slackAtArrivalMinutes;
      slackCount += 1;
    }
  }

  const activeSeatCapacity = input.vehicles
    .filter((v) => v.status === 'live' || v.status === 'scheduled')
    .reduce((sum, v) => sum + Math.max(0, v.seatsTotal), 0);

  const seatUtilisationPct =
    activeSeatCapacity > 0
      ? Math.min(100, Math.round((input.assignments.length / activeSeatCapacity) * 1000) / 10)
      : 0;

  const uniqueReallocatedVehicles = new Set(input.reallocations.map((r) => r.tripId)).size;

  return {
    totalStudents,
    examStudents,
    onTime,
    atRisk,
    cannotReach: input.unreachable.length,
    seatUtilisationPct,
    vehiclesReallocated: uniqueReallocatedVehicles,
    averageSlackMinutes: slackCount > 0 ? Math.round((slackSum / slackCount) * 10) / 10 : 0,
  };
}

export async function computeCrisisPlan(input: CrisisEngineInput): Promise<CrisisPlanResult> {
  const nowMs = input.nowMs;
  const activeZones = normalizeBlockedZones(input.blockedZones).filter((z) => z.active);
  const validationErrors = validateCrisisInputs({
    vehicles: input.vehicles,
    students: input.students,
    blockedZones: activeZones,
    nowMs,
  });

  const baseResolver: CrisisRouteResolver =
    input.routeResolver ??
    ((origin, dest, zones) => resolveBlockedZoneRoute(origin, dest, zones));

  const routeCache = new Map<string, Promise<BlockedZoneRouteOutcome>>();
  const cachedResolve = (
    origin: LatLngPoint,
    dest: LatLngPoint,
  ): Promise<BlockedZoneRouteOutcome> => {
    const key = `${origin.lat.toFixed(5)},${origin.lng.toFixed(5)}->${dest.lat.toFixed(5)},${dest.lng.toFixed(5)}`;
    const existing = routeCache.get(key);
    if (existing) return existing;
    const promise = baseResolver(origin, dest, activeZones);
    routeCache.set(key, promise);
    return promise;
  };

  // 1. PRIORITY ENGINE: resolve blocked-zone-avoiding minTravel for each student
  const tieredStudents: TieredStudent[] = await Promise.all(
    input.students.map(async (student): Promise<TieredStudent> => {
      const outcome = await cachedResolve(student.pickup, student.destination);
      const minTravelSeconds = outcome.route ? outcome.route.durationSeconds : null;

      let latestDepartureMs: number | null = null;
      let slackMinutes: number | null = null;

      if (student.examAtMs !== null && minTravelSeconds !== null) {
        latestDepartureMs =
          student.examAtMs - minTravelSeconds * 1000 - EXAM_SAFETY_BUFFER_MS;
        slackMinutes = Math.round(((latestDepartureMs - nowMs) / 60_000) * 10) / 10;
      }

      const isTier1 =
        student.examAtMs !== null && student.examAtMs - nowMs <= TIER_1_EXAM_WINDOW_MS;

      const deadlineMs = student.examAtMs ?? student.arriveByMs;

      return {
        student,
        tier: isTier1 ? 1 : 2,
        deadlineMs,
        minTravelSeconds,
        latestDepartureMs,
        slackMinutes,
        directRouteStatus: outcome.status,
        blockedByZoneIds: outcome.blockedByZoneIds,
      };
    }),
  );

  // Sort Tier 1 first by ascending slack (most urgent first), then Tier 2 by arriveBy deadline
  const sortedForNxtpath = [...tieredStudents].sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier;
    if (a.tier === 1) {
      const sa = a.slackMinutes ?? Number.NEGATIVE_INFINITY;
      const sb = b.slackMinutes ?? Number.NEGATIVE_INFINITY;
      if (sa !== sb) return sa - sb;
      return (a.deadlineMs ?? Infinity) - (b.deadlineMs ?? Infinity);
    }
    const da = a.deadlineMs ?? Infinity;
    const db = b.deadlineMs ?? Infinity;
    if (da !== db) return da - db;
    return a.student.createdAtMs - b.student.createdAtMs;
  });

  // Track seat pools & cumulative detours for Nxtpath solver
  const availableVehicles = input.vehicles.filter(
    (v) => v.status === 'live' || v.status === 'scheduled',
  );
  const seatsLeft = new Map<string, number>();
  const extraDetourMsByTrip = new Map<string, number>();
  const assignedByTrip = new Map<string, CrisisAssignmentRecord[]>();
  for (const v of availableVehicles) {
    seatsLeft.set(v.tripId, Math.max(0, v.seatsFree));
    extraDetourMsByTrip.set(v.tripId, 0);
    assignedByTrip.set(v.tripId, []);
  }

  const nxtAssignments: CrisisAssignmentRecord[] = [];
  const uncoveredStudents: Array<{
    tiered: TieredStudent;
    reasonHint: 'road_blocked' | 'no_seat' | 'no_vehicle_in_range';
    detail: string;
  }> = [];

  // Helper to evaluate Level 1 single pickup on an existing route
  const evaluateLevel1 = (
    tiered: TieredStudent,
    vehicle: CrisisVehicle,
    currentDetourMs: number,
  ): { etaArrivalMs: number; onTime: boolean } | null => {
    if (vehicle.routeGeometry.length < 2) return null;
    const pickupProj = projectPointToRoute(
      tiered.student.pickup,
      vehicle.routeGeometry,
      vehicle.cumulativeDurations,
    );
    const destProj = projectPointToRoute(
      tiered.student.destination,
      vehicle.routeGeometry,
      vehicle.cumulativeDurations,
    );

    if (!pickupProj || !destProj) return null;
    if (pickupProj.distanceMeters > MAX_PICKUP_WALK_METERS) return null;
    if (destProj.distanceMeters > MAX_DROPOFF_METERS) return null;
    if (pickupProj.progress >= destProj.progress - 0.01) return null;
    if (destProj.timeSeconds <= pickupProj.timeSeconds) return null;

    const timing = getVehicleStartTimeOnRoute(vehicle, nowMs);
    if (vehicle.status === 'live' && vehicle.currentPosition) {
      const distPast =
        timing.vehicleProgress > pickupProj.progress
          ? haversineDistanceMeters(vehicle.currentPosition, pickupProj.snappedPoint)
          : 0;
      if (timing.vehicleProgress > pickupProj.progress + 0.05 && distPast > 150) {
        return null;
      }
    }

    // Verify route segment from current/pickup stop to school avoids blocked zones
    const corridorSlice = sliceRouteBetweenProgress(
      vehicle.routeGeometry,
      Math.max(timing.vehicleProgress, pickupProj.progress),
      destProj.progress,
      pickupProj.snappedPoint,
      destProj.snappedPoint,
    );
    if (routeIntersectsBlockedZone(corridorSlice, activeZones).blocked) {
      return null;
    }

    const etaFromStartSec = Math.max(0, destProj.timeSeconds - timing.vehicleTimeOffsetSec);
    const etaArrivalMs = timing.startEpochMs + etaFromStartSec * 1000 + currentDetourMs;
    const onTime = tiered.deadlineMs === null || etaArrivalMs <= tiered.deadlineMs;
    return { etaArrivalMs, onTime };
  };

  // Helper to evaluate Level 2 pickup insertion into an existing route (<= 10 min extra detour, zero missed deadlines)
  const evaluateLevel2 = async (
    tiered: TieredStudent,
    vehicle: CrisisVehicle,
    currentDetourMs: number,
    existingOnVehicle: CrisisAssignmentRecord[],
  ): Promise<{ etaArrivalMs: number; detourSeconds: number; routeStatus: 'clear' | 'detoured' } | null> => {
    if (vehicle.routeGeometry.length < 2) return null;

    // Must terminate near student's school
    const destProj = projectPointToRoute(
      tiered.student.destination,
      vehicle.routeGeometry,
      vehicle.cumulativeDurations,
    );
    if (!destProj || destProj.distanceMeters > MAX_DROPOFF_METERS) return null;

    const pickupProj = projectPointToRoute(
      tiered.student.pickup,
      vehicle.routeGeometry,
      vehicle.cumulativeDurations,
    );
    if (!pickupProj) return null;
    if (pickupProj.distanceMeters > LEVEL2_CORRIDOR_SEARCH_METERS) return null;
    if (pickupProj.progress >= destProj.progress - 0.01) return null;

    const timing = getVehicleStartTimeOnRoute(vehicle, nowMs);
    if (vehicle.status === 'live' && timing.vehicleProgress > pickupProj.progress + 0.05) {
      return null;
    }

    // Check vehicle's post-insertion segment to school avoids blocked zones
    const afterPickupSlice = sliceRouteBetweenProgress(
      vehicle.routeGeometry,
      pickupProj.progress,
      destProj.progress,
      pickupProj.snappedPoint,
      destProj.snappedPoint,
    );
    if (routeIntersectsBlockedZone(afterPickupSlice, activeZones).blocked) {
      return null;
    }

    const anchorBeforeIdx = Math.max(
      Math.floor(timing.vehicleProgress),
      Math.max(0, Math.floor(pickupProj.progress) - 1),
    );
    const anchorAfterIdx = Math.min(
      vehicle.routeGeometry.length - 1,
      Math.min(Math.ceil(destProj.progress), Math.ceil(pickupProj.progress) + 1),
    );

    const anchorBefore =
      anchorBeforeIdx <= Math.floor(timing.vehicleProgress) && vehicle.currentPosition
        ? vehicle.currentPosition
        : vehicle.routeGeometry[anchorBeforeIdx];
    const anchorAfter = vehicle.routeGeometry[anchorAfterIdx];

    const baselineSegmentSec = Math.max(
      0,
      (vehicle.cumulativeDurations[anchorAfterIdx] ?? destProj.timeSeconds) -
        (vehicle.cumulativeDurations[anchorBeforeIdx] ?? timing.vehicleTimeOffsetSec),
    );

    const legIn = await cachedResolve(anchorBefore, tiered.student.pickup);
    if (legIn.status === 'no_road_path' || !legIn.route) return null;

    const legOut = await cachedResolve(tiered.student.pickup, anchorAfter);
    if (legOut.status === 'no_road_path' || !legOut.route) return null;

    const detourSeconds = Math.max(
      LEVEL2_BOARDING_DWELL_SECONDS,
      Math.round(
        legIn.route.durationSeconds +
          legOut.route.durationSeconds -
          baselineSegmentSec +
          LEVEL2_BOARDING_DWELL_SECONDS,
      ),
    );

    if (detourSeconds > MAX_LEVEL2_DETOUR_SECONDS) {
      return null;
    }

    // Ensure no already-assigned student on this vehicle misses their deadline due to detour
    const detourMs = detourSeconds * 1000;
    for (const prev of existingOnVehicle) {
      if (prev.deadlineMs !== null && prev.etaArrivalMs + detourMs > prev.deadlineMs) {
        return null;
      }
    }

    const etaFromStartSec = Math.max(0, destProj.timeSeconds - timing.vehicleTimeOffsetSec);
    const etaArrivalMs = timing.startEpochMs + etaFromStartSec * 1000 + currentDetourMs + detourMs;

    if (tiered.deadlineMs !== null && etaArrivalMs > tiered.deadlineMs) {
      return null;
    }

    const routeStatus: 'clear' | 'detoured' =
      legIn.status === 'detoured' || legOut.status === 'detoured' ? 'detoured' : 'clear';

    return { etaArrivalMs, detourSeconds, routeStatus };
  };

  // 2. ASSIGNMENT LOOP (Tier 1 first, then Tier 2)
  for (const tiered of sortedForNxtpath) {
    if (tiered.directRouteStatus === 'no_road_path') {
      uncoveredStudents.push({
        tiered,
        reasonHint: 'road_blocked',
        detail: `All road paths to ${tiered.student.destinationName} pass through blocked zone(s).`,
      });
      continue;
    }

    let bestOption: CandidateAssignmentOption | null = null;
    let sawZeroSeatMatch = false;
    let sawBlockedCorridorMatch = false;

    for (const vehicle of availableVehicles) {
      const free = seatsLeft.get(vehicle.tripId) ?? 0;
      const currentDetourMs = extraDetourMsByTrip.get(vehicle.tripId) ?? 0;

      // Check why a vehicle might not be usable for diagnostic reason reporting
      const pickupProj = projectPointToRoute(
        tiered.student.pickup,
        vehicle.routeGeometry,
        vehicle.cumulativeDurations,
      );
      const destProj = projectPointToRoute(
        tiered.student.destination,
        vehicle.routeGeometry,
        vehicle.cumulativeDurations,
      );
      const geometricCorridorHit =
        pickupProj &&
        destProj &&
        pickupProj.distanceMeters <= LEVEL2_CORRIDOR_SEARCH_METERS &&
        destProj.distanceMeters <= MAX_DROPOFF_METERS &&
        pickupProj.progress < destProj.progress;

      if (geometricCorridorHit) {
        const corridorSlice = sliceRouteBetweenProgress(
          vehicle.routeGeometry,
          pickupProj.progress,
          destProj.progress,
          pickupProj.snappedPoint,
          destProj.snappedPoint,
        );
        if (routeIntersectsBlockedZone(corridorSlice, activeZones).blocked) {
          sawBlockedCorridorMatch = true;
        }
      }

      if (free <= 0) {
        if (geometricCorridorHit) {
          sawZeroSeatMatch = true;
        }
        continue;
      }

      // Level 1 check
      const l1 = evaluateLevel1(tiered, vehicle, currentDetourMs);
      if (l1 && l1.onTime) {
        const cand: CandidateAssignmentOption = {
          vehicle,
          assignmentLevel: 1,
          etaArrivalMs: l1.etaArrivalMs,
          detourSeconds: 0,
          routeStatus: tiered.directRouteStatus === 'detoured' ? 'detoured' : 'clear',
        };
        if (
          !bestOption ||
          cand.etaArrivalMs < bestOption.etaArrivalMs ||
          (cand.etaArrivalMs === bestOption.etaArrivalMs &&
            cand.assignmentLevel < bestOption.assignmentLevel)
        ) {
          bestOption = cand;
        }
        continue;
      }

      // Level 2 route pickup insertion check
      const existingOnVehicle = assignedByTrip.get(vehicle.tripId) ?? [];
      const l2 = await evaluateLevel2(tiered, vehicle, currentDetourMs, existingOnVehicle);
      if (l2) {
        const cand: CandidateAssignmentOption = {
          vehicle,
          assignmentLevel: 2,
          etaArrivalMs: l2.etaArrivalMs,
          detourSeconds: l2.detourSeconds,
          routeStatus: l2.routeStatus,
        };
        if (
          !bestOption ||
          cand.etaArrivalMs < bestOption.etaArrivalMs ||
          (cand.etaArrivalMs === bestOption.etaArrivalMs &&
            cand.assignmentLevel < bestOption.assignmentLevel)
        ) {
          bestOption = cand;
        }
      }
    }

    if (bestOption) {
      const tripId = bestOption.vehicle.tripId;
      seatsLeft.set(tripId, (seatsLeft.get(tripId) ?? 1) - 1);

      // Apply detour delay to already-assigned riders if Level 2 insertion occurred
      if (bestOption.assignmentLevel === 2 && bestOption.detourSeconds > 0) {
        const detourMs = bestOption.detourSeconds * 1000;
        extraDetourMsByTrip.set(tripId, (extraDetourMsByTrip.get(tripId) ?? 0) + detourMs);
        const existingList = assignedByTrip.get(tripId) ?? [];
        for (const existing of existingList) {
          existing.etaArrivalMs += detourMs;
          if (existing.deadlineMs !== null) {
            const marginMs = existing.deadlineMs - existing.etaArrivalMs;
            existing.slackAtArrivalMinutes = Math.round((marginMs / 60_000) * 10) / 10;
            existing.atRisk = marginMs >= 0 && marginMs < AT_RISK_MARGIN_MS;
          }
        }
      }

      const marginMs =
        tiered.deadlineMs !== null ? tiered.deadlineMs - bestOption.etaArrivalMs : null;
      const record: CrisisAssignmentRecord = {
        studentId: tiered.student.studentId,
        requestId: tiered.student.requestId,
        studentName: tiered.student.studentName,
        tripId,
        driverId: bestOption.vehicle.driverId,
        driverName: bestOption.vehicle.driverName,
        tier: tiered.tier,
        assignmentLevel: bestOption.assignmentLevel,
        etaArrivalMs: bestOption.etaArrivalMs,
        deadlineMs: tiered.deadlineMs,
        slackAtArrivalMinutes:
          marginMs !== null ? Math.round((marginMs / 60_000) * 10) / 10 : null,
        atRisk: marginMs !== null && marginMs >= 0 && marginMs < AT_RISK_MARGIN_MS,
        detourMinutes: Math.round((bestOption.detourSeconds / 60) * 10) / 10,
        routeStatus: bestOption.routeStatus,
      };

      nxtAssignments.push(record);
      assignedByTrip.get(tripId)?.push(record);
    } else {
      const reasonHint: 'road_blocked' | 'no_seat' | 'no_vehicle_in_range' =
        sawBlockedCorridorMatch && !sawZeroSeatMatch
          ? 'road_blocked'
          : sawZeroSeatMatch
            ? 'no_seat'
            : 'no_vehicle_in_range';

      const detail =
        reasonHint === 'road_blocked'
          ? `Nearby corridor toward ${tiered.student.destinationName} intersects active blocked zone.`
          : reasonHint === 'no_seat'
            ? `Matching vehicles heading to ${tiered.student.destinationName} have 0 free seats.`
            : `No available vehicle passes within range before ${tiered.deadlineMs ? new Date(tiered.deadlineMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'cutoff'}.`;

      uncoveredStudents.push({ tiered, reasonHint, detail });
    }
  }

  // 3. REALLOCATION PROPOSALS for uncovered Tier 1 exam students
  const uncoveredTier1 = uncoveredStudents.filter(
    (u) => u.tiered.tier === 1 && u.tiered.directRouteStatus !== 'no_road_path',
  );

  interface UncoveredCluster {
    id: string;
    placeLabel: string;
    center: LatLngPoint;
    destination: LatLngPoint;
    students: TieredStudent[];
    tightestExamMs: number;
  }

  const clusters: UncoveredCluster[] = [];
  for (const item of uncoveredTier1) {
    const t = item.tiered;
    const match = clusters.find(
      (c) =>
        haversineDistanceMeters(c.center, t.student.pickup) <= REALLOCATION_CLUSTER_RADIUS_METERS &&
        haversineDistanceMeters(c.destination, t.student.destination) <= MAX_DROPOFF_METERS,
    );
    if (match) {
      match.students.push(t);
      const count = match.students.length;
      match.center = {
        lat: (match.center.lat * (count - 1) + t.student.pickup.lat) / count,
        lng: (match.center.lng * (count - 1) + t.student.pickup.lng) / count,
      };
      if (t.deadlineMs !== null && t.deadlineMs < match.tightestExamMs) {
        match.tightestExamMs = t.deadlineMs;
      }
    } else {
      clusters.push({
        id: `cluster-${clusters.length + 1}`,
        placeLabel: t.student.destinationName
          ? `${t.student.destinationName} pickup`
          : 'Exam pickup cluster',
        center: t.student.pickup,
        destination: t.student.destination,
        students: [t],
        tightestExamMs: t.deadlineMs ?? nowMs + TIER_1_EXAM_WINDOW_MS,
      });
    }
  }

  const reallocations: CrisisReallocationRecord[] = [];
  const usedReallocationTrips = new Set<string>();

  clusters.sort((a, b) => {
    if (b.students.length !== a.students.length) return b.students.length - a.students.length;
    return a.tightestExamMs - b.tightestExamMs;
  });

  for (const cluster of clusters) {
    let bestProposal: CrisisReallocationRecord | null = null;

    for (const vehicle of availableVehicles) {
      if (usedReallocationTrips.has(vehicle.tripId)) continue;
      if (vehicle.seatsTotal <= 0) continue;

      const assignedOnVehicle = assignedByTrip.get(vehicle.tripId) ?? [];
      const hasTier1 = assignedOnVehicle.some((r) => r.tier === 1);
      if (hasTier1) continue; // Never pull a vehicle away from already-assigned Tier 1 exam students

      const isScheduledLater =
        vehicle.status === 'scheduled' &&
        vehicle.departureTimeMs - nowMs >= SCHEDULED_LATER_THRESHOLD_MS;
      const isIdle = assignedOnVehicle.length === 0 && !isScheduledLater;
      const reasonTag: 'idle' | 'scheduled_later' | 'tier2_only' = isScheduledLater
        ? 'scheduled_later'
        : isIdle
          ? 'idle'
          : 'tier2_only';

      const vehicleStart = vehicle.currentPosition ?? vehicle.origin;
      const toCluster = await cachedResolve(vehicleStart, cluster.center);
      if (toCluster.status === 'no_road_path' || !toCluster.route) continue;

      const toSchool = await cachedResolve(cluster.center, cluster.destination);
      if (toSchool.status === 'no_road_path' || !toSchool.route) continue;

      const totalTripSec = toCluster.route.durationSeconds + toSchool.route.durationSeconds;
      const arrivalMs = nowMs + totalTripSec * 1000;
      if (arrivalMs > cluster.tightestExamMs) continue;

      const baselineSec = vehicle.durationSeconds > 0 ? vehicle.durationSeconds : 0;
      const detourSeconds =
        reasonTag === 'tier2_only'
          ? Math.max(60, totalTripSec - baselineSec)
          : Math.max(60, toCluster.route.durationSeconds);

      const detourMinutes = Math.max(1, Math.round(detourSeconds / 60));
      const capacity = Math.min(cluster.students.length, vehicle.seatsTotal);
      if (capacity <= 0) continue;

      if (!bestProposal || detourMinutes < bestProposal.detourMinutes) {
        bestProposal = {
          id: `realloc-${vehicle.tripId}-${cluster.id}`,
          tripId: vehicle.tripId,
          driverId: vehicle.driverId,
          driverName: vehicle.driverName,
          vehicleType: vehicle.vehicleType,
          currentStatus: vehicle.status,
          reasonTag,
          clusterPlace: cluster.placeLabel,
          clusterCenter: cluster.center,
          studentIds: cluster.students.slice(0, capacity).map((s) => s.student.studentId),
          studentCount: capacity,
          detourMinutes,
          approved: false,
        };
      }
    }

    if (bestProposal) {
      reallocations.push(bestProposal);
      usedReallocationTrips.add(bestProposal.tripId);
    }
  }

  // 4. UNREACHABLE: every unassigned student is explicitly emitted with exact reason
  const unreachable: CrisisUnreachableRecord[] = uncoveredStudents.map((u) => ({
    studentId: u.tiered.student.studentId,
    requestId: u.tiered.student.requestId,
    studentName: u.tiered.student.studentName,
    tier: u.tiered.tier,
    reason: u.reasonHint,
    detail: u.detail,
  }));

  const kpis = computeKpis({
    tieredStudents,
    assignments: nxtAssignments,
    unreachable,
    reallocations,
    vehicles: input.vehicles,
  });

  // 5. FCFS BASELINE on the exact same inputs (arrival order, Level 1 only, no priority/reallocation)
  const sortedFcfs = [...tieredStudents].sort(
    (a, b) => a.student.createdAtMs - b.student.createdAtMs,
  );
  const fcfsSeatsLeft = new Map<string, number>();
  for (const v of availableVehicles) {
    fcfsSeatsLeft.set(v.tripId, Math.max(0, v.seatsFree));
  }

  const fcfsAssignments: CrisisAssignmentRecord[] = [];
  const fcfsUnreachable: CrisisUnreachableRecord[] = [];

  for (const tiered of sortedFcfs) {
    if (tiered.directRouteStatus === 'no_road_path') {
      fcfsUnreachable.push({
        studentId: tiered.student.studentId,
        requestId: tiered.student.requestId,
        studentName: tiered.student.studentName,
        tier: tiered.tier,
        reason: 'road_blocked',
        detail: `Road path to ${tiered.student.destinationName} is blocked.`,
      });
      continue;
    }

    let pickedVehicle: CrisisVehicle | null = null;
    let pickedEtaMs = Infinity;
    let sawNoSeat = false;
    let sawBlocked = false;

    for (const vehicle of availableVehicles) {
      const free = fcfsSeatsLeft.get(vehicle.tripId) ?? 0;
      const l1 = evaluateLevel1(tiered, vehicle, 0);

      if (!l1) {
        const pickupProj = projectPointToRoute(
          tiered.student.pickup,
          vehicle.routeGeometry,
          vehicle.cumulativeDurations,
        );
        const destProj = projectPointToRoute(
          tiered.student.destination,
          vehicle.routeGeometry,
          vehicle.cumulativeDurations,
        );
        if (
          pickupProj &&
          destProj &&
          pickupProj.distanceMeters <= MAX_PICKUP_WALK_METERS &&
          destProj.distanceMeters <= MAX_DROPOFF_METERS &&
          pickupProj.progress < destProj.progress
        ) {
          const slice = sliceRouteBetweenProgress(
            vehicle.routeGeometry,
            pickupProj.progress,
            destProj.progress,
            pickupProj.snappedPoint,
            destProj.snappedPoint,
          );
          if (routeIntersectsBlockedZone(slice, activeZones).blocked) {
            sawBlocked = true;
          }
        }
        continue;
      }

      if (free <= 0) {
        if (l1.onTime) sawNoSeat = true;
        continue;
      }

      if (l1.onTime && l1.etaArrivalMs < pickedEtaMs) {
        pickedEtaMs = l1.etaArrivalMs;
        pickedVehicle = vehicle;
      }
    }

    if (pickedVehicle) {
      fcfsSeatsLeft.set(pickedVehicle.tripId, (fcfsSeatsLeft.get(pickedVehicle.tripId) ?? 1) - 1);
      const marginMs = tiered.deadlineMs !== null ? tiered.deadlineMs - pickedEtaMs : null;
      fcfsAssignments.push({
        studentId: tiered.student.studentId,
        requestId: tiered.student.requestId,
        studentName: tiered.student.studentName,
        tripId: pickedVehicle.tripId,
        driverId: pickedVehicle.driverId,
        driverName: pickedVehicle.driverName,
        tier: tiered.tier,
        assignmentLevel: 1,
        etaArrivalMs: pickedEtaMs,
        deadlineMs: tiered.deadlineMs,
        slackAtArrivalMinutes:
          marginMs !== null ? Math.round((marginMs / 60_000) * 10) / 10 : null,
        atRisk: marginMs !== null && marginMs >= 0 && marginMs < AT_RISK_MARGIN_MS,
        detourMinutes: 0,
        routeStatus: tiered.directRouteStatus === 'detoured' ? 'detoured' : 'clear',
      });
    } else {
      fcfsUnreachable.push({
        studentId: tiered.student.studentId,
        requestId: tiered.student.requestId,
        studentName: tiered.student.studentName,
        tier: tiered.tier,
        reason: sawNoSeat ? 'no_seat' : sawBlocked ? 'road_blocked' : 'no_vehicle_in_range',
        detail: sawNoSeat
          ? 'FCFS exhausted all seats before reaching student.'
          : sawBlocked
            ? 'Direct corridor blocked by active zone.'
            : 'No FCFS vehicle reaches school on time.',
      });
    }
  }

  const fcfsKpis = computeKpis({
    tieredStudents,
    assignments: fcfsAssignments,
    unreachable: fcfsUnreachable,
    reallocations: [],
    vehicles: input.vehicles,
  });

  return {
    computedAtMs: nowMs,
    tieredStudents,
    assignments: nxtAssignments,
    unreachable,
    reallocations,
    kpis,
    fcfsAssignments,
    fcfsUnreachable,
    fcfsKpis,
    validationErrors,
  };
}
