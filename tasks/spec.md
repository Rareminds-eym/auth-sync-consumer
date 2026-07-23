# Spec: HTTP Sync Endpoints — auth-sync-consumer → SkillPassport

## Objective

Replace direct Supabase database writes from auth-sync-consumer with authenticated internal HTTP sync endpoints on SkillPassport (Pages Function). This eliminates the service role key exposure, decouples schema dependencies, and moves business logic behind a proper API boundary.

**Success criteria:**
- All 14 event types are routed through SkillPassport sync endpoints
- `SUPABASE_SERVICE_ROLE_KEY` is removed from auth-sync-consumer
- Business logic (role mapping, org defaults, learner creation) lives in SkillPassport
- Hyperdrive connection pooling is configured for SkillPassport's DB access
- Zero messages lost during cutover
- Rollback to direct DB requires only reverting the deploy

## Assumptions

```
ASSUMPTIONS I'M MAKING:
1. SkillPassport is a Cloudflare Pages Function (not a Worker) — confirmed
2. Both services are on the same Cloudflare account — if not, fall back to public HTTP + service token
3. Worker→PagesFunction service binding direction works (undocumented but likely) — will verify in Phase 1
4. The Supabase service role key stays in SkillPassport (moved out of auth-sync-consumer)
5. auth-sync-consumer continues consuming Cloudflare Queues (no architectural change there)
6. No changes to the SSO Worker producer — events are published as-is
7. Hyperdrive supports Supabase PostgreSQL (it's standard Postgres, so yes)
→ Correct me now or I'll proceed with these.
```

## Tech Stack

| Component | Technology |
|---|---|
| Caller | Cloudflare Worker (TypeScript, existing) |
| Receiver | Cloudflare Pages Function (TypeScript, existing) |
| Communication | HTTP Service Binding (`env.BINDING.fetch()`) |
| Database | Supabase PostgreSQL via Hyperdrive (new) |
| Validation | Zod (existing in consumer, add to Pages) |
| Runtime | `nodejs_compat` flag (both sides) |

## Commands

```
# auth-sync-consumer
Dev: npx wrangler dev
Deploy: npx wrangler deploy
Types: npx wrangler types
Logs: npx wrangler tail

# SkillPassport (Pages)
Dev: npx wrangler pages dev <dist>
Deploy: npx wrangler pages deploy
Local multi-worker: npx wrangler dev -c wrangler.toml -c ../skillpassport/wrangler.toml
```

## Project Structure

### auth-sync-consumer (simplified)

```
src/
├── index.ts                 # Queue handler — no db-client.ts import
├── handlers/
│   ├── index.ts             # Re-exports
│   ├── types.ts             # SyncEvent type (unchanged)
│   ├── schemas.ts           # Zod schemas (unchanged)
│   ├── event-processor.ts   # Switch on type, call Service Binding (simplified)
│   └── message-router.ts    # Dependency ordering (unchanged)
└── lib/
    └── sync-client.ts       # ★ NEW: Thin wrapper over env.SKILLPASSPORT_SYNC.fetch()
```

**Removed files:**
- `src/lib/db-client.ts` — deleted (no longer needed)
- `src/role-mapper.ts` — moved to SkillPassport
- `.dev.vars` — deleted (no longer needs service role key)

### SkillPassport (new sync endpoints)

```
functions/
├── sync/
│   ├── user.ts              # POST — user.created/updated/deleted/email_verified
│   ├── org.ts               # POST — organization.created/updated
│   ├── membership.ts        # POST — membership.created/role_changed/status_changed/removed
│   └── subscription.ts      # POST — subscription.created/updated/cancelled/expired
src/
├── services/
│   └── sync-service.ts      # ★ NEW: Domain logic (role mapping, defaults, learner creation)
├── lib/
│   └── db.ts                # ★ NEW: Hyperdrive-wrapped Postgres client
└── role-mapper.ts           # ★ MOVED from auth-sync-consumer
```

## Code Style

```typescript
// Sync endpoint handler pattern (SkillPassport Pages Function)
// functions/sync/user.ts
import { SyncService } from '../../src/services/sync-service';
import { syncResponse, syncError } from '../../src/lib/sync-response';

interface SyncRequest {
  action: 'created' | 'updated' | 'deleted' | 'email_verified';
  data: Record<string, unknown>;
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const body: SyncRequest = await context.request.json();
  const db = createDb(context.env.HYPERDRIVE);
  const service = new SyncService(db);

  try {
    switch (body.action) {
      case 'created':
      case 'updated':
        await service.syncUser(body.data, body.action);
        break;
      case 'deleted':
        await service.deleteUser(body.data);
        break;
      case 'email_verified':
        await service.verifyEmail(body.data);
        break;
    }
    return syncResponse({ success: true });
  } catch (err) {
    return syncError(err);
  }
};

// Sync client pattern (auth-sync-consumer)
// src/lib/sync-client.ts
export async function syncUser(
  binding: Fetcher,
  action: string,
  data: Record<string, unknown>
): Promise<SyncResult> {
  const res = await binding.fetch('https://internal/sync/user', {
    method: 'POST',
    body: JSON.stringify({ action, data }),
    headers: { 'Content-Type': 'application/json' },
  });
  return res.json();
}
```

**Key conventions:**
- Endpoint receives `{ action, data }` envelope — never raw DB rows
- Endpoint returns `{ success: boolean, error?: string, retryable?: boolean }`
- Validation at the endpoint boundary (Zod), not in the caller
- Consistent error response shape across all 4 endpoints

## API Contract

### Endpoints

| Method | Path | Action Values | Description |
|---|---|---|---|
| POST | `/sync/user` | `created`, `updated`, `deleted`, `email_verified` | Sync user lifecycle |
| POST | `/sync/org` | `created`, `updated` | Sync organization lifecycle |
| POST | `/sync/membership` | `created`, `role_changed`, `status_changed`, `removed` | Sync membership lifecycle |
| POST | `/sync/subscription` | `created`, `updated`, `cancelled`, `expired` | Sync subscription lifecycle |

### Request Envelope

```json
{
  "action": "created",
  "data": { /* domain-specific fields */ }
}
```

### Response Envelope

```json
{
  "success": true,
  "error": null,
  "retryable": false
}
```

```json
{
  "success": false,
  "error": "User not found",
  "retryable": true,
  "errorCode": "NOT_FOUND"
}
```

### Error Codes

| Code | HTTP Status | Retryable | Meaning |
|---|---|---|---|
| `VALIDATION_ERROR` | 400 | No | Malformed payload |
| `NOT_FOUND` | 404 | Yes | Referenced entity missing (FK dependency) |
| `CONFLICT` | 409 | Yes | Race condition |
| `INTERNAL_ERROR` | 500 | Yes | Transient failure |

## Testing Strategy

| Level | Tool | Location | Coverage |
|---|---|---|---|
| Unit (service logic) | Vitest | `skillpassport/src/__tests__/` | All business logic paths |
| Integration (endpoints) | Vitest + Miniflare | `skillpassport/functions/__tests__/` | Each endpoint happy + error paths |
| E2E (full queue flow) | Manual + wrangler tail | N/A | Verify cutover |

**auth-sync-consumer** currently has zero tests. After refactoring handlers to be thin RPC callers, writing tests becomes less critical (the logic moved to SkillPassport). But we should add basic tests for the `sync-client.ts` wrapper.

**Test command:** `vitest run` (to be added to package.json)

## Boundaries

- **Always do:**
  - Validate all inputs with Zod at the endpoint boundary
  - Return structured error responses
  - Log sync failures with enough context to debug
  - Deploy SkillPassport endpoints before auth-sync-consumer changes
  - Test with multi-worker dev before production deploy

- **Ask first:**
  - Adding new event types beyond the 14 existing ones
  - Changing the response envelope shape
  - Adding authentication to sync endpoints (currently not needed with Service Bindings)
  - Modifying the queue batch configuration

- **Never do:**
  - Expose sync endpoints to the public internet
  - Log the Supabase service role key
  - Remove retry logic from auth-sync-consumer
  - Change the SSO Worker event format without coordination

## Migration Plan (two-phase)

### Phase 1 — SkillPassport sync endpoints
1. Create Hyperdrive binding in SkillPassport wrangler config
2. Create `src/lib/db.ts` with Hyperdrive + Postgres.js client
3. Move `role-mapper.ts` into SkillPassport
4. Create `src/services/sync-service.ts` with all business logic
5. Create `functions/sync/user.ts`, `org.ts`, `membership.ts`, `subscription.ts`
6. Add Zod schemas to validate incoming requests
7. Test locally with wrangler multi-worker dev

### Phase 2 — auth-sync-consumer refactor
1. Create `src/lib/sync-client.ts` thin wrapper
2. Simplify all handlers to call sync endpoints instead of DB
3. Delete `db-client.ts`
4. Delete `.dev.vars`, remove `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`
5. Add `[[services]]` binding to wrangler.toml
6. Deploy Phase 1 first, then Phase 2
7. Monitor and rollback if errors

## Open Questions

1. Does Worker→PagesFunction service binding direction actually work in production? (Docs only show Pages→Worker) — Test in preview first.
2. Postgres.js or node-postgres for Hyperdrive client? Both support Workers with `nodejs_compat`.
3. Should sync endpoints be behind a middleware for request logging/metrics?
4. Is there an existing Hyperdrive config for the SkillPassport Supabase DB or does one need to be created?

---

## Success Criteria

- [ ] All 14 event types synced without direct DB access from auth-sync-consumer
- [ ] `SUPABASE_SERVICE_ROLE_KEY` secret deleted from auth-sync-consumer
- [ ] Business logic for role mapping, org defaults, learner creation lives in SkillPassport
- [ ] Hyperdrive connection configured and tested
- [ ] Queue message throughput unchanged (no increased latency from HTTP hop)
- [ ] Rollback restores previous behavior by reverting deploy
- [ ] `db-client.ts`, `role-mapper.ts`, `.dev.vars` deleted from auth-sync-consumer
