import type { Timestamp } from 'firebase/firestore';

export type Language = 'en' | 'kn' | 'hi';

export type UserRole = 'student' | 'driver' | 'teacher';

export type VehicleType =
  | 'govt_bus'
  | 'private_bus'
  | 'school_van'
  | 'milk_van'
  | 'ration_truck'
  | 'tractor'
  | 'auto'
  | 'other';

export type TripStatus = 'scheduled' | 'live' | 'completed' | 'disrupted' | 'unavailable';

export type SeatRequestStatus = 'pending' | 'accepted' | 'declined' | 'completed';

export type ReportReason = 'bus_no_show' | 'breakdown' | 'full';

export type NotificationKind = 'seat_update' | 'disruption' | 'verification' | 'reallocation';

export interface LatLngPoint {
  lat: number;
  lng: number;
}

export interface SavedSchool {
  name: string;
  address: string;
  lat: number;
  lng: number;
}

export interface UserProfile {
  uid: string;
  displayName: string;
  role: UserRole;
  language: Language;
  verifiedDriver: boolean;
  onboardingComplete: boolean;
  savedSchoolName?: string;
  savedSchoolAddress?: string;
  savedSchoolLat?: number;
  savedSchoolLng?: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface UserPrivateContact {
  uid: string;
  email?: string;
  updatedAt: Timestamp;
}

export interface Vehicle {
  id: string;
  ownerId: string;
  vehicleType: VehicleType;
  label: string;
  defaultSeats: number;
  verified: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface Trip {
  id: string;
  driverId: string;
  driverName: string;
  driverVerified: boolean;
  vehicleType: VehicleType;
  originName: string;
  originLat: number;
  originLng: number;
  destinationName: string;
  destinationLat: number;
  destinationLng: number;
  distanceMeters: number;
  durationSeconds: number;
  seatsFree: number;
  seatsTotal: number;
  status: TripStatus;
  routeGeometry: LatLngPoint[];
  cumulativeDurations: number[];
  departureTime: Timestamp;
  isDrill?: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface LivePosition {
  tripId: string;
  driverId: string;
  lat: number;
  lng: number;
  accuracy: number;
  heading?: number;
  speed?: number;
  isDrill?: boolean;
  updatedAt: Timestamp;
}

export interface SeatRequest {
  id: string;
  tripId: string;
  studentId: string;
  driverId: string;
  studentName: string;
  pickupLat: number;
  pickupLng: number;
  destinationName: string;
  destinationLat?: number;
  destinationLng?: number;
  arriveBy?: string;
  examAt?: Timestamp;
  isDrill?: boolean;
  rideCode?: string;
  status: SeatRequestStatus;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface DemandPin {
  id: string;
  studentId: string;
  lat: number;
  lng: number;
  destinationName: string;
  destinationLat?: number;
  destinationLng?: number;
  arriveBy?: string;
  examAt?: Timestamp;
  isDrill?: boolean;
  active: boolean;
  offeredByDriverId?: string;
  offeredByDriverName?: string;
  offeredTripId?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface TripReport {
  id: string;
  tripId: string;
  reporterId: string;
  stopLat: number;
  stopLng: number;
  reason: ReportReason;
  createdAt: Timestamp;
}

export type NotificationActionStatus = 'pending' | 'accepted' | 'declined';

export interface AppNotification {
  id: string;
  userId: string;
  title: string;
  body: string;
  kind: NotificationKind;
  read: boolean;
  actionStatus?: NotificationActionStatus;
  tripId?: string;
  clusterPlace?: string;
  studentCount?: number;
  isDrill?: boolean;
  respondedAt?: Timestamp;
  createdAt: Timestamp;
}

export interface AdminRecord {
  uid: string;
  grantedAt: Timestamp;
}

export interface BlockedZone {
  id: string;
  center: LatLngPoint;
  radiusMeters: number;
  label: string;
  createdBy: string;
  active: boolean;
  isDrill?: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface CrisisKpiSummary {
  totalStudents: number;
  examStudents: number;
  onTime: number;
  atRisk: number;
  cannotReach: number;
  seatUtilisationPct: number;
  vehiclesReallocated: number;
  averageSlackMinutes: number;
}

export interface CrisisAssignmentRecord {
  studentId: string;
  requestId: string;
  studentName: string;
  tripId: string;
  driverId: string;
  driverName: string;
  tier: 1 | 2;
  assignmentLevel: 1 | 2;
  etaArrivalMs: number;
  deadlineMs: number | null;
  slackAtArrivalMinutes: number | null;
  atRisk: boolean;
  detourMinutes: number;
  routeStatus: 'clear' | 'detoured' | 'no_road_path';
}

export interface CrisisUnreachableRecord {
  studentId: string;
  requestId: string;
  studentName: string;
  tier: 1 | 2;
  reason: 'no_seat' | 'road_blocked' | 'no_vehicle_in_range';
  detail: string;
}

export interface CrisisReallocationRecord {
  id: string;
  tripId: string;
  driverId: string;
  driverName: string;
  vehicleType: VehicleType;
  currentStatus: TripStatus;
  reasonTag: 'idle' | 'scheduled_later' | 'tier2_only';
  clusterPlace: string;
  clusterCenter: LatLngPoint;
  studentIds: string[];
  studentCount: number;
  detourMinutes: number;
  approved?: boolean;
}

export interface CrisisPlanDocument {
  id: string;
  createdBy: string;
  createdAt: Timestamp;
  isDrill?: boolean;
  assignments: CrisisAssignmentRecord[];
  unreachable: CrisisUnreachableRecord[];
  reallocations: CrisisReallocationRecord[];
  kpis: CrisisKpiSummary;
  fcfsKpis: CrisisKpiSummary;
  validationErrors: string[];
}
