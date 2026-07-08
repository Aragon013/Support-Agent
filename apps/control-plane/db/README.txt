Control-plane DB migrations

How to apply manually (PostgreSQL):
1. Open psql with target database.
2. Run the migration in order:
   - db/migrations/0001_command_engine_init.sql
   - db/migrations/0002_secaudit_ops.sql

Notes:
- This schema is the CP-02 baseline for Command Engine.
- It is intentionally SQL-first to keep tooling lightweight.
- Application-level state transition guards remain in domain code.
- SecAudit batches/schedules are persisted when SECAUDIT_DB_URL is configured.
