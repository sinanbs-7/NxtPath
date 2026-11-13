import test from 'node:test';
import assert from 'node:assert/strict';
import { Timestamp } from 'firebase/firestore';
import {
  computeTicketProgress,
  isLivePositionFresh,
  matchAndRankRides,
  projectPointToRoute,
} from './matchRides';
import type { LivePosition, SeatRequest, Trip } from '../types/firestore';

function makeTrip(overrides: Partial<Trip> & { id: string }): Trip {
  const now = Timestamp.fromMillis(1_700_000_000_000);
  return {
    driverId: 'driver-1',
    driverName: 'Ramesh',
    driverVerified: true,
    vehicleType: 'milk_van',
    originName: 'Village A',
    originLat: 12.50,
    originLng: 76.90,
    destinationName: 'Mandya High School',
    destinationLat: 12.54,
    destinationLng: 76.90,
    distanceMeters: 4440,
    durationSeconds: 600,
    seatsFree: 3,
    seatsTotal: 4,
    status: 'live',
    routeGeometry: [
      { lat: 12.50, lng: 76.90 },
      { lat: 12.52, lng: 76.90 },
      { lat: 12.54, lng: 76.90 },
    ],
    cumulativeDurations: [0, 300, 600],
    departureTime: now,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

test('projectPointToRoute snaps to nearest segment and interpolates duration', () => {
  const route = [
    { lat: 12.50, lng: 76.90 },
    { lat: 12.52, lng: 76.90 },
    { lat: 12.54, lng: 76.90 },
  ];
  const proj = projectPointToRoute({ lat: 12.51, lng: 76.901 }, route, [0, 300, 600]);
  assert.ok(proj);
  assert.ok(proj.distanceMeters > 80 && proj.distanceMeters < 150);
  assert.ok(Math.abs(proj.timeSeconds - 150) < 5);
  assert.ok(proj.progress > 0.45 && proj.progress < 0.55);
});

test('isLivePositionFresh treats > 90s old updates as offline', () => {
  const baseMs = 1_700_000_100_000;
  const fresh: LivePosition = {
    tripId: 't1',
    driverId: 'd1',
    lat: 12.50,
    lng: 76.90,
    accuracy: 10,
    updatedAt: Timestamp.fromMillis(baseMs - 30_000),
  };
  const stale: LivePosition = {
    ...fresh,
    updatedAt: Timestamp.fromMillis(baseMs - 95_000),
  };
  assert.equal(isLivePositionFresh(fresh, baseMs), true);
  assert.equal(isLivePositionFresh(stale, baseMs), false);
});

test('matchAndRankRides filters out wrong direction, full seats, and ranks live verified close trips first with reasons', () => {
  const nowMs = new Date(2026, 10, 12, 8, 0, 0).getTime();

  const bestLiveTrip = makeTrip({
    id: 'best-live',
    driverName: 'Ramesh',
    driverVerified: true,
    vehicleType: 'milk_van',
    seatsFree: 3,
    createdAt: Timestamp.fromMillis(nowMs - 60_000),
  });

  const fartherScheduledTrip = makeTrip({
    id: 'farther-sched',
    driverId: 'driver-2',
    driverName: 'Suresh',
    driverVerified: false,
    vehicleType: 'auto',
    status: 'scheduled',
    departureTime: Timestamp.fromMillis(nowMs + 15 * 60_000),
    routeGeometry: [
      { lat: 12.50, lng: 76.905 },
      { lat: 12.52, lng: 76.905 },
      { lat: 12.54, lng: 76.905 },
    ],
  });

  const reverseTrip = makeTrip({
    id: 'reverse-trip',
    driverId: 'driver-3',
    routeGeometry: [
      { lat: 12.54, lng: 76.90 },
      { lat: 12.52, lng: 76.90 },
      { lat: 12.50, lng: 76.90 },
    ],
  });

  const fullTrip = makeTrip({
    id: 'full-trip',
    driverId: 'driver-4',
    seatsFree: 0,
  });

  const passedPickupTrip = makeTrip({
    id: 'already-passed',
    driverId: 'driver-5',
  });

  const livePositions: Record<string, LivePosition> = {
    'best-live': {
      tripId: 'best-live',
      driverId: 'driver-1',
      lat: 12.505,
      lng: 76.90,
      accuracy: 10,
      updatedAt: Timestamp.fromMillis(nowMs - 4_000),
    },
    'already-passed': {
      tripId: 'already-passed',
      driverId: 'driver-5',
      lat: 12.53,
      lng: 76.90,
      accuracy: 10,
      updatedAt: Timestamp.fromMillis(nowMs - 5_000),
    },
  };

  const result = matchAndRankRides({
    trips: [fartherScheduledTrip, reverseTrip, fullTrip, passedPickupTrip, bestLiveTrip],
    livePositionsByTripId: livePositions,
    pickup: { lat: 12.515, lng: 76.9005 },
    destination: { lat: 12.539, lng: 76.90 },
    arriveByHHmm: '08:30',
    nowMs,
  });

  assert.equal(result.options.length, 2);
  assert.equal(result.options[0].trip.id, 'best-live');
  assert.equal(result.options[0].rank, 1);
  assert.equal(result.options[1].trip.id, 'farther-sched');
  assert.equal(result.options[1].rank, 2);
  assert.ok(result.options[0].rankingReasons.some((r) => r.code === 'live_online'));
  assert.ok(result.options[0].rankingReasons.some((r) => r.code === 'before_bell'));
  assert.ok(result.options[0].rankingReasons.some((r) => r.code === 'verified_driver'));
  assert.ok((result.options[0].minutesBeforeBell ?? 0) > 10);
  assert.equal(result.nearbyLiveDriversCount, 4);
});

test('computeTicketProgress transitions through waiting, arriving, on_the_way, and reached_school', () => {
  const nowMs = 1_700_000_000_000;
  const trip = makeTrip({ id: 't1', createdAt: Timestamp.fromMillis(nowMs - 20_000) });
  const req: SeatRequest = {
    id: 'r1',
    tripId: 't1',
    studentId: 's1',
    driverId: 'driver-1',
    studentName: 'Ananya',
    pickupLat: 12.52,
    pickupLng: 76.90,
    destinationName: 'Mandya High School',
    status: 'pending',
    createdAt: Timestamp.fromMillis(nowMs) as unknown as Timestamp,
    updatedAt: Timestamp.fromMillis(nowMs) as unknown as Timestamp,
  };

  assert.equal(computeTicketProgress(req, trip, null, nowMs).stage, 'waiting');

  const acceptedReq: SeatRequest = { ...req, status: 'accepted', rideCode: '4821' };
  const arrivingPos: LivePosition = {
    tripId: 't1',
    driverId: 'driver-1',
    lat: 12.51,
    lng: 76.90,
    accuracy: 8,
    updatedAt: Timestamp.fromMillis(nowMs - 3_000),
  };
  const arriving = computeTicketProgress(acceptedReq, trip, arrivingPos, nowMs);
  assert.equal(arriving.stage, 'arriving');
  assert.equal(arriving.countdownMinutes, 3); // 150s -> 3 min

  const onTheWayPos: LivePosition = {
    ...arrivingPos,
    lat: 12.53,
  };
  const onTheWay = computeTicketProgress(acceptedReq, trip, onTheWayPos, nowMs);
  assert.equal(onTheWay.stage, 'on_the_way');

  const reachedPos: LivePosition = {
    ...arrivingPos,
    lat: 12.5395,
  };
  const reached = computeTicketProgress(acceptedReq, trip, reachedPos, nowMs);
  assert.equal(reached.stage, 'reached_school');
});
