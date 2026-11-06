# Shared-card PostgreSQL operating contract

2026-11-06. Local implementation only. Owner approved PostgreSQL lifecycle/snapshots and a$15/month planning budget, not spending or deployment. Render/Frankfurt,7-day access, accepted backup/disaster limits retained. No public service exists. Maintenance operator unassigned. No account/credentials/provider resources created.

## Components and configuration

`npm ci --prefix service --ignore-scripts` installs only the service-scoped pinned MIT `pg` driver and lockfile dependencies. Root application packages are unchanged. Driver license retained in `licenses/pg-MIT.txt`; npm packages retain their individual licenses. Node24 tested. No browser/native PostgreSQL driver or remote upload is added to the app.

`render.yaml` prepares one$7 web instance plus paid$6 Postgres and1GB DB storage$0.30, same Frankfurt region, Hobby workspace, no app disk: **$13.30/month base** before taxes/FX/egress/build overages. No auto-deploy, no public DB IP allowance and issuance disabled by default. Applying the Blueprint WOULD provision paid resources and is not authorized. Storage/compute scaling, recovery-overlap billing and a domain are excluded from this estimate. The$15 budget is not a hard cap. Confirm checkout/capacity before use.

Production settings:

| Setting | Contract |
| --- | --- |
| `CARD_STORAGE=postgres` | Explicit selection; never falls back to filesystem if SQL fails. Unset/local filesystem mode remains available for historical local tests and retains its per-boot production guard. |
| `CARD_MODE=production`, `PORT` | Bind0.0.0.0 to the provided port. Missing/unsafe settings fail with generic errors. |
| `CARD_DATABASE_URL` | Restricted runtime-role URI, no query/fragment. Secret environment value, never printed. Do NOT supply the provider's default owner connection string to the web service. |
| `CARD_DATABASE_TLS=verify` | Certificate and hostname verification; no `sslmode=disable` URL override. Explicit local mode alone permits `local` TLS setting on loopback. Actual provider TLS/private-host compatibility still requires deployment validation. |
| `CARD_DATABASE_ID`, `CARD_NAMESPACE` | Explicit UUIDs kept in deployment configuration outside DB backups and matched against initialized authority. Stable on NORMAL restart; NEW on disaster recovery. Missing/mismatched identity/schema never auto-initializes. |
| `CARD_TTL_MS=604800000` | Seven days from DB-clock issuance; upload/retry never resets it. |
| Origins/proxy | Exact `CARD_SERVICE_ORIGIN`, `CARD_ALLOWED_ORIGINS`, `CARD_TRUST_PROXY=render`, verified trusted-end `CARD_PROXY_HOPS` and `CARD_PROXY_VERIFIED=yes` required. R6 ingress verification remains a provider preflight gate; CORS is not authentication. |
| Resource settings | Existing max100 rows/64MB service content bound,20 issues/day,4GB accounted bytes/month, source/body/PNG/admission limits retained. Defaults can be reduced, not silently raised. These are not provider capacity guarantees or a billing cap. |
| `CARD_ISSUANCE_ENABLED` | Defaults off in Blueprint. Disabled issuance leaves read/revoke available. |

The app destination remains unset. Explicit future `VITE_CARD_SERVICE_URL` configuration requires separately approved candidate/release work. No automatic upload or loss of offline image sharing.

## Explicit empty initialization and role separation

Use an EMPTY dedicated database and an owner/admin session; no initialization is run by the web process or deployment startup. Separately provision a restricted LOGIN role with NOSUPERUSER/NOCREATEDB/NOCREATEROLE/NOREPLICATION and no owner membership. Keep credentials with the operator and out of shell history/source/logs. This assignment used only trust-authenticated synthetic roles in a loopback test cluster, not provider accounts.

With the production settings above, `CARD_ADMIN_DATABASE_URL` available only to the one-off administrative process and `CARD_DATABASE_RUNTIME_ROLE` naming that precreated role:

```
node service/database-operate.mjs init-empty INITIALIZE_EMPTY_DATABASE_INVALIDATE_OLD_LINKS
```

The initializer refuses existing application tables/views/sequences, creates schema version1, inserts one authority and zeroed quotas, and grants runtime usage/read/cards DML plus UPDATE of quota columns only. It grants no DDL, authority insertion/deletion/identity update or truncate. Runtime readiness rejects superuser/createdb/createrole/replication/schema-owner-capable credentials. No destructive migration, drop, repair or imported local records. Initialization errors are generic and roll back.

Admin access for future provider setup must use an explicitly authorized trusted network/session; do not expose the database broadly just to run this tool. No admin URL belongs in persistent web-service environment. Blueprint deliberately leaves the runtime URI for operator configuration instead of injecting owner credentials automatically.

## Transaction and restart behavior

One bounded pool (max2),3s connection/lock deadlines and5s SQL statements; no request/body/token/credential logging. Each operation leases ONE client for BEGIN through COMMIT, sets synchronous_commit=on, verifies fsync/full_page_writes and runtime privileges, and locks the authority row. This serializes lifecycle and global quotas across independent app instances. No in-memory authorization cache or disk fallback. PNG/text queries remain bounded by existing service limits.

Creation capabilities and HTTP envelopes remain R3D version2. Issuance inserts a new identity only; activation strictly UPDATEs an existing authorized reservation, cannot upsert absence. Exact retries retain original bytes/expiry; conflicting content returns409. PostgreSQL stores exact PNG bytea and ordered presentation JSON text. Expiry uses database time; record reads refresh the DB check time even if the transaction was delayed. Revocation removes PNG/text and commits terminal state atomically.

**HTTP success is buffered until COMMIT succeeds.** Connection/commit-response uncertainty returns503; the transaction may already have committed. Exact retry/read/revoke reconciles rather than rolling content back or allocating a replacement URL. No uncommitted content is sent. A transient failure does not permanently poison the SQL adapter: subsequent operations reconnect/recheck authoritative state.

Normal web-process or PostgreSQL-engine restart reconnects to the SAME live database/namespace and retains cards without operator approval. `/readyz` verifies live authority and cleanup; Blueprint health now uses it. `/livez` remains process liveness only. DB/namespace unavailable means503, no automatic empty reset. Filesystem-mode approval logic is not removed; it is bypassed ONLY by explicitly selected, successfully verified SQL authority.

## Retention and disaster recovery

Access denies at original expiry independent of sweeper success. Healthy startup/periodic/request sweeps clear expired PNG/text, unlink unused reservations at min(10min,TTL), and delete terminal metadata at original expiry+24h. A SQL failure rolls the transaction back; access still fails closed. No retention extension for replay prevention. Logical DELETE/NULL and vacuum/WAL do not prove physical secure erasure.

For disaster recovery: suspend serving; isolate recovered media/database; create a NEW empty dedicated database, NEW external namespace and authority UUIDs, and a properly restricted runtime role. Run:

```
node service/database-operate.mjs recover-empty INITIALIZE_EMPTY_DATABASE_INVALIDATE_OLD_LINKS
```

It uses the same empty-only initialization checks. Never import old lifecycle rows or set deployment config back to the old namespace. Confirm old read/activation capabilities remain unavailable, new creation differs, and normal restart retains the NEW state. Point application connection/configuration to that clean authority only after a separately authorized drill. Local History/recipient images are untouched. Quarantined copies need an approved deletion procedure, not indefinite retention.

Render PITR creates a separate instance and requires explicit connection changes. Ordinary restart is not permission to restore old snapshots. Runtime role cannot restore/DDL, but a privileged administrator or provider in-place rollback retaining old identity/configuration can undo revocation; this adapter does NOT cryptographically detect that. Confirm acknowledged-write durability/automated failover/restore boundaries with the provider before claiming protection. Never replay a backup into the serving DB. Code rollback retains current authority/config or stops serving, never returns to prior files.

Hobby PITR3 days and provider logical-export retention7 days fit the selected normal backup tolerance; no all-media erasure SLA follows. Public backup/privacy/log/clock/abuse review and provider evidence remain prerequisites. Sources reviewed2026-11-06: [Render recovery](https://render.com/docs/postgresql-backups), [creating/private connections](https://render.com/docs/postgresql-creating-connecting), [pricing](https://render.com/pricing), [storage pricing](https://render.com/articles/how-much-does-cloud-application-hosting-cost-for-small-businesses), [node-postgres transactions](https://node-postgres.com/features/transactions).

## Local actual-database tests

With existing Linux Node24 and PostgreSQL16 tools, install the pinned service dependencies, then run `bash service/test-postgres.sh` from repository root. Optional `CARD_TEST_NODE`, `CARD_TEST_PG_BINDIR`, `CARD_TEST_PG_SHARE` and process-scoped loader path support user-extracted distributions. The launcher creates a dedicated cluster under `$HOME/.local/share/taxi-check-pg-tests/run.*`, binds only loopback55439, uses trust authentication ONLY for synthetic local data, suppresses statement/parameter logging, runs all service tests serially and stops its own cluster. It never starts/stops a system service, buys compute or operates unrelated DBs. Evidence directories are retained outside the repo. Do not use that trust configuration with personal/live data or provider deployment.

Without `CARD_TEST_DATABASE_URL`, actual Postgres cases are explicitly SKIPPED, not passed. The launcher supplies the URL, engine-control/data paths and Linux temporary directory; tests create/drop only generated `tc_` fixture databases in this cluster. Failure injections still intentionally simulate response loss/rollback; SQL transactions and PostgreSQL restart are real. No Render/TLS/failover/power-loss evidence is inferred from local ext4. Keep provider validation and human/native acceptance separate.


Executed2026-11-06: maintained launcher on Node24.15.0/Linux ext4 with real PostgreSQL16.15 passed74/74 cases, zero skips, including actual database-engine restart. Application522 cases/26 files, typecheck/web build and local Blueprint schema validation passed. Test dependency footprint475333 bytes, root dependency files unchanged. Development cleanup observation window was corrected from150ms to5s after reproduced Linux timing failures; cleanup behavior was not changed. No managed provider, live TLS, production load or physical-device evidence inferred.
