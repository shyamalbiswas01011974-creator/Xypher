# Xypher Firestore Security Specification

## Data Invariants
1. A `/users/{userId}` document contains PII (`email`, `displayName`, `photoURL`) and can ONLY be read, created, updated, or deleted by the verified authenticated owner (`request.auth.uid == userId && request.auth.token.email_verified == true`).
2. Users cannot list `/users` globally (no directory scraping).
3. A `/users/{userId}/wallets/{walletId}` subcollection document cannot be created unless the parent `/users/{userId}` profile document exists (Master Gate) and `incoming().ownerUid == request.auth.uid == userId`.
4. Private keys / WIF strings are NEVER stored in Firestore; only strict allowlisted public fields are permitted (`hasOnly`).
5. `uid`, `ownerUid`, `walletId`, and `createdAt` are immutable after creation; `createdAt` and `updatedAt` must equal `request.time`.

## The "Dirty Dozen" Adversarial Payloads (All Must Return PERMISSION_DENIED)
1. **Unauthenticated read** of `/users/alice`.
2. **Cross-user PII read**: `bob` calls `get` on `/users/alice`.
3. **Directory scrape**: `alice` calls `list` on `/users`.
4. **Unverified email write**: `alice` with `email_verified: false` tries to create `/users/alice`.
5. **Identity spoofing on create**: `bob` tries to create `/users/bob` with `uid: "alice"`.
6. **Shadow field injection**: `alice` tries to create `/users/alice` with extra ghost field `isAdmin: true` or `role: "admin"`.
7. **Timestamp forgery**: `alice` tries to create `/users/alice` with client-supplied past `createdAt` instead of `request.time`.
8. **Immutable field mutation**: `alice` tries to update `/users/alice` changing `createdAt` or `uid`.
9. **Resource exhaustion (oversized string)**: `alice` tries to update `displayName` with a 500-character string (>100 limit).
10. **ID poisoning**: `alice` tries to create `/users/alice/wallets/bad..id$chars` (fails `isValidId`).
11. **Orphaned subcollection write**: `charlie` tries to create `/users/charlie/wallets/w1` when `/users/charlie` does not exist.
12. **Invalid wallet type / shadow key**: `alice` tries to create a LinkedWallet with `walletType: "admin"` or extra field `wif: "secret"`.
