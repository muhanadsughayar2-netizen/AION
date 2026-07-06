---
name: Postgres 1600-column ceiling from init_db
description: One exhausted legacy table can silently take down an entire Flask/Postgres API if startup schema-migration ALTERs share one transaction.
---

Postgres has a hard per-table limit of 1600 column "slots" (`attnum`). That
counter only ever goes up — a `DROP COLUMN` frees the *name* but not the
slot. A table that has been through many years of `ADD COLUMN` /
`DROP COLUMN` churn can hit the 1600 ceiling while having only a couple
dozen *live* columns. Once hit, `ALTER TABLE ... ADD COLUMN` on that table
fails forever (`TooManyColumns`) until the table itself is rebuilt.

**Why this matters:** if a startup routine runs many `CREATE TABLE` /
`ALTER TABLE ADD COLUMN IF NOT EXISTS` statements in a single unguarded
transaction/try-block, one exhausted (or otherwise broken) table failing
mid-sequence aborts the whole Postgres transaction. Every statement after
it — including for completely unrelated, healthy tables — silently fails
too, and the top-level exception handler reports total DB init failure.
Downstream, any request path that gates on "is DB ready" (e.g. a
`before_request` lazy-init check) starts 503ing for *all* users, even
though 95% of the schema was actually fine.

**How to apply:** wrap each `ALTER TABLE ... ADD COLUMN` (or any DDL that
might legitimately fail against pre-existing production data) in its own
`SAVEPOINT` / `ROLLBACK TO SAVEPOINT` so one failing statement is isolated
and logged, and the rest of schema init proceeds normally. Don't rely on
one big try/except around the whole migration block — psycopg2 (and
Postgres generally) poisons the entire transaction after any error inside
it, so subsequent statements in the same transaction fail too unless you
roll back to a savepoint first. Diagnose actual `attnum`/dropped-column
bloat via `pg_attribute` (`attisdropped`, `max(attnum)`) per table, not
just `information_schema.columns` (which only shows live columns and will
hide the real cause). Recreating a table to reclaim slots requires DDL on
production, which normal agent workflows can't run directly — that part
needs the app's own runtime/admin path or platform support, but making
init resilient (savepoints) restores service immediately without touching
production DDL.
