# Production sharing service preparation

2026-11-06. PostgreSQL lifecycle and exact snapshots are owner-approved for local implementation, with a$15/month planning budget. **No purchase, account or deployment authorized.**

[Current PostgreSQL configuration, initialization, restart/recovery contract and local test instructions](POSTGRES.md) are the maintained operating procedure. The prepared `render.yaml` now selects Postgres, Frankfurt, DB-backed `/readyz`, no app disk and no automatic deploys. Runtime credentials must be restricted; owner/admin credentials are not injected into the web service. Estimated base$13.30/month before tax/overages, not a guaranteed cap.

The R6/R6A filesystem production path remains in source for compatibility and requires per-boot manual approval. It is not an unattended production alternative and is never a fallback for failed Postgres. Its init/approve tools are separate from `database-operate.mjs`; do not mix their store IDs with database authority identities.

Postgres normal restart reconnects to existing committed authority without invalidating links. Disaster recovery uses an EMPTY database/new external namespace and loses old links under the accepted policy. Provider in-place rollback/privileged misconfiguration is not cryptographically detected. Operator unassigned; provider TLS/proxy/durability/restore, capacity, policy/privacy and public release evidence remain gates. Mac/iPhone access and human acceptance remain separate and deferred. No working public deployment or comprehensive security audit is claimed.
