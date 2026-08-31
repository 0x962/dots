Runs when: The diff adds or changes a database migration, a schema file, or a model field. When that misses, return SKIP with the file that decided it.

Rules:
1. A migration is additive first: add the column or table, backfill, then add the constraint. A single migration that adds a NOT NULL column with no default to a live table is a finding.
2. No statement that holds a long lock on a hot table. Name the lock the statement takes when you report it.
3. The migration is reversible, or the finding says exactly why it cannot be and what the rollback plan is instead.
4. When code and schema must deploy in a fixed order, the pull request says so. A migration the old code cannot run against is a finding.
5. An enum or a check constraint grows by addition. Renaming or removing a value that live rows may hold is a finding.
6. A data migration is idempotent: running it twice leaves the same result.
7. A new index on a large table states how it is built; an index build that blocks writes is a finding.
8. Report every finding with the migration file name, so the reader can find it without the diff.
