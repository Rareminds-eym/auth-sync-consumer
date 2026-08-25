# auth-sync-consumer

Consumes identity sync events from the **sso-worker** `SYNC_QUEUE`
(`auth-db-sync-queue`) and replicates them into the SkillPassport app database
by POSTing signed webhooks to SkillPassport's `/sync/*` endpoints.

## Events handled

| Event | App-DB effect |
|---|---|
| `user.created` / `user.updated` | `users` upsert (email, names, role, phone) |
| `user.deleted` | `users` delete |
| `user.email_verified` | `metadata.is_email_verified = true` |
| `organization.created` / `updated` | `organizations` upsert (+ `organization_members`) |
| `membership.created` | `organization_members` upsert + `learners` row for learner roles (`handleLearnerOrgAssignment`) |
| `membership.removed` / `role_changed` / `status_changed` | membership mirror updates |
| `subscription.created/updated/cancelled/expired` | `subscription_cache` upsert |

Failures retry up to 3× then land in `auth-db-sync-dlq` (logged on consumption).

## ⚠️ Local topology requirement

Miniflare queues do **not** deliver across separate `wrangler dev` processes.
This consumer must share a Miniflare instance with sso-worker:

```bash
cd ../sso-worker && npm run dev:stack   # runs sso-api + this consumer together
```

Then start SkillPassport pages separately (`npm start`, port 8788) — it is the
webhook receiver.

## Configuration (`.dev.vars`)

See [`.dev.vars.example`](./.dev.vars.example) for the full template:

| Var | Purpose |
|---|---|
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | Local SkillPassport app DB (direct writes: `subscription_cache`) |
| `SKILLPASSPORT_SYNC_URL` | Webhook target, e.g. `http://localhost:8788` |
| `SYNC_API_SECRET` | Must equal SkillPassport's `INTERNAL_WEBHOOK_SECRET` — `/sync/*` rejects unauthenticated calls |

## Production

Set in `[env.production.vars]`: `SKILLPASSPORT_SYNC_URL=https://skillpassport.rareminds.in`,
plus secrets `SYNC_API_SECRET` and the prod app-DB key via
`wrangler secret put`. Deploy order after sso-worker changes: worker → consumer → pages.
