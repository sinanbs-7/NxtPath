export interface PlaceResult {
  id: string;
  name: string;
  subtitle: string;
  lat: number;
  lng: number;
  category?: string;
}

interface PhotonFeatureProperties {
  osm_id?: number;
  osm_type?: string;
  name?: string;
  street?: string;
  housenumber?: string;
  city?: string;
  town?: string;
  village?: string;
  suburb?: string;
  county?: string;
  state?: string;
  country?: string;
  osm_value?: string;
  type?: string;
}

interface PhotonFeature {
  type?: string;
  geometry?: {
    type?: string;
    coordinates?: [number, number];
  };
  properties?: PhotonFeatureProperties;
}

interface PhotonApiResponse {
  features?: PhotonFeature[];
}

const memoryCache = new Map<string, PlaceResult[]>();
const SESSION_CACHE_PREFIX = 'nxtpath_photon_v1:';

export function buildPhotonCacheKey(
  query: string,
  biasLat?: number | null,
  biasLng?: number | null,
): string {
  const normQuery = query.trim().toLowerCase().replace(/\s+/g, ' ');
  const latBucket = typeof biasLat === 'number' ? biasLat.toFixed(1) : 'none';
  const lngBucket = typeof biasLng === 'number' ? biasLng.toFixed(1) : 'none';
  return `${normQuery}|${latBucket}|${lngBucket}`;
}

export function buildPhotonUrl(
  query: string,
  biasLat?: number | null,
  biasLng?: number | null,
  limit = 6,
): string {
  const params = new URLSearchParams();
  params.set('q', query.trim());
  params.set('limit', String(limit));
  if (
    typeof biasLat === 'number' &&
    typeof biasLng === 'number' &&
    Number.isFinite(biasLat) &&
    Number.isFinite(biasLng)
  ) {
    params.set('lat', biasLat.toFixed(4));
    params.set('lon', biasLng.toFixed(4));
  }
  return `https://photon.komoot.io/api/?${params.toString()}`;
}

export function parsePhotonResponse(payload: unknown): PlaceResult[] {
  if (!payload || typeof payload !== 'object') return [];
  const data = payload as PhotonApiResponse;
  if (!Array.isArray(data.features)) return [];

  const results: PlaceResult[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < data.features.length; i += 1) {
    const feat = data.features[i];
    const coords = feat?.geometry?.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) continue;

    const lng = Number(coords[0]);
    const lat = Number(coords[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

    const props = feat.properties ?? {};
    const primaryName =
      props.name ||
      props.village ||
      props.town ||
      props.city ||
      props.street ||
      `${lat.toFixed(4)}, ${lng.toFixed(4)}`;

    const localityParts = [
      props.village && props.village !== primaryName ? props.village : null,
      props.suburb && props.suburb !== primaryName ? props.suburb : null,
      props.town && props.town !== primaryName ? props.town : null,
      props.city && props.city !== primaryName ? props.city : null,
      props.county && props.county !== primaryName ? props.county : null,
      props.state && props.state !== primaryName ? props.state : null,
    ].filter((part): part is string => Boolean(part));

    const uniqueParts = Array.from(new Set(localityParts));
    const subtitle = uniqueParts.slice(0, 3).join(', ') || props.country || '';

    const dedupeKey = `${primaryName.toLowerCase()}|${lat.toFixed(3)}|${lng.toFixed(3)}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const id = props.osm_id
      ? `${props.osm_type || 'N'}-${props.osm_id}`
      : `photon-${i}-${lat.toFixed(4)}-${lng.toFixed(4)}`;

    results.push({
      id,
      name: primaryName,
      subtitle,
      lat,
      lng,
      category: props.osm_value || props.type,
    });
  }

  return results;
}

function readSessionCache(cacheKey: string): PlaceResult[] | null {
  if (typeof window === 'undefined' || !window.sessionStorage) return null;
  try {
    const raw = window.sessionStorage.getItem(SESSION_CACHE_PREFIX + cacheKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PlaceResult[];
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function writeSessionCache(cacheKey: string, results: PlaceResult[]): void {
  if (typeof window === 'undefined' || !window.sessionStorage) return;
  try {
    window.sessionStorage.setItem(SESSION_CACHE_PREFIX + cacheKey, JSON.stringify(results));
  } catch {
    // Ignore sessionStorage quota limits
  }
}

export function clearPhotonCache(): void {
  memoryCache.clear();
}

export async function searchPhotonPlaces(
  query: string,
  options?: {
    biasLat?: number | null;
    biasLng?: number | null;
    limit?: number;
    signal?: AbortSignal;
    fetchImpl?: typeof fetch;
  },
): Promise<{ results: PlaceResult[]; fromCache: boolean }> {
  const trimmed = query.trim();
  if (trimmed.length < 2) {
    return { results: [], fromCache: false };
  }

  const cacheKey = buildPhotonCacheKey(trimmed, options?.biasLat, options?.biasLng);
  const memHit = memoryCache.get(cacheKey);
  if (memHit) {
    return { results: memHit, fromCache: true };
  }

  const sessionHit = readSessionCache(cacheKey);
  if (sessionHit) {
    memoryCache.set(cacheKey, sessionHit);
    return { results: sessionHit, fromCache: true };
  }

  const url = buildPhotonUrl(trimmed, options?.biasLat, options?.biasLng, options?.limit ?? 6);
  const fetcher = options?.fetchImpl ?? fetch;

  const response = await fetcher(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    signal: options?.signal,
  });

  if (!response.ok) {
    throw new Error(`Photon search failed with status ${response.status}`);
  }

  const json = (await response.json()) as unknown;
  const results = parsePhotonResponse(json);
  memoryCache.set(cacheKey, results);
  writeSessionCache(cacheKey, results);
  return { results, fromCache: false };
}
