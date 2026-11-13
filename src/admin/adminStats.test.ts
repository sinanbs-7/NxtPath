import test from 'node:test';
import assert from 'node:assert/strict';
import type { Timestamp } from 'firebase/firestore';
import { computeAdminStats } from './adminStats';
import type {
  DemandPin,
  SeatRequest,
  Trip,
  TripReport,
  UserProfile,
} from '../types/firestore';

function fakeTs(ms: number): Timestamp {
  return {
    seconds: Math.floor(ms / 1000),
    nanoseconds: 0,
    toMillis: () => ms,
  } as unknown as Timestamp;
}

test('computeAdminStats returns honest zeros on empty Firestore collections', () => {
  const stats = computeAdminStats({
    users: [],
    trips: [],
    seatRequests: [],
    demandPins: [],
    reports: [],
  });

  assert.equal(stats.totalUsers, 0);
  assert.equal(stats.driverCount, 0);
  assert.equal(stats.verifiedDriversCount, 0);
  assert.equal(stats.unverifiedDriversCount, 0);
  assert.equal(stats.liveTripsCount, 0);
  assert.equal(stats.totalRequestsCount, 0);
  assert.equal(stats.activeDemandPinsCount, 0);
  assert.equal(stats.reportsCount, 0);
  assert.deepEqual(stats.activeVehicleBreakdown, []);
  assert.deepEqual(stats.driverQueue, []);
});

test('computeAdminStats computes exact counts and orders unverified drivers first', () => {
  const users: UserProfile[] = [
    {
      uid: 'u1',
      displayName: 'Asha',
      role: 'student',
      language: 'kn',
      verifiedDriver: false,
      onboardingComplete: true,
      createdAt: fakeTs(1000),
      updatedAt: fakeTs(1000),
    },
    {
      uid: 'd1',
      displayName: 'Ramesh',
      role: 'driver',
      language: 'kn',
      verifiedDriver: true,
      onboardingComplete: true,
      createdAt: fakeTs(1000),
      updatedAt: fakeTs(5000),
    },
    {
      uid: 'd2',
      displayName: 'Suresh',
      role: 'driver',
      language: 'en',
      verifiedDriver: false,
      onboardingComplete: true,
      createdAt: fakeTs(2000),
      updatedAt: fakeTs(9000),
    },
    {
      uid: 't1',
      displayName: 'Meena',
      role: 'teacher',
      language: 'hi',
      verifiedDriver: false,
      onboardingComplete: true,
      createdAt: fakeTs(3000),
      updatedAt: fakeTs(3000),
    },
  ];

  const trips: Trip[] = [
    {
      id: 'tr1',
      driverId: 'd1',
      driverName: 'Ramesh',
      driverVerified: true,
      vehicleType: 'milk_van',
      originName: 'A',
      originLat: 15.1,
      originLng: 75.1,
      destinationName: 'School',
      destinationLat: 15.2,
      destinationLng: 75.2,
      distanceMeters: 4000,
      durationSeconds: 600,
      seatsFree: 3,
      seatsTotal: 5,
      status: 'live',
      routeGeometry: [
        { lat: 15.1, lng: 75.1 },
        { lat: 15.2, lng: 75.2 },
      ],
      cumulativeDurations: [0, 600],
      departureTime: fakeTs(1000),
      createdAt: fakeTs(1000),
      updatedAt: fakeTs(1000),
    },
    {
      id: 'tr2',
      driverId: 'd2',
      driverName: 'Suresh',
      driverVerified: false,
      vehicleType: 'auto',
      originName: 'B',
      originLat: 15.1,
      originLng: 75.1,
      destinationName: 'School',
      destinationLat: 15.2,
      destinationLng: 75.2,
      distanceMeters: 2000,
      durationSeconds: 300,
      seatsFree: 2,
      seatsTotal: 2,
      status: 'disrupted',
      routeGeometry: [
        { lat: 15.1, lng: 75.1 },
        { lat: 15.2, lng: 75.2 },
      ],
      cumulativeDurations: [0, 300],
      departureTime: fakeTs(1000),
      createdAt: fakeTs(1000),
      updatedAt: fakeTs(1000),
    },
  ];

  const seatRequests: SeatRequest[] = [
    {
      id: 'sr1',
      tripId: 'tr1',
      studentId: 'u1',
      driverId: 'd1',
      studentName: 'Asha',
      pickupLat: 15.15,
      pickupLng: 75.15,
      destinationName: 'School',
      rideCode: '4812',
      status: 'accepted',
      createdAt: fakeTs(1000),
      updatedAt: fakeTs(2000),
    },
    {
      id: 'sr2',
      tripId: 'tr1',
      studentId: 'u2',
      driverId: 'd1',
      studentName: 'Kiran',
      pickupLat: 15.16,
      pickupLng: 75.16,
      destinationName: 'School',
      status: 'pending',
      createdAt: fakeTs(1500),
      updatedAt: fakeTs(1500),
    },
  ];

  const demandPins: DemandPin[] = [
    {
      id: 'dp1',
      studentId: 'u1',
      lat: 15.1,
      lng: 75.1,
      destinationName: 'School',
      active: true,
      offeredTripId: 'tr1',
      createdAt: fakeTs(1000),
      updatedAt: fakeTs(2000),
    },
    {
      id: 'dp2',
      studentId: 'u2',
      lat: 15.12,
      lng: 75.12,
      destinationName: 'School',
      active: false,
      createdAt: fakeTs(1000),
      updatedAt: fakeTs(2000),
    },
  ];

  const reports: TripReport[] = [
    {
      id: 'rep1',
      tripId: 'tr2',
      reporterId: 'u1',
      stopLat: 15.15,
      stopLng: 75.15,
      reason: 'bus_no_show',
      createdAt: fakeTs(2000),
    },
  ];

  const stats = computeAdminStats({ users, trips, seatRequests, demandPins, reports });

  assert.equal(stats.totalUsers, 4);
  assert.equal(stats.studentCount, 1);
  assert.equal(stats.driverCount, 2);
  assert.equal(stats.teacherCount, 1);
  assert.equal(stats.verifiedDriversCount, 1);
  assert.equal(stats.unverifiedDriversCount, 1);
  assert.equal(stats.driverQueue[0].uid, 'd2');
  assert.equal(stats.driverQueue[1].uid, 'd1');
  assert.equal(stats.liveTripsCount, 1);
  assert.equal(stats.disruptedTripsCount, 1);
  assert.equal(stats.activeSeatsTotal, 5);
  assert.equal(stats.activeSeatsFree, 3);
  assert.equal(stats.acceptedRequestsCount, 1);
  assert.equal(stats.pendingRequestsCount, 1);
  assert.equal(stats.activeDemandPinsCount, 1);
  assert.equal(stats.offeredDemandPinsCount, 1);
  assert.equal(stats.reportsCount, 1);
  assert.deepEqual(stats.activeVehicleBreakdown, [{ vehicleType: 'milk_van', count: 1 }]);
});
