import test from 'node:test';
import assert from 'node:assert/strict';
import { Timestamp } from 'firebase/firestore';
import {
  clusterDemandPins,
  formatDistance,
  formatDuration,
  formatElapsed,
  generateRideCode,
  resolveDepartureDate,
} from './tripLogic';
import type { DemandPin } from '../types/firestore';

test('generateRideCode produces a 4-digit numeric string', () => {
  assert.equal(generateRideCode(() => 0), '1000');
  assert.equal(generateRideCode(() => 0.9999), '9999');
  assert.match(generateRideCode(), /^[0-9]{4}$/);
});

test('formatElapsed formats mm:ss and h:mm:ss', () => {
  assert.equal(formatElapsed(5), '00:05');
  assert.equal(formatElapsed(125), '02:05');
  assert.equal(formatElapsed(3665), '1:01:05');
});

test('formatDistance and formatDuration format readable units', () => {
  assert.equal(formatDistance(450), '450 m');
  assert.equal(formatDistance(4250), '4.3 km');
  assert.equal(formatDistance(14800), '15 km');
  assert.equal(formatDuration(900), '15 min');
  assert.equal(formatDuration(3600), '1 hr');
  assert.equal(formatDuration(4500), '1 hr 15 min');
});

test('resolveDepartureDate handles now and HH:mm time strings', () => {
  const base = new Date(2026, 10, 12, 7, 15, 0);
  const nowDate = resolveDepartureDate('now', '08:30', base);
  assert.equal(nowDate.getHours(), 7);

  const laterDate = resolveDepartureDate('later', '08:45', base);
  assert.equal(laterDate.getHours(), 8);
  assert.equal(laterDate.getMinutes(), 45);
});

test('clusterDemandPins groups nearby active pins within radius', () => {
  const ts = Timestamp.fromMillis(1700000000000);
  const pins: DemandPin[] = [
    {
      id: 'p1',
      studentId: 's1',
      lat: 12.5218,
      lng: 76.8951,
      destinationName: 'Mandya School',
      active: true,
      createdAt: ts,
      updatedAt: ts,
    },
    {
      id: 'p2',
      studentId: 's2',
      lat: 12.5221,
      lng: 76.8953,
      destinationName: 'Mandya School',
      active: true,
      createdAt: ts,
      updatedAt: ts,
    },
    {
      id: 'p3',
      studentId: 's3',
      lat: 12.55,
      lng: 76.92,
      destinationName: 'Maddur High School',
      active: true,
      createdAt: ts,
      updatedAt: ts,
    },
  ];

  const clusters = clusterDemandPins(pins, 150);
  assert.equal(clusters.length, 2);
  assert.equal(clusters[0].count, 2);
  assert.equal(clusters[1].count, 1);
});
