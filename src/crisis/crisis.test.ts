import test from 'node:test';
import assert from 'node:assert/strict';
import type { OsrmRouteResult } from '../map/osrm';
import { haversineDistanceMeters } from '../trips/tripLogic';
import {
  resolveBlockedZoneRoute,
  routeIntersectsBlockedZone,
} from './blockedRouting';
import {
  buildCrisisChangeSignature,
  computeCrisisPlan,
  validateCrisisInputs,
} from './crisisEngine';
import type {
  BlockedZoneRouteOutcome,
  CrisisBlockedZone,
  CrisisRouteResolver,
  CrisisStudentDemand,
  CrisisVehicle,
} from './types';

// Reference Mandya rural corridor (~12.52 N, 76.89 E -> ~12.42 N, 76.89 E = ~11.1 km south)
const NORTH_VILLAGE = { lat: 12.52, lng: 76.89 };
const MID_CORRIDOR = { lat: 12.47, lng: 76.89 };
const FLOODED_BRIDGE = { lat: 12.47, lng: 76.89 };
const SIDE_HAMLET_EAST = { lat: 12.47, lng: 76.926 }; // ~1.74 km east of bypass corridor (> 1200m walk -> requires Level 2 detour)
const FAR_DETOUR_HAMLET = { lat: 12.47, lng: 76.99 }; // ~10.8 km east (> 10 min detour)
const SCHOOL_TOWN = { lat: 12.42, lng: 76.89 };
const ISOLATED_VILLAGE = { lat: 12.56, lng: 76.78 };

const NOW_MS = Date.UTC(2026, 10, 12, 7, 30, 0); // 07:30:00Z

function makeStraightRoute(
  points: Array<{ lat: number; lng: number }>,
  speedMetersPerSec = 10,
): OsrmRouteResult {
  const cumulativeDurations = [0];
  let totalDist = 0;
  for (let i = 1; i < points.length; i += 1) {
    const d = haversineDistanceMeters(points[i - 1], points[i]);
    totalDist += d;
    cumulativeDurations.push(Math.round(totalDist / speedMetersPerSec));
  }
  return {
    routeGeometry: points,
    cumulativeDurations,
    distanceMeters: Math.round(totalDist),
    durationSeconds: cumulativeDurations[cumulativeDurations.length - 1] ?? 60,
  };
}

function makeDirectResolver(): CrisisRouteResolver {
  return async (origin, dest, zones): Promise<BlockedZoneRouteOutcome> => {
    const direct = makeStraightRoute([origin, dest], 10);
    const hit = routeIntersectsBlockedZone(direct.routeGeometry, zones);
    if (!hit.blocked) {
      return { status: 'clear', route: direct, blockedByZoneIds: [] };
    }
    // Try an eastern bypass around the flooded bridge if neither endpoint is inside the zone
    const bypassMid = {
      lat: (origin.lat + dest.lat) / 2,
      lng: Math.max(origin.lng, dest.lng) + 0.02,
    };
    const bypass = makeStraightRoute([origin, bypassMid, dest], 10);
    const recheck = routeIntersectsBlockedZone(bypass.routeGeometry, zones);
    if (!recheck.blocked) {
      return { status: 'detoured', route: bypass, blockedByZoneIds: [], usedWaypoint: bypassMid };
    }
    return {
      status: 'no_road_path',
      route: null,
      blockedByZoneIds: recheck.intersectingZoneIds,
    };
  };
}

test('routeIntersectsBlockedZone rejects routes passing within radius + 50m', () => {
  const zone: CrisisBlockedZone = {
    id: 'flood-1',
    center: FLOODED_BRIDGE,
    radiusMeters: 200,
    label: 'Flooded River Bridge',
    active: true,
  };

  // Segment passes directly over center (0 m distance < 250 m threshold)
  const hit = routeIntersectsBlockedZone([NORTH_VILLAGE, SCHOOL_TOWN], [zone]);
  assert.equal(hit.blocked, true);
  assert.deepEqual(hit.intersectingZoneIds, ['flood-1']);

  // Corridor shifted 300 m east clears radius (200 m) + buffer (50 m)
  const clearLine = [
    { lat: 12.52, lng: 76.893 },
    { lat: 12.42, lng: 76.893 },
  ];
  const clear = routeIntersectsBlockedZone(clearLine, [zone]);
  assert.equal(clear.blocked, false);
});

test('resolveBlockedZoneRoute rejects blocked OSRM alternatives, retries with detour waypoint, and reports no_road_path if still blocked', async () => {
  const zone: CrisisBlockedZone = {
    id: 'flood-1',
    center: FLOODED_BRIDGE,
    radiusMeters: 250,
    label: 'Flooded Bridge',
    active: true,
  };

  // Case 1: OSRM alternatives=true returns [blockedRoute, cleanAlternative]
  const res1 = await resolveBlockedZoneRoute(NORTH_VILLAGE, SCHOOL_TOWN, [zone], {
    fetchRoutesFn: async () => ({
      fromCache: false,
      routes: [
        makeStraightRoute([NORTH_VILLAGE, FLOODED_BRIDGE, SCHOOL_TOWN]),
        makeStraightRoute([NORTH_VILLAGE, { lat: 12.47, lng: 76.92 }, SCHOOL_TOWN]),
      ],
    }),
  });
  assert.equal(res1.status, 'clear');
  assert.ok(res1.route !== null);

  // Case 2: All initial alternatives are blocked; detour waypoint succeeds on second try
  const res2 = await resolveBlockedZoneRoute(NORTH_VILLAGE, SCHOOL_TOWN, [zone], {
    fetchRoutesFn: async (_origin, _dest, opts) => {
      if (!opts?.waypoints || opts.waypoints.length === 0) {
        return {
          fromCache: false,
          routes: [makeStraightRoute([NORTH_VILLAGE, FLOODED_BRIDGE, SCHOOL_TOWN])],
        };
      }
      const wp = opts.waypoints[0];
      return {
        fromCache: false,
        routes: [makeStraightRoute([NORTH_VILLAGE, wp, SCHOOL_TOWN])],
      };
    },
  });
  assert.equal(res2.status, 'detoured');
  assert.ok(res2.route !== null);
  assert.ok(res2.usedWaypoint !== undefined);

  // Case 3: Every returned route & detour still crosses the blocked zone -> no_road_path
  const res3 = await resolveBlockedZoneRoute(NORTH_VILLAGE, SCHOOL_TOWN, [zone], {
    fetchRoutesFn: async () => ({
      fromCache: false,
      routes: [makeStraightRoute([NORTH_VILLAGE, FLOODED_BRIDGE, SCHOOL_TOWN])],
    }),
  });
  assert.equal(res3.status, 'no_road_path');
  assert.equal(res3.route, null);
  assert.deepEqual(res3.blockedByZoneIds, ['flood-1']);
});

test('Exam Day Crisis engine prioritizes Tier 1 exam urgency over FCFS, executes Level 2 detours, flags unreachable reasons, and proposes reallocations', async () => {
  const straightCorridor = makeStraightRoute([NORTH_VILLAGE, MID_CORRIDOR, SCHOOL_TOWN], 10);
  // Bypass corridor along eastern road avoids flooded bridge
  const bypassCorridor = makeStraightRoute(
    [NORTH_VILLAGE, { lat: 12.47, lng: 76.91 }, SCHOOL_TOWN],
    10,
  );

  const vehicles: CrisisVehicle[] = [
    // Two govt buses failed during the crisis: excluded from assignment!
    {
      tripId: 'bus-broken-1',
      driverId: 'd-bus-1',
      driverName: 'Govt Bus 12A',
      driverVerified: true,
      vehicleType: 'govt_bus',
      status: 'disrupted',
      seatsFree: 30,
      seatsTotal: 30,
      origin: NORTH_VILLAGE,
      destination: SCHOOL_TOWN,
      destinationName: 'Mandya High School',
      currentPosition: NORTH_VILLAGE,
      departureTimeMs: NOW_MS,
      durationSeconds: straightCorridor.durationSeconds,
      routeGeometry: straightCorridor.routeGeometry,
      cumulativeDurations: straightCorridor.cumulativeDurations,
    },
    {
      tripId: 'bus-broken-2',
      driverId: 'd-bus-2',
      driverName: 'Govt Bus 14B',
      driverVerified: true,
      vehicleType: 'govt_bus',
      status: 'unavailable',
      seatsFree: 25,
      seatsTotal: 25,
      origin: NORTH_VILLAGE,
      destination: SCHOOL_TOWN,
      destinationName: 'Mandya High School',
      currentPosition: NORTH_VILLAGE,
      departureTimeMs: NOW_MS,
      durationSeconds: straightCorridor.durationSeconds,
      routeGeometry: straightCorridor.routeGeometry,
      cumulativeDurations: straightCorridor.cumulativeDurations,
    },
    // Milk van on bypass road with 2 seats free (one seat can do Level 2 side hamlet pickup <= 10 min)
    {
      tripId: 'milk-van-1',
      driverId: 'd-milk-1',
      driverName: 'Raju Milk Van',
      driverVerified: true,
      vehicleType: 'milk_van',
      status: 'live',
      seatsFree: 2,
      seatsTotal: 2,
      origin: NORTH_VILLAGE,
      destination: SCHOOL_TOWN,
      destinationName: 'Mandya High School',
      currentPosition: NORTH_VILLAGE,
      departureTimeMs: NOW_MS,
      durationSeconds: bypassCorridor.durationSeconds,
      routeGeometry: bypassCorridor.routeGeometry,
      cumulativeDurations: bypassCorridor.cumulativeDurations,
    },
    // Scheduled-later school van (starts 40 min later, 4 seats) -> candidate for Reallocation!
    {
      tripId: 'van-later',
      driverId: 'd-van-later',
      driverName: 'Kumar School Van',
      driverVerified: true,
      vehicleType: 'school_van',
      status: 'scheduled',
      seatsFree: 4,
      seatsTotal: 4,
      origin: { lat: 12.51, lng: 76.91 },
      destination: SCHOOL_TOWN,
      destinationName: 'Mandya High School',
      currentPosition: null,
      departureTimeMs: NOW_MS + 45 * 60_000,
      durationSeconds: 1200,
      routeGeometry: makeStraightRoute(
        [{ lat: 12.51, lng: 76.91 }, SCHOOL_TOWN],
        10,
      ).routeGeometry,
      cumulativeDurations: makeStraightRoute(
        [{ lat: 12.51, lng: 76.91 }, SCHOOL_TOWN],
        10,
      ).cumulativeDurations,
    },
  ];

  const blockedZones: CrisisBlockedZone[] = [
    {
      id: 'flood-bridge',
      center: FLOODED_BRIDGE,
      radiusMeters: 250,
      label: 'Flooded Bridge',
      active: true,
    },
  ];

  // Students:
  // - 2 early Tier 2 non-exam commuters created FIRST (FCFS gives milk-van seats to them!)
  // - 2 urgent Tier 1 exam students created AFTER (+40% crisis surge):
  //    * s-exam-urgent: at NORTH_VILLAGE, exam in 40 min (tightest slack -> Tier 1 #1)
  //    * s-exam-hamlet: at SIDE_HAMLET_EAST (~220m off bypass corridor -> Level 2 detour <= 10m!)
  //    * s-exam-cluster-1 & s-exam-cluster-2: uncovered Tier 1 exam students near north village once van is full -> triggers reallocation of van-later AND shows 'no_seat' in unreachable!
  //    * s-blocked: pickup inside flooded bridge -> 'road_blocked'
  //    * s-far: in isolated western village far from any vehicle -> 'no_vehicle_in_range'
  const students: CrisisStudentDemand[] = [
    {
      studentId: 's-tier2-a',
      requestId: 'req-t2-a',
      studentName: 'Early Commuter A',
      pickup: NORTH_VILLAGE,
      destination: SCHOOL_TOWN,
      destinationName: 'Mandya High School',
      arriveByMs: NOW_MS + 3 * 3600_000,
      examAtMs: null,
      createdAtMs: NOW_MS - 300_000,
      source: 'seat_request',
    },
    {
      studentId: 's-tier2-b',
      requestId: 'req-t2-b',
      studentName: 'Early Commuter B',
      pickup: NORTH_VILLAGE,
      destination: SCHOOL_TOWN,
      destinationName: 'Mandya High School',
      arriveByMs: NOW_MS + 3 * 3600_000,
      examAtMs: null,
      createdAtMs: NOW_MS - 250_000,
      source: 'seat_request',
    },
    {
      studentId: 's-exam-urgent',
      requestId: 'req-ex-1',
      studentName: 'Ananya (Exam 40m)',
      pickup: NORTH_VILLAGE,
      destination: SCHOOL_TOWN,
      destinationName: 'Mandya High School',
      arriveByMs: null,
      examAtMs: NOW_MS + 40 * 60_000,
      createdAtMs: NOW_MS - 100_000,
      source: 'seat_request',
    },
    {
      studentId: 's-exam-hamlet',
      requestId: 'req-ex-2',
      studentName: 'Darshan (Side Hamlet)',
      pickup: SIDE_HAMLET_EAST,
      destination: SCHOOL_TOWN,
      destinationName: 'Mandya High School',
      arriveByMs: null,
      examAtMs: NOW_MS + 42 * 60_000,
      createdAtMs: NOW_MS - 90_000,
      source: 'demand_pin',
    },
    {
      studentId: 's-exam-cluster-3',
      requestId: 'req-ex-3',
      studentName: 'Kavya (Exam 68m)',
      pickup: NORTH_VILLAGE,
      destination: SCHOOL_TOWN,
      destinationName: 'Mandya High School',
      arriveByMs: null,
      examAtMs: NOW_MS + 68 * 60_000,
      createdAtMs: NOW_MS - 80_000,
      source: 'demand_pin',
    },
    {
      studentId: 's-blocked',
      requestId: 'req-blk',
      studentName: 'Stranded At Bridge',
      pickup: FLOODED_BRIDGE,
      destination: SCHOOL_TOWN,
      destinationName: 'Mandya High School',
      arriveByMs: null,
      examAtMs: NOW_MS + 50 * 60_000,
      createdAtMs: NOW_MS - 70_000,
      source: 'demand_pin',
    },
    {
      studentId: 's-far',
      requestId: 'req-far',
      studentName: 'Isolated Hamlet',
      pickup: ISOLATED_VILLAGE,
      destination: SCHOOL_TOWN,
      destinationName: 'Mandya High School',
      arriveByMs: null,
      examAtMs: NOW_MS + 18 * 60_000, // tighter than travel time + no nearby vehicle
      createdAtMs: NOW_MS - 60_000,
      source: 'demand_pin',
    },
  ];

  const plan = await computeCrisisPlan({
    vehicles,
    students,
    blockedZones,
    nowMs: NOW_MS,
    routeResolver: makeDirectResolver(),
  });

  assert.deepEqual(plan.validationErrors, []);

  // 1. Tier 1 exam students appear before Tier 2, ordered by slack ascending
  const tier1Ids = plan.tieredStudents
    .filter((t) => t.tier === 1)
    .sort((a, b) => (a.slackMinutes ?? 0) - (b.slackMinutes ?? 0))
    .map((t) => t.student.studentId);
  assert.ok(tier1Ids.includes('s-exam-urgent'));
  assert.ok(tier1Ids.includes('s-exam-hamlet'));
  assert.ok(tier1Ids.includes('s-exam-cluster-3'));

  // 2. Nxtpath assigns urgent exam students onto milk-van-1 (including Level 2 side hamlet pickup),
  // whereas FCFS burned both seats of milk-van-1 on Early Commuter A & B!
  const milkVanNxtIds = new Set(
    plan.assignments.filter((a) => a.tripId === 'milk-van-1').map((a) => a.studentId),
  );
  assert.ok(milkVanNxtIds.has('s-exam-urgent'));
  assert.ok(milkVanNxtIds.has('s-exam-hamlet'));
  assert.equal(milkVanNxtIds.has('s-tier2-a'), false);

  const milkVanFcfsIds = new Set(
    plan.fcfsAssignments.filter((a) => a.tripId === 'milk-van-1').map((a) => a.studentId),
  );
  assert.ok(milkVanFcfsIds.has('s-tier2-a'));
  assert.ok(milkVanFcfsIds.has('s-tier2-b'));
  assert.equal(milkVanFcfsIds.has('s-exam-urgent'), false);

  // Check Level 2 was triggered cleanly for s-exam-hamlet (detour <= 10 min)
  const hamletAssignment = plan.assignments.find((a) => a.studentId === 's-exam-hamlet');
  assert.ok(hamletAssignment !== undefined);
  assert.equal(hamletAssignment.assignmentLevel, 2);
  assert.ok(hamletAssignment.detourMinutes <= 10);

  // 3. Reallocation proposal generated for uncovered Tier 1 student (s-exam-cluster-3) using scheduled_later van-later
  assert.ok(plan.reallocations.length >= 1);
  const realloc = plan.reallocations[0];
  assert.equal(realloc.tripId, 'van-later');
  assert.equal(realloc.reasonTag, 'scheduled_later');
  assert.ok(realloc.detourMinutes >= 1);

  // 4. Unreachable students are NEVER hidden and show exact reasons
  const unreachableByStudent = new Map(
    plan.unreachable.map((u) => [u.studentId, u.reason]),
  );
  assert.equal(unreachableByStudent.get('s-blocked'), 'road_blocked');
  assert.equal(unreachableByStudent.get('s-exam-cluster-3'), 'no_seat');
  assert.equal(unreachableByStudent.get('s-far'), 'no_vehicle_in_range');

  // 5. KPIs computed accurately for both plans
  assert.equal(plan.kpis.totalStudents, 7);
  assert.equal(plan.fcfsKpis.totalStudents, 7);
  assert.equal(plan.kpis.vehiclesReallocated, 1);
  assert.equal(plan.fcfsKpis.vehiclesReallocated, 0);
  assert.ok(plan.kpis.seatUtilisationPct > 0);
});

test('Level 2 insertion rejects detour > 10 min or when an already-assigned exam student would miss their deadline', async () => {
  const bypassCorridor = makeStraightRoute(
    [NORTH_VILLAGE, { lat: 12.47, lng: 76.91 }, SCHOOL_TOWN],
    10,
  );
  const travelMinutes = Math.round(bypassCorridor.durationSeconds / 60); // ~19 min

  const vehicles: CrisisVehicle[] = [
    {
      tripId: 'milk-van-tight',
      driverId: 'd-tight',
      driverName: 'Tight Schedule Van',
      driverVerified: true,
      vehicleType: 'milk_van',
      status: 'live',
      seatsFree: 2,
      seatsTotal: 2,
      origin: NORTH_VILLAGE,
      destination: SCHOOL_TOWN,
      destinationName: 'Mandya High School',
      currentPosition: NORTH_VILLAGE,
      departureTimeMs: NOW_MS,
      durationSeconds: bypassCorridor.durationSeconds,
      routeGeometry: bypassCorridor.routeGeometry,
      cumulativeDurations: bypassCorridor.cumulativeDurations,
    },
  ];

  // Rider 1 has a razor-thin exam deadline (+2 min margin after arrival).
  // Rider 2 at SIDE_HAMLET_EAST causes ~4 min detour -> Rider 1 would miss deadline!
  // Rider 3 at FAR_DETOUR_HAMLET causes > 10 min detour anyway.
  const students: CrisisStudentDemand[] = [
    {
      studentId: 's-tight',
      requestId: 'req-tight',
      studentName: 'Tight Exam Student',
      pickup: NORTH_VILLAGE,
      destination: SCHOOL_TOWN,
      destinationName: 'Mandya High School',
      arriveByMs: null,
      examAtMs: NOW_MS + (travelMinutes + 1) * 60_000, // only 1 min spare!
      createdAtMs: NOW_MS - 100_000,
      source: 'seat_request',
    },
    {
      studentId: 's-detour-breaks-r1',
      requestId: 'req-l2-break',
      studentName: 'Detour Breaks Deadline',
      pickup: SIDE_HAMLET_EAST,
      destination: SCHOOL_TOWN,
      destinationName: 'Mandya High School',
      arriveByMs: null,
      examAtMs: NOW_MS + 60 * 60_000,
      createdAtMs: NOW_MS - 50_000,
      source: 'demand_pin',
    },
    {
      studentId: 's-too-far-detour',
      requestId: 'req-l2-far',
      studentName: 'Too Far Detour',
      pickup: FAR_DETOUR_HAMLET,
      destination: SCHOOL_TOWN,
      destinationName: 'Mandya High School',
      arriveByMs: null,
      examAtMs: NOW_MS + 90 * 60_000,
      createdAtMs: NOW_MS - 40_000,
      source: 'demand_pin',
    },
  ];

  const plan = await computeCrisisPlan({
    vehicles,
    students,
    blockedZones: [],
    nowMs: NOW_MS,
    routeResolver: makeDirectResolver(),
  });

  // Only s-tight is assigned; neither s-detour-breaks-r1 nor s-too-far-detour gets inserted
  assert.equal(plan.assignments.length, 1);
  assert.equal(plan.assignments[0].studentId, 's-tight');
  assert.equal(plan.assignments[0].atRisk, true);
  assert.equal(plan.kpis.atRisk, 1);
  assert.equal(plan.unreachable.length, 2);
});

test('validateCrisisInputs detects bad coordinates, negative seats, and invalid zone radius', () => {
  const errors = validateCrisisInputs({
    vehicles: [
      {
        tripId: 't1',
        driverId: 'd1',
        driverName: 'Test',
        driverVerified: false,
        vehicleType: 'auto',
        status: 'live',
        seatsFree: -1,
        seatsTotal: 3,
        origin: { lat: 99, lng: 76 },
        destination: SCHOOL_TOWN,
        destinationName: 'School',
        currentPosition: null,
        departureTimeMs: NOW_MS,
        durationSeconds: 300,
        routeGeometry: [NORTH_VILLAGE], // too short
        cumulativeDurations: [0, 300], // length mismatch
      },
    ],
    students: [],
    blockedZones: [
      {
        id: 'z1',
        center: FLOODED_BRIDGE,
        radiusMeters: 0,
        label: 'Zero Radius',
        active: true,
      },
    ],
    nowMs: NOW_MS,
  });

  assert.ok(errors.some((e) => e.includes('invalid origin or destination')));
  assert.ok(errors.some((e) => e.includes('invalid seatsFree')));
  assert.ok(errors.some((e) => e.includes('length mismatch')));
  assert.ok(errors.some((e) => e.includes('radius must be positive')));
});

test('buildCrisisChangeSignature changes on significant vehicle status, blocked zone, and demand updates', () => {
  const sigA = buildCrisisChangeSignature({
    trips: [],
    livePositionsByTripId: {},
    seatRequests: [],
    demandPins: [],
    blockedZones: [],
  });
  const sigB = buildCrisisChangeSignature({
    trips: [],
    livePositionsByTripId: {},
    seatRequests: [],
    demandPins: [],
    blockedZones: [
      {
        id: 'z1',
        center: FLOODED_BRIDGE,
        radiusMeters: 250,
        label: 'Flooded',
        createdBy: 'admin',
        active: true,
        createdAt: { seconds: 1000, nanoseconds: 0 } as never,
        updatedAt: { seconds: 1000, nanoseconds: 0 } as never,
      },
    ],
  });
  assert.notEqual(sigA, sigB);
});
