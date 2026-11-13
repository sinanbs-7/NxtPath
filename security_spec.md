# Nxtpath Firestore Security Specification

## 1. Data Invariants
1. **Self-Owned Profiles & PII Isolation**: Users can only read/write their own `/users/{userId}` operational profile and `/users/{userId}/private/{docId}` PII document. Users can never self-assign `verifiedDriver: true` on create or update; only verified Admins can modify `verifiedDriver`.
2. **Driver-Owned Vehicles & Live Positions**: Only the vehicle owner (`ownerId == request.auth.uid`) can create/update their vehicle details, and only Admins can flip `verified`. Only the active trip driver (`trips/{tripId}.driverId == request.auth.uid`) can write or delete `/livePositions/{tripId}`.
3. **Immutable Ownership & Timestamps**: `uid`, `ownerId`, `driverId`, `studentId`, `reporterId`, and `createdAt` cannot be changed after document creation. `createdAt` and `updatedAt` must equal `request.time`.
4. **Terminal State Locking**: Once a `trip` reaches `completed` or a `seatRequest` reaches `declined`/`completed`, non-admin clients cannot reopen or mutate it.
5. **Query Enforcer**: All `allow list` rules explicitly validate `resource.data` against ownership or active operational visibility (`status in ['scheduled', 'live', 'disrupted']` or `active == true`).

## 2. The "Dirty Dozen" Adversarial Payloads (Must All Return PERMISSION_DENIED)
1. **Self-Verification Escalation (User Create)**: `{ uid: "u1", displayName: "Ravi", role: "driver", language: "en", verifiedDriver: true, onboardingComplete: true, createdAt: serverTime, updatedAt: serverTime }` -> Rejected (`verifiedDriver` must be `false` on create unless admin).
2. **Ghost Field Injection (User Update)**: `{ displayName: "Ravi", isAdmin: true, updatedAt: serverTime }` -> Rejected (`affectedKeys().hasOnly(...)` blocks `isAdmin`).
3. **PII Cross-User Read**: User `u2` calls `get(/users/u1/private/contact)` -> Rejected (`request.auth.uid != userId`).
4. **Live Position Hijack**: User `u2` (not the driver of `trip1`) writes `/livePositions/trip1` -> Rejected (`get(/trips/trip1).data.driverId != request.auth.uid`).
5. **Driver Self-Verify Vehicle**: Driver creates `/vehicles/v1` with `{ verified: true }` -> Rejected (`verified` must be `false` on create).
6. **Student Reassigns SeatRequest**: Student `s1` creates `/seatRequests/r1` with `{ studentId: "s2" }` -> Rejected (`studentId != request.auth.uid`).
7. **Orphaned SeatRequest**: Student `s1` creates `/seatRequests/r1` pointing to non-existent `tripId: "ghost_trip"` -> Rejected (`exists(/trips/ghost_trip)` fails).
8. **Terminal Trip Reopen**: Driver updates `trips/t1` from `status: "completed"` back to `status: "live"` -> Rejected (terminal lock on `existing().status == 'completed'`).
9. **Resource Poisoning ID**: Creating `/trips/<1500-char-string>` -> Rejected (`isValidId(tripId)` enforces `size() <= 128` and regex).
10. **Timestamp Backdating**: Creating `/demandPins/p1` with client-supplied `createdAt: 2020-01-01` -> Rejected (`createdAt == request.time`).
11. **Unverified Admin Email Spoof**: Unverified email token claiming admin email attempts to verify a driver -> Rejected (`email_verified == true` required).
12. **Blanket Notifications Scrape**: User `u1` runs `list` on `/notifications` without filtering `userId == request.auth.uid` -> Rejected (`resource.data.userId == request.auth.uid` enforced in `allow list`).
