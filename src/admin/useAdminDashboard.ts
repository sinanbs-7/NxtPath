import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  collection,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  writeBatch,
} from 'firebase/firestore';
import { useAuth } from '../auth/AuthContext';
import { db, handleFirestoreError, OperationType } from '../firebase/config';
import type {
  DemandPin,
  SeatRequest,
  Trip,
  TripReport,
  UserProfile,
} from '../types/firestore';
import { computeAdminStats } from './adminStats';

export function useAdminDashboard(enabled: boolean) {
  const { authReady, firebaseUser, isAdmin } = useAuth();
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [seatRequests, setSeatRequests] = useState<SeatRequest[]>([]);
  const [demandPins, setDemandPins] = useState<DemandPin[]>([]);
  const [reports, setReports] = useState<TripReport[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyUid, setBusyUid] = useState<string | null>(null);
  const [adminError, setAdminError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || !authReady || !firebaseUser || !isAdmin) {
      setUsers([]);
      setTrips([]);
      setSeatRequests([]);
      setDemandPins([]);
      setReports([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    let usersDone = false;
    let tripsDone = false;
    let reqsDone = false;
    let pinsDone = false;
    let reportsDone = false;
    const checkDone = () => {
      if (usersDone && tripsDone && reqsDone && pinsDone && reportsDone) {
        setLoading(false);
      }
    };

    const unsubUsers = onSnapshot(
      query(collection(db, 'users')),
      (snap) => {
        setUsers(snap.docs.map((d) => d.data() as UserProfile));
        usersDone = true;
        checkDone();
      },
      (error) => {
        setLoading(false);
        handleFirestoreError(error, OperationType.LIST, 'users');
      },
    );

    const unsubTrips = onSnapshot(
      query(collection(db, 'trips')),
      (snap) => {
        setTrips(
          snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Trip, 'id'>) })),
        );
        tripsDone = true;
        checkDone();
      },
      (error) => {
        setLoading(false);
        handleFirestoreError(error, OperationType.LIST, 'trips');
      },
    );

    const unsubReqs = onSnapshot(
      query(collection(db, 'seatRequests')),
      (snap) => {
        setSeatRequests(
          snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<SeatRequest, 'id'>) })),
        );
        reqsDone = true;
        checkDone();
      },
      (error) => {
        setLoading(false);
        handleFirestoreError(error, OperationType.LIST, 'seatRequests');
      },
    );

    const unsubPins = onSnapshot(
      query(collection(db, 'demandPins')),
      (snap) => {
        setDemandPins(
          snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<DemandPin, 'id'>) })),
        );
        pinsDone = true;
        checkDone();
      },
      (error) => {
        setLoading(false);
        handleFirestoreError(error, OperationType.LIST, 'demandPins');
      },
    );

    const unsubReports = onSnapshot(
      query(collection(db, 'reports')),
      (snap) => {
        setReports(
          snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<TripReport, 'id'>) })),
        );
        reportsDone = true;
        checkDone();
      },
      (error) => {
        setLoading(false);
        handleFirestoreError(error, OperationType.LIST, 'reports');
      },
    );

    return () => {
      unsubUsers();
      unsubTrips();
      unsubReqs();
      unsubPins();
      unsubReports();
    };
  }, [enabled, authReady, firebaseUser, isAdmin]);

  const stats = useMemo(
    () =>
      computeAdminStats({
        users,
        trips,
        seatRequests,
        demandPins,
        reports,
      }),
    [users, trips, seatRequests, demandPins, reports],
  );

  const toggleDriverVerification = useCallback(
    async (driver: UserProfile) => {
      if (!isAdmin) return;
      const nextVerified = !driver.verifiedDriver;
      setBusyUid(driver.uid);
      setAdminError(null);
      try {
        const batch = writeBatch(db);
        batch.update(doc(db, 'users', driver.uid), {
          verifiedDriver: nextVerified,
          updatedAt: serverTimestamp(),
        });

        // Sync active/scheduled trips belonging to this driver
        for (const tr of trips) {
          if (
            tr.driverId === driver.uid &&
            (tr.status === 'live' || tr.status === 'scheduled')
          ) {
            batch.update(doc(db, 'trips', tr.id), {
              driverVerified: nextVerified,
              updatedAt: serverTimestamp(),
            });
          }
        }

        await batch.commit();
      } catch (error) {
        setAdminError(error instanceof Error ? error.message : String(error));
        handleFirestoreError(error, OperationType.UPDATE, `users/${driver.uid}`);
      } finally {
        setBusyUid(null);
      }
    },
    [isAdmin, trips],
  );

  return {
    loading,
    stats,
    trips,
    seatRequests,
    demandPins,
    busyUid,
    adminError,
    toggleDriverVerification,
  };
}
