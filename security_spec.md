# Security Specification: Daytona Volume Storage & Firestore Rules

## 1. Core Data Invariants
1. **Strict Ownership Isolation**: A user with UID `U` may only read/write `/users/{U}`, `/users/{U}/projects/{P}` and its subcollections (`sessions`, `files`, `versions`), `/chats/*` where `userId == U`, and `/files/*` where `userId == U`. Cross-user access is strictly denied unless `isAdmin()`.
2. **Metadata-Only Firestore**: Project documents store volume subpath (`users/{uid}/projects/{projectId}`), sandbox ID/status, file counts, byte totals, and SHA-256 checksums — never unrestricted source code bodies.
3. **Admin Escalation Lock**: `/admins/{uid}` is read-only to the matching user or existing verified admins; client SDKs cannot self-grant admin rights or forge unverified email tokens (`email_verified == true` is mandatory for admin email matching).
4. **Immutable Ownership & Creation Timestamps**: Once created, `uid`, `ownerId`, `userId`, `projectId`, `volumeSubpath`, and `createdAt` cannot be modified on update.
5. **Terminal State Protection**: Completed migration items (`status == 'completed'`) and ended workspace sessions (`status == 'ended'`) cannot be silently reverted by non-admin clients.
6. **Master Gate & Query Confinement**: Every subcollection check verifies parent ownership on create/update, and every `list` query strictly filters by `resource.data.userId == request.auth.uid` or path `{userId} == request.auth.uid`.

## 2. The "Dirty Dozen" Attack Payloads
1. **Unauthenticated Project Create**: Anonymous caller (`auth == null`) writes `/users/u1/projects/p1` -> `PERMISSION_DENIED`.
2. **Cross-Tenant Project Read**: Authenticated user `u2` reads `/users/u1/projects/p1` -> `PERMISSION_DENIED`.
3. **Cross-Tenant Session Hijack**: Authenticated user `u2` creates `/users/u1/projects/p1/sessions/s1` with `ownerId: 'u2'` -> `PERMISSION_DENIED`.
4. **Path Traversal Subpath Spoofing**: User `u1` sets `volumeSubpath: '../u2/projects/p2'` on project create -> `PERMISSION_DENIED`.
5. **Shadow Ghost Field Injection**: User `u1` adds unexpected ghost key `isVerifiedAdmin: true` to `/users/u1` or `/users/u1/projects/p1` -> `PERMISSION_DENIED`.
6. **ID Poisoning**: User `u1` writes project with ID containing `/` or spaces or >128 chars -> `PERMISSION_DENIED`.
7. **Owner Reassignment Update**: User `u1` tries to mutate `ownerId` from `u1` to `u2` on existing `/users/u1/projects/p1` -> `PERMISSION_DENIED`.
8. **Admin Self-Grant**: User `u1` creates `/admins/u1` -> `PERMISSION_DENIED`.
9. **Unverified Admin Email Spoof**: Caller has `email: 'shahedalmefleh850@gmail.com'` with `email_verified: false` reading `/migrations/job1` -> `PERMISSION_DENIED`.
10. **Denial-of-Wallet Oversized String**: User `u1` submits a 20,000-character `name` or `relativePath` -> `PERMISSION_DENIED`.
11. **Terminal Migration Tampering**: Non-admin authenticated user tries to modify `/migrations/job1/items/item1` -> `PERMISSION_DENIED`.
12. **Unfiltered Collection Scrape**: Authenticated user `u2` runs unfiltered list on `/chats` or `/files` matching `u1`'s document -> `PERMISSION_DENIED`.
