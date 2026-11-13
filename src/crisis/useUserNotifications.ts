import { useCallback, useEffect, useState } from 'react';
import {
  collection,
  doc,
  limit,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import { useAuth } from '../auth/AuthContext';
import { db, handleFirestoreError, OperationType } from '../firebase/config';
import { timestampToMillis } from '../matching/matchRides';
import type { AppNotification } from '../types/firestore';

export function useUserNotifications(enabled = true) {
  const { authReady, firebaseUser } = useAuth();
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [respondingId, setRespondingId] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || !authReady || !firebaseUser) {
      setNotifications([]);
      return;
    }

    const q = query(
      collection(db, 'notifications'),
      where('userId', '==', firebaseUser.uid),
      limit(25),
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        const list = snap.docs
          .map((d) => ({
            id: d.id,
            ...(d.data() as Omit<AppNotification, 'id'>),
          }))
          .sort(
            (a, b) =>
              (timestampToMillis(b.createdAt) ?? 0) - (timestampToMillis(a.createdAt) ?? 0),
          );
        setNotifications(list);
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, 'notifications');
      },
    );

    return () => unsub();
  }, [enabled, authReady, firebaseUser]);

  const markAsRead = useCallback(
    async (notificationId: string) => {
      if (!firebaseUser) return;
      try {
        await updateDoc(doc(db, 'notifications', notificationId), { read: true });
      } catch (error) {
        handleFirestoreError(error, OperationType.UPDATE, `notifications/${notificationId}`);
      }
    },
    [firebaseUser],
  );

  const respondToReallocation = useCallback(
    async (notificationId: string, decision: 'accepted' | 'declined') => {
      if (!firebaseUser) return;
      setRespondingId(notificationId);
      try {
        await updateDoc(doc(db, 'notifications', notificationId), {
          actionStatus: decision,
          respondedAt: serverTimestamp(),
          read: true,
        });
      } catch (error) {
        handleFirestoreError(error, OperationType.UPDATE, `notifications/${notificationId}`);
      } finally {
        setRespondingId(null);
      }
    },
    [firebaseUser],
  );

  const activeReallocations = notifications.filter(
    (n) =>
      n.kind === 'reallocation' &&
      (!n.read || n.actionStatus === 'accepted' || n.actionStatus === 'declined'),
  );

  const unreadReallocations = notifications.filter(
    (n) => n.kind === 'reallocation' && !n.read,
  );

  return {
    notifications,
    unreadReallocations,
    activeReallocations,
    respondingId,
    markAsRead,
    respondToReallocation,
  };
}
