import { fetchOsrmRoutes, type OsrmRoutesOptions, type OsrmRouteResult } from '../map/osrm';
import { haversineDistanceMeters } from '../trips/tripLogic';
import type { LatLngPoint } from '../types/firestore';
import type { BlockedZoneRouteOutcome, CrisisBlockedZone } from './types';

export const BLOCKED_ZONE_BUFFER_METERS = 50;
export const DETOUR_WAYPOINT_CLEARANCE_METERS = 250;

export function pointToSegmentDistanceMeters(
  point: LatLngPoint,
  segStart: LatLngPoint,
  segEnd: LatLngPoint,
): number {
  const refLatRad = (point.lat * Math.PI) / 180;
  const metersPerDegLat = 111_320;
  const metersPerDegLng = Math.max(1000, 111_320 * Math.cos(refLatRad));

  const ax = (segStart.lng - point.lng) * metersPerDegLng;
  const ay = (segStart.lat - point.lat) * metersPerDegLat;
  const bx = (segEnd.lng - point.lng) * metersPerDegLng;
  const by = (segEnd.lat - point.lat) * metersPerDegLat;

  const abx = bx - ax;
  const aby = by - ay;
  const abLenSq = abx * abx + aby * aby;

  let t = 0;
  if (abLenSq > 1e-6) {
    t = Math.max(0, Math.min(1, (-ax * abx - ay * aby) / abLenSq));
  }

  const closest: LatLngPoint = {
    lat: segStart.lat + t * (segEnd.lat - segStart.lat),
    lng: segStart.lng + t * (segEnd.lng - segStart.lng),
  };

  return haversineDistanceMeters(point, closest);
}

export function routeIntersectsBlockedZone(
  geometry: LatLngPoint[],
  zones: CrisisBlockedZone[],
  extraBufferMeters = BLOCKED_ZONE_BUFFER_METERS,
): { blocked: boolean; intersectingZoneIds: string[]; minClearanceMeters: number } {
  const activeZones = zones.filter((z) => z.active);
  if (activeZones.length === 0 || geometry.length === 0) {
    return { blocked: false, intersectingZoneIds: [], minClearanceMeters: Infinity };
  }

  const intersecting = new Set<string>();
  let minClearanceMeters = Infinity;

  for (const zone of activeZones) {
    const threshold = Math.max(0, zone.radiusMeters) + extraBufferMeters;
    let zoneMinDist = haversineDistanceMeters(zone.center, geometry[0]);

    for (let i = 0; i < geometry.length - 1; i += 1) {
      const dist = pointToSegmentDistanceMeters(zone.center, geometry[i], geometry[i + 1]);
      if (dist < zoneMinDist) {
        zoneMinDist = dist;
      }
      if (dist <= threshold) {
        intersecting.add(zone.id);
      }
    }

    if (geometry.length === 1 && zoneMinDist <= threshold) {
      intersecting.add(zone.id);
    }

    const clearance = zoneMinDist - threshold;
    if (clearance < minClearanceMeters) {
      minClearanceMeters = clearance;
    }
  }

  return {
    blocked: intersecting.size > 0,
    intersectingZoneIds: Array.from(intersecting),
    minClearanceMeters,
  };
}

export function computeDetourWaypoints(
  origin: LatLngPoint,
  dest: LatLngPoint,
  zone: CrisisBlockedZone,
  extraOffsetMeters = DETOUR_WAYPOINT_CLEARANCE_METERS,
): LatLngPoint[] {
  const refLatRad = (zone.center.lat * Math.PI) / 180;
  const metersPerDegLat = 111_320;
  const metersPerDegLng = Math.max(1000, 111_320 * Math.cos(refLatRad));

  const dx = (dest.lng - origin.lng) * metersPerDegLng;
  const dy = (dest.lat - origin.lat) * metersPerDegLat;
  const len = Math.hypot(dx, dy);

  const ux = len > 1 ? dx / len : 1;
  const uy = len > 1 ? dy / len : 0;

  // Perpendicular unit vectors to the left and right of the corridor
  const leftNormal: [number, number] = [-uy, ux];
  const rightNormal: [number, number] = [uy, -ux];

  const offset = Math.max(100, zone.radiusMeters) + BLOCKED_ZONE_BUFFER_METERS + extraOffsetMeters;

  const shiftPoint = (normal: [number, number], distMeters: number): LatLngPoint => ({
    lat: zone.center.lat + (normal[1] * distMeters) / metersPerDegLat,
    lng: zone.center.lng + (normal[0] * distMeters) / metersPerDegLng,
  });

  return [
    shiftPoint(leftNormal, offset),
    shiftPoint(rightNormal, offset),
    shiftPoint(leftNormal, offset * 2),
    shiftPoint(rightNormal, offset * 2),
  ];
}

export type FetchRoutesFn = (
  origin: LatLngPoint,
  dest: LatLngPoint,
  options?: OsrmRoutesOptions,
) => Promise<{ routes: OsrmRouteResult[]; fromCache: boolean }>;

export async function resolveBlockedZoneRoute(
  origin: LatLngPoint,
  dest: LatLngPoint,
  zones: CrisisBlockedZone[],
  options?: {
    signal?: AbortSignal;
    fetchImpl?: typeof fetch;
    fetchRoutesFn?: FetchRoutesFn;
  },
): Promise<BlockedZoneRouteOutcome> {
  const activeZones = zones.filter((z) => z.active);
  const fetcher = options?.fetchRoutesFn ?? fetchOsrmRoutes;

  // Endpoints located inside a blocked zone cannot safely depart/arrive.
  const endpointCheck = routeIntersectsBlockedZone([origin, dest], activeZones);
  for (const zone of activeZones) {
    const threshold = zone.radiusMeters + BLOCKED_ZONE_BUFFER_METERS;
    if (
      haversineDistanceMeters(origin, zone.center) <= threshold ||
      haversineDistanceMeters(dest, zone.center) <= threshold
    ) {
      return {
        status: 'no_road_path',
        route: null,
        blockedByZoneIds: endpointCheck.intersectingZoneIds.length
          ? endpointCheck.intersectingZoneIds
          : [zone.id],
      };
    }
  }

  let initialRoutes: OsrmRouteResult[] = [];
  try {
    const res = await fetcher(origin, dest, {
      alternatives: activeZones.length > 0,
      signal: options?.signal,
      fetchImpl: options?.fetchImpl,
    });
    initialRoutes = res.routes;
  } catch {
    return {
      status: 'no_road_path',
      route: null,
      blockedByZoneIds: activeZones.map((z) => z.id),
    };
  }

  if (activeZones.length === 0) {
    const fastest = [...initialRoutes].sort((a, b) => a.durationSeconds - b.durationSeconds)[0] ?? null;
    return {
      status: fastest ? 'clear' : 'no_road_path',
      route: fastest,
      blockedByZoneIds: [],
    };
  }

  // Evaluate OSRM alternatives and pick fastest route avoiding radius + 50m
  const clearInitialRoutes: OsrmRouteResult[] = [];
  const intersectingZones = new Set<string>();

  for (const route of initialRoutes) {
    const check = routeIntersectsBlockedZone(route.routeGeometry, activeZones);
    if (!check.blocked) {
      clearInitialRoutes.push(route);
    } else {
      for (const id of check.intersectingZoneIds) {
        intersectingZones.add(id);
      }
    }
  }

  if (clearInitialRoutes.length > 0) {
    clearInitialRoutes.sort((a, b) => a.durationSeconds - b.durationSeconds);
    return {
      status: 'clear',
      route: clearInitialRoutes[0],
      blockedByZoneIds: [],
    };
  }

  // All alternatives intersected a blocked zone; retry with perpendicular detour waypoints beside the zone
  const primaryZone =
    activeZones.find((z) => intersectingZones.has(z.id)) ?? activeZones[0];
  const candidateWaypoints = computeDetourWaypoints(origin, dest, primaryZone);

  const validDetours: Array<{ route: OsrmRouteResult; waypoint: LatLngPoint }> = [];

  for (const waypoint of candidateWaypoints) {
    // Skip detour waypoints that fall inside another active blocked zone
    const wpCheck = routeIntersectsBlockedZone([waypoint], activeZones);
    if (wpCheck.blocked) continue;

    try {
      const detourRes = await fetcher(origin, dest, {
        waypoints: [waypoint],
        alternatives: false,
        signal: options?.signal,
        fetchImpl: options?.fetchImpl,
      });

      for (const detourRoute of detourRes.routes) {
        const recheck = routeIntersectsBlockedZone(detourRoute.routeGeometry, activeZones);
        if (!recheck.blocked) {
          validDetours.push({ route: detourRoute, waypoint });
        } else {
          for (const id of recheck.intersectingZoneIds) {
            intersectingZones.add(id);
          }
        }
      }
    } catch {
      // Try next detour waypoint
    }
  }

  if (validDetours.length > 0) {
    validDetours.sort((a, b) => a.route.durationSeconds - b.route.durationSeconds);
    return {
      status: 'detoured',
      route: validDetours[0].route,
      blockedByZoneIds: [],
      usedWaypoint: validDetours[0].waypoint,
    };
  }

  return {
    status: 'no_road_path',
    route: null,
    blockedByZoneIds: Array.from(intersectingZones),
  };
}
