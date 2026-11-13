import type { LatLngPoint, VehicleType } from '../types/firestore';

export interface SurgeStudentSeed {
  studentId: string;
  studentName: string;
  rawPickup: LatLngPoint;
  destination: LatLngPoint;
  destinationName: string;
  examAtMs: number | null;
  arriveByHHmm: string;
  isDrill: true;
}

export interface DrillVehicleSeed {
  tripId: string;
  driverId: string;
  driverName: string;
  vehicleType: VehicleType;
  seatsTotal: number;
  originName: string;
  origin: LatLngPoint;
  destination: LatLngPoint;
  destinationName: string;
  isDrill: true;
}

export function computeSurgeCount(realStudentCount: number): number {
  const safeCount = Math.max(0, Math.floor(realStudentCount));
  return Math.max(8, Math.ceil(safeCount * 0.4));
}

export function offsetPointByMeters(
  origin: LatLngPoint,
  distanceMeters: number,
  bearingRad: number,
): LatLngPoint {
  const earthRadius = 6371000;
  const latRad = (origin.lat * Math.PI) / 180;
  const dLat = (distanceMeters * Math.cos(bearingRad)) / earthRadius;
  const cosLat = Math.max(0.1, Math.cos(latRad));
  const dLng = (distanceMeters * Math.sin(bearingRad)) / (earthRadius * cosLat);
  return {
    lat: Number((origin.lat + (dLat * 180) / Math.PI).toFixed(6)),
    lng: Number((origin.lng + (dLng * 180) / Math.PI).toFixed(6)),
  };
}

function formatHHmmFromMs(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function buildSurgeStudentSeeds(input: {
  realPickups: Array<{ studentId: string; pickup: LatLngPoint; destination?: LatLngPoint; destinationName?: string }>;
  anchorCenter: LatLngPoint;
  defaultDestination: LatLngPoint;
  defaultDestinationName: string;
  examStartMs: number;
  nowMs: number;
}): SurgeStudentSeed[] {
  const count = computeSurgeCount(input.realPickups.length);
  const examTargetCount = Math.max(1, Math.round(count * 0.6));
  const seeds: SurgeStudentSeed[] = [];

  for (let i = 0; i < count; i += 1) {
    const source = input.realPickups.length > 0 ? input.realPickups[i % input.realPickups.length] : null;
    const basePoint = source ? source.pickup : input.anchorCenter;
    const distMeters = 240 + (i % 5) * 95;
    const bearing = i * 2.399963229728653; // Golden angle spread around real pickup
    const shifted = offsetPointByMeters(basePoint, distMeters, bearing);

    const hasExam = i < examTargetCount;
    // Keep exam students inside the 2-hour Tier 1 window relative to nowMs, anchored near examStartMs
    const twoHoursMs = 2 * 60 * 60 * 1000;
    const clampedExamBase = Math.max(
      input.nowMs + 35 * 60_000,
      Math.min(input.examStartMs - 25 * 60_000, input.nowMs + twoHoursMs - 25 * 60_000),
    );
    const examAtMs = hasExam ? clampedExamBase + (i % 4) * 8 * 60_000 : null;
    const arriveByMs = examAtMs ?? input.nowMs + (140 + (i % 3) * 20) * 60_000;

    seeds.push({
      studentId: `drill-student-${i + 1}`,
      studentName: `Student D-${i + 1} (DRILL)`,
      rawPickup: shifted,
      destination: source?.destination ?? input.defaultDestination,
      destinationName: source?.destinationName || input.defaultDestinationName || 'Government High School',
      examAtMs,
      arriveByHHmm: formatHHmmFromMs(arriveByMs),
      isDrill: true,
    });
  }

  return seeds;
}

export function buildDrillVehicleSeeds(input: {
  anchorCenter: LatLngPoint;
  destination: LatLngPoint;
  destinationName: string;
  batchTag: string;
}): DrillVehicleSeed[] {
  const specs: Array<{
    driverName: string;
    vehicleType: VehicleType;
    seatsTotal: number;
    distMeters: number;
    bearing: number;
    originName: string;
  }> = [
    {
      driverName: 'Drill Van 1 (DRILL)',
      vehicleType: 'school_van',
      seatsTotal: 8,
      distMeters: 1600,
      bearing: 0.7,
      originName: 'North Village Cross (DRILL)',
    },
    {
      driverName: 'Drill Milk Van 2 (DRILL)',
      vehicleType: 'milk_van',
      seatsTotal: 5,
      distMeters: 1900,
      bearing: 3.1,
      originName: 'Dairy Booth Stop (DRILL)',
    },
    {
      driverName: 'Drill Bus 3 (DRILL)',
      vehicleType: 'private_bus',
      seatsTotal: 14,
      distMeters: 2200,
      bearing: 4.9,
      originName: 'Taluk Gate Stand (DRILL)',
    },
  ];

  return specs.map((spec, idx) => ({
    tripId: `drill_trip_${input.batchTag}_${idx + 1}`,
    driverId: `drill_driver_${input.batchTag}_${idx + 1}`,
    driverName: spec.driverName,
    vehicleType: spec.vehicleType,
    seatsTotal: spec.seatsTotal,
    originName: spec.originName,
    origin: offsetPointByMeters(input.anchorCenter, spec.distMeters, spec.bearing),
    destination: input.destination,
    destinationName: input.destinationName || 'Government High School',
    isDrill: true,
  }));
}
