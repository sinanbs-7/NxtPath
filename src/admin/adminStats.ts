import type {
  DemandPin,
  SeatRequest,
  Trip,
  TripReport,
  UserProfile,
  VehicleType,
} from '../types/firestore';

export interface VehicleBreakdownRow {
  vehicleType: VehicleType;
  count: number;
}

export interface AdminComputedStats {
  totalUsers: number;
  studentCount: number;
  driverCount: number;
  teacherCount: number;
  verifiedDriversCount: number;
  unverifiedDriversCount: number;
  totalTripsCount: number;
  liveTripsCount: number;
  scheduledTripsCount: number;
  disruptedTripsCount: number;
  completedTripsCount: number;
  activeSeatsTotal: number;
  activeSeatsFree: number;
  totalRequestsCount: number;
  pendingRequestsCount: number;
  acceptedRequestsCount: number;
  completedRequestsCount: number;
  declinedRequestsCount: number;
  activeDemandPinsCount: number;
  offeredDemandPinsCount: number;
  reportsCount: number;
  activeVehicleBreakdown: VehicleBreakdownRow[];
  driverQueue: UserProfile[];
}

function timestampMillis(ts: unknown): number {
  if (!ts || typeof ts !== 'object') return 0;
  const maybe = ts as { toMillis?: () => number; seconds?: number };
  if (typeof maybe.toMillis === 'function') return maybe.toMillis();
  if (typeof maybe.seconds === 'number') return maybe.seconds * 1000;
  return 0;
}

export function computeAdminStats(input: {
  users: UserProfile[];
  trips: Trip[];
  seatRequests: SeatRequest[];
  demandPins: DemandPin[];
  reports: TripReport[];
}): AdminComputedStats {
  const { users, trips, seatRequests, demandPins, reports } = input;

  let studentCount = 0;
  let driverCount = 0;
  let teacherCount = 0;
  let verifiedDriversCount = 0;
  let unverifiedDriversCount = 0;
  const driverQueue: UserProfile[] = [];

  for (const user of users) {
    if (user.role === 'student') studentCount += 1;
    else if (user.role === 'teacher') teacherCount += 1;
    else if (user.role === 'driver') {
      driverCount += 1;
      if (user.verifiedDriver) {
        verifiedDriversCount += 1;
      } else {
        unverifiedDriversCount += 1;
      }
    }

    if (user.role === 'driver' || user.verifiedDriver) {
      driverQueue.push(user);
    }
  }

  driverQueue.sort((a, b) => {
    if (a.verifiedDriver !== b.verifiedDriver) {
      return a.verifiedDriver ? 1 : -1;
    }
    return timestampMillis(b.updatedAt) - timestampMillis(a.updatedAt);
  });

  let liveTripsCount = 0;
  let scheduledTripsCount = 0;
  let disruptedTripsCount = 0;
  let completedTripsCount = 0;
  let activeSeatsTotal = 0;
  let activeSeatsFree = 0;
  const vehicleCounts = new Map<VehicleType, number>();

  for (const trip of trips) {
    if (trip.status === 'live') {
      liveTripsCount += 1;
      activeSeatsTotal += Math.max(0, trip.seatsTotal);
      activeSeatsFree += Math.max(0, trip.seatsFree);
      vehicleCounts.set(trip.vehicleType, (vehicleCounts.get(trip.vehicleType) ?? 0) + 1);
    } else if (trip.status === 'scheduled') {
      scheduledTripsCount += 1;
      activeSeatsTotal += Math.max(0, trip.seatsTotal);
      activeSeatsFree += Math.max(0, trip.seatsFree);
      vehicleCounts.set(trip.vehicleType, (vehicleCounts.get(trip.vehicleType) ?? 0) + 1);
    } else if (trip.status === 'disrupted') {
      disruptedTripsCount += 1;
    } else if (trip.status === 'completed') {
      completedTripsCount += 1;
    }
  }

  let pendingRequestsCount = 0;
  let acceptedRequestsCount = 0;
  let completedRequestsCount = 0;
  let declinedRequestsCount = 0;

  for (const req of seatRequests) {
    if (req.status === 'pending') pendingRequestsCount += 1;
    else if (req.status === 'accepted') acceptedRequestsCount += 1;
    else if (req.status === 'completed') completedRequestsCount += 1;
    else if (req.status === 'declined') declinedRequestsCount += 1;
  }

  let activeDemandPinsCount = 0;
  let offeredDemandPinsCount = 0;

  for (const pin of demandPins) {
    if (pin.active) {
      activeDemandPinsCount += 1;
      if (pin.offeredTripId) {
        offeredDemandPinsCount += 1;
      }
    }
  }

  const activeVehicleBreakdown: VehicleBreakdownRow[] = Array.from(vehicleCounts.entries())
    .map(([vehicleType, count]) => ({ vehicleType, count }))
    .sort((a, b) => b.count - a.count);

  return {
    totalUsers: users.length,
    studentCount,
    driverCount,
    teacherCount,
    verifiedDriversCount,
    unverifiedDriversCount,
    totalTripsCount: trips.length,
    liveTripsCount,
    scheduledTripsCount,
    disruptedTripsCount,
    completedTripsCount,
    activeSeatsTotal,
    activeSeatsFree,
    totalRequestsCount: seatRequests.length,
    pendingRequestsCount,
    acceptedRequestsCount,
    completedRequestsCount,
    declinedRequestsCount,
    activeDemandPinsCount,
    offeredDemandPinsCount,
    reportsCount: reports.length,
    activeVehicleBreakdown,
    driverQueue,
  };
}
