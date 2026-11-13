import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOsrmNearestUrl, parseOsrmNearestPoint } from '../map/osrm';
import { haversineDistanceMeters } from '../trips/tripLogic';
import {
  buildDrillVehicleSeeds,
  buildSurgeStudentSeeds,
  computeSurgeCount,
  offsetPointByMeters,
} from './crisisDrillHelpers';

test('computeSurgeCount applies +40% with minimum 8 students', () => {
  assert.equal(computeSurgeCount(0), 8);
  assert.equal(computeSurgeCount(5), 8);
  assert.equal(computeSurgeCount(20), 8);
  assert.equal(computeSurgeCount(25), 10);
  assert.equal(computeSurgeCount(30), 12);
});

test('offsetPointByMeters moves coordinate accurately by target meter distance', () => {
  const origin = { lat: 12.5218, lng: 76.8951 };
  const shifted = offsetPointByMeters(origin, 500, Math.PI / 4);
  const actual = haversineDistanceMeters(origin, shifted);
  assert.ok(actual >= 490 && actual <= 510, `Expected ~500m, got ${actual}`);
});

test('buildSurgeStudentSeeds tags isDrill and gives ~60% exam within 2 hours', () => {
  const nowMs = Date.UTC(2026, 10, 12, 7, 30, 0);
  const examStartMs = nowMs + 2 * 60 * 60 * 1000;
  const seeds = buildSurgeStudentSeeds({
    realPickups: [
      {
        studentId: 'real-1',
        pickup: { lat: 12.5218, lng: 76.8951 },
        destination: { lat: 12.5418, lng: 76.9151 },
        destinationName: 'Mandya High School',
      },
    ],
    anchorCenter: { lat: 12.5218, lng: 76.8951 },
    defaultDestination: { lat: 12.5418, lng: 76.9151 },
    defaultDestinationName: 'Mandya High School',
    examStartMs,
    nowMs,
  });

  assert.equal(seeds.length, 8);
  assert.ok(seeds.every((s) => s.isDrill === true));

  const withExam = seeds.filter((s) => s.examAtMs !== null);
  assert.equal(withExam.length, 5); // round(8 * 0.6) = 5 (~60%)
  for (const s of withExam) {
    assert.ok((s.examAtMs ?? 0) - nowMs <= 2 * 60 * 60 * 1000);
  }
});

test('buildDrillVehicleSeeds creates tagged drill vehicles for backup seats', () => {
  const seeds = buildDrillVehicleSeeds({
    anchorCenter: { lat: 12.5218, lng: 76.8951 },
    destination: { lat: 12.5418, lng: 76.9151 },
    destinationName: 'Mandya High School',
    batchTag: '999',
  });
  assert.equal(seeds.length, 3);
  assert.ok(seeds.every((v) => v.isDrill === true && v.seatsTotal > 0));
});

test('OSRM nearest endpoint builder and parser snap points safely', () => {
  const pt = { lat: 12.5218, lng: 76.8951 };
  const url = buildOsrmNearestUrl(pt);
  assert.match(url, /\/nearest\/v1\/driving\/76\.895100,12\.521800/);

  const parsed = parseOsrmNearestPoint({
    code: 'Ok',
    waypoints: [{ location: [76.8962, 12.5224] }],
  });
  assert.deepEqual(parsed, { lat: 12.5224, lng: 76.8962 });

  // Malformed response returns null so caller keeps original coordinate
  assert.equal(parseOsrmNearestPoint({ code: 'NoSegment', waypoints: [] }), null);
});
