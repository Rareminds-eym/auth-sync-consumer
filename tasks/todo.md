# Task List: HTTP Sync Endpoints

---

## Phase 1: SkillPassport Sync Endpoints

### Task 1.1: Hyperdrive binding and DB utility

**Description:** Add Hyperdrive binding to SkillPassport's `wrangler.toml`, create `src/lib/db.ts` with a Postgres.js client factory wrapping the Hyperdrive connection.

**Acceptance criteria:**
- [ ] Hyperdrive binding declared in `wrangler.toml` (e.g., `[[hyperdrive]]` with binding `HYPERDRIVE`)
- [ ] `src/lib/db.ts` exports `createDb(hp: Hyperdrive)` returning a Postgres.js instance
- [ ] Connection uses `hp.connectionString` and `nodejs_compat`

**Verification:**
- [ ] `npx wrangler types` includes the binding type
- [ ] Local dev connects to Hyperdrive (smoke test with `SELECT 1`)

**Dependencies:** None

**Files likely touched:**
- `skillpassport/wrangler.toml`
- `skillpassport/src/lib/db.ts` (new)
- `skillpassport/src/env.d.ts`

**Estimated scope:** Small (2 files)

---

### Task 1.2: Move role-mapper to SkillPassport

**Description:** Copy `role-mapper.ts` from auth-sync-consumer into SkillPassport under `src/role-mapper.ts`. Ensure it's importable without changes.

**Acceptance criteria:**
- [ ] `auth-sync-consumer/src/role-mapper.ts` copied to `skillpassport/src/role-mapper.ts`
- [ ] No code changes needed — pure TypeScript with no external deps
- [ ] Verified importable in test

**Verification:**
- [ ] `import { mapSSORole } from './role-mapper'` resolves

**Dependencies:** None

**Files likely touched:**
- `skillpassport/src/role-mapper.ts` (new)
- (auth-sync-consumer copy still exists — will delete in Phase 2)

**Estimated scope:** XS (1 file)

---

### Task 1.3: Create sync-service.ts

**Description:** Implement `src/services/sync-service.ts` with all business logic currently spread across auth-sync-consumer handlers. Each method accepts validated data and returns a result.

**Methods:**
- `syncUser(data)`, `deleteUser(data)`, `verifyEmail(data)`
- `syncOrg(data)`, `deleteOrg(data)`
- `syncMembership(data)`, `removeMembership(data)`
- `syncSubscription(data)`, `cancelSubscription(data)`, `expireSubscription(data)`

**Acceptance criteria:**
- [ ] All 11 methods implemented covering all 14 event types
- [ ] Each method uses `createDb(hp)` for DB access
- [ ] Role mapping calls `role-mapper.ts`
- [ ] Returns `{ success, error?, errorCode?, retryable? }`

**Verification:**
- [ ] Unit tests pass with mocked DB

**Dependencies:** Task 1.1, Task 1.2

**Files likely touched:**
- `skillpassport/src/services/sync-service.ts` (new)

**Estimated scope:** Large (business logic from 4 handler files consolidated)

---

### Task 1.4: User sync endpoint

**Description:** Create `functions/sync/user.ts` handling `created`, `updated`, `deleted`, `email_verified` actions.

**Acceptance criteria:**
- [ ] `POST /sync/user` validates input with Zod
- [ ] Dispatches to `SyncService.syncUser | deleteUser | verifyEmail` based on `action`
- [ ] Returns structured response envelope

**Verification:**
- [ ] `curl -X POST .../sync/user -d '{"action":"created","data":{...}}'` returns 200

**Dependencies:** Task 1.3

**Files likely touched:**
- `skillpassport/functions/sync/user.ts` (new)

**Estimated scope:** Small (1 file)

---

### Task 1.5: Organization sync endpoint

**Description:** Create `functions/sync/org.ts` handling `created`, `updated` actions.

**Acceptance criteria:**
- [ ] `POST /sync/org` validates input with Zod
- [ ] Dispatches to `SyncService.syncOrg` based on `action`
- [ ] Returns structured response envelope

**Verification:**
- [ ] `curl` test returns 200 with valid payload, 400 with invalid

**Dependencies:** Task 1.3

**Files likely touched:**
- `skillpassport/functions/sync/org.ts` (new)

**Estimated scope:** Small (1 file)

---

### Task 1.6: Membership sync endpoint

**Description:** Create `functions/sync/membership.ts` handling `created`, `role_changed`, `status_changed`, `removed` actions.

**Acceptance criteria:**
- [ ] `POST /sync/membership` validates input with Zod
- [ ] Dispatches to appropriate `SyncService` method
- [ ] Returns structured response envelope

**Verification:**
- [ ] `curl` test returns 200 with valid payload, 400 with invalid

**Dependencies:** Task 1.3

**Files likely touched:**
- `skillpassport/functions/sync/membership.ts` (new)

**Estimated scope:** Small (1 file)

---

### Task 1.7: Subscription sync endpoint

**Description:** Create `functions/sync/subscription.ts` handling `created`, `updated`, `cancelled`, `expired` actions.

**Acceptance criteria:**
- [ ] `POST /sync/subscription` validates input with Zod
- [ ] Dispatches to appropriate `SyncService` method
- [ ] Returns structured response envelope

**Verification:**
- [ ] `curl` test returns 200 with valid payload, 400 with invalid

**Dependencies:** Task 1.3

**Files likely touched:**
- `skillpassport/functions/sync/subscription.ts` (new)

**Estimated scope:** Small (1 file)

### Checkpoint: Phase 1 Complete
- [ ] `npx wrangler pages dev` starts without errors
- [ ] All 4 endpoints respond to POST requests
- [ ] `Hyperdrive` binding is active
- [ ] Review with human before Phase 2

---

## Phase 2: auth-sync-consumer Refactor

### Task 2.1: Create sync-client.ts

**Description:** Create `src/lib/sync-client.ts` — a thin fetch wrapper over `env.SKILLPASSPORT_SYNC`. One function per sync domain.

**Functions:**
- `syncUser(binding, action, data)`
- `syncOrg(binding, action, data)`
- `syncMembership(binding, action, data)`
- `syncSubscription(binding, action, data)`

**Acceptance criteria:**
- [ ] Each function calls `binding.fetch('https://internal/sync/<domain>', POST)`
- [ ] Returns parsed response with typed result
- [ ] Re-throws non-retryable errors, swallows retryable with logging

**Verification:**
- [ ] Unit test with mock `Fetcher`

**Dependencies:** Phase 1 deployed

**Files likely touched:**
- `auth-sync-consumer/src/lib/sync-client.ts` (new)

**Estimated scope:** Small (1 file)

---

### Task 2.2a: Simplify user handler

**Description:** Rewrite `src/handlers/user.ts` to call `sync-client.ts` instead of `db-client.ts`.

**Acceptance criteria:**
- [ ] All user event types (`created`, `updated`, `deleted`, `email_verified`) dispatch via `syncClient.syncUser`
- [ ] No direct DB calls remain in this handler

**Verification:**
- [ ] Queue message with user event triggers sync endpoint call

**Dependencies:** Task 2.1

**Files likely touched:**
- `auth-sync-consumer/src/handlers/user.ts`

**Estimated scope:** Small (1 file)

---

### Task 2.2b: Simplify organization handler

**Description:** Rewrite `src/handlers/organization.ts` to call `sync-client.ts` instead of `db-client.ts`.

**Acceptance criteria:**
- [ ] All org event types dispatch via `syncClient.syncOrg`
- [ ] No direct DB calls remain

**Verification:**
- [ ] Queue message with org event triggers sync endpoint call

**Dependencies:** Task 2.1

**Files likely touched:**
- `auth-sync-consumer/src/handlers/organization.ts`

**Estimated scope:** Small (1 file)

---

### Task 2.2c: Simplify membership handler

**Description:** Rewrite `src/handlers/membership.ts` to call `sync-client.ts` instead of `db-client.ts`.

**Acceptance criteria:**
- [ ] All membership event types dispatch via `syncClient.syncMembership`
- [ ] No direct DB calls remain

**Verification:**
- [ ] Queue message with membership event triggers sync endpoint call

**Dependencies:** Task 2.1

**Files likely touched:**
- `auth-sync-consumer/src/handlers/membership.ts`

**Estimated scope:** Small (1 file)

---

### Task 2.2d: Simplify subscription handler

**Description:** Rewrite `src/handlers/subscription.ts` to call `sync-client.ts` instead of `db-client.ts`.

**Acceptance criteria:**
- [ ] All subscription event types dispatch via `syncClient.syncSubscription`
- [ ] No direct DB calls remain

**Verification:**
- [ ] Queue message with subscription event triggers sync endpoint call

**Dependencies:** Task 2.1

**Files likely touched:**
- `auth-sync-consumer/src/handlers/subscription.ts`

**Estimated scope:** Small (1 file)

---

### Task 2.3: Remove dead code and secrets

**Description:** Delete `db-client.ts`, `role-mapper.ts`, `.dev.vars`. Remove `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` from `wrangler.toml`.

**Acceptance criteria:**
- [ ] `src/lib/db-client.ts` deleted
- [ ] `src/role-mapper.ts` deleted
- [ ] `.dev.vars` deleted
- [ ] `SUPABASE_*` env vars removed from `wrangler.toml`
- [ ] No compilation errors after removal

**Verification:**
- [ ] `npx wrangler types` succeeds without SUPABASE references
- [ ] `npm run build` succeeds

**Dependencies:** Tasks 2.2a–2.2d

**Files likely touched:**
- `auth-sync-consumer/src/lib/db-client.ts` (delete)
- `auth-sync-consumer/src/role-mapper.ts` (delete)
- `auth-sync-consumer/.dev.vars` (delete)
- `auth-sync-consumer/wrangler.toml`

**Estimated scope:** Small (4 files)

---

### Task 2.4: Configure service binding in wrangler.toml

**Description:** Add the `[[services]]` binding to `auth-sync-consumer/wrangler.toml` pointing to SkillPassport's sync service.

**Acceptance criteria:**
- [ ] `[[services]]` block added with `binding = "SKILLPASSPORT_SYNC"`, `service = "skillpassport-sync"`, `environment = "production"` (or appropriate)
- [ ] `npx wrangler types` generates the binding type

**Verification:**
- [ ] `npx wrangler deploy --dry-run` succeeds
- [ ] `npx wrangler types` includes `SKILLPASSPORT_SYNC: Fetcher`

**Dependencies:** Phase 1 deployed

**Files likely touched:**
- `auth-sync-consumer/wrangler.toml`
- `auth-sync-consumer/worker-configuration.d.ts`

**Estimated scope:** XS (2 files)

---

### Checkpoint: Phase 2 Complete
- [ ] Full queue → sync endpoint → database flow works end-to-end
- [ ] No direct DB access in auth-sync-consumer
- [ ] `npx wrangler deploy --dry-run` succeeds for both services
- [ ] All secrets and dead code removed
- [ ] Ready for production deploy

---

## Verification

### Cutover Procedure
1. Deploy Phase 1 (SkillPassport sync endpoints) — no consumer impact
2. Deploy Phase 2 (auth-sync-consumer refactor)
3. Monitor queue processing for errors
4. If errors spike: rollback auth-sync-consumer deploy only

### Rollback
- **auth-sync-consumer:** `npx wrangler rollback` — restores direct DB writes (old code)
- **SkillPassport:** Leave endpoints running; they're harmless without callers
- Secrets: If deleted, restore from commit history
