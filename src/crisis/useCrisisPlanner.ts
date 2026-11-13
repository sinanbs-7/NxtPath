import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  addDoc,
  collection,
  doc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
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
import { fetchOsrmRoute, snapPointToRoadOsrm } from '../map/osrm';
import { haversineDistanceMeters } from '../trips/tripLogic';
import type {
  AppNotification,
  BlockedZone,
  CrisisPlanDocument,
  CrisisReallocationRecord,
  DemandPin,
  LatLngPoint,
  LivePosition,
  SeatRequest,
  Trip,
} from '../types/firestore';
import {
  buildCrisisChangeSignature,
  buildCrisisInputsFromFirestore,
  computeCrisisPlan,
} from './crisisEngine';
import { buildDrillVehicleSeeds, buildSurgeStudentSeeds } from './crisisDrillHelpers';
import type { CrisisPlanResult } from './types';

export const REPLAN_DEBOUNCE_MS = 3000;
const DRILL_RESTORES_STORAGE_KEY = 'nxtpath_drill_restores_v1';

interface DrillRestoreEntry {
  status: 'scheduled' | 'live';
}

function readDrillRestores(): Record<string, DrillRestoreEntry> {
  try {
    const raw = window.localStorage.getItem(DRILL_RESTORES_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, DrillRestoreEntry>) : {};
  } catch {
    return {};
  }
}

function writeDrillRestores(map: Record<string, DrillRestoreEntry>): void {
  try {
    if (Object.keys(map).length === 0) {
      window.localStorage.removeItem(DRILL_RESTORES_STORAGE_KEY);
    } else {
      window.localStorage.setItem(DRILL_RESTORES_STORAGE_KEY, JSON.stringify(map));
    }
  } catch {
    // ignore storage errors
  }
}

export interface StartCrisisDrillConfig {
  examStartMs: number;
  breakTripIds: string[];
  addDrillVehicles: boolean;
  anchorHint?: LatLngPoint | null;
}

export function useCrisisPlanner(input: {
  enabled: boolean;
  trips: Trip[];
  seatRequests: SeatRequest[];
  demandPins: DemandPin[];
}) {
  const { authReady, firebaseUser, isAdmin } = useAuth();
  const [livePositionsByTripId, setLivePositionsByTripId] = useState<
    Record<string, LivePosition>
  >({});
  const [blockedZones, setBlockedZones] = useState<BlockedZone[]>([]);
  const [savedPlans, setSavedPlans] = useState<CrisisPlanDocument[]>([]);
  const [reallocationNotifs, setReallocationNotifs] = useState<AppNotification[]>([]);
  const [plan, setPlan] = useState<CrisisPlanResult | null>(null);
  const [computing, setComputing] = useState(false);
  const [drillBusy, setDrillBusy] = useState<'starting' | 'ending' | null>(null);
  const [crisisError, setCrisisError] = useState<string | null>(null);
  const [approvedIds, setApprovedIds] = useState<Record<string, boolean>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [restoredCountHint, setRestoredCountHint] = useState<number>(() =>
    Object.keys(readDrillRestores()).length,
  );

  const lastSavedSigRef = useRef<string>('');
  const runIdRef = useRef(0);

  useEffect(() => {
    if (!input.enabled || !authReady || !firebaseUser || !isAdmin) {
      setLivePositionsByTripId({});
      setBlockedZones([]);
      setSavedPlans([]);
      setReallocationNotifs([]);
      return;
    }

    const unsubLive = onSnapshot(
      query(collection(db, 'livePositions')),
      (snap) => {
        const next: Record<string, LivePosition> = {};
        for (const d of snap.docs) {
          const data = d.data() as LivePosition;
          next[data.tripId || d.id] = { ...data, tripId: data.tripId || d.id };
        }
        setLivePositionsByTripId(next);
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, 'livePositions');
      },
    );

    const unsubZones = onSnapshot(
      query(collection(db, 'blockedZones')),
      (snap) => {
        setBlockedZones(
          snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<BlockedZone, 'id'>) })),
        );
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, 'blockedZones');
      },
    );

    const unsubPlans = onSnapshot(
      query(collection(db, 'crisisPlans'), orderBy('createdAt', 'desc'), limit(5)),
      (snap) => {
        setSavedPlans(
          snap.docs.map((d) => ({
            id: d.id,
            ...(d.data() as Omit<CrisisPlanDocument, 'id'>),
          })),
        );
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, 'crisisPlans');
      },
    );

    const unsubNotifs = onSnapshot(
      query(collection(db, 'notifications'), where('kind', '==', 'reallocation'), limit(40)),
      (snap) => {
        setReallocationNotifs(
          snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<AppNotification, 'id'>) })),
        );
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, 'notifications');
      },
    );

    return () => {
      unsubLive();
      unsubZones();
      unsubPlans();
      unsubNotifs();
    };
  }, [input.enabled, authReady, firebaseUser, isAdmin]);

  const isDrillActive = useMemo(() => {
    if (restoredCountHint > 0) return true;
    return (
      input.trips.some((t) => Boolean(t.isDrill)) ||
      input.seatRequests.some((r) => Boolean(r.isDrill)) ||
      input.demandPins.some((p) => Boolean(p.isDrill)) ||
      blockedZones.some((z) => Boolean(z.isDrill))
    );
  }, [
    restoredCountHint,
    input.trips,
    input.seatRequests,
    input.demandPins,
    blockedZones,
  ]);

  const reallocationStatusByTrip = useMemo(() => {
    const map: Record<string, 'pending' | 'accepted' | 'declined'> = {};
    for (const n of reallocationNotifs) {
      if (n.tripId) {
        map[n.tripId] = n.actionStatus ?? 'pending';
      }
    }
    return map;
  }, [reallocationNotifs]);

  const signature = useMemo(
    () =>
      buildCrisisChangeSignature({
        trips: input.trips,
        livePositionsByTripId,
        seatRequests: input.seatRequests,
        demandPins: input.demandPins,
        blockedZones,
      }),
    [input.trips, livePositionsByTripId, input.seatRequests, input.demandPins, blockedZones],
  );

  const runCompute = useCallback(
    async (persistToFirestore: boolean) => {
      if (!input.enabled || !firebaseUser || !isAdmin) return;

      const myRunId = ++runIdRef.current;
      setComputing(true);
      setCrisisError(null);

      try {
        const nowMs = Date.now();
        const normalized = buildCrisisInputsFromFirestore({
          trips: input.trips,
          livePositionsByTripId,
          seatRequests: input.seatRequests,
          demandPins: input.demandPins,
          nowMs,
        });

        const result = await computeCrisisPlan({
          vehicles: normalized.vehicles,
          students: normalized.students,
          blockedZones,
          nowMs,
        });

        if (myRunId !== runIdRef.current) return;
        setPlan(result);

        const hasData =
          normalized.vehicles.length > 0 ||
          normalized.students.length > 0 ||
          blockedZones.length > 0;

        if (persistToFirestore && hasData && signature !== lastSavedSigRef.current) {
          lastSavedSigRef.current = signature;
          const hasDrill =
            normalized.vehicles.some((v) => v.isDrill) ||
            normalized.students.some((s) => s.isDrill) ||
            blockedZones.some((z) => z.isDrill);

          await addDoc(collection(db, 'crisisPlans'), {
            createdBy: firebaseUser.uid,
            createdAt: serverTimestamp(),
            assignments: result.assignments.slice(0, 1000),
            unreachable: result.unreachable.slice(0, 1000),
            reallocations: result.reallocations.slice(0, 500),
            kpis: result.kpis,
            fcfsKpis: result.fcfsKpis,
            validationErrors: result.validationErrors.slice(0, 500),
            isDrill: hasDrill,
          });
        }
      } catch (error) {
        if (myRunId === runIdRef.current) {
          setCrisisError(error instanceof Error ? error.message : String(error));
        }
      } finally {
        if (myRunId === runIdRef.current) {
          setComputing(false);
        }
      }
    },
    [
      input.enabled,
      input.trips,
      input.seatRequests,
      input.demandPins,
      livePositionsByTripId,
      blockedZones,
      firebaseUser,
      isAdmin,
      signature,
    ],
  );

  useEffect(() => {
    if (!input.enabled || !authReady || !firebaseUser || !isAdmin) return;
    const timer = window.setTimeout(() => {
      void runCompute(true);
    }, REPLAN_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [input.enabled, authReady, firebaseUser, isAdmin, signature, runCompute]);

  const replanNow = useCallback(async () => {
    lastSavedSigRef.current = '';
    await runCompute(true);
  }, [runCompute]);

  const createBlockedZone = useCallback(
    async (params: {
      label: string;
      lat: number;
      lng: number;
      radiusMeters: number;
      isDrill?: boolean;
    }): Promise<boolean> => {
      if (!firebaseUser || !isAdmin) return false;
      const cleanLabel = params.label.trim().slice(0, 140);
      if (!cleanLabel) {
        setCrisisError('Blocked zone label is required.');
        return false;
      }
      if (
        !Number.isFinite(params.lat) ||
        !Number.isFinite(params.lng) ||
        params.lat < -90 ||
        params.lat > 90 ||
        params.lng < -180 ||
        params.lng > 180
      ) {
        setCrisisError('Enter valid latitude and longitude.');
        return false;
      }
      if (
        !Number.isFinite(params.radiusMeters) ||
        params.radiusMeters < 20 ||
        params.radiusMeters > 50000
      ) {
        setCrisisError('Radius must be between 20 m and 50,000 m.');
        return false;
      }

      setBusyId('add-zone');
      setCrisisError(null);
      try {
        await addDoc(collection(db, 'blockedZones'), {
          center: { lat: params.lat, lng: params.lng },
          radiusMeters: Math.round(params.radiusMeters),
          label: cleanLabel,
          createdBy: firebaseUser.uid,
          active: true,
          isDrill: Boolean(params.isDrill),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        return true;
      } catch (error) {
        setCrisisError(error instanceof Error ? error.message : String(error));
        handleFirestoreError(error, OperationType.CREATE, 'blockedZones');
        return false;
      } finally {
        setBusyId(null);
      }
    },
    [firebaseUser, isAdmin],
  );

  const toggleBlockedZone = useCallback(
    async (zone: BlockedZone) => {
      if (!firebaseUser || !isAdmin) return;
      setBusyId(zone.id);
      setCrisisError(null);
      try {
        await updateDoc(doc(db, 'blockedZones', zone.id), {
          active: !zone.active,
          updatedAt: serverTimestamp(),
        });
      } catch (error) {
        setCrisisError(error instanceof Error ? error.message : String(error));
        handleFirestoreError(error, OperationType.UPDATE, `blockedZones/${zone.id}`);
      } finally {
        setBusyId(null);
      }
    },
    [firebaseUser, isAdmin],
  );

  const approveReallocation = useCallback(
    async (proposal: CrisisReallocationRecord) => {
      if (!firebaseUser || !isAdmin) return;
      setBusyId(proposal.id);
      setCrisisError(null);
      try {
        const message = `Go to ${proposal.clusterPlace} to pick up ${proposal.studentCount} students with exams.`;
        await addDoc(collection(db, 'notifications'), {
          userId: proposal.driverId,
          title: 'Exam Day Crisis Reallocation',
          body: message,
          kind: 'reallocation',
          actionStatus: 'pending',
          tripId: proposal.tripId,
          clusterPlace: proposal.clusterPlace,
          studentCount: proposal.studentCount,
          isDrill: isDrillActive,
          read: false,
          createdAt: serverTimestamp(),
        });
        setApprovedIds((prev) => ({ ...prev, [proposal.id]: true }));
      } catch (error) {
        setCrisisError(error instanceof Error ? error.message : String(error));
        handleFirestoreError(error, OperationType.CREATE, 'notifications');
      } finally {
        setBusyId(null);
      }
    },
    [firebaseUser, isAdmin, isDrillActive],
  );

  const startCrisisDrill = useCallback(
    async (config: StartCrisisDrillConfig): Promise<boolean> => {
      if (!firebaseUser || !isAdmin) return false;
      setDrillBusy('starting');
      setCrisisError(null);

      try {
        const nowMs = Date.now();
        const batchTag = String(nowMs).slice(-6);

        // 1. Mark chosen real live/scheduled vehicles unavailable and record restore entries
        const restores = readDrillRestores();
        const toBreak = input.trips.filter(
          (t) => !t.isDrill && config.breakTripIds.includes(t.id) && (t.status === 'live' || t.status === 'scheduled'),
        );

        for (const trip of toBreak) {
          restores[trip.id] = { status: trip.status === 'scheduled' ? 'scheduled' : 'live' };
          await updateDoc(doc(db, 'trips', trip.id), {
            status: 'unavailable',
            updatedAt: serverTimestamp(),
          });
        }
        writeDrillRestores(restores);
        setRestoredCountHint(Object.keys(restores).length);

        // 2. Gather real student pickups & school destination to anchor demand surge
        const realPickups: Array<{
          studentId: string;
          pickup: LatLngPoint;
          destination?: LatLngPoint;
          destinationName?: string;
        }> = [];
        for (const r of input.seatRequests) {
          if (r.isDrill) continue;
          const trip = input.trips.find((t) => t.id === r.tripId);
          realPickups.push({
            studentId: r.studentId,
            pickup: { lat: r.pickupLat, lng: r.pickupLng },
            destination: trip
              ? { lat: trip.destinationLat, lng: trip.destinationLng }
              : undefined,
            destinationName: r.destinationName,
          });
        }
        for (const p of input.demandPins) {
          if (p.isDrill || !p.active) continue;
          realPickups.push({
            studentId: p.studentId,
            pickup: { lat: p.lat, lng: p.lng },
            destination:
              typeof p.destinationLat === 'number' && typeof p.destinationLng === 'number'
                ? { lat: p.destinationLat, lng: p.destinationLng }
                : undefined,
            destinationName: p.destinationName,
          });
        }

        const firstRealTrip = input.trips.find((t) => !t.isDrill) ?? input.trips[0];
        const anchorCenter: LatLngPoint =
          realPickups[0]?.pickup ??
          (firstRealTrip
            ? { lat: firstRealTrip.originLat, lng: firstRealTrip.originLng }
            : config.anchorHint ?? { lat: 12.5218, lng: 76.8951 });

        const defaultDest: LatLngPoint = firstRealTrip
          ? { lat: firstRealTrip.destinationLat, lng: firstRealTrip.destinationLng }
          : { lat: anchorCenter.lat + 0.025, lng: anchorCenter.lng + 0.028 };
        const defaultDestName = firstRealTrip?.destinationName || 'Government High School';

        // 3. Build & OSRM road-snap +40% (min 8, ~60% exam within 2h) drill students
        const studentSeeds = buildSurgeStudentSeeds({
          realPickups,
          anchorCenter,
          defaultDestination: defaultDest,
          defaultDestinationName: defaultDestName,
          examStartMs: config.examStartMs,
          nowMs,
        });

        const snappedPickups: LatLngPoint[] = [];
        for (let i = 0; i < studentSeeds.length; i += 4) {
          const chunk = studentSeeds.slice(i, i + 4);
          const resolved = await Promise.all(
            chunk.map(async (s) => (await snapPointToRoadOsrm(s.rawPickup)).point),
          );
          snappedPickups.push(...resolved);
        }

        const studentBatch = writeBatch(db);
        studentSeeds.forEach((seed, idx) => {
          const snapped = snappedPickups[idx] ?? seed.rawPickup;
          const pinId = `drill_pin_${batchTag}_${idx + 1}`;
          studentBatch.set(doc(db, 'demandPins', pinId), {
            studentId: `${seed.studentId}_${batchTag}`,
            lat: snapped.lat,
            lng: snapped.lng,
            destinationLat: seed.destination.lat,
            destinationLng: seed.destination.lng,
            destinationName: seed.destinationName,
            arriveBy: seed.arriveByHHmm,
            ...(seed.examAtMs !== null ? { examAt: Timestamp.fromMillis(seed.examAtMs) } : {}),
            active: true,
            isDrill: true,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        });
        await studentBatch.commit();

        // 4. Optional drill backup vehicles so seats exist to plan with
        if (config.addDrillVehicles) {
          const vehicleSeeds = buildDrillVehicleSeeds({
            anchorCenter,
            destination: defaultDest,
            destinationName: defaultDestName,
            batchTag,
          });

          for (const vSeed of vehicleSeeds) {
            let routeGeometry: LatLngPoint[] = [vSeed.origin, vSeed.destination];
            let cumulativeDurations: number[] = [0, 720];
            let distanceMeters = Math.round(haversineDistanceMeters(vSeed.origin, vSeed.destination));
            let durationSeconds = 720;

            try {
              const { route: osrm } = await fetchOsrmRoute(vSeed.origin, vSeed.destination);
              routeGeometry = osrm.routeGeometry;
              cumulativeDurations = osrm.cumulativeDurations;
              distanceMeters = osrm.distanceMeters;
              durationSeconds = osrm.durationSeconds;
            } catch {
              // Fallback geometry keeps drill functional offline
            }

            await setDoc(doc(db, 'trips', vSeed.tripId), {
              driverId: vSeed.driverId,
              driverName: vSeed.driverName,
              driverVerified: true,
              vehicleType: vSeed.vehicleType,
              seatsTotal: vSeed.seatsTotal,
              seatsFree: vSeed.seatsTotal,
              originName: vSeed.originName,
              originLat: vSeed.origin.lat,
              originLng: vSeed.origin.lng,
              destinationName: vSeed.destinationName,
              destinationLat: vSeed.destination.lat,
              destinationLng: vSeed.destination.lng,
              departureTime: serverTimestamp(),
              status: 'live',
              routeGeometry,
              cumulativeDurations,
              distanceMeters,
              durationSeconds,
              isDrill: true,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });

            await setDoc(doc(db, 'livePositions', vSeed.tripId), {
              tripId: vSeed.tripId,
              driverId: vSeed.driverId,
              lat: vSeed.origin.lat,
              lng: vSeed.origin.lng,
              speed: 8.5,
              accuracy: 10,
              isDrill: true,
              updatedAt: serverTimestamp(),
            });
          }
        }

        lastSavedSigRef.current = '';
        await runCompute(true);
        return true;
      } catch (error) {
        setCrisisError(error instanceof Error ? error.message : String(error));
        return false;
      } finally {
        setDrillBusy(null);
      }
    },
    [firebaseUser, isAdmin, input.trips, input.seatRequests, input.demandPins, runCompute],
  );

  const endCrisisDrill = useCallback(async (): Promise<boolean> => {
    if (!firebaseUser || !isAdmin) return false;
    setDrillBusy('ending');
    setCrisisError(null);

    try {
      // 1. Restore broken real vehicles
      const restores = readDrillRestores();
      for (const [tripId, entry] of Object.entries(restores)) {
        try {
          await updateDoc(doc(db, 'trips', tripId), {
            status: entry.status,
            updatedAt: serverTimestamp(),
          });
        } catch {
          // Trip may have been ended/removed in meantime
        }
      }
      writeDrillRestores({});
      setRestoredCountHint(0);

      // 2. Delete all isDrill === true records across collections
      const drillCollections = [
        'trips',
        'livePositions',
        'seatRequests',
        'demandPins',
        'blockedZones',
        'notifications',
        'crisisPlans',
      ] as const;

      for (const colName of drillCollections) {
        const snap = await getDocs(
          query(collection(db, colName), where('isDrill', '==', true)),
        );
        if (snap.empty) continue;

        for (let i = 0; i < snap.docs.length; i += 400) {
          const batch = writeBatch(db);
          snap.docs.slice(i, i + 400).forEach((d) => batch.delete(d.ref));
          await batch.commit();
        }
      }

      setApprovedIds({});
      lastSavedSigRef.current = '';
      await runCompute(false);
      return true;
    } catch (error) {
      setCrisisError(error instanceof Error ? error.message : String(error));
      return false;
    } finally {
      setDrillBusy(null);
    }
  }, [firebaseUser, isAdmin, runCompute]);

  return {
    plan,
    livePositionsByTripId,
    blockedZones,
    savedPlans,
    reallocationStatusByTrip,
    computing,
    drillBusy,
    isDrillActive,
    crisisError,
    approvedIds,
    busyId,
    replanNow,
    createBlockedZone,
    toggleBlockedZone,
    approveReallocation,
    startCrisisDrill,
    endCrisisDrill,
  };
}
