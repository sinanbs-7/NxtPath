import type { OsrmRouteResult } from '../map/osrm';
import type {
  BlockedZone,
  CrisisAssignmentRecord,
  CrisisKpiSummary,
  CrisisReallocationRecord,
  CrisisUnreachableRecord,
  LatLngPoint,
  TripStatus,
  VehicleType,
} from '../types/firestore';

export type RouteCheckStatus = 'clear' | 'detoured' | 'no_road_path';

export interface CrisisBlockedZone {
  id: string;
  center: LatLngPoint;
  radiusMeters: number;
  label: string;
  active: boolean;
}

export interface BlockedZoneRouteOutcome {
  status: RouteCheckStatus;
  route: OsrmRouteResult | null;
  blockedByZoneIds: string[];
  usedWaypoint?: LatLngPoint;
}

export interface CrisisStudentDemand {
  studentId: string;
  requestId: string;
  studentName: string;
  pickup: LatLngPoint;
  destination: LatLngPoint;
  destinationName: string;
  arriveByMs: number | null;
  examAtMs: number | null;
  createdAtMs: number;
  isDrill?: boolean;
  source: 'seat_request' | 'demand_pin';
}

export interface CrisisVehicle {
  tripId: string;
  driverId: string;
  driverName: string;
  driverVerified: boolean;
  vehicleType: VehicleType;
  status: TripStatus;
  seatsFree: number;
  seatsTotal: number;
  origin: LatLngPoint;
  destination: LatLngPoint;
  destinationName: string;
  currentPosition: LatLngPoint | null;
  departureTimeMs: number;
  durationSeconds: number;
  routeGeometry: LatLngPoint[];
  cumulativeDurations: number[];
  isDrill?: boolean;
}

export interface TieredStudent {
  student: CrisisStudentDemand;
  tier: 1 | 2;
  deadlineMs: number | null;
  minTravelSeconds: number | null;
  latestDepartureMs: number | null;
  slackMinutes: number | null;
  directRouteStatus: RouteCheckStatus;
  blockedByZoneIds: string[];
}

export type CrisisRouteResolver = (
  origin: LatLngPoint,
  dest: LatLngPoint,
  activeZones: CrisisBlockedZone[],
) => Promise<BlockedZoneRouteOutcome>;

export interface CrisisEngineInput {
  vehicles: CrisisVehicle[];
  students: CrisisStudentDemand[];
  blockedZones: Array<CrisisBlockedZone | BlockedZone>;
  nowMs: number;
  routeResolver?: CrisisRouteResolver;
}

export interface CrisisPlanResult {
  computedAtMs: number;
  tieredStudents: TieredStudent[];
  assignments: CrisisAssignmentRecord[];
  unreachable: CrisisUnreachableRecord[];
  reallocations: CrisisReallocationRecord[];
  kpis: CrisisKpiSummary;
  fcfsAssignments: CrisisAssignmentRecord[];
  fcfsUnreachable: CrisisUnreachableRecord[];
  fcfsKpis: CrisisKpiSummary;
  validationErrors: string[];
}
