import test from 'node:test';
import assert from 'node:assert/strict';
import type { LivePosition, Trip, TripReport } from '../types/firestore';
import { evaluateTripDisruption, findPlanBAlternatives } from './disruption';

function makeTs(ms: number) {
  return {
    toMillis: () => ms,
    seconds: Math.floor(ms / 1000),
    nanoseconds: 0,
  } as unknown as Trip['createdAt'];
}

function makeTrip(overrides: Partial<Trip> & { id: string }): Trip {
  const now = 1_700_000_000_000;
  return {
    driverId: `driver-${overrides.id}`,
    driverName: 'Ramesh',
    driverVerified: true,
    vehicleType: 'milk_van',
    originName: 'Kikkeri',
    originLat: 12.50,
    originLng: 76.87,
    destinationName: 'Mandya High School',
    destinationLat: 12.53,
    destinationLng: 76.90,
    distanceMeters: 4800,
    durationSeconds: 600,
    seatsFree: 3,
    seatsTotal: 4,
    status: 'live',
    routeGeometry: [
      { lat: 12.50, lng: 76.87 },
      { lat: 12.515, lng: 76.885 },
      { lat: 12.53, lng: 76.90 },
    ],
    cumulativeDurations: [0, 300, 600],
    departureTime: makeTs(now),
    createdAt: makeTs(now),
    updatedAt: makeTs(now),
    ...overrides,
  };
}

test('Trigger 1: driver breakdown immediately sets Disruption Mode', () => {
  const nowMs = 1_700_000_000_000;
  const trip = makeTrip({ id: 'bus-1', status: 'disrupted', vehicleType: 'govt_bus' });
  const ev = evaluateTripDisruption({
    trip,
    livePos: null,
    reports: [],
    stopPoint: { lat: 12.515, lng: 76.885 },
    nowMs,
  });
  assert.equal(ev.disrupted, true);
  assert.equal(ev.trigger, 'driver_breakdown');
});

test('Trigger 2: scheduled trip > 10 min late with no fresh live GPS triggers Disruption Mode', () => {
  const nowMs = 1_700_000_000_000;
  const lateTrip = makeTrip({
    id: 'sched-late',
    status: 'scheduled',
    departureTime: makeTs(nowMs - 12 * 60_000),
  });

  const evLate = evaluateTripDisruption({
    trip: lateTrip,
    livePos: null,
    reports: [],
    stopPoint: { lat: 12.515, lng: 76.885 },
    nowMs,
  });
  assert.equal(evLate.disrupted, true);
  assert.equal(evLate.trigger, 'scheduled_late');
  assert.equal(evLate.lateMinutes, 12);

  // Within 10 minutes should NOT trigger
  const onTimeTrip = makeTrip({
    id: 'sched-ok',
    status: 'scheduled',
    departureTime: makeTs(nowMs - 8 * 60_000),
  });
  const evOk = evaluateTripDisruption({
    trip: onTimeTrip,
    livePos: null,
    reports: [],
    stopPoint: { lat: 12.515, lng: 76.885 },
    nowMs,
  });
  assert.equal(evOk.disrupted, false);
});

test('Trigger 3: 2+ distinct students reporting bus_no_show near stop trigger Disruption Mode', () => {
  const nowMs = 1_700_000_000_000;
  const stop = { lat: 12.515, lng: 76.885 };
  const trip = makeTrip({ id: 'bus-2', status: 'live', vehicleType: 'govt_bus' });

  const oneReport: TripReport[] = [
    {
      id: 'rep-1',
      tripId: 'bus-2',
      reporterId: 'stu-1',
      stopLat: 12.5151,
      stopLng: 76.8851,
      reason: 'bus_no_show',
      createdAt: makeTs(nowMs - 60_000),
    },
    // Duplicate from same student should still count as 1
    {
      id: 'rep-1b',
      tripId: 'bus-2',
      reporterId: 'stu-1',
      stopLat: 12.5151,
      stopLng: 76.8851,
      reason: 'bus_no_show',
      createdAt: makeTs(nowMs - 30_000),
    },
  ];

  const ev1 = evaluateTripDisruption({ trip, livePos: null, reports: oneReport, stopPoint: stop, nowMs });
  assert.equal(ev1.disrupted, false);
  assert.equal(ev1.noShowReportCount, 1);

  const twoReports: TripReport[] = [
    ...oneReport,
    {
      id: 'rep-2',
      tripId: 'bus-2',
      reporterId: 'stu-2',
      stopLat: 12.5152,
      stopLng: 76.8852,
      reason: 'bus_no_show',
      createdAt: makeTs(nowMs - 10_000),
    },
  ];

  const ev2 = evaluateTripDisruption({ trip, livePos: null, reports: twoReports, stopPoint: stop, nowMs });
  assert.equal(ev2.disrupted, true);
  assert.equal(ev2.trigger, 'student_no_show');
  assert.equal(ev2.noShowReportCount, 2);
});

test('findPlanBAlternatives excludes disrupted and late trips and returns healthy backup ride', () => {
  const nowMs = 1_700_000_000_000;
  const disruptedTrip = makeTrip({ id: 'broken-bus', status: 'disrupted', vehicleType: 'govt_bus' });
  const lateScheduled = makeTrip({
    id: 'late-sched',
    status: 'scheduled',
    departureTime: makeTs(nowMs - 15 * 60_000),
  });
  const backupMilkVan = makeTrip({ id: 'backup-milk', status: 'live', vehicleType: 'milk_van', seatsFree: 2 });

  const livePositionsByTripId: Record<string, LivePosition | undefined> = {
    'backup-milk': {
      tripId: 'backup-milk',
      driverId: 'driver-backup-milk',
      lat: 12.502,
      lng: 76.872,
      accuracy: 10,
      updatedAt: makeTs(nowMs - 5_000),
    },
  };

  const res = findPlanBAlternatives({
    disruptedTripId: 'broken-bus',
    trips: [disruptedTrip, lateScheduled, backupMilkVan],
    livePositionsByTripId,
    reports: [],
    pickup: { lat: 12.515, lng: 76.885 },
    destination: { lat: 12.53, lng: 76.90 },
    nowMs,
  });

  assert.equal(res.options.length, 1);
  assert.equal(res.options[0].trip.id, 'backup-milk');
});
