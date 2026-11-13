import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPhotonUrl,
  clearPhotonCache,
  parsePhotonResponse,
  searchPhotonPlaces,
} from './photon';

test('buildPhotonUrl includes query, limit, and location bias when provided', () => {
  const withBias = buildPhotonUrl('Mandya High School', 12.5218, 76.8951, 6);
  assert.ok(withBias.startsWith('https://photon.komoot.io/api/?'));
  assert.ok(withBias.includes('q=Mandya+High+School'));
  assert.ok(withBias.includes('lat=12.5218'));
  assert.ok(withBias.includes('lon=76.8951'));
  assert.ok(withBias.includes('limit=6'));

  const withoutBias = buildPhotonUrl('Mandya', null, null);
  assert.ok(!withoutBias.includes('lat='));
  assert.ok(!withoutBias.includes('lon='));
});

test('parsePhotonResponse extracts rural place fields and deduplicates entries', () => {
  const sample = {
    features: [
      {
        geometry: { coordinates: [76.8951, 12.5218] },
        properties: {
          osm_id: 101,
          osm_type: 'N',
          name: 'Government High School',
          village: 'Kirugavalu',
          county: 'Malavalli',
          state: 'Karnataka',
          osm_value: 'school',
        },
      },
      {
        geometry: { coordinates: [76.8952, 12.5219] },
        properties: {
          osm_id: 102,
          osm_type: 'N',
          name: 'Government High School',
          village: 'Kirugavalu',
          state: 'Karnataka',
        },
      },
    ],
  };

  const parsed = parsePhotonResponse(sample);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].name, 'Government High School');
  assert.equal(parsed[0].subtitle, 'Kirugavalu, Malavalli, Karnataka');
  assert.equal(parsed[0].lat, 12.5218);
  assert.equal(parsed[0].lng, 76.8951);
});

test('searchPhotonPlaces caches repeated queries and avoids duplicate fetch calls', async () => {
  clearPhotonCache();
  let calls = 0;
  const fakeFetch: typeof fetch = async () => {
    calls += 1;
    return new Response(
      JSON.stringify({
        features: [
          {
            geometry: { coordinates: [76.6394, 12.2958] },
            properties: { name: 'Mysuru', state: 'Karnataka', osm_id: 55 },
          },
        ],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  };

  const first = await searchPhotonPlaces('Mysuru', {
    biasLat: 12.52,
    biasLng: 76.89,
    fetchImpl: fakeFetch,
  });
  assert.equal(first.fromCache, false);
  assert.equal(first.results.length, 1);
  assert.equal(calls, 1);

  const second = await searchPhotonPlaces('  mysuru ', {
    biasLat: 12.52,
    biasLng: 76.89,
    fetchImpl: fakeFetch,
  });
  assert.equal(second.fromCache, true);
  assert.equal(second.results[0].name, 'Mysuru');
  assert.equal(calls, 1);
});
