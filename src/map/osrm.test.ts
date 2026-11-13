import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildOsrmRoutesUrl,
  buildOsrmUrl,
  clearOsrmCache,
  downsampleRouteWithDurations,
  fetchOsrmRoute,
  fetchOsrmRoutes,
  parseOsrmRoute,
  parseOsrmRoutes,
} from './osrm';

test('buildOsrmUrl formats lon,lat coordinates and requests geojson + duration annotations', () => {
  const url = buildOsrmUrl({ lat: 12.5218, lng: 76.8951 }, { lat: 12.2958, lng: 76.6394 });
  assert.ok(url.startsWith('https://router.project-osrm.org/route/v1/driving/'));
  assert.ok(url.includes('76.895100,12.521800;76.639400,12.295800'));
  assert.ok(url.includes('annotations=duration'));
});

test('buildOsrmRoutesUrl includes waypoints and alternatives=true when requested', () => {
  const url = buildOsrmRoutesUrl(
    { lat: 12.52, lng: 76.89 },
    { lat: 12.3, lng: 76.64 },
    {
      waypoints: [{ lat: 12.42, lng: 76.78 }],
      alternatives: true,
    },
  );
  assert.ok(url.includes('76.890000,12.520000;76.780000,12.420000;76.640000,12.300000'));
  assert.ok(url.includes('alternatives=true'));
});

test('parseOsrmRoute builds cumulativeDurations from segment annotations', () => {
  const sample = {
    code: 'Ok',
    routes: [
      {
        distance: 1500,
        duration: 120,
        geometry: {
          coordinates: [
            [76.89, 12.52],
            [76.88, 12.51],
            [76.87, 12.50],
          ],
        },
        legs: [
          {
            annotation: {
              duration: [45.5, 74.5],
            },
          },
        ],
      },
    ],
  };

  const parsed = parseOsrmRoute(sample);
  assert.equal(parsed.distanceMeters, 1500);
  assert.equal(parsed.durationSeconds, 120);
  assert.equal(parsed.routeGeometry.length, 3);
  assert.deepEqual(parsed.cumulativeDurations, [0, 45.5, 120]);
});

test('parseOsrmRoutes parses multiple alternatives and concatenates multi-leg waypoint durations', () => {
  const sample = {
    code: 'Ok',
    routes: [
      {
        distance: 3200,
        duration: 240,
        geometry: {
          coordinates: [
            [76.89, 12.52],
            [76.85, 12.48],
            [76.82, 12.45],
            [76.80, 12.42],
          ],
        },
        legs: [
          { annotation: { duration: [80, 70] } },
          { annotation: { duration: [90] } },
        ],
      },
      {
        distance: 4100,
        duration: 300,
        geometry: {
          coordinates: [
            [76.89, 12.52],
            [76.80, 12.42],
          ],
        },
        legs: [{ annotation: { duration: [300] } }],
      },
    ],
  };

  const routes = parseOsrmRoutes(sample);
  assert.equal(routes.length, 2);
  assert.deepEqual(routes[0].cumulativeDurations, [0, 80, 150, 240]);
  assert.equal(routes[1].durationSeconds, 300);
});

test('downsampleRouteWithDurations preserves endpoints and caps vertex count', () => {
  const pts = Array.from({ length: 500 }, (_, i) => ({ lat: 12 + i * 0.001, lng: 76 + i * 0.001 }));
  const durs = Array.from({ length: 500 }, (_, i) => i * 2);
  const compact = downsampleRouteWithDurations(pts, durs, 100);
  assert.equal(compact.routeGeometry.length, 100);
  assert.equal(compact.cumulativeDurations.length, 100);
  assert.deepEqual(compact.routeGeometry[0], pts[0]);
  assert.deepEqual(compact.routeGeometry[99], pts[499]);
  assert.equal(compact.cumulativeDurations[99], 998);
});

test('fetchOsrmRoute and fetchOsrmRoutes cache identical route requests', async () => {
  clearOsrmCache();
  let calls = 0;
  const fakeFetch: typeof fetch = async () => {
    calls += 1;
    return new Response(
      JSON.stringify({
        code: 'Ok',
        routes: [
          {
            distance: 2400,
            duration: 210,
            geometry: {
              coordinates: [
                [76.89, 12.52],
                [76.87, 12.50],
              ],
            },
            legs: [{ annotation: { duration: [210] } }],
          },
        ],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  };

  const a = await fetchOsrmRoute(
    { lat: 12.52, lng: 76.89 },
    { lat: 12.5, lng: 76.87 },
    { fetchImpl: fakeFetch },
  );
  assert.equal(a.fromCache, false);
  assert.equal(calls, 1);

  const b = await fetchOsrmRoute(
    { lat: 12.52, lng: 76.89 },
    { lat: 12.5, lng: 76.87 },
    { fetchImpl: fakeFetch },
  );
  assert.equal(b.fromCache, true);
  assert.equal(calls, 1);

  const c = await fetchOsrmRoutes(
    { lat: 12.52, lng: 76.89 },
    { lat: 12.5, lng: 76.87 },
    { alternatives: true, fetchImpl: fakeFetch },
  );
  assert.equal(c.fromCache, false);
  assert.equal(c.routes.length, 1);
  assert.equal(calls, 2);

  const d = await fetchOsrmRoutes(
    { lat: 12.52, lng: 76.89 },
    { lat: 12.5, lng: 76.87 },
    { alternatives: true, fetchImpl: fakeFetch },
  );
  assert.equal(d.fromCache, true);
  assert.equal(calls, 2);
});
