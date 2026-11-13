import React, { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import {
  Circle,
  MapContainer,
  Marker,
  Polyline,
  Popup,
  TileLayer,
  useMap,
  useMapEvents,
} from 'react-leaflet';
import { Crosshair, Minus, Plus, RotateCcw } from 'lucide-react';
import type { GpsReading } from './useGeolocation';
import type { PlaceResult } from './photon';
import type { BlockedZone, LatLngPoint, VehicleType } from '../types/firestore';
import type { DemandCluster } from '../trips/tripLogic';
import { createVehicleLeafletIcon } from '../ui/VehicleIcons';
import { useI18n } from '../i18n/I18nContext';

export const OSM_TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
export const OSM_TILE_ATTRIBUTION = '© OpenStreetMap contributors';

const DEFAULT_CENTER: [number, number] = [15.3173, 75.7139];
const DEFAULT_ZOOM = 6;
const ACTIVE_ZOOM = 15;

const gpsDotIcon = L.divIcon({
  className: 'nx-gps-marker-wrapper',
  html: '<div class="nx-gps-dot"><span class="nx-gps-pulse"></span><span class="nx-gps-core"></span></div>',
  iconSize: [20, 20],
  iconAnchor: [10, 10],
});

const placeSignIcon = L.divIcon({
  className: 'nx-place-marker-wrapper',
  html: `<div style="display:flex;flex-direction:column;align-items:center;">
    <div style="width:28px;height:28px;border-radius:8px;background:#0E6B4E;border:2.5px solid #FFFFFF;box-shadow:0 2px 6px rgba(31,42,46,0.35);display:flex;align-items:center;justify-content:center;">
      <div style="width:8px;height:8px;border-radius:2px;background:#FFC20E;"></div>
    </div>
    <div style="width:3px;height:10px;background:#1F2A2E;margin-top:-1px;"></div>
  </div>`,
  iconSize: [28, 38],
  iconAnchor: [14, 38],
  popupAnchor: [0, -34],
});

const pickupPinIcon = L.divIcon({
  className: 'nx-pickup-marker-wrapper',
  html: `<div style="display:flex;flex-direction:column;align-items:center;cursor:grab;">
    <div style="width:28px;height:28px;border-radius:999px;background:#FFC20E;border:3px solid #1F2A2E;box-shadow:0 2px 8px rgba(31,42,46,0.35);display:flex;align-items:center;justify-content:center;">
      <div style="width:8px;height:8px;border-radius:999px;background:#1F2A2E;"></div>
    </div>
    <div style="width:3px;height:10px;background:#1F2A2E;margin-top:-2px;"></div>
  </div>`,
  iconSize: [28, 38],
  iconAnchor: [14, 38],
  popupAnchor: [0, -34],
});

function createDemandPinIcon(count: number): L.DivIcon {
  return L.divIcon({
    className: 'nx-demand-pin-wrapper',
    html: `<div style="display:inline-flex;align-items:center;gap:4px;padding:4px 8px;background:#FFC20E;color:#1F2A2E;border:2px solid #1F2A2E;border-radius:8px;font-family:Archivo,sans-serif;font-weight:800;font-size:12px;white-space:nowrap;box-shadow:0 2px 6px rgba(31,42,46,0.28);">
      <span>${count}</span>
      <span style="width:6px;height:6px;border-radius:999px;background:#1F2A2E;"></span>
    </div>`,
    iconSize: [38, 28],
    iconAnchor: [19, 14],
    popupAnchor: [0, -14],
  });
}

function createExamStudentIcon(isAtRisk = false, isUnreachable = false, isDrill = false): L.DivIcon {
  const border = isUnreachable || isAtRisk ? '#D7352B' : '#1F2A2E';
  const badgeText = isDrill ? 'EXAM·D' : 'EXAM';
  return L.divIcon({
    className: 'nx-exam-student-wrapper',
    html: `<div style="display:inline-flex;align-items:center;gap:4px;padding:2px 6px;background:#FFC20E;color:#1F2A2E;border:2px solid ${border};border-radius:8px;font-family:Archivo,sans-serif;font-weight:900;font-size:10px;letter-spacing:0.03em;white-space:nowrap;box-shadow:0 2px 6px rgba(31,42,46,0.32);">
      <span>${badgeText}</span>
    </div>`,
    iconSize: [52, 24],
    iconAnchor: [26, 12],
    popupAnchor: [0, -12],
  });
}

function MapClickListener({ onMapClick }: { onMapClick?: (pt: LatLngPoint) => void }) {
  useMapEvents({
    click(e) {
      if (onMapClick) {
        onMapClick({ lat: e.latlng.lat, lng: e.latlng.lng });
      }
    },
  });
  return null;
}

function MapController({
  position,
  pickupPin,
  selectedPlace,
  routePolyline,
  focusBoundsPoints,
  recenterSignal,
}: {
  position: GpsReading | null;
  pickupPin?: LatLngPoint | null;
  selectedPlace: PlaceResult | null;
  routePolyline?: LatLngPoint[] | null;
  focusBoundsPoints?: LatLngPoint[];
  recenterSignal: number;
}) {
  const map = useMap();
  const hasCenteredGpsRef = useRef(false);
  const lastPlaceKeyRef = useRef<string | null>(null);
  const lastRouteKeyRef = useRef<string | null>(null);
  const lastFocusKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (
      position &&
      !hasCenteredGpsRef.current &&
      !selectedPlace &&
      (!routePolyline || routePolyline.length < 2) &&
      (!focusBoundsPoints || focusBoundsPoints.length === 0)
    ) {
      hasCenteredGpsRef.current = true;
      map.setView([position.lat, position.lng], ACTIVE_ZOOM, { animate: true });
    }
  }, [map, position, selectedPlace, routePolyline, focusBoundsPoints]);

  useEffect(() => {
    if (!focusBoundsPoints || focusBoundsPoints.length === 0) {
      lastFocusKeyRef.current = null;
      return;
    }
    const key = focusBoundsPoints
      .slice(0, 6)
      .map((p) => `${p.lat.toFixed(3)},${p.lng.toFixed(3)}`)
      .join('|');
    if (key !== lastFocusKeyRef.current) {
      lastFocusKeyRef.current = key;
      if (focusBoundsPoints.length === 1) {
        map.setView([focusBoundsPoints[0].lat, focusBoundsPoints[0].lng], 13, { animate: true });
      } else {
        const bounds = L.latLngBounds(
          focusBoundsPoints.map((pt) => [pt.lat, pt.lng] as [number, number]),
        );
        map.fitBounds(bounds, {
          paddingTopLeft: [40, 48],
          paddingBottomRight: [40, 64],
          maxZoom: 14,
          animate: true,
        });
      }
    }
  }, [map, focusBoundsPoints]);

  useEffect(() => {
    if (!selectedPlace || (routePolyline && routePolyline.length >= 2)) return;
    const key = `${selectedPlace.lat.toFixed(5)},${selectedPlace.lng.toFixed(5)}|${pickupPin ? `${pickupPin.lat.toFixed(3)},${pickupPin.lng.toFixed(3)}` : 'none'}`;
    if (key !== lastPlaceKeyRef.current) {
      lastPlaceKeyRef.current = key;
      if (pickupPin) {
        const bounds = L.latLngBounds([
          [pickupPin.lat, pickupPin.lng],
          [selectedPlace.lat, selectedPlace.lng],
        ]);
        const isDesktop = window.innerWidth >= 768;
        map.fitBounds(bounds, {
          paddingTopLeft: [isDesktop ? 470 : 36, 56],
          paddingBottomRight: [isDesktop ? 64 : 48, isDesktop ? 96 : 340],
          maxZoom: ACTIVE_ZOOM,
          animate: true,
        });
      } else {
        map.setView([selectedPlace.lat, selectedPlace.lng], ACTIVE_ZOOM, { animate: true });
      }
    }
  }, [map, selectedPlace, pickupPin, routePolyline]);

  useEffect(() => {
    if (!routePolyline || routePolyline.length < 2) {
      lastRouteKeyRef.current = null;
      return;
    }
    const first = routePolyline[0];
    const last = routePolyline[routePolyline.length - 1];
    const key = `${first.lat.toFixed(4)},${first.lng.toFixed(4)}->${last.lat.toFixed(4)},${last.lng.toFixed(4)}`;
    if (key !== lastRouteKeyRef.current) {
      lastRouteKeyRef.current = key;
      const bounds = L.latLngBounds(routePolyline.map((pt) => [pt.lat, pt.lng] as [number, number]));
      const isDesktop = window.innerWidth >= 768;
      map.fitBounds(bounds, {
        paddingTopLeft: [isDesktop ? 470 : 36, 56],
        paddingBottomRight: [isDesktop ? 64 : 48, isDesktop ? 96 : 340],
        maxZoom: 15,
        animate: true,
      });
    }
  }, [map, routePolyline]);

  useEffect(() => {
    if (recenterSignal > 0 && position) {
      map.setView([position.lat, position.lng], Math.max(map.getZoom(), ACTIVE_ZOOM), {
        animate: true,
      });
    }
  }, [map, position, recenterSignal]);

  return null;
}

function MapControlsOverlay({
  hasGps,
  onRecenter,
  topOffsetClass,
}: {
  hasGps: boolean;
  onRecenter: () => void;
  topOffsetClass: string;
}) {
  const map = useMap();
  const { t } = useI18n();

  return (
    <div className={`absolute right-3 ${topOffsetClass} z-[500] flex flex-col gap-2`}>
      {hasGps && (
        <button
          type="button"
          onClick={onRecenter}
          aria-label={t.centerOnMe}
          title={t.centerOnMe}
          className="h-11 w-11 rounded-xl bg-white border-2 border-[#1F2A2E] text-[#1F2A2E] flex items-center justify-center shadow-sm active:scale-95 transition-transform"
        >
          <Crosshair className="w-5 h-5 text-[#2F6FDE]" aria-hidden="true" />
        </button>
      )}
      <div className="flex flex-col rounded-xl bg-white border-2 border-[#1F2A2E] overflow-hidden shadow-sm">
        <button
          type="button"
          onClick={() => map.zoomIn()}
          aria-label={t.zoomIn}
          title={t.zoomIn}
          className="h-11 w-11 flex items-center justify-center text-[#1F2A2E] border-b border-[#D5DDD8] active:bg-[#F2F5F3]"
        >
          <Plus className="w-5 h-5" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => map.zoomOut()}
          aria-label={t.zoomOut}
          title={t.zoomOut}
          className="h-11 w-11 flex items-center justify-center text-[#1F2A2E] active:bg-[#F2F5F3]"
        >
          <Minus className="w-5 h-5" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

export interface LiveVehicleMarker {
  tripId: string;
  vehicleType: VehicleType;
  driverName: string;
  driverVerified?: boolean;
  seatsFree: number;
  lat: number;
  lng: number;
  isOffline: boolean;
  isBroken?: boolean;
  isDrill?: boolean;
  isSelected?: boolean;
}

export interface ExtraRouteOverlay {
  id: string;
  geometry: LatLngPoint[];
  color?: string;
  animate?: boolean;
  dashed?: boolean;
}

export interface ExamStudentOverlay {
  id: string;
  name: string;
  lat: number;
  lng: number;
  isDrill?: boolean;
  isAtRisk?: boolean;
  unreachable?: boolean;
  detail?: string;
}

interface NxtMapProps {
  position: GpsReading | null;
  selectedPlace: PlaceResult | null;
  pickupPin?: LatLngPoint | null;
  onPickupDragEnd?: (point: LatLngPoint) => void;
  routePolyline?: LatLngPoint[] | null;
  disruptedPolyline?: LatLngPoint[] | null;
  animateRecovery?: boolean;
  extraRoutes?: ExtraRouteOverlay[];
  blockedZones?: BlockedZone[];
  examStudents?: ExamStudentOverlay[];
  activeVehicleType?: VehicleType | null;
  liveVehicles?: LiveVehicleMarker[];
  onSelectVehicleTrip?: (tripId: string) => void;
  demandClusters?: DemandCluster[];
  onOfferDemandCluster?: (cluster: DemandCluster) => void;
  onMapClick?: (point: LatLngPoint) => void;
  focusBoundsPoints?: LatLngPoint[];
  controlsTopOffsetClass?: string;
}

export function NxtMap({
  position,
  selectedPlace,
  pickupPin,
  onPickupDragEnd,
  routePolyline,
  disruptedPolyline,
  animateRecovery = false,
  extraRoutes = [],
  blockedZones = [],
  examStudents = [],
  activeVehicleType,
  liveVehicles = [],
  onSelectVehicleTrip,
  demandClusters = [],
  onOfferDemandCluster,
  onMapClick,
  focusBoundsPoints,
  controlsTopOffsetClass = 'top-3',
}: NxtMapProps) {
  const { t } = useI18n();
  const [tileErrorCount, setTileErrorCount] = useState(0);
  const [tileLayerKey, setTileLayerKey] = useState(0);
  const [recenterSignal, setRecenterSignal] = useState(0);

  const initialCenter = useMemo<[number, number]>(() => {
    if (selectedPlace) return [selectedPlace.lat, selectedPlace.lng];
    if (pickupPin) return [pickupPin.lat, pickupPin.lng];
    if (position) return [position.lat, position.lng];
    if (focusBoundsPoints && focusBoundsPoints.length > 0) {
      return [focusBoundsPoints[0].lat, focusBoundsPoints[0].lng];
    }
    return DEFAULT_CENTER;
  }, [position, pickupPin, selectedPlace, focusBoundsPoints]);

  const initialZoom =
    selectedPlace || pickupPin || position || (focusBoundsPoints && focusBoundsPoints.length > 0)
      ? ACTIVE_ZOOM
      : DEFAULT_ZOOM;

  const polylinePositions = useMemo(
    () => (routePolyline ? routePolyline.map((p) => [p.lat, p.lng] as [number, number]) : null),
    [routePolyline],
  );

  const disruptedPositions = useMemo(
    () =>
      disruptedPolyline ? disruptedPolyline.map((p) => [p.lat, p.lng] as [number, number]) : null,
    [disruptedPolyline],
  );

  const driverVehicleIcon = useMemo(
    () => (activeVehicleType ? createVehicleLeafletIcon(activeVehicleType) : null),
    [activeVehicleType],
  );

  return (
    <div
      className={`relative w-full h-full ${onMapClick ? 'cursor-crosshair' : ''}`}
      data-testid="nxt-map"
    >
      {/* SVG hatch pattern used by hatched red blocked road zones */}
      <svg
        aria-hidden="true"
        width="0"
        height="0"
        style={{ position: 'absolute', width: 0, height: 0, pointerEvents: 'none' }}
      >
        <defs>
          <pattern
            id="nx-flood-hatch"
            width="10"
            height="10"
            patternTransform="rotate(45 0 0)"
            patternUnits="userSpaceOnUse"
          >
            <rect width="10" height="10" fill="rgba(215, 53, 43, 0.16)" />
            <line
              x1="0"
              y1="0"
              x2="0"
              y2="10"
              stroke="#D7352B"
              strokeWidth="3.5"
              strokeOpacity="0.72"
            />
          </pattern>
        </defs>
      </svg>

      <MapContainer
        center={initialCenter}
        zoom={initialZoom}
        zoomControl={false}
        className="w-full h-full z-0"
      >
        <TileLayer
          key={tileLayerKey}
          url={OSM_TILE_URL}
          attribution={OSM_TILE_ATTRIBUTION}
          maxZoom={19}
          eventHandlers={{
            tileerror: () => setTileErrorCount((c) => c + 1),
            tileload: () => {
              setTileErrorCount(0);
            },
          }}
        />

        <MapClickListener onMapClick={onMapClick} />

        <MapController
          position={position}
          pickupPin={pickupPin}
          selectedPlace={selectedPlace}
          routePolyline={routePolyline ?? disruptedPolyline}
          focusBoundsPoints={focusBoundsPoints}
          recenterSignal={recenterSignal}
        />

        <MapControlsOverlay
          hasGps={Boolean(position)}
          onRecenter={() => setRecenterSignal((s) => s + 1)}
          topOffsetClass={controlsTopOffsetClass}
        />

        {blockedZones
          .filter((z) => z.active)
          .map((zone) => (
            <Circle
              key={zone.id}
              center={[zone.center.lat, zone.center.lng]}
              radius={zone.radiusMeters}
              pathOptions={{
                color: '#D7352B',
                weight: 3,
                dashArray: '8 5',
                fillColor: '#D7352B',
                fillOpacity: 0.45,
                className: 'nx-blocked-zone-circle',
              }}
            >
              <Popup>
                <div className="text-sm text-[#1F2A2E] space-y-0.5">
                  <p className="font-bold text-[#D7352B]">
                    {zone.label}
                    {zone.isDrill ? ' · DRILL' : ''}
                  </p>
                  <p className="text-xs text-[#526066] tabular-nums">
                    {Math.round(zone.radiusMeters)} m
                  </p>
                </div>
              </Popup>
            </Circle>
          ))}

        {extraRoutes.map((route) => {
          if (!route.geometry || route.geometry.length < 2) return null;
          const pts = route.geometry.map((p) => [p.lat, p.lng] as [number, number]);
          return (
            <React.Fragment key={route.id}>
              <Polyline
                positions={pts}
                pathOptions={{ color: '#FFFFFF', weight: 7.5, opacity: 0.85 }}
              />
              <Polyline
                positions={pts}
                pathOptions={{
                  color: route.color ?? '#0E6B4E',
                  weight: 4.5,
                  opacity: 0.95,
                  dashArray: route.dashed ? '8 6' : undefined,
                  className: route.animate ? 'nx-recovery-ribbon' : undefined,
                }}
              />
            </React.Fragment>
          );
        })}

        {disruptedPositions && disruptedPositions.length >= 2 && (
          <>
            <Polyline
              positions={disruptedPositions}
              pathOptions={{ color: '#FFFFFF', weight: 8, opacity: 0.75 }}
            />
            <Polyline
              positions={disruptedPositions}
              pathOptions={{
                color: '#D7352B',
                weight: 5,
                opacity: 0.9,
                className: 'nx-disrupted-ribbon',
              }}
            />
          </>
        )}

        {polylinePositions && polylinePositions.length >= 2 && (
          <>
            <Polyline
              positions={polylinePositions}
              pathOptions={{ color: '#FFFFFF', weight: 9, opacity: 0.95 }}
            />
            <Polyline
              positions={polylinePositions}
              pathOptions={{
                color: '#0E6B4E',
                weight: 5.5,
                opacity: 1,
                className: animateRecovery ? 'nx-recovery-ribbon' : undefined,
              }}
            />
          </>
        )}

        {position && (
          <>
            {position.accuracy > 25 && (
              <Circle
                center={[position.lat, position.lng]}
                radius={Math.min(position.accuracy, 2000)}
                pathOptions={{
                  color: '#2F6FDE',
                  fillColor: '#2F6FDE',
                  fillOpacity: 0.14,
                  weight: 1.5,
                }}
              />
            )}
            <Marker
              position={[position.lat, position.lng]}
              icon={driverVehicleIcon ?? gpsDotIcon}
            >
              <Popup>
                <span className="font-bold text-[#1F2A2E]">
                  {position.isSimulated ? `${t.simulatedBadge} GPS` : t.gpsReady}
                </span>
              </Popup>
            </Marker>
          </>
        )}

        {pickupPin && onPickupDragEnd && (
          <Marker
            position={[pickupPin.lat, pickupPin.lng]}
            icon={pickupPinIcon}
            draggable
            zIndexOffset={450}
            eventHandlers={{
              dragend: (e) => {
                const ll = (e.target as L.Marker).getLatLng();
                onPickupDragEnd({ lat: ll.lat, lng: ll.lng });
              },
            }}
          >
            <Popup>
              <span className="font-bold text-[#1F2A2E]">{t.studentPickupLabel}</span>
            </Popup>
          </Marker>
        )}

        {liveVehicles.map((v) => (
          <Marker
            key={v.tripId}
            position={[v.lat, v.lng]}
            icon={createVehicleLeafletIcon(v.vehicleType, v.isOffline, v.isBroken, v.isDrill)}
            zIndexOffset={v.isSelected ? 500 : v.isBroken ? 200 : 300}
            eventHandlers={
              onSelectVehicleTrip
                ? {
                    click: () => onSelectVehicleTrip(v.tripId),
                  }
                : undefined
            }
          >
            <Popup>
              <div className="text-sm text-[#1F2A2E] space-y-1">
                <p className="font-bold">
                  {v.driverName}
                  {v.isDrill ? ' · DRILL' : ''}
                </p>
                <p className="text-xs text-[#526066] tabular-nums">
                  {v.isBroken
                    ? t.tripStatusUnavailable
                    : `${v.seatsFree} ${t.seatsLeftSuffix}${v.isOffline ? ` · ${t.vehicleOfflineBadge}` : ''}`}
                </p>
                {v.driverVerified === false ? (
                  <p className="text-xs font-bold text-[#D7352B]">{t.mapPopupUnverified}</p>
                ) : v.driverVerified === true ? (
                  <p className="text-xs font-bold text-[#0E6B4E]">{t.mapPopupVerified}</p>
                ) : null}
              </div>
            </Popup>
          </Marker>
        ))}

        {examStudents.map((st) => (
          <Marker
            key={st.id}
            position={[st.lat, st.lng]}
            icon={createExamStudentIcon(st.isAtRisk, st.unreachable, st.isDrill)}
            zIndexOffset={420}
          >
            <Popup>
              <div className="text-sm text-[#1F2A2E] space-y-0.5">
                <p className="font-bold">
                  {st.name}
                  {st.isDrill ? ' · DRILL' : ''}
                </p>
                {st.detail && <p className="text-xs text-[#526066]">{st.detail}</p>}
              </div>
            </Popup>
          </Marker>
        ))}

        {selectedPlace && (
          <Marker position={[selectedPlace.lat, selectedPlace.lng]} icon={placeSignIcon}>
            <Popup>
              <div className="text-sm text-[#1F2A2E]">
                <p className="font-bold">{selectedPlace.name}</p>
                {selectedPlace.subtitle && (
                  <p className="text-xs text-[#526066] mt-0.5">{selectedPlace.subtitle}</p>
                )}
              </div>
            </Popup>
          </Marker>
        )}

        {demandClusters.map((cluster) => (
          <Marker
            key={cluster.id}
            position={[cluster.lat, cluster.lng]}
            icon={createDemandPinIcon(cluster.count)}
          >
            <Popup>
              <div className="text-sm text-[#1F2A2E] space-y-2 min-w-[180px]">
                <p className="font-bold">
                  {cluster.count === 1
                    ? t.driverDemandWaitingSingle
                    : `${cluster.count} ${t.driverDemandWaitingPlural}`}
                </p>
                <p className="text-xs text-[#526066]">{cluster.primaryDestination}</p>
                {onOfferDemandCluster && (
                  <button
                    type="button"
                    onClick={() => onOfferDemandCluster(cluster)}
                    className="w-full min-h-[40px] px-3 rounded-lg bg-[#0E6B4E] text-white text-xs font-bold"
                  >
                    {t.driverTakeThemBtn}
                  </button>
                )}
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>

      {tileErrorCount > 0 && (
        <div
          role="alert"
          data-testid="map-tile-error"
          className="absolute top-3 left-3 right-16 z-[500] bg-white border-2 border-[#D7352B] rounded-xl px-4 py-3 shadow-sm flex items-center justify-between gap-3"
        >
          <p className="text-sm font-medium text-[#1F2A2E]">{t.mapTileError}</p>
          <button
            type="button"
            onClick={() => {
              setTileErrorCount(0);
              setTileLayerKey((k) => k + 1);
            }}
            className="min-h-[44px] px-3 rounded-lg bg-[#1F2A2E] text-white text-sm font-bold inline-flex items-center gap-1.5 shrink-0"
          >
            <RotateCcw className="w-4 h-4" aria-hidden="true" />
            <span>{t.retry}</span>
          </button>
        </div>
      )}
    </div>
  );
}
