# auth-sync-consumer Cleanup Plan

**Goal:** Delete dead code, collapse passthroughs, apply senior patterns to both auth-sync-consumer and SkillPassport sync endpoints.

---

## Phase 1 — auth-sync-consumer (6 files deleted)

### Current (11 files, 504 lines)
```
src/
├── index.ts                   38  entry — keep
├── lib/
│   └── sync-client.ts        61  HTTP wrapper — keep
└── handlers/
    ├── types.ts               25  SyncEvent type — keep
    ├── message-router.ts      68  dependency ordering — keep
    ├── event-processor.ts     87  event switch — MODIFY
    ├── user-handler.ts        24  passthrough — DELETE
    ├── organization-handler.ts 22  passthrough — DELETE
    ├── membership-handler.ts  30  passthrough — DELETE
    ├── subscription-handler.ts 34  passthrough — DELETE
    ├── schemas.ts            103  dead — DELETE
    └── index.ts               12  dead — DELETE
```

### After (5 files, ~300 lines)
```
src/
├── index.ts                   38  entry
├── lib/
│   └── sync-client.ts        61  HTTP wrapper
└── handlers/
    ├── types.ts               25  types
    ├── message-router.ts      68  dependency ordering
    └── event-processor.ts    ~110  switch + inline calls
```

### Changes

**1. Rewrite `event-processor.ts`**
- Import sync-client functions directly
- Add a shared `callSync()` helper to avoid repeating the retryable-check/log pattern
- Each switch case calls sync-client directly instead of routing through handler files

```typescript
import { Fetcher } from '@cloudflare/workers-types';
import { SyncEvent } from './types';
import { syncUser, syncOrg, syncMembership, syncSubscription, SyncResult } from '../lib/sync-client';

async function callSync(label: string, fn: () => Promise<SyncResult>, suffix: string) {
  const result = await fn();
  if (!result.success && result.retryable) throw new Error(result.error);
  if (!result.success) console.error(`[${label}] Non-retryable: ${result.error}`);
  console.log(`[${label}] ✅ ${suffix}`);
}

export async function processMessage(msg: Message<SyncEvent>, binding: Fetcher): Promise<void> {
  try {
    const { type, payload } = msg.body;
    switch (type) {
      case 'user.created':
        await callSync('user', () => syncUser(binding, 'created', payload), 'Synced user.created');
        break;
      case 'user.updated':
        await callSync('user', () => syncUser(binding, 'updated', payload), 'Synced user.updated');
        break;
      case 'user.email_verified':
        await callSync('user', () => syncUser(binding, 'updated', payload), 'Synced email_verified');
        break;
      case 'user.deleted':
        await callSync('user', () => syncUser(binding, 'deleted', payload), 'Deleted user');
        break;
      case 'organization.created':
        await callSync('org', () => syncOrg(binding, 'created', payload), 'Synced org.created');
        break;
      case 'organization.updated':
        await callSync('org', () => syncOrg(binding, 'updated', payload), 'Synced org.updated');
        break;
      case 'membership.created':
        await callSync('membership', () => syncMembership(binding, 'created', payload), 'Synced membership.created');
        break;
      case 'membership.role_changed':
        await callSync('membership', () => syncMembership(binding, 'role_changed', payload), 'Synced role_changed');
        break;
      case 'membership.status_changed':
        await callSync('membership', () => syncMembership(binding, 'status_changed', payload), 'Synced status_changed');
        break;
      case 'membership.removed':
        await callSync('membership', () => syncMembership(binding, 'removed', payload), 'Removed membership');
        break;
      case 'subscription.created':
        await callSync('subscription', () => syncSubscription(binding, 'created', payload), 'Synced sub.created');
        break;
      case 'subscription.updated':
        await callSync('subscription', () => syncSubscription(binding, 'updated', payload), 'Synced sub.updated');
        break;
      case 'subscription.cancelled':
        await callSync('subscription', () => syncSubscription(binding, 'cancelled', payload), 'Synced sub.cancelled');
        break;
      case 'subscription.expired':
        await callSync('subscription', () => syncSubscription(binding, 'expired', payload), 'Synced sub.expired');
        break;
      default:
        throw new Error(`Unknown event type: ${type}`);
    }
    msg.ack();
  } catch (err) {
    const isRetryable = !(err instanceof TypeError);
    console.error(`[event-processor] Message failed: ${err instanceof Error ? err.message : String(err)} type=${msg.body.type}`);
    if (isRetryable) msg.retry();
    else msg.ack();
  }
}
```

**2. Delete files**
- `src/handlers/user-handler.ts`
- `src/handlers/organization-handler.ts`
- `src/handlers/membership-handler.ts`
- `src/handlers/subscription-handler.ts`
- `src/handlers/schemas.ts`
- `src/handlers/index.ts`

**3. Remove `zod` from `package.json` dependencies**

---

## Phase 2 — SkillPassport sync endpoints (cleaner)

### Problem
4 endpoint files repeat the same boilerplate (JSON parse → action guard → create service → dispatch → wrap result). sync-service.ts (453 lines) mixes Zod schemas with business logic.

### Changes

**1. NEW — `functions/lib/sync-handler.ts`** — Shared dispatch helper

```typescript
import { SyncService } from './sync-service';
import { apiSuccess, apiError } from './response';
import type { PagesEnv } from './types';

export async function handleSyncRequest(
  context: { request: Request; env: PagesEnv },
  handlers: Record<string, (service: SyncService, data: any) => Promise<{ success: boolean; error?: string; errorCode?: string }>>
): Promise<Response> {
  let body: any;
  try {
    body = await context.request.json();
  } catch {
    return apiError(400, 'VALIDATION_ERROR', 'Invalid JSON body', context.request);
  }
  const { action, data } = body;
  if (!action) return apiError(400, 'VALIDATION_ERROR', 'action is required', context.request);
  const handler = handlers[action];
  if (!handler) return apiError(400, 'VALIDATION_ERROR', `Unknown action: ${action}`, context.request);
  const service = new SyncService(context.env);
  const result = await handler(service, data);
  if (!result.success) {
    const status = result.errorCode === 'NOT_FOUND' ? 404 : 400;
    return apiError(status, result.errorCode!, result.error!, context.request);
  }
  return apiSuccess(result, context.request);
}
```

**2. NEW — `functions/lib/sync-schemas.ts`** — Extract Zod schemas from sync-service.ts (lines 10-93)

**3. MODIFY — Each endpoint file** becomes ~8-12 lines

```typescript
// functions/sync/user.ts
import { handleSyncRequest } from '../lib/sync-handler';

export const onRequestPost = (ctx: any) => handleSyncRequest(ctx, {
  created:       (s, d) => s.syncUser(d),
  updated:       (s, d) => s.syncUser(d),
  deleted:       (s, d) => s.deleteUser(d),
  email_verified: (s, d) => s.verifyEmail(d),
});
```

```typescript
// functions/sync/org.ts
export const onRequestPost = (ctx: any) => handleSyncRequest(ctx, {
  created: (s, d) => s.syncOrgCreated(d),
  updated: (s, d) => s.syncOrgUpdated(d),
});
```

```typescript
// functions/sync/membership.ts
export const onRequestPost = (ctx: any) => handleSyncRequest(ctx, {
  created:       (s, d) => s.syncMembership(d),
  role_changed:  (s, d) => s.syncMembership(d),
  status_changed: (s, d) => s.syncMembership(d),
  removed:       (s, d) => s.removeMembership(d),
});
```

```typescript
// functions/sync/subscription.ts
export const onRequestPost = (ctx: any) => handleSyncRequest(ctx, {
  created:  (s, d) => s.syncSubscriptionCreated(d),
  updated:  (s, d) => s.syncSubscriptionUpdated(d),
  cancelled: (s, d) => s.syncSubscriptionCancelledOrExpired(d, 'subscription.cancelled'),
  expired:  (s, d) => s.syncSubscriptionCancelledOrExpired(d, 'subscription.expired'),
});
```

**4. MODIFY — `sync-service.ts`** — remove inline Zod schemas, import from sync-schemas

---

## Files to Touch

### auth-sync-consumer
| Action | File |
|---|---|
| Rewrite | `src/handlers/event-processor.ts` |
| Delete | `src/handlers/user-handler.ts` |
| Delete | `src/handlers/organization-handler.ts` |
| Delete | `src/handlers/membership-handler.ts` |
| Delete | `src/handlers/subscription-handler.ts` |
| Delete | `src/handlers/schemas.ts` |
| Delete | `src/handlers/index.ts` |
| Edit | `package.json` (remove zod) |

### SkillPassport
| Action | File |
|---|---|
| New | `functions/lib/sync-handler.ts` |
| New | `functions/lib/sync-schemas.ts` |
| Rewrite | `functions/sync/user.ts` |
| Rewrite | `functions/sync/org.ts` |
| Rewrite | `functions/sync/membership.ts` |
| Rewrite | `functions/sync/subscription.ts` |
| Rewrite | `functions/lib/sync-service.ts` (remove schemas, import from sync-schemas) |

---

## Verification

```bash
# auth-sync-consumer
npx tsc --noEmit
npx wrangler deploy --dry-run

# SkillPassport
npx tsc --noEmit -p tsconfig.functions.json
```
