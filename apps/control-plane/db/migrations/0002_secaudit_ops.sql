-- SecAudit operational persistence (batches + schedules)
-- Phase: durable scheduler/batch recovery

CREATE TABLE IF NOT EXISTS secaudit_batches (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  operator_id TEXT NOT NULL,
  endpoint_ids_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  plan_ids_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'partial', 'failed', 'cancelled')),
  created_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_secaudit_batches_tenant_created
  ON secaudit_batches (tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS secaudit_schedules (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  operator_id TEXT NOT NULL,
  endpoint_id TEXT NOT NULL,
  package_id TEXT NOT NULL,
  target_os TEXT NOT NULL,
  execution_level TEXT NOT NULL,
  modules_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  interval_minutes INTEGER NOT NULL,
  next_run_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_secaudit_schedules_next_run
  ON secaudit_schedules (next_run_at ASC);
