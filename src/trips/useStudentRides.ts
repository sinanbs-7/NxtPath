import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  collection,
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
import type { MatchedRideOption } from '../matching/matchRides';
import type {
  BlockedZone,
  DemandPin,
  LatLngPoint,
  LivePosition,
  SeatRequest,
  Trip,
  TripReport,
} from '../types/firestore';

function createdMillis(ts: unknown): number {
  if (!ts || typeof ts !== 'object') return Number.MAX_SAFE_INTEGER;
  const maybe = ts as { toMillis?: () => number; seconds?: number };
  if (typeof maybe.toMillis === 'function') return maybe.toMillis();
  if (typeof maybe.seconds === 'number') return maybe.seconds * 1000;
  return Number.MAX_SAFE_INTEGER;
}

export function useStudentRides(enabled: boolean) {
  const { firebaseUser, displayName, authReady } = useAuth();
  const [trips, setTrips] = useState<Trip[]>([]);
  const [livePositionsByTripId, setLivePositionsByTripId] = useState<
    Record<string, LivePosition>
  >({});
  const [studentRequests, setStudentRequests] = useState<SeatRequest[]>([]);
  const [demandPins, setDemandPins] = useState<DemandPin[]>([]);
  const [blockedZones, setBlockedZones] = useState<BlockedZone[]>([]);
  const [trackedTrip, setTrackedTrip] = useState<Trip | null>(null);
  const [trackedLivePos, setTrackedLivePos] = useState<LivePosition | null>(null);
  const [tripReports, setTripReports] = useState<TripReport[]>([]);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [dismissedRequestId, setDismissedRequestId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enabled || !authReady || !firebaseUser) {
      setTrips([]);
      setLivePositionsByTripId({});
      setStudentRequests([]);
      setDemandPins([]);
      setBlockedZones([]);
      setTripReports([]);
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

    const tripsQuery = query(
      collection(db, 'trips'),
      where('status', 'in', ['scheduled', 'live']),
    );
    const unsubTrips = onSnapshot(
      tripsQuery,
      (snap) => {
        const list = snap.docs
          .map((d) => ({ id: d.id, ...(d.data() as Omit<Trip, 'id'>) }))
          .sort((a, b) => createdMillis(b.createdAt) - createdMillis(a.createdAt));
        setTrips(list);
        tripsLoaded = true;
        checkDone();
      },
      (error) => {
        setLoading(false);
        handleFirestoreError(error, OperationType.LIST, 'trips');
      },
    );

    const liveQuery = query(collection(db, 'livePositions'));
    const unsubLive = onSnapshot(
      liveQuery,
      (snap) => {
        const next: Record<string, LivePosition> = {};
        for (const d of snap.docs) {
          const data = d.data() as LivePosition;
          next[d.id] = { ...data, tripId: data.tripId || d.id };
        }
        setLivePositionsByTripId(next);
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, 'livePositions');
      },
    );

    const reqQuery = query(collection(db, 'seatRequests'), where('studentId', '==', uid));
    const unsubReqs = onSnapshot(
      reqQuery,
      (snap) => {
        const list = snap.docs
          .map((d) => ({ id: d.id, ...(d.data() as Omit<SeatRequest, 'id'>) }))
          .sort((a, b) => createdMillis(b.createdAt) - createdMillis(a.createdAt));
        setStudentRequests(list);
        reqsLoaded = true;
        checkDone();
      },
      (error) => {
        setLoading(false);
        handleFirestoreError(error, OperationType.LIST, 'seatRequests');
      },
    );

    const pinQuery = query(collection(db, 'demandPins'), where('studentId', '==', uid));
    const unsubPins = onSnapshot(
      pinQuery,
      (snap) => {
        const list = snap.docs
          .map((d) => ({ id: d.id, ...(d.data() as Omit<DemandPin, 'id'>) }))
          .sort((a, b) => createdMillis(b.createdAt) - createdMillis(a.createdAt));
        setDemandPins(list);
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, 'demandPins');
      },
    );

    const reportsQuery = query(collection(db, 'reports'));
    const unsubReports = onSnapshot(
      reportsQuery,
      (snap) => {
        const list = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<TripReport, 'id'>),
        }));
        setTripReports(list);
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, 'reports');
      },
    );

    const zonesQuery = query(collection(db, 'blockedZones'), where('active', '==', true));
    const unsubZones = onSnapshot(
      zonesQuery,
      (snap) => {
        setBlockedZones(
          snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<BlockedZone, 'id'>) })),
        );
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, 'blockedZones');
      },
    );

    return () => {
      unsubTrips();
      unsubLive();
      unsubReqs();
      unsubPins();
      unsubReports();
      unsubZones();
    };
  }, [enabled, authReady, firebaseUser]);

  const activeRequest = useMemo(() => {
    const open = studentRequests.find(
      (r) => r.status === 'pending' || r.status === 'accepted',
    );
    if (open) return open;
    const latest = studentRequests[0] ?? null;
    if (latest && latest.id !== dismissedRequestId) return latest;
    return null;
  }, [studentRequests, dismissedRequestId]);

  useEffect(() => {
    if (!enabled || !authReady || !firebaseUser || !activeRequest) {
      setTrackedTrip(null);
      setTrackedLivePos(null);
      return;
    }

    const tripId = activeRequest.tripId;
    const unsubTrip = onSnapshot(
      doc(db, 'trips', tripId),
      (snap) => {
        if (snap.exists()) {
          setTrackedTrip({ id: snap.id, ...(snap.data() as Omit<Trip, 'id'>) });
        } else {
          setTrackedTrip(null);
        }
      },
      (error) => {
        handleFirestoreError(error, OperationType.GET, `trips/${tripId}`);
      },
    );

    const unsubLive = onSnapshot(
      doc(db, 'livePositions', tripId),
      (snap) => {
        if (snap.exists()) {
          const data = snap.data() as LivePosition;
          setTrackedLivePos({ ...data, tripId: data.tripId || snap.id });
        } else {
          setTrackedLivePos(null);
        }
      },
      (error) => {
        handleFirestoreError(error, OperationType.GET, `livePositions/${tripId}`);
      },
    );

    return () => {
      unsubTrip();
      unsubLive();
    };
  }, [enabled, authReady, firebaseUser, activeRequest?.tripId]);

  const activeDemandPin = useMemo(
    () => demandPins.find((p) => p.active) ?? null,
    [demandPins],
  );

  const askForSeat = useCallback(
    async (
      option: MatchedRideOption,
      pickup: LatLngPoint,
      destinationName: string,
      examOptions?: {
        examAtMs?: number | null;
        arriveBy?: string;
        destinationLat?: number;
        destinationLng?: number;
      },
    ): Promise<boolean> => {
      if (!firebaseUser) {
        setActionError('sign_in_required');
        return false;
      }

      setBusyAction(`ask:${option.trip.id}`);
      setActionError(null);
      setDismissedRequestId(null);

      const reqRef = doc(collection(db, 'seatRequests'));
      const cleanName = (displayName || 'Student').trim().slice(0, 80) || 'Student';
      const cleanDest =
        (destinationName || option.trip.destinationName).trim().slice(0, 160) ||
        option.trip.destinationName;

      try {
        await setDoc(reqRef, {
          tripId: option.trip.id,
          studentId: firebaseUser.uid,
          driverId: option.trip.driverId,
          studentName: cleanName,
          pickupLat: pickup.lat,
          pickupLng: pickup.lng,
          destinationName: cleanDest,
          ...(typeof examOptions?.destinationLat === 'number' &&
          typeof examOptions?.destinationLng === 'number'
            ? {
                destinationLat: examOptions.destinationLat,
                destinationLng: examOptions.destinationLng,
              }
            : {}),
          ...(examOptions?.arriveBy ? { arriveBy: examOptions.arriveBy } : {}),
          ...(examOptions?.examAtMs ? { examAt: Timestamp.fromMillis(examOptions.examAtMs) } : {}),
          status: 'pending',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        return true;
      } catch (error) {
        handleFirestoreError(error, OperationType.CREATE, `seatRequests/${reqRef.id}`);
      } finally {
        setBusyAction(null);
      }
    },
    [firebaseUser, displayName],
  );

  const cancelSeatRequest = useCallback(async (req: SeatRequest) => {
    setBusyAction(`cancel:${req.id}`);
    setDismissedRequestId(req.id);
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

  const markReachedSchool = useCallback(async (req: SeatRequest) => {
    setBusyAction(`complete:${req.id}`);
    try {
      await updateDoc(doc(db, 'seatRequests', req.id), {
        status: 'completed',
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `seatRequests/${req.id}`);
    } finally {
      setBusyAction(null);
    }
  }, []);

  const dismissTicket = useCallback((reqId: string) => {
    setDismissedRequestId(reqId);
  }, []);

  const createDemandPin = useCallback(
    async (
      pickup: LatLngPoint,
      destinationName: string,
      examOptions?: {
        examAtMs?: number | null;
        arriveBy?: string;
        destinationLat?: number;
        destinationLng?: number;
      },
    ): Promise<boolean> => {
      if (!firebaseUser) {
        setActionError('sign_in_required');
        return false;
      }

      setBusyAction('demand:create');
      setActionError(null);
      const pinRef = doc(collection(db, 'demandPins'));
      const cleanDest = destinationName.trim().slice(0, 160) || 'School';

      try {
        await setDoc(pinRef, {
          studentId: firebaseUser.uid,
          lat: pickup.lat,
          lng: pickup.lng,
          destinationName: cleanDest,
          ...(typeof examOptions?.destinationLat === 'number' &&
          typeof examOptions?.destinationLng === 'number'
            ? {
                destinationLat: examOptions.destinationLat,
                destinationLng: examOptions.destinationLng,
              }
            : {}),
          ...(examOptions?.arriveBy ? { arriveBy: examOptions.arriveBy } : {}),
          ...(examOptions?.examAtMs ? { examAt: Timestamp.fromMillis(examOptions.examAtMs) } : {}),
          active: true,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        return true;
      } catch (error) {
        handleFirestoreError(error, OperationType.CREATE, `demandPins/${pinRef.id}`);
      } finally {
        setBusyAction(null);
      }
    },
    [firebaseUser],
  );

  const cancelDemandPin = useCallback(async (pin: DemandPin) => {
    setBusyAction(`demand:cancel:${pin.id}`);
    try {
      await updateDoc(doc(db, 'demandPins', pin.id), {
        active: false,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `demandPins/${pin.id}`);
    } finally {
      setBusyAction(null);
    }
  }, []);

  const reportBusNoShow = useCallback(
    async (tripId: string, stopPoint: LatLngPoint): Promise<boolean> => {
      if (!firebaseUser) {
        setActionError('sign_in_required');
        return false;
      }

      const alreadyReported = tripReports.some(
        (r) =>
          r.tripId === tripId &&
          r.reporterId === firebaseUser.uid &&
          r.reason === 'bus_no_show',
      );
      if (alreadyReported) return true;

      setBusyAction(`noshow:${tripId}`);
      setActionError(null);
      const reportId = `${tripId}_${firebaseUser.uid}`.slice(0, 128);
      try {
        await setDoc(doc(db, 'reports', reportId), {
          tripId,
          reporterId: firebaseUser.uid,
          stopLat: stopPoint.lat,
          stopLng: stopPoint.lng,
          reason: 'bus_no_show',
          createdAt: serverTimestamp(),
        });
        return true;
      } catch (error) {
        handleFirestoreError(error, OperationType.CREATE, `reports/${reportId}`);
      } finally {
        setBusyAction(null);
      }
    },
    [firebaseUser, tripReports],
  );

  const switchToBackupRide = useCallback(
    async (
      oldRequest: SeatRequest,
      backupOption: MatchedRideOption,
      pickup: LatLngPoint,
      destinationName: string,
    ): Promise<boolean> => {
      if (!firebaseUser) {
        setActionError('sign_in_required');
        return false;
      }

      setBusyAction(`switch:${backupOption.trip.id}`);
      setActionError(null);
      setDismissedRequestId(null);

      const newReqRef = doc(collection(db, 'seatRequests'));
      const cleanName = (displayName || 'Student').trim().slice(0, 80) || 'Student';
      const cleanDest =
        (destinationName || backupOption.trip.destinationName).trim().slice(0, 160) ||
        backupOption.trip.destinationName;

      try {
        const batch = writeBatch(db);
        if (oldRequest.status === 'pending' || oldRequest.status === 'accepted') {
          batch.update(doc(db, 'seatRequests', oldRequest.id), {
            status: 'declined',
            updatedAt: serverTimestamp(),
          });
        }
        batch.set(newReqRef, {
          tripId: backupOption.trip.id,
          studentId: firebaseUser.uid,
          driverId: backupOption.trip.driverId,
          studentName: cleanName,
          pickupLat: pickup.lat,
          pickupLng: pickup.lng,
          destinationName: cleanDest,
          ...(oldRequest.examAt ? { examAt: oldRequest.examAt } : {}),
          ...(oldRequest.arriveBy ? { arriveBy: oldRequest.arriveBy } : {}),
          status: 'pending',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        await batch.commit();
        return true;
      } catch (error) {
        handleFirestoreError(error, OperationType.WRITE, `seatRequests/${newReqRef.id}`);
      } finally {
        setBusyAction(null);
      }
    },
    [firebaseUser, displayName],
  );

  const clearActionError = useCallback(() => setActionError(null), []);

  return {
    loading,
    trips,
    livePositionsByTripId,
    studentRequests,
    activeRequest,
    trackedTrip,
    trackedLivePos,
    tripReports,
    blockedZones,
    activeDemandPin,
    busyAction,
    actionError,
    clearActionError,
    askForSeat,
    cancelSeatRequest,
    markReachedSchool,
    dismissTicket,
    createDemandPin,
    cancelDemandPin,
    reportBusNoShow,
    switchToBackupRide,
  };
}
