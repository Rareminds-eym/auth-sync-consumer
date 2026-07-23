# Architecture Review: auth-sync-consumer

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Critical Finding: Pages Functions Do Not Support RPC](#critical-finding-pages-functions-do-not-support-rpc)
3. [Current Architecture Analysis](#current-architecture-analysis)
4. [Coupling Analysis](#coupling-analysis)
5. [Cloudflare Best Practices Research](#cloudflare-best-practices-research)
6. [Approach Comparison: Direct DB vs HTTP Endpoints vs Service Bindings vs Pages Migration](#approach-comparison)
7. [Production Readiness Evaluation](#production-readiness-evaluation)
8. [Recommended Architecture: Migrate SkillPassport to Worker + RPC Service Bindings](#recommended-architecture)
9. [API Contract Design](#api-contract-design)
10. [Current Architecture Diagram](#current-architecture-diagram)
11. [Proposed Architecture Diagram](#proposed-architecture-diagram)
12. [Migration Plan](#migration-plan)
13. [Risks](#risks)
14. [Rollback Strategy](#rollback-strategy)
15. [Final Recommendation](#final-recommendation)

---

## Executive Summary

The auth-sync-consumer is a Cloudflare Worker that consumes SSO sync events from Cloudflare Queues and writes directly to the SkillPassport Supabase database using the service role key. This creates a tight coupling to the database schema, a significant security exposure (full admin access to the database from a queue consumer), and no opportunity for SkillPassport to validate or transform incoming data.

**Primary Recommendation**: Migrate SkillPassport from Pages Functions to a Cloudflare Worker, then use **Service Binding RPC** between auth-sync-consumer and SkillPassport. Cloudflare itself recommends Workers over Pages Functions for new full-stack projects. Migrating unlocks type-safe RPC communication, zero-cost same-thread calls, and capability-based security.

**Fallback Recommendation (if Pages migration is too large)**: Use **HTTP Service Bindings** from auth-sync-consumer Worker to SkillPassport Pages Function (fetch-based), with structured sync endpoints. This still avoids public internet latency and eliminates the service role key, but lacks type safety.

**Last Resort**: Traditional **authenticated HTTP endpoints** over the public internet.

---

## 2. Critical Finding: Pages Functions Do Not Support RPC Service Bindings

After researching official Cloudflare documentation, this is the single most important discovery affecting the architectural decision:

### 2.1 Confirmed Limitations

| Capability | Workers | Pages Functions |
|---|---|---|
| RPC Service Bindings (`WorkerEntrypoint`) | ✅ Full support | ❌ Not supported |
| HTTP Service Bindings (`Fetcher.fetch()`) | ✅ Supported | ✅ Supported (outbound only) |
| Direction: Pages → Worker via service binding | N/A | ✅ Documented |
| Direction: Worker → Pages via service binding | Not documented / untested | Not documented / untested |

### 2.2 Official Sources

1. **Pages Bindings docs** state: *"A service binding allows you to call a Worker from within your Pages Function"* — one direction only (Pages → Worker). The binding type is `Fetcher`, not `Service<EntrypointType>`, meaning only HTTP `fetch()` is available, never RPC.

2. **RPC docs** require `WorkerEntrypoint extends WorkerEntrypoint` — Pages Functions use the `onRequest` pattern, not `WorkerEntrypoint`, so they cannot expose RPC methods.

3. **Hono/Cloudflare Pages docs** (June 2026) explicitly state: *"For new projects, Cloudflare now recommends using Cloudflare Workers instead of Cloudflare Pages. Workers supports static assets and offers a broader set of features. If you are starting a new full-stack application, see Cloudflare Workers + Vite."*

4. **Community reports** (Cloudflare Discord, Nov 2024, #pages-discussions) confirm RPC from Pages doesn't work locally with `wrangler pages dev`.

### 2.3 What This Means for the Architecture

Since SkillPassport is a Pages Function, the following options exist:

| Option | Changes Required | Communication Method | RPC? |
|---|---|---|---|
| **A. Convert SkillPassport to Worker** | Migrate Pages → Worker | Service Binding RPC | ✅ Yes |
| **B. HTTP Service Bindings** (Pages stays) | Add fetch-based endpoints to SkillPassport | `env.BINDING.fetch()` | ❌ No (HTTP only) |
| **C. Public HTTP Endpoints** (Pages stays) | Add public endpoints + auth | `fetch('https://...')` | ❌ No |

**Option A is strongly preferred.** It aligns with Cloudflare's own recommendations and unlocks the cleanest architecture. Options B and C are workarounds for the Pages Functions limitation. Option B still avoids public internet but lacks type safety. Option C is the most traditional but adds latency and token management overhead.

### 2.4 If Full Pages-to-Worker Migration Is Too Large

If migrating SkillPassport from Pages to a Worker is not feasible immediately, use **Option B (HTTP Service Bindings)** as an intermediate step. The auth-sync-consumer can call SkillPassport's fetch handler internally. This still eliminates the service role key risk. The Pages-to-Worker migration can follow later.

---

## 3. Current Architecture Analysis

### 1.1 Sync Flow (Complete Trace)

```
SSO Worker (producer)
  │  env.SYNC_QUEUE.send({ type, payload, timestamp })
  ▼
Cloudflare Queue: auth-db-sync-queue
  │  max_batch_size=10, max_batch_timeout=1s, max_retries=3
  ▼
auth-sync-consumer (index.ts)
  │  queue() handler
  ▼
message-router.ts
  │  sortMessagesByDependency() → [userOrg, membership, other]
  │  Sequential processing (for...of loops)
  ▼
event-processor.ts
  │  Zod validation → switch(event.type) → route to handler
  │  On success: msg.ack()
  │  On ZodError: msg.ack() (poison message)
  │  On other error: msg.retry()
  ▼
Handler functions (user-handler.ts, organization-handler.ts,
                  membership-handler.ts, subscription-handler.ts)
  │  Business logic (field mapping, role mapping, defaults)
  ▼
db-client.ts (Supabase REST API)
  │  POST /rest/v1/{table}?on_conflict={cols}  (upsert)
  │  PATCH /rest/v1/{table}?{col}=eq.{val}     (update)
  │  DELETE /rest/v1/{table}?{col}=eq.{val}     (remove)
  │  GET /rest/v1/{table}?{col}=eq.{val}&select=... (select)
  ▼
Supabase PostgreSQL: hweljtkqictqpwxbuwre.supabase.co
  Tables: users, organizations, organization_members, learners, subscription_cache
```

### 1.2 All Database Operations

| File | Line | Table | Operation | Purpose |
|---|---|---|---|---|
| `user-handler.ts` | 40 | `users` | UPSERT | Create/update user profile |
| `user-handler.ts` | 48 | `users` | DELETE | Remove deleted user |
| `event-processor.ts` | 46 | `users` | SELECT | Read existing metadata for email_verified |
| `event-processor.ts` | 50 | `users` | UPDATE (PATCH) | Set is_email_verified flag |
| `membership-handler.ts` | 22 | `users` | UPDATE | Set organizationId on user |
| `membership-handler.ts` | 58 | `users` | SELECT | Read name/email for learner record |
| `membership-handler.ts` | 120 | `users` | UPDATE | Clear/reset organizationId |
| `organization-handler.ts` | 39 | `organizations` | UPSERT | Create/update organization |
| `organization-handler.ts` | 68 | `organizations` | UPDATE | Partial update org fields |
| `membership-handler.ts` | 79 | `organizations` | SELECT | Read org_type for learner assignment |
| `membership-handler.ts` | 14 | `organization_members` | UPSERT | Add/update membership |
| `membership-handler.ts` | 109 | `organization_members` | DELETE | Remove membership |
| `membership-handler.ts` | 114 | `organization_members` | SELECT | Find remaining memberships |
| `membership-handler.ts` | 70 | `learners` | UPSERT | Create/update learner record |
| `membership-handler.ts` | 96 | `learners` | UPDATE | Set school_id or college_id |
| `subscription-handler.ts` | 49 | `subscription_cache` | UPSERT | Create subscription |
| `subscription-handler.ts` | 91 | `subscription_cache` | UPDATE | Update subscription |
| `subscription-handler.ts` | 100 | `subscription_cache` | UPDATE | Cancel/expire subscription |

**Total**: 16 database operations across 5 tables. Every operation is mediated by the Supabase REST API using the service role key.

### 1.3 Business Logic vs. Simple Persistence

**Pure CRUD (passthrough):**
- `user.deleted` — simple DELETE
- `user.email_verified` — simple read-modify-write on metadata
- `organization.updated` — field passthrough
- `subscription.created/updated/cancelled/expired` — field mapping with type coercion
- `membership.removed` — delete + query remaining + update user

**Business logic embedded in the consumer:**
- `user.created/updated` — field normalization (firstName vs first_name, contact_number vs phone)
- `organization.created` — hardcoded defaults (verification_status='approved', is_active=true, approval_status='approved', account_status='active')
- `membership.created/role_changed` — role mapping (SSO → org_member role), learner record creation, school/college assignment based on org_type
- `role-mapper.ts` — entire SSO-to-local role translation with priority-based resolution

**Key insight**: The business logic in this Worker *belongs* to the SkillPassport domain. Defaulting organizations to `approved`, creating learner records, assigning school_id/college_id, and mapping roles are decisions about SkillPassport's own data model. They should be encapsulated *behind* an API boundary, not executed by an external consumer that happens to have DB credentials.

---

## 2. Coupling Analysis

### 2.1 Schema Coupling

The auth-sync-consumer knows about:

- **Column names**: `firstName`, `lastName`, `organizationId`, `organization_type`, `verification_status`, `approval_status`, `account_status`, `recruitment_enabled`, `max_recruiters`, `school_id`, `college_id`, `subscription_cache` columns, etc.
- **Table names**: `users`, `organizations`, `organization_members`, `learners`, `subscription_cache`
- **Constraint names**: `on_conflict=id`, `on_conflict=user_id,organization_id`, `on_conflict=user_id`
- **Column types**: `metadata` is JSONB (merge behavior), `organization_type` is string (compared to 'school'/'college')
- **Default values**: Which columns get what defaults on org creation

### 2.2 Schema Change Risks

| Change in SkillPassport DB | Impact on auth-sync-consumer |
|---|---|
| Column renamed (`firstName` → `given_name`) | Break silently — wrong column name |
| Column dropped | 400 error from Supabase |
| Column type changed | Potential 400 error |
| Table renamed | Break — table name hardcoded |
| New required column added | Upsert/update might fail |
| Constraint changed (on_conflict key changes) | Wrong upsert behavior |
| RLS policies changed | Bypassed anyway (service role) |

### 2.3 Deployment Implications

- auth-sync-consumer and SkillPassport are **independently deployable Workers** in theory, but auth-sync-consumer must be updated whenever the SkillPassport schema changes
- No version negotiation — a deploy of auth-sync-consumer can silently use the wrong schema
- No way to run auth-sync-consumer against a different schema version during migration
- No testing of the contract between the two systems (no integration tests)

### 2.4 Security Implications

- **Service role key** is the single worst credential to expose: it bypasses ALL Row-Level Security, has full DDL/DML access, and is not scoped to specific tables or operations
- The key lives in `.dev.vars` on disk (checked in to gitignore but present)
- Any code change to auth-sync-consumer could inadvertently read, write, or delete any data in any table
- No audit trail for individual sync operations at the database level (all operations use the same service role identity)
- If the queue is compromised (e.g., a malicious message), the consumer executes arbitrary writes to the database

---

## 4. Cloudflare Best Practices Research

### 3.1 Service Bindings (Official Cloudflare Recommendation)

From the [Cloudflare Workers Best Practices](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/) page:

> **Use service bindings for Worker-to-Worker communication.** When one Worker needs to call another, use service bindings instead of making an HTTP request to a public URL. Service bindings are zero-cost, bypass the public internet, and support type-safe RPC.

Key characteristics:
- **Zero network overhead** — Workers run on the same thread by default
- **Type-safe RPC** — extend `WorkerEntrypoint`, expose methods, call directly
- **Capability-based security** — only Workers with an explicit binding can call; no public URL, no credentials to manage
- **Independent deployments** — each Worker deploys separately
- **No additional cost** — service binding calls are not billed as separate requests
- **Smart Placement compatible** — each Worker runs at the optimal location

### 3.2 RPC Security Model

From the [Visibility and Security Model](https://developers.cloudflare.com/workers/runtime-apis/rpc/visibility/) docs:

- Workers RPC uses **Object Capabilities (Capability-Based Security)**
- Each side can only invoke objects and functions for which it has explicitly received stubs
- Private class members (#) are never exposed over RPC
- Instance properties are not exposed by default — only explicitly declared methods
- The system does not allow either side to access arbitrary objects or invoke arbitrary code

### 3.3 Hyperdrive (Database Access Optimization)

From the [Hyperdrive docs](https://developers.cloudflare.com/hyperdrive/):

> Hyperdrive is a service that accelerates queries you make to existing databases, making it faster to access your data from across the globe from Cloudflare Workers.

- Maintains a regional connection pool near your database
- Eliminates per-request TCP handshake + TLS negotiation (often 300-500ms)
- Optional query caching
- Supports any Postgres or MySQL database (including Supabase/Neon/RDS/Aurora)

### 3.4 Queues Best Practices

From [Cloudflare Queues docs](https://developers.cloudflare.com/queues/):

- Queues are designed for async background processing
- Max retries with dead letter queue is the recommended pattern (already used)
- DLQ messages should trigger alerts, not just log-and-ack

### 3.5 Observability

Already partially configured in wrangler.toml:
- `observability.enabled = true` ✓
- `head_sampling_rate = 1` (100% log capture) ✓
- Traces enabled at 1% sampling ✓

Missing: structured error reporting, alerting on DLQ messages.

### 3.6 Secrets Management

From [Workers Best Practices](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/):

- Secrets go in `wrangler secret put`, never in wrangler.toml or .dev.vars in production
- `.dev.vars` is acceptable for local development but should use non-production credentials
- Environment configuration in `[vars]` block is for non-secret values only

---

## 5. Approach Comparison

### A. Direct Database Access (Current)

| Aspect | Assessment |
|---|---|
| **Advantages** | Simple to understand; no API to build/maintain; low latency (direct Supabase REST) |
| **Disadvantages** | Schema coupling; service role key exposure; no validation boundary; no encapsulation; security nightmare; no versioning; no audit trail |
| **Performance** | Good (REST API with 10s timeout), but no connection pooling (Hyperdrive not used) |
| **Security** | **Critical risk** — service role key bypasses all RLS, full DML/DDL |
| **Scalability** | Weak — sequential processing; no backpressure; database becomes bottleneck |
| **Operational complexity** | Low initially, but high long-term (schema changes require coordinated deploys) |

### B. HTTP Endpoint Synchronization

| Aspect | Assessment |
|---|---|
| **Advantages** | Encapsulates domain logic; API versioning possible; schema changes are decoupled; works with any runtime; standard auth patterns |
| **Disadvantages** | Network latency (~50-200ms per call); serialization overhead; need to manage auth tokens; rate limiting needed; more infrastructure |
| **Performance** | Moderate — each sync call adds HTTP round-trip (batch of 10 = 10 sequential HTTP calls) |
| **Reliability** | Good — standard HTTP retry patterns; can use idempotency keys |
| **Maintainability** | Good — OpenAPI spec can document contract; independent deploys |
| **Security** | Good — scoped service tokens; authentication required; audit trail per request |
| **Versioning** | API versioning in URL or header (`/v1/users/sync`) |

### C. HTTP Service Bindings (Worker to Pages Function, fallback)

| Aspect | Assessment |
|---|---|
| **Advantages** | Zero-cost (same-thread, no public internet); no credentials to manage; capability-based security; independent deployments; no auth token management |
| **Disadvantages** | HTTP-only (no RPC — Pages limitation); must construct Request/parse Response objects; no type safety; boilerplate routing needed |
| **Performance** | **Excellent** — same-thread execution; no network hop |
| **Reliability** | Good — HTTP status codes for error handling; standard retry patterns |
| **Maintainability** | Moderate — routing logic for endpoints; manual serialization; no compile-time contract |
| **Security** | **Very Good** — no public exposure; no credentials needed; capability-based |
| **Versioning** | URL-based versioning (`/sync/v1/user`) |

### D. Pages-to-Worker Migration + RPC Service Bindings (Recommended)

| Aspect | Assessment |
|---|---|
| **Advantages** | Zero-cost (same-thread); type-safe (TypeScript); no credentials; capability-based security; independent deployments; no serialization overhead; most future-proof |
| **Disadvantages** | Requires migrating SkillPassport from Pages to Worker; Cloudflare-only; TypeScript types must be shared; max 32 subrequest chain limit |
| **Performance** | **Best** — same-thread execution; no network hop; no serialization; no TCP handshake |
| **Reliability** | Excellent — errors propagate as native JS exceptions; caller controls retry |
| **Maintainability** | Best — TypeScript types define the contract; API surface is explicit methods on WorkerEntrypoint |
| **Security** | **Best** — capability-based; no public exposure; no credentials; only Workers with explicit bindings can call |
| **Versioning** | Deploy new methods alongside old; remove deprecated methods after callers migrate |

### Comparison Matrix

| Criterion | Direct DB | HTTP Endpoints | HTTP Service Binding | Pages→Worker + RPC |
|---|---|---|---|---|
| Latency | ~20-50ms | ~50-200ms | ~0ms (same thread) | ~0ms (same thread) |
| Security | **Critical risk** | Good | Very Good | **Best** |
| Schema coupling | Tight | None | None | None |
| Credential mgmt | Service role key | Service token | None | None |
| Indep. deploys | No | Yes | Yes | Yes |
| API versioning | N/A | Yes | URL-based | Type-based |
| Type safety | None | Contract/OpenAPI | None (HTTP) | **Native TS** |
| Cloudflare-only | No | No | Yes (CF internal) | Yes |
| Monitoring/audit | None | Request logs | Internal fetch logs | RPC traces |
| Implementation cost | None | Medium | Low | Medium (incl. migration) |
| Pages-compatible | ✅ | ✅ | Partial (direction?) | ❌ (needs Worker) |

**Key insight**: Options C and D are both zero-cost (no public internet). Option D adds type safety via RPC but requires migrating Pages to Worker. Option C works with Pages as-is but uses HTTP-style fetch calls.

---

## 5. Production Readiness Evaluation

### Scenario: Millions of Users

| Requirement | Direct DB | HTTP | Service Binding RPC |
|---|---|---|---|
| Throughput | Queue batch of 10, sequential processing | Sequential per-user HTTP calls | Same-thread calls, no overhead |
| DB connection pooling | None (each call opens new Supabase REST) | SkillPassport can pool | SkillPassport can use Hyperdrive |
| Cold start impact | OK (no connection state) | OK | Best (no serialization setup) |
| Backpressure | None | HTTP 429 support | Native (await propagates backpressure) |
| Rate limiting | None | Yes (SkillPassport side) | Yes (SkillPassport side) |

### Scenario: Multiple Workers

Multiple Workers trying to sync data → **Direct DB** gives them all service role keys, which is untenable. Both HTTP and Service Binding RPC allow SkillPassport to be the single entry point.

### Scenario: Independent Deployments

**Direct DB** fails — every schema change requires coordinated deployment. Both alternatives succeed.

### Scenario: Future Microservices

**Service Binding RPC** is best — each microservice extends `WorkerEntrypoint` and exposes its own set of RPC methods. The pattern scales naturally. Named entrypoints allow exposing different interfaces to different callers from a single Worker.

### Scenario: Evolving Database Schema

**Direct DB** breaks on every migration. **Service Binding RPC** — SkillPassport's internal schema can change freely as long as the RPC method signatures remain compatible.

---

## 7. Recommended Architecture: Pages-to-Worker Migration + Service Binding RPC

### 7.1 The Pages Function Constraint

SkillPassport is currently a Pages Function. This means **RPC Service Bindings cannot be used directly** — Pages Functions do not support `WorkerEntrypoint`.

There are two paths forward:

| Path | Action | Outcome |
|---|---|---|
| **Path A (Recommended)** | Migrate SkillPassport from Pages to Worker | Clean RPC Service Bindings, type safety, future-proof |
| **Path B (Intermediate)** | Use HTTP Service Bindings, keep Pages | Eliminates service role key, but HTTP-only communication |

### 7.2 Path A: Why Migrate Pages → Worker

Cloudflare [now recommends](https://hono.dev/docs/getting-started/cloudflare-pages) Workers over Pages for new full-stack projects:
- Workers support [static assets](https://developers.cloudflare.com/workers/static-assets/) (Pages' main differentiator is now available in Workers)
- Workers get `WorkerEntrypoint` + RPC Service Bindings
- Workers have a simpler deployment model (single `wrangler deploy`)
- Pages Functions are Workers under the hood — migration is primarily restructuring the entry point

### 7.3 Why RPC over HTTP (even internal HTTP Service Bindings)

If migrating to Worker, RPC Service Bindings are strictly better than HTTP Service Bindings:

1. **Zero cost** — Not billed as separate requests
2. **Zero latency** — Same-thread execution
3. **No credentials** — Capability-based security
4. **Type safety** — Native TypeScript; no OpenAPI spec drift
5. **Error propagation** — JS exceptions naturally; no HTTP status code parsing
6. **Backpressure** — Native async; no 429 design needed
7. **Method discovery** — Named methods vs. URL routing boilerplate

### 6.2 Architecture

```
auth-sync-consumer (queue consumer)
  │
  │  [[services]]
  │  binding = "SKILLPASSPORT_SYNC"
  │  service = "skillpassport-app"
  │  entrypoint = "SyncEntrypoint"
  │
  ▼
SkillPassport Worker (SyncEntrypoint)
  │  
  │  extends WorkerEntrypoint {
  │    async syncUser(action, data)
  │    async syncOrganization(action, data)
  │    async syncMembership(action, data)
  │    async syncSubscription(action, data)
  │  }
  │
  ▼
SkillPassport domain logic
  │  validation, authorization, business rules
  ▼
Hyperdrive → PostgreSQL (SkillPassport DB)
  │  Connection pooling, query caching
```

### 6.3 Authentication

**No explicit auth needed.** Service Bindings use Cloudflare's capability-based security model:
- Only Workers that declare `[[services]]` binding to `skillpassport-app` can call it
- The binding is configured at the Cloudflare account level
- No token, no API key, no JWT to manage
- The target Worker can be configured with **no public route** (internal only)

---

## 7. API Contract Design

### 7.1 SyncEntrypoint RPC Methods

```typescript
// File: skillpassport-app/src/entrypoints/sync-entrypoint.ts
import { WorkerEntrypoint } from "cloudflare:workers";

export class SyncEntrypoint extends WorkerEntrypoint {
  // ── Users ──────────────────────────────────────
  async syncUser(
    action: 'created' | 'updated' | 'email_verified' | 'deleted',
    data: {
      id: string;
      email?: string;
      firstName?: string;
      lastName?: string;
      phone?: string;
      role?: string;
      metadata?: Record<string, unknown>;
    }
  ): Promise<{ success: boolean; userId?: string; error?: string }>;

  // ── Organizations ──────────────────────────────
  async syncOrganization(
    action: 'created' | 'updated',
    data: {
      id: string;
      name: string;
      slug?: string;
      organizationType?: string;
      email?: string;
      phone?: string;
      address?: string;
      city?: string;
      state?: string;
      country?: string;
      pincode?: string;
      website?: string;
      establishedYear?: number;
      recruitmentEnabled?: boolean;
      maxRecruiters?: number;
      createdBy?: string;
    }
  ): Promise<{ success: boolean; orgId?: string; error?: string }>;

  // ── Memberships ────────────────────────────────
  async syncMembership(
    action: 'created' | 'role_changed' | 'status_changed' | 'removed',
    data: {
      userId: string;
      organizationId: string;
      roles?: string[];
      status?: string;
    }
  ): Promise<{ success: boolean; error?: string }>;

  // ── Subscriptions ──────────────────────────────
  async syncSubscription(
    action: 'created' | 'updated' | 'cancelled' | 'expired',
    data: {
      id: string;
      userId: string;
      organizationId?: string | null;
      planCode: string;
      planType?: string;
      planAmount?: number;
      billingCycle?: string;
      seatCount?: number;
      assignedSeats?: number;
      features?: unknown[];
      status?: string;
      startDate?: string;
      endDate?: string | null;
      isOrganizationSubscription?: boolean;
      productId?: string | null;
      updatedAt?: string;
    }
  ): Promise<{ success: boolean; error?: string }>;
}
```

### 7.2 Error Handling Design

```typescript
SyncResult = {
  success: boolean;
  error?: string;
  errorCode?: 'VALIDATION_ERROR' | 'NOT_FOUND' | 'CONFLICT' | 'INTERNAL_ERROR';
  retryable?: boolean; // true → auth-sync-consumer should retry
  userId?: string;
  orgId?: string;
};
```

### 7.3 Retry Strategy (in auth-sync-consumer)

| Error Code | Action |
|---|---|
| `VALIDATION_ERROR` | Ack the message (poison message — won't succeed on retry) |
| `NOT_FOUND` | Retry (dependency not yet synced, e.g., FK reference) |
| `CONFLICT` | Retry (optimistic lock or race condition) |
| `INTERNAL_ERROR` | Retry (transient server error) |

### 7.4 Idempotency

The `action` field combined with `data.id` (or `{userId, organizationId}` for memberships) provides natural idempotency:
- `syncUser('created', { id: '42', ... })` called twice → second call is idempotent (upsert behavior)
- SkillPassport can also reject `'created'` actions if the user already exists and return a conflict

### 7.5 Observability

- **auth-sync-consumer**: logs success/failure per message with `msg.ack()` or `msg.retry()`
- **SkillPassport SyncEntrypoint**: logs per-method invocation with duration, result, and error code
- **Trace propagation**: Cloudflare Workers automatically propagate trace context through service bindings
- **DLQ alerting**: Configure alert when DLQ receives messages (currently silent drop)

### 7.6 Rate Limiting

Service binding calls are not subject to HTTP rate limiting, but SkillPassport can still implement application-level throttling:
- Per-caller rate limits (based on the calling Worker identity — automatically available)
- Bulk operation limits (e.g., max 100 sync operations per minute per caller)

---

## 9. Current Architecture Diagram

```
┌────────────────────────────────────────────────────────────────────┐
│                        CLOUDFLARE WORKERS                          │
│                                                                    │
│  ┌─────────────────────────┐                                       │
│  │      SSO WORKER         │                                       │
│  │  (many event producers) │                                       │
│  │                         │   Cloudflare Queue                    │
│  │  env.SYNC_QUEUE.send()  │──►  auth-db-sync-queue               │
│  └─────────────────────────┘       max_batch=10, max_retries=3     │
│                                           │                        │
│                                           ▼                        │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │                 AUTH-SYNC-CONSUMER                            │  │
│  │  ┌──────────┐  ┌────────────┐  ┌──────────┐  ┌────────────┐  │  │
│  │  │message-  │─►│ event-     │─►│ handlers │─►│ db-client   │  │  │
│  │  │router.ts │  │ processor  │  │ (4 files) │  │ (Supabase) │  │  │
│  │  └──────────┘  └────────────┘  └──────────┘  └──────┬──────┘  │  │
│  └──────────────────────────────────────────────────────────┼─────┘  │
│                                                              │       │
│                                                    HTTPS (service role)
└──────────────────────────────────────────────────────────────┼───────┘
                                                               ▼
┌────────────────────────────────────────────────────────────────────┐
│                    SUPABASE (PostgreSQL)                            │
│  https://hweljtkqictqpwxbuwre.supabase.co                          │
│                                                                    │
│  ┌──────────┐  ┌──────────────┐  ┌───────────────────┐            │
│  │  users   │  │organizations │  │organization_members│            │
│  ├──────────┤  ├──────────────┤  ├───────────────────┤            │
│  │ id       │  │ id           │  │ user_id           │            │
│  │ email    │  │ name         │  │ organization_id   │            │
│  │ firstName│  │ slug         │  │ role              │            │
│  │ lastName │  │ admin_id     │  │ status            │            │
│  │ phone    │  │ org_type     │  │ updated_at        │            │
│  │ role     │  │ is_active    │  └───────────────────┘            │
│  │ metadata │  │ verification │                                      │
│  │ orgId    │  │ status       │  ┌───────────────────┐            │
│  └──────────┘  │ approval     │  │  learners         │            │
│                │ status       │  ├───────────────────┤            │
│                │ account_     │  │ user_id           │            │
│                │ status       │  │ name              │            │
│                │ recruitment  │  │ email             │            │
│                │ enabled      │  │ school_id         │            │
│                │ max_recruit- │  │ college_id        │            │
│                │ ers          │  └───────────────────┘            │
│                └──────────────┘                                      │
│                                          ┌──────────────────────┐  │
│                                          │ subscription_cache   │  │
│                                          ├──────────────────────┤  │
│                                          │ id, user_id, org_id  │  │
│                                          │ plan_code, status... │  │
│                                          └──────────────────────┘  │
│                                                                    │
│  ⚠️ Service role key = unrestricted DB access                      │
└────────────────────────────────────────────────────────────────────┘
```

---

## 10. Proposed Architecture

SkillPassport is a Pages Function, so RPC Service Bindings are not available. There are two paths:

### Phase 1 (Immediate): HTTP Service Bindings — Keep Pages Function

```
┌────────────────────────────────────────────────────────────────────┐
│                        CLOUDFLARE PLATFORM                         │
│                                                                    │
│  ┌─────────────────────────┐                                       │
│  │      SSO WORKER         │                                       │
│  │  env.SYNC_QUEUE.send()  │──►  Cloudflare Queue                  │
│  └─────────────────────────┘    auth-db-sync-queue                 │
│                                           │                        │
│                                           ▼                        │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │                 AUTH-SYNC-CONSUMER (Worker)                   │  │
│  │                                                              │  │
│  │  ┌──────────┐  ┌────────────┐  ┌─────────────────────────┐  │  │
│  │  │message-  │─►│ event-     │─►│ env.SKILLPASSPORT_SYNC  │  │  │
│  │  │router.ts │  │ processor  │  │  .fetch(new Request(     │  │  │
│  │  └──────────┘  └────────────┘  │   '/sync/user', {        │  │  │
│  │                   (no db-client│    method: 'POST',        │  │  │
│  │                    .ts anymore)│    body: JSON.stringify(  │  │  │
│  │                                │      { action, data }    │  │  │
│  │                                │    )}))                   │  │  │
│  │                                └───────────┬─────────────┘  │  │
│  └────────────────────────────────────────────┼─────────────────┘  │
│ HTTP Service Binding (zero-cost, same-thread) │                     │
│ Worker calls Pages Function via fetch()       │                     │
│ (no public internet, but HTTP-only, no RPC)   ▼                     │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │            SKILLPASSPORT (Pages Function)                    │  │
│  │                                                              │  │
│  │  functions/sync/user.ts       → onRequestPost(context)       │  │
│  │  functions/sync/org.ts        → onRequestPost(context)       │  │
│  │  functions/sync/membership.ts → onRequestPost(context)       │  │
│  │  functions/sync/subscription.ts→ onRequestPost(context)      │  │
│  │                                                              │  │
│  │  ┌────────────────────────────────────────────────────┐      │  │
│  │  │  Domain Service Layer                              │      │  │
│  │  │  (business logic moved from auth-sync-consumer)    │      │  │
│  │  │  ─ Role mapping, org defaults, learner creation    │      │  │
│  │  │  ─ Field mapping & normalization                   │      │  │
│  │  │  ─ Validation                                      │      │  │
│  │  └────────────────────────────────────────────────────┘      │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                        │                          │
│              Supabase REST / Hyperdrive  │                          │
└─────────────────────────────────────────┼─────────────────────────┘
                                           ▼
┌────────────────────────────────────────────────────────────────────┐
│                    SUPABASE (PostgreSQL)                            │
│  Database only accessible through SkillPassport.                   │
│  No direct DB access from auth-sync-consumer.                      │
│  Service role key removed from auth-sync-consumer.                 │
└────────────────────────────────────────────────────────────────────┘
```

### Phase 2 (Long-term): Pages→Worker Migration + RPC Service Bindings

```
┌────────────────────────────────────────────────────────────────────┐
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │                 AUTH-SYNC-CONSUMER (Worker)                   │  │
│  │  ┌──────────┐  ┌────────────┐  ┌─────────────────────────┐  │  │
│  │  │message-  │─►│ event-     │─►│ env.SKILLPASSPORT_SYNC  │  │  │
│  │  │router.ts │  │ processor  │  │   .syncUser('created',  │  │  │
│  │  └──────────┘  └────────────┘  │    { id, email, ... })  │  │  │
│  │                   (simplified) │   .syncOrg(...)          │  │  │
│  │                                │   .syncMembership(...)   │  │  │
│  │                                │   .syncSubscription(...) │  │  │
│  │                                └───────────┬─────────────┘  │  │
│  └────────────────────────────────────────────┼─────────────────┘  │
│                              RPC Service Binding (zero-cost)       │
│                                               ▼                    │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │                 SKILLPASSPORT (Worker)                        │  │
│  │  ┌────────────────────────────────────────────────────┐      │  │
│  │  │  class SyncEntrypoint extends WorkerEntrypoint {   │      │  │
│  │  │    async syncUser(action, data): SyncResult {...}  │      │  │
│  │  │    async syncOrganization(action, data) {...}      │      │  │
│  │  │    async syncMembership(action, data) {...}        │      │  │
│  │  │    async syncSubscription(action, data) {...}      │      │  │
│  │  │  }                                                 │      │  │
│  │  └──────────────────────┬─────────────────────────────┘      │  │
│  │  ┌──────────────────────▼─────────────────────────────┐      │  │
│  │  │  Domain Service Layer                              │      │  │
│  │  └──────────────────────┬─────────────────────────────┘      │  │
│  │  ┌──────────────────────▼─────────────────────────────┐      │  │
│  │  │  Hyperdrive + PostgreSQL client                    │      │  │
│  └──────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────┘
```

---

## 11. Migration Plan

### Phase 1: Add Sync Endpoints to SkillPassport Pages Function

1. Create endpoint functions in SkillPassport:
   - `functions/sync/user.ts` — `onRequestPost(context)` — handle user sync
   - `functions/sync/org.ts` — `onRequestPost(context)` — handle org sync
   - `functions/sync/membership.ts` — `onRequestPost(context)` — handle membership sync
   - `functions/sync/subscription.ts` — `onRequestPost(context)` — handle subscription sync
2. Move business logic from auth-sync-consumer into these endpoints:
   - Role mapping (`role-mapper.ts`)
   - Org default values
   - Learner record creation logic
   - Field normalization
3. Move `SUPABASE_SERVICE_ROLE_KEY` to SkillPassport (it already needs DB access)
4. Test locally with Wrangler multi-worker dev

### Phase 2: auth-sync-consumer HTTP Service Binding Integration

1. Add `[[services]]` binding in auth-sync-consumer's `wrangler.toml`:
```toml
[[services]]
binding = "SKILLPASSPORT_SYNC"
service = "skillpassport-app"  # Pages Function name in Cloudflare dashboard
```
2. Replace `db-client.ts` calls with fetch calls through the service binding:
```typescript
// Before:
import { dbClient } from './lib/db-client';
const db = dbClient(env);
await db.upsert('users', payload, 'id');

// After:
const res = await env.SKILLPASSPORT_SYNC.fetch(
  new Request('https://internal/sync/user', {
    method: 'POST',
    body: JSON.stringify({ action: 'created', data: payload }),
    headers: { 'Content-Type': 'application/json' },
  })
);
if (!res.ok) throw new Error(await res.text());
```
3. Simplify handlers — remove database logic, keep only event type routing + RPC call
4. Remove `db-client.ts` and `SUPABASE_SERVICE_ROLE_KEY` from auth-sync-consumer
5. Test with Wrangler multi-worker dev

### Phase 3: Cutover

1. Deploy SkillPassport Pages Function changes first (new endpoint functions)
2. Deploy updated auth-sync-consumer
3. Monitor for errors in both services
4. Verify messages flow through successfully

### Phase 4: Cleanup

1. Remove `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` env vars from auth-sync-consumer
2. Delete `db-client.ts`, `role-mapper.ts` from auth-sync-consumer
3. Delete `.dev.vars` from auth-sync-consumer
4. Update `wrangler.toml` to remove unused vars

### Phase 5 (Optional): Pages-to-Worker Migration

1. Convert SkillPassport Pages Function to a Worker (`src/index.ts` with `fetch` handler)
2. Convert sync endpoints to `WorkerEntrypoint` class with named RPC methods
3. Update auth-sync-consumer binding to use RPC instead of HTTP `fetch()`
4. Deploy SkillPassport Worker, then auth-sync-consumer

---

## 12. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **HTTP Service Binding from Worker to Pages Function untested** | Medium | High | Verify with a test deployment before full migration; Community reports mixed results; may need to skip to public HTTP endpoints |
| **Worker → Pages Function service binding direction not officially documented** | Medium | High | Cloudflare docs document Pages→Worker, not Worker→Pages. Test in preview environment. Fall back to public HTTP endpoints if it doesn't work |
| **Business logic extraction errors** | Medium | High | Extract logic one handler at a time; test each before deploying; keep old handlers as fallback |
| **No testing currently exists** | High | High | Write integration tests for sync endpoints before cutover; manual verification during Phase 2 |
| **Pages→Worker migration scope** | Medium | High | If Phase 5 is pursued, requires restructuring the entire SkillPassport app; budget separate effort |
| **auth-sync-consumer must wait for SkillPassport deploy** | Low | Medium | Deploy SkillPassport first; auth-sync-consumer can fail gracefully (Queue retries) |

---

## 13. Rollback Strategy

### Rollback Plan

1. **If Phase 1 or 2 fails** (Sync endpoints or binding broken):
   - Revert SkillPassport Pages Function deploy
   - Revert auth-sync-consumer to previous version
   - Messages in queue will retry (max 3 retries, then DLQ)
   - Reprocess DLQ messages after rollback

2. **If Phase 3 fails** (cutover has errors):
   - Revert auth-sync-consumer to old code (re-adding `db-client.ts`)
   - Restore `SUPABASE_SERVICE_ROLE_KEY` secret
   - Reprocess any failed messages from the DLQ

3. **If Phase 5 fails** (Pages→Worker migration):
   - Revert SkillPassport to Pages Function version
   - Revert auth-sync-consumer to HTTP Service Binding version
   - No data loss — old code path is fully compatible

4. **Coexistence**: Both old and new deployments can run simultaneously against the same database and queue without conflict.

---

## 14. Final Recommendation

### Primary: Phase 1 → Phase 2 → Phase 3 (HTTP Service Bindings, keep Pages)

This is the minimum viable improvement:
- **Eliminates the service role key** from auth-sync-consumer — the critical security fix
- **Moves business logic** behind an API boundary
- **Enables independent deployments**
- **Zero-cost internal communication** (no public internet)
- **Works with Pages Functions as-is**

Then evaluate whether Phase 5 (Pages→Worker migration) is worth the effort based on:
- How often the sync API contract changes
- How valuable type-safe RPC is vs. HTTP fetch
- Cloudflare's roadmap for Pages Functions vs. Workers

### Secondary: Phase 5 (Pages→Worker + RPC Service Bindings)

Pursue this if:
- The sync surface grows beyond 4 endpoints
- Multiple consumers need the sync API
- Type safety becomes a pain point
- Cloudflare further deprecates Pages Functions in favor of Workers

### Key Files Affected

| File | Action |
|---|---|
| `auth-sync-consumer/src/lib/db-client.ts` | **Delete** — replaced by Service Binding fetch |
| `auth-sync-consumer/src/handlers/*.ts` | Simplify — remove DB logic, call Service Binding |
| `auth-sync-consumer/src/role-mapper.ts` | **Move** to SkillPassport |
| `auth-sync-consumer/wrangler.toml` | Add `[[services]]` binding, remove `SUPABASE_URL` |
| `auth-sync-consumer/.dev.vars` | **Delete** |
| `skillpassport/functions/sync/*.ts` | **Create** — sync endpoint functions |
| `skillpassport/src/services/sync-service.ts` | **Create** — domain service layer |
