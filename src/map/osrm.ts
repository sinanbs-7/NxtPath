import type { LatLngPoint } from '../types/firestore';

export interface OsrmRouteResult {
  routeGeometry: LatLngPoint[];
  cumulativeDurations: number[];
  distanceMeters: number;
  durationSeconds: number;
}

interface OsrmApiRoute {
  distance?: number;
  duration?: number;
  geometry?: {
    coordinates?: Array<[number, number]>;
  };
  legs?: Array<{
    annotation?: {
      duration?: number[];
    };
  }>;
}

interface OsrmApiResponse {
  code?: string;
  message?: string;
  routes?: OsrmApiRoute[];
}

const routeMemoryCache = new Map<string, OsrmRouteResult>();
const SESSION_ROUTE_PREFIX = 'nxtpath_osrm_v1:';

export interface OsrmRoutesOptions {
  waypoints?: LatLngPoint[];
  alternatives?: boolean;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}

function serializeCoordList(points: LatLngPoint[]): string {
  return points.map((p) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`).join(';');
}

export function buildOsrmRoutesCacheKey(
  origin: LatLngPoint,
  dest: LatLngPoint,
  waypoints: LatLngPoint[] = [],
  alternatives = false,
): string {
  const wpKey =
    waypoints.length > 0
      ? `|wp:${waypoints.map((w) => `${w.lat.toFixed(4)},${w.lng.toFixed(4)}`).join(';')}`
      : '';
  const altKey = alternatives ? '|alt=1' : '';
  return `${origin.lat.toFixed(4)},${origin.lng.toFixed(4)}->${dest.lat.toFixed(4)},${dest.lng.toFixed(4)}${wpKey}${altKey}`;
}

export function buildOsrmCacheKey(origin: LatLngPoint, dest: LatLngPoint): string {
  return `${origin.lat.toFixed(4)},${origin.lng.toFixed(4)}->${dest.lat.toFixed(4)},${dest.lng.toFixed(4)}`;
}

export function buildOsrmRoutesUrl(
  origin: LatLngPoint,
  dest: LatLngPoint,
  options?: { waypoints?: LatLngPoint[]; alternatives?: boolean },
): string {
  const pts = [origin, ...(options?.waypoints ?? []), dest];
  const altParam = options?.alternatives ? '&alternatives=true' : '';
  return `https://router.project-osrm.org/route/v1/driving/${serializeCoordList(pts)}?overview=full&geometries=geojson&annotations=duration${altParam}`;
}

export function buildOsrmUrl(origin: LatLngPoint, dest: LatLngPoint): string {
  return buildOsrmRoutesUrl(origin, dest, { alternatives: false });
}

function haversineMeters(a: LatLngPoint, b: LatLngPoint): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s1 = Math.sin(dLat / 2);
  const s2 = Math.sin(dLng / 2);
  const h = s1 * s1 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * s2 * s2;
  return 2 * R * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export function downsampleRouteWithDurations(
  points: LatLngPoint[],
  cumulativeDurations: number[],
  maxPoints = 250,
): { routeGeometry: LatLngPoint[]; cumulativeDurations: number[] } {
  if (points.length <= maxPoints || points.length <= 2) {
    return { routeGeometry: points, cumulativeDurations };
  }

  const sampledPoints: LatLngPoint[] = [];
  const sampledDurations: number[] = [];
  const step = (points.length - 1) / (maxPoints - 1);

  let lastIndex = -1;
  for (let i = 0; i < maxPoints; i += 1) {
    const idx = i === maxPoints - 1 ? points.length - 1 : Math.round(i * step);
    if (idx !== lastIndex) {
      sampledPoints.push(points[idx]);
      sampledDurations.push(cumulativeDurations[idx]);
      lastIndex = idx;
    }
  }

  return {
    routeGeometry: sampledPoints,
    cumulativeDurations: sampledDurations,
  };
}

function parseSingleOsrmRoute(route: OsrmApiRoute): OsrmRouteResult {
  const rawCoords = route.geometry?.coordinates;
  if (!Array.isArray(rawCoords) || rawCoords.length < 2) {
    throw new Error('Route geometry is incomplete.');
  }

  const points: LatLngPoint[] = rawCoords
    .filter((c) => Array.isArray(c) && c.length >= 2 && Number.isFinite(c[0]) && Number.isFinite(c[1]))
    .map((c) => ({ lat: Number(c[1]), lng: Number(c[0]) }));

  if (points.length < 2) {
    throw new Error('Route geometry has fewer than two valid points.');
  }

  const totalDistance =
    typeof route.distance === 'number' && Number.isFinite(route.distance)
      ? Math.max(0, route.distance)
      : points.reduce((sum, pt, idx) => (idx === 0 ? 0 : sum + haversineMeters(points[idx - 1], pt)), 0);

  const totalDuration =
    typeof route.duration === 'number' && Number.isFinite(route.duration)
      ? Math.max(1, route.duration)
      : Math.max(1, Math.round(totalDistance / 10));

  const legSegmentDurations: number[] = [];
  let hasCompleteLegAnnotations = Array.isArray(route.legs) && route.legs.length > 0;
  if (hasCompleteLegAnnotations && route.legs) {
    for (const leg of route.legs) {
      const segs = leg?.annotation?.duration;
      if (!Array.isArray(segs)) {
        hasCompleteLegAnnotations = false;
        break;
      }
      for (const s of segs) {
        legSegmentDurations.push(Number(s));
      }
    }
  }

  const cumulative: number[] = [0];

  if (hasCompleteLegAnnotations && legSegmentDurations.length === points.length - 1) {
    let running = 0;
    for (let i = 0; i < legSegmentDurations.length; i += 1) {
      const seg = legSegmentDurations[i];
      running += Number.isFinite(seg) && seg >= 0 ? seg : 0;
      cumulative.push(Number(running.toFixed(2)));
    }
  } else {
    const segLengths: number[] = [];
    let geoLength = 0;
    for (let i = 1; i < points.length; i += 1) {
      const d = haversineMeters(points[i - 1], points[i]);
      segLengths.push(d);
      geoLength += d;
    }
    let running = 0;
    for (let i = 0; i < segLengths.length; i += 1) {
      const ratio = geoLength > 0 ? segLengths[i] / geoLength : 1 / segLengths.length;
      running += ratio * totalDuration;
      cumulative.push(Number(running.toFixed(2)));
    }
  }

  const compact = downsampleRouteWithDurations(points, cumulative, 250);

  return {
    routeGeometry: compact.routeGeometry,
    cumulativeDurations: compact.cumulativeDurations,
    distanceMeters: Math.round(totalDistance),
    durationSeconds: Math.round(totalDuration),
  };
}

export function parseOsrmRoutes(payload: unknown): OsrmRouteResult[] {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Invalid routing response.');
  }

  const data = payload as OsrmApiResponse;
  if (data.code !== 'Ok' || !Array.isArray(data.routes) || data.routes.length === 0) {
    throw new Error(data.message || 'No driving route found between these points.');
  }

  return data.routes.map((route) => parseSingleOsrmRoute(route));
}

export function parseOsrmRoute(payload: unknown): OsrmRouteResult {
  return parseOsrmRoutes(payload)[0];
}

const routesListMemoryCache = new Map<string, OsrmRouteResult[]>();

function readSessionRoute(key: string): OsrmRouteResult | null {
  if (typeof window === 'undefined' || !window.sessionStorage) return null;
  try {
    const raw = window.sessionStorage.getItem(SESSION_ROUTE_PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as OsrmRouteResult;
    if (!Array.isArray(parsed.routeGeometry) || !Array.isArray(parsed.cumulativeDurations)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeSessionRoute(key: string, route: OsrmRouteResult): void {
  if (typeof window === 'undefined' || !window.sessionStorage) return;
  try {
    window.sessionStorage.setItem(SESSION_ROUTE_PREFIX + key, JSON.stringify(route));
  } catch {
    // Ignore storage quota issues
  }
}

export function clearOsrmCache(): void {
  routeMemoryCache.clear();
  routesListMemoryCache.clear();
}

export async function fetchOsrmRoutes(
  origin: LatLngPoint,
  dest: LatLngPoint,
  options?: OsrmRoutesOptions,
): Promise<{ routes: OsrmRouteResult[]; fromCache: boolean }> {
  const waypoints = options?.waypoints ?? [];
  const alternatives = Boolean(options?.alternatives);
  const key = buildOsrmRoutesCacheKey(origin, dest, waypoints, alternatives);

  const memHit = routesListMemoryCache.get(key);
  if (memHit) {
    return { routes: memHit, fromCache: true };
  }

  const url = buildOsrmRoutesUrl(origin, dest, { waypoints, alternatives });
  const fetcher = options?.fetchImpl ?? fetch;
  const response = await fetcher(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    signal: options?.signal,
  });

  if (!response.ok) {
    throw new Error(`OSRM routing failed (${response.status})`);
  }

  const json = (await response.json()) as unknown;
  const routes = parseOsrmRoutes(json);
  routesListMemoryCache.set(key, routes);
  if (waypoints.length === 0 && !alternatives && routes[0]) {
    const singleKey = buildOsrmCacheKey(origin, dest);
    routeMemoryCache.set(singleKey, routes[0]);
    writeSessionRoute(singleKey, routes[0]);
  }
  return { routes, fromCache: false };
}

export async function fetchOsrmRoute(
  origin: LatLngPoint,
  dest: LatLngPoint,
  options?: {
    signal?: AbortSignal;
    fetchImpl?: typeof fetch;
  },
): Promise<{ route: OsrmRouteResult; fromCache: boolean }> {
  const key = buildOsrmCacheKey(origin, dest);
  const memHit = routeMemoryCache.get(key);
  if (memHit) {
    return { route: memHit, fromCache: true };
  }

  const sessionHit = readSessionRoute(key);
  if (sessionHit) {
    routeMemoryCache.set(key, sessionHit);
    return { route: sessionHit, fromCache: true };
  }

  const url = buildOsrmUrl(origin, dest);
  const fetcher = options?.fetchImpl ?? fetch;
  const response = await fetcher(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    signal: options?.signal,
  });

  if (!response.ok) {
    throw new Error(`OSRM routing failed (${response.status})`);
  }

  const json = (await response.json()) as unknown;
  const route = parseOsrmRoute(json);
  routeMemoryCache.set(key, route);
  writeSessionRoute(key, route);
  return { route, fromCache: false };
}

export function buildOsrmNearestUrl(point: LatLngPoint): string {
  return `https://router.project-osrm.org/nearest/v1/driving/${point.lng.toFixed(6)},${point.lat.toFixed(6)}?number=1`;
}

export function parseOsrmNearestPoint(payload: unknown): LatLngPoint | null {
  if (!payload || typeof payload !== 'object') return null;
  const data = payload as {
    code?: string;
    waypoints?: Array<{ location?: [number, number] }>;
  };
  if (data.code !== 'Ok' || !Array.isArray(data.waypoints) || data.waypoints.length === 0) {
    return null;
  }
  const loc = data.waypoints[0]?.location;
  if (!Array.isArray(loc) || loc.length < 2) return null;
  const lng = Number(loc[0]);
  const lat = Number(loc[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return null;
  }
  return { lat, lng };
}

export async function snapPointToRoadOsrm(
  point: LatLngPoint,
  options?: {
    signal?: AbortSignal;
    fetchImpl?: typeof fetch;
  },
): Promise<{ point: LatLngPoint; snapped: boolean }> {
  try {
    const fetcher = options?.fetchImpl ?? fetch;
    const response = await fetcher(buildOsrmNearestUrl(point), {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: options?.signal,
    });
    if (!response.ok) {
      return { point, snapped: false };
    }
    const json = (await response.json()) as unknown;
    const snapped = parseOsrmNearestPoint(json);
    if (!snapped) {
      return { point, snapped: false };
    }
    return { point: snapped, snapped: true };
  } catch {
    return { point, snapped: false };
  }
}
