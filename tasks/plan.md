# Implementation Plan: HTTP Sync Endpoints

## Overview
Replace direct Supabase DB writes from `auth-sync-consumer` (Worker) with authenticated internal HTTP sync endpoints on `SkillPassport` (Pages Function). Two-phase migration: deploy endpoints first, then cut over the consumer.

## Dependency Graph

```
Phase 1 (SkillPassport)
├── 1.1: Hyperdrive binding & db utility
├── 1.2: role-mapper.ts (moved)
├── 1.3: sync-service.ts (domain logic)
├── 1.4: sync/user endpoint
├── 1.5: sync/org endpoint
├── 1.6: sync/membership endpoint
└── 1.7: sync/subscription endpoint

Phase 2 (auth-sync-consumer)
├── 2.1: sync-client.ts (fetch wrapper)
├── 2.2: Simplify handlers to call sync-client
│   ├── 2.2a: user handler
│   ├── 2.2b: organization handler
│   ├── 2.2c: membership handler
│   └── 2.2d: subscription handler
├── 2.3: Delete db-client.ts, role-mapper.ts, .dev.vars
└── 2.4: wrangler.toml service binding
```

## Architecture Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Hyperdrive client | Postgres.js | Lightest, native-sql, built-in `nodejs_compat` support |
| Worker→Pages binding | HTTP Service Binding | Only option; RPC not available for Pages Functions |
| Endpoint structure | One file per domain | Clear ownership, independent deploy/rollback per domain |
| Error handling | Structured envelope | Consumers can decide retry vs dead-letter |
| Validation | Zod at endpoint boundary | Defense-in-depth; consumer input is already validated but trust nothing internal |

## Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Worker→Pages binding direction doesn't work | High | Fallback: make endpoints public with shared secret header, route via URL |
| Hyperdrive adds latency > 500ms per call | Medium | Test in preview; add connection pooling, keep warm |
| Event format changes upstream | Medium | Zod validation catches schema drift immediately |
| Phase 2 deploys before Phase 1 | High | Deploy commands must be sequential; add deploy plan to scripts |
| Missing FK dependencies cause failures | Low | Retryable errors + Queue redelivery handles eventual consistency |

## Open Questions
1. Does Worker→PagesFunction HTTP service binding actually work? — Must test first.
2. Postgres.js connection string format for Hyperdrive? — Will verify from Hyperdrive dashboard.
