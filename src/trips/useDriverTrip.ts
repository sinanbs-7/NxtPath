import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { useAuth } from '../auth/AuthContext';
import { db, handleFirestoreError, OperationType } from '../firebase/config';
import type { OsrmRouteResult } from '../map/osrm';
import type { UseGeolocationResult } from '../map/useGeolocation';
import type {
  DemandPin,
  LatLngPoint,
  SeatRequest,
  Trip,
  VehicleType,
} from '../types/firestore';
import { clusterDemandPins, generateRideCode, type DemandCluster } from './tripLogic';

function createdMillis(ts: unknown): number {
  if (!ts || typeof ts !== 'object') return Number.MAX_SAFE_INTEGER;
  const maybe = ts as { toMillis?: () => number; seconds?: number };
  if (typeof maybe.toMillis === 'function') return maybe.toMillis();
  if (typeof maybe.seconds === 'number') return maybe.seconds * 1000;
  return Number.MAX_SAFE_INTEGER;
}

export interface StartTripInput {
  vehicleType: VehicleType;
  seatsTotal: number;
  originName: string;
  origin: LatLngPoint;
  destinationName: string;
  destination: LatLngPoint;
  departureMode: 'now' | 'later';
  departureDate: Date;
  route: OsrmRouteResult;
}

interface WakeLockSentinelLike {
  released: boolean;
  release: () => Promise<void>;
}

export function useDriverTrip(geo: UseGeolocationResult, enabled: boolean) {
  const { firebaseUser, userProfile, displayName, authReady } = useAuth();
  const [driverTrips, setDriverTrips] = useState<Trip[]>([]);
  const [seatRequests, setSeatRequests] = useState<SeatRequest[]>([]);
  const [demandPins, setDemandPins] = useState<DemandPin[]>([]);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [tripError, setTripError] = useState<string | null>(null);
  const [wakeLockActive, setWakeLockActive] = useState(false);
  const [lastGpsSyncAt, setLastGpsSyncAt] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  const wakeLockRef = useRef<WakeLockSentinelLike | null>(null);
  const lastWriteMsRef = useRef<number>(0);
  const latestGeoRef = useRef(geo.position);
  latestGeoRef.current = geo.position;

  useEffect(() => {
    if (!enabled || !authReady || !firebaseUser) {
      setDriverTrips([]);
      setSeatRequests([]);
      setDemandPins([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    let tripsLoaded = false;
    let reqsLoaded = false;
    const checkDone = () => {
      if (tripsLoaded && reqsLoaded) {
        setLoading(false);
      }
    };

    const uid = firebaseUser.uid;

    const tripsQuery = query(collection(db, 'trips'), where('driverId', '==', uid));

    const unsubTrips = onSnapshot(
      tripsQuery,
      (snap) => {
        const list = snap.docs
          .map((d) => ({ id: d.id, ...(d.data() as Omit<Trip, 'id'>) }))
          .sort((a, b) => createdMillis(b.createdAt) - createdMillis(a.createdAt));
        setDriverTrips(list);
        tripsLoaded = true;
        checkDone();
      },
      (error) => {
        setLoading(false);
        handleFirestoreError(error, OperationType.LIST, 'trips');
      },
    );

    const reqQuery = query(collection(db, 'seatRequests'), where('driverId', '==', uid));

    const unsubReqs = onSnapshot(
      reqQuery,
      (snap) => {
        const list = snap.docs
          .map((d) => ({
            id: d.id,
            ...(d.data() as Omit<SeatRequest, 'id'>),
          }))
          .sort((a, b) => createdMillis(b.createdAt) - createdMillis(a.createdAt));
        setSeatRequests(list);
        reqsLoaded = true;
        checkDone();
      },
      (error) => {
        setLoading(false);
        handleFirestoreError(error, OperationType.LIST, 'seatRequests');
      },
    );

    const pinsQuery = query(collection(db, 'demandPins'), where('active', '==', true));

    const unsubPins = onSnapshot(
      pinsQuery,
      (snap) => {
        const list = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<DemandPin, 'id'>),
        }));
        setDemandPins(list);
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, 'demandPins');
      },
    );

    return () => {
      unsubTrips();
      unsubReqs();
      unsubPins();
    };
  }, [enabled, authReady, firebaseUser]);

  const activeTrip = useMemo(
    () => driverTrips.find((tr) => tr.status === 'live') ?? null,
    [driverTrips],
  );

  const scheduledTrips = useMemo(
    () => driverTrips.filter((tr) => tr.status === 'scheduled'),
    [driverTrips],
  );

  const activeTripRequests = useMemo(() => {
    if (!activeTrip) return [];
    return seatRequests.filter((r) => r.tripId === activeTrip.id);
  }, [activeTrip, seatRequests]);

  const pendingRequests = useMemo(
    () => activeTripRequests.filter((r) => r.status === 'pending'),
    [activeTripRequests],
  );

  const acceptedRequests = useMemo(
    () => activeTripRequests.filter((r) => r.status === 'accepted'),
    [activeTripRequests],
  );

  const demandClusters = useMemo<DemandCluster[]>(
    () => clusterDemandPins(demandPins, 150),
    [demandPins],
  );

  // Screen Wake Lock while live trip is running
  useEffect(() => {
    if (!enabled || !activeTrip || activeTrip.status !== 'live') {
      if (wakeLockRef.current) {
        void wakeLockRef.current.release().catch(() => {});
        wakeLockRef.current = null;
      }
      setWakeLockActive(false);
      return;
    }

    let cancelled = false;

    const acquireWakeLock = async () => {
      try {
        const nav = navigator as Navigator & {
          wakeLock?: { request: (type: 'screen') => Promise<WakeLockSentinelLike> };
        };
        if (!nav.wakeLock || cancelled) return;
        const sentinel = await nav.wakeLock.request('screen');
        if (cancelled) {
          await sentinel.release().catch(() => {});
          return;
        }
        wakeLockRef.current = sentinel;
        setWakeLockActive(true);
      } catch {
        setWakeLockActive(false);
      }
    };

    void acquireWakeLock();

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        void acquireWakeLock();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibility);
      if (wakeLockRef.current) {
        void wakeLockRef.current.release().catch(() => {});
        wakeLockRef.current = null;
      }
      setWakeLockActive(false);
    };
  }, [enabled, activeTrip?.id, activeTrip?.status]);

  // Write livePosition at most once every 5s while trip is live
  const publishLivePosition = useCallback(
    async (tripId: string, driverId: string, force = false) => {
      const pos = latestGeoRef.current;
      if (!pos) return;
      const now = Date.now();
      if (!force && now - lastWriteMsRef.current < 4800) return;
      lastWriteMsRef.current = now;

      const path = `livePositions/${tripId}`;
      const payload: Record<string, unknown> = {
        tripId,
        driverId,
        lat: pos.lat,
        lng: pos.lng,
        accuracy: Math.min(10000, Math.max(0, pos.accuracy)),
        updatedAt: serverTimestamp(),
      };
      if (typeof pos.heading === 'number' && Number.isFinite(pos.heading) && pos.heading >= 0 && pos.heading <= 360) {
        payload.heading = pos.heading;
      }
      if (typeof pos.speed === 'number' && Number.isFinite(pos.speed) && pos.speed >= 0 && pos.speed <= 200) {
        payload.speed = pos.speed;
      }

      try {
        await setDoc(doc(db, 'livePositions', tripId), payload);
        setLastGpsSyncAt(now);
      } catch (error) {
        handleFirestoreError(error, OperationType.WRITE, path);
      }
    },
    [],
  );

  useEffect(() => {
    if (!enabled || !activeTrip || activeTrip.status !== 'live' || !firebaseUser) {
      return;
    }

    void publishLivePosition(activeTrip.id, firebaseUser.uid, true);

    const interval = window.setInterval(() => {
      void publishLivePosition(activeTrip.id, firebaseUser.uid, false);
    }, 5000);

    return () => {
      window.clearInterval(interval);
    };
  }, [enabled, activeTrip?.id, activeTrip?.status, firebaseUser, publishLivePosition]);

  // Also trigger rate-limited publish when new GPS fix arrives
  useEffect(() => {
    if (!enabled || !activeTrip || activeTrip.status !== 'live' || !firebaseUser || !geo.position) {
      return;
    }
    void publishLivePosition(activeTrip.id, firebaseUser.uid, false);
  }, [
    enabled,
    activeTrip?.id,
    activeTrip?.status,
    firebaseUser,
    geo.position?.lat,
    geo.position?.lng,
    geo.position?.timestamp,
    publishLivePosition,
  ]);

  const startTrip = useCallback(
    async (input: StartTripInput): Promise<boolean> => {
      if (!firebaseUser) {
        setTripError('sign_in_required');
        return false;
      }

      setBusyAction('start');
      setTripError(null);
      const tripRef = doc(collection(db, 'trips'));
      const tripId = tripRef.id;
      const status = input.departureMode === 'now' ? 'live' : 'scheduled';

      const payload = {
        driverId: firebaseUser.uid,
        driverName: (displayName || 'Driver').slice(0, 80),
        driverVerified: Boolean(userProfile?.verifiedDriver),
        vehicleType: input.vehicleType,
        originName: input.originName.slice(0, 160),
        originLat: input.origin.lat,
        originLng: input.origin.lng,
        destinationName: input.destinationName.slice(0, 160),
        destinationLat: input.destination.lat,
        destinationLng: input.destination.lng,
        distanceMeters: Math.round(input.route.distanceMeters),
        durationSeconds: Math.round(input.route.durationSeconds),
        seatsFree: Math.max(1, Math.min(80, Math.round(input.seatsTotal))),
        seatsTotal: Math.max(1, Math.min(80, Math.round(input.seatsTotal))),
        status,
        routeGeometry: input.route.routeGeometry,
        cumulativeDurations: input.route.cumulativeDurations,
        departureTime: Timestamp.fromDate(input.departureDate),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };

      try {
        await setDoc(tripRef, payload);
        if (status === 'live' && latestGeoRef.current) {
          await publishLivePosition(tripId, firebaseUser.uid, true);
        }
        return true;
      } catch (error) {
        handleFirestoreError(error, OperationType.CREATE, `trips/${tripId}`);
      } finally {
        setBusyAction(null);
      }
    },
    [firebaseUser, displayName, userProfile?.verifiedDriver, publishLivePosition],
  );

  const activateScheduledTrip = useCallback(
    async (tripId: string) => {
      if (!firebaseUser) return;
      setBusyAction(`activate:${tripId}`);
      setTripError(null);
      try {
        await updateDoc(doc(db, 'trips', tripId), {
          status: 'live',
          updatedAt: serverTimestamp(),
        });
        if (latestGeoRef.current) {
          await publishLivePosition(tripId, firebaseUser.uid, true);
        }
      } catch (error) {
        handleFirestoreError(error, OperationType.UPDATE, `trips/${tripId}`);
      } finally {
        setBusyAction(null);
      }
    },
    [firebaseUser, publishLivePosition],
  );

  const adjustSeatsFree = useCallback(
    async (delta: number) => {
      if (!activeTrip) return;
      const next = Math.max(0, Math.min(activeTrip.seatsTotal, activeTrip.seatsFree + delta));
      if (next === activeTrip.seatsFree) return;
      setBusyAction('seats');
      try {
        await updateDoc(doc(db, 'trips', activeTrip.id), {
          seatsFree: next,
          updatedAt: serverTimestamp(),
        });
      } catch (error) {
        handleFirestoreError(error, OperationType.UPDATE, `trips/${activeTrip.id}`);
      } finally {
        setBusyAction(null);
      }
    },
    [activeTrip],
  );

  const acceptSeatRequest = useCallback(
    async (req: SeatRequest) => {
      if (!activeTrip) return;
      setBusyAction(`accept:${req.id}`);
      try {
        const batch = writeBatch(db);
        const rideCode = generateRideCode();
        batch.update(doc(db, 'seatRequests', req.id), {
          status: 'accepted',
          rideCode,
          updatedAt: serverTimestamp(),
        });
        const nextSeats = Math.max(0, activeTrip.seatsFree - 1);
        batch.update(doc(db, 'trips', activeTrip.id), {
          seatsFree: nextSeats,
          updatedAt: serverTimestamp(),
        });
        await batch.commit();
      } catch (error) {
        handleFirestoreError(error, OperationType.UPDATE, `seatRequests/${req.id}`);
      } finally {
        setBusyAction(null);
      }
    },
    [activeTrip],
  );

  const declineSeatRequest = useCallback(async (req: SeatRequest) => {
    setBusyAction(`decline:${req.id}`);
    try {
      await updateDoc(doc(db, 'seatRequests', req.id), {
        status: 'declined',
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `seatRequests/${req.id}`);
    } finally {
      setBusyAction(null);
    }
  }, []);

  const offerRideToDemandPin = useCallback(
    async (pin: DemandPin) => {
      if (!firebaseUser || !activeTrip) return;
      setBusyAction(`pin:${pin.id}`);
      try {
        await updateDoc(doc(db, 'demandPins', pin.id), {
          offeredByDriverId: firebaseUser.uid,
          offeredByDriverName: (displayName || 'Driver').slice(0, 80),
          offeredTripId: activeTrip.id,
          updatedAt: serverTimestamp(),
        });
      } catch (error) {
        handleFirestoreError(error, OperationType.UPDATE, `demandPins/${pin.id}`);
      } finally {
        setBusyAction(null);
      }
    },
    [firebaseUser, activeTrip, displayName],
  );

  const finishTripWithStatus = useCallback(
    async (status: 'completed' | 'disrupted') => {
      if (!activeTrip) return;
      setBusyAction(status);
      try {
        await updateDoc(doc(db, 'trips', activeTrip.id), {
          status,
          updatedAt: serverTimestamp(),
        });
        await deleteDoc(doc(db, 'livePositions', activeTrip.id)).catch(() => {
          // livePositions doc may not exist if GPS was never granted
        });
        setLastGpsSyncAt(null);
      } catch (error) {
        handleFirestoreError(error, OperationType.UPDATE, `trips/${activeTrip.id}`);
      } finally {
        setBusyAction(null);
      }
    },
    [activeTrip],
  );

  const endTrip = useCallback(() => finishTripWithStatus('completed'), [finishTripWithStatus]);
  const reportBreakdown = useCallback(
    () => finishTripWithStatus('disrupted'),
    [finishTripWithStatus],
  );

  const clearTripError = useCallback(() => setTripError(null), []);

  return {
    loading,
    driverTrips,
    activeTrip,
    scheduledTrips,
    seatRequests,
    pendingRequests,
    acceptedRequests,
    demandClusters,
    busyAction,
    tripError,
    clearTripError,
    wakeLockActive,
    lastGpsSyncAt,
    startTrip,
    activateScheduledTrip,
    adjustSeatsFree,
    acceptSeatRequest,
    declineSeatRequest,
    offerRideToDemandPin,
    endTrip,
    reportBreakdown,
  };
}
