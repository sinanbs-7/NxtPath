import type { DemandPin, LatLngPoint } from '../types/firestore';

export interface DemandCluster {
  id: string;
  lat: number;
  lng: number;
  count: number;
  pins: DemandPin[];
  primaryDestination: string;
}

export function generateRideCode(randomSource: () => number = Math.random): string {
  const num = Math.floor(1000 + randomSource() * 9000);
  return String(Math.min(9999, Math.max(1000, num)));
}

export function formatElapsed(totalSeconds: number): string {
  const clamped = Math.max(0, Math.floor(totalSeconds));
  const hrs = Math.floor(clamped / 3600);
  const mins = Math.floor((clamped % 3600) / 60);
  const secs = clamped % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  if (hrs > 0) {
    return `${hrs}:${pad(mins)}:${pad(secs)}`;
  }
  return `${pad(mins)}:${pad(secs)}`;
}

export function formatDistance(meters: number): string {
  if (!Number.isFinite(meters) || meters <= 0) return '0 m';
  if (meters < 1000) return `${Math.round(meters)} m`;
  const km = meters / 1000;
  return km >= 10 ? `${Math.round(km)} km` : `${km.toFixed(1)} km`;
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '1 min';
  const totalMins = Math.max(1, Math.round(seconds / 60));
  const hrs = Math.floor(totalMins / 60);
  const mins = totalMins % 60;
  if (hrs === 0) return `${totalMins} min`;
  if (mins === 0) return `${hrs} hr`;
  return `${hrs} hr ${mins} min`;
}

export function resolveDepartureDate(
  mode: 'now' | 'later',
  hhmm: string,
  now: Date = new Date(),
): Date {
  if (mode === 'now') return new Date(now.getTime());
  const parts = hhmm.split(':');
  const h = Number(parts[0]);
  const m = Number(parts[1]);
  if (!Number.isInteger(h) || !Number.isInteger(m) || h < 0 || h > 23 || m < 0 || m > 59) {
    return new Date(now.getTime());
  }
  const target = new Date(now.getTime());
  target.setHours(h, m, 0, 0);
  return target;
}

export function haversineDistanceMeters(a: LatLngPoint, b: LatLngPoint): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s1 = Math.sin(dLat / 2);
  const s2 = Math.sin(dLng / 2);
  const h = s1 * s1 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * s2 * s2;
  return 2 * R * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export function clusterDemandPins(pins: DemandPin[], radiusMeters = 150): DemandCluster[] {
  const activePins = pins.filter((p) => p.active);
  const clusters: DemandCluster[] = [];

  for (const pin of activePins) {
    const match = clusters.find(
      (c) => haversineDistanceMeters({ lat: c.lat, lng: c.lng }, { lat: pin.lat, lng: pin.lng }) <= radiusMeters,
    );
    if (match) {
      match.pins.push(pin);
      const n = match.pins.length;
      match.lat = match.pins.reduce((sum, item) => sum + item.lat, 0) / n;
      match.lng = match.pins.reduce((sum, item) => sum + item.lng, 0) / n;
      match.count = n;
    } else {
      clusters.push({
        id: pin.id,
        lat: pin.lat,
        lng: pin.lng,
        count: 1,
        pins: [pin],
        primaryDestination: pin.destinationName,
      });
    }
  }

  return clusters;
}
