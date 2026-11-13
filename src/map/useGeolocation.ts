import { useCallback, useEffect, useRef, useState } from 'react';

export type GpsPermissionState = 'prompt' | 'granted' | 'denied' | 'unavailable';

export interface GpsReading {
  lat: number;
  lng: number;
  accuracy: number;
  heading: number | null;
  speed: number | null;
  timestamp: number;
  isSimulated: boolean;
}

export interface UseGeolocationResult {
  position: GpsReading | null;
  permissionState: GpsPermissionState;
  loading: boolean;
  errorMessage: string | null;
  isDebugMode: boolean;
  requestLocation: () => void;
  setSimulatedPosition: (lat: number, lng: number, accuracy?: number) => void;
  clearSimulatedPosition: () => void;
}

export function isDebugQueryEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('debug') === '1';
}

export function useGeolocation(): UseGeolocationResult {
  const [isDebugMode] = useState<boolean>(() => isDebugQueryEnabled());
  const [realPosition, setRealPosition] = useState<GpsReading | null>(null);
  const [simulatedPos, setSimulatedPos] = useState<GpsReading | null>(null);
  const [permissionState, setPermissionState] = useState<GpsPermissionState>(() => {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      return 'unavailable';
    }
    return 'prompt';
  });
  const [loading, setLoading] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const watchIdRef = useRef<number | null>(null);

  const stopWatch = useCallback(() => {
    if (watchIdRef.current !== null && typeof navigator !== 'undefined' && navigator.geolocation) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
  }, []);

  const startWatch = useCallback(() => {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      setPermissionState('unavailable');
      setLoading(false);
      return;
    }

    stopWatch();
    setLoading(true);
    setErrorMessage(null);

    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        setPermissionState('granted');
        setLoading(false);
        setErrorMessage(null);
        setRealPosition({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          heading: typeof pos.coords.heading === 'number' ? pos.coords.heading : null,
          speed: typeof pos.coords.speed === 'number' ? pos.coords.speed : null,
          timestamp: pos.timestamp,
          isSimulated: false,
        });
      },
      (err) => {
        setLoading(false);
        if (err.code === err.PERMISSION_DENIED) {
          setPermissionState('denied');
        } else {
          setErrorMessage(err.message || 'Could not lock GPS signal.');
        }
      },
      {
        enableHighAccuracy: true,
        maximumAge: 5000,
        timeout: 15000,
      },
    );
  }, [stopWatch]);

  useEffect(() => {
    let active = true;
    if (typeof navigator !== 'undefined' && navigator.permissions && navigator.permissions.query) {
      navigator.permissions
        .query({ name: 'geolocation' })
        .then((status) => {
          if (!active) return;
          if (status.state === 'granted') {
            setPermissionState('granted');
            startWatch();
          } else if (status.state === 'denied') {
            setPermissionState('denied');
          } else {
            setPermissionState('prompt');
          }
          status.onchange = () => {
            if (!active) return;
            if (status.state === 'granted') {
              setPermissionState('granted');
              startWatch();
            } else if (status.state === 'denied') {
              setPermissionState('denied');
              stopWatch();
            } else {
              setPermissionState('prompt');
            }
          };
        })
        .catch(() => {
          // Permissions API not supported for geolocation; wait for explicit requestLocation
        });
    }
    return () => {
      active = false;
      stopWatch();
    };
  }, [startWatch, stopWatch]);

  const setSimulatedPosition = useCallback((lat: number, lng: number, accuracy = 12) => {
    setSimulatedPos({
      lat,
      lng,
      accuracy,
      heading: 0,
      speed: 0,
      timestamp: Date.now(),
      isSimulated: true,
    });
  }, []);

  const clearSimulatedPosition = useCallback(() => {
    setSimulatedPos(null);
  }, []);

  const position = isDebugMode && simulatedPos ? simulatedPos : realPosition;

  return {
    position,
    permissionState,
    loading,
    errorMessage,
    isDebugMode,
    requestLocation: startWatch,
    setSimulatedPosition,
    clearSimulatedPosition,
  };
}
