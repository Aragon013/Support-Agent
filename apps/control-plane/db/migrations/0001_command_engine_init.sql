-- Command Engine initial schema
-- Phase 5 / CP-02

-- Optional helper for UUID generation in Postgres.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS command_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  endpoint_id UUID NOT NULL,
  session_id UUID NULL,
  operator_id UUID NOT NULL,
  catalog_command_id TEXT NOT NULL,
  command_version TEXT NOT NULL,
  requested_params_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  risk_level TEXT NOT NULL CHECK (risk_level IN ('low', 'medium', 'high', 'critical')),
  requires_mfa BOOLEAN NOT NULL DEFAULT FALSE,
  mfa_verified_at TIMESTAMPTZ NULL,
  status TEXT NOT NULL CHECK (
    status IN (
      'created',
      'policy_check',
      'mfa_pending',
      'queued',
      'dispatched',
      'running',
      'streaming',
      'verifying',
      'completed',
      'failed',
      'cancelled',
      'blocked'
    )
  ),
  priority SMALLINT NOT NULL DEFAULT 5,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 1,
  queued_at TIMESTAMPTZ NULL,
  started_at TIMESTAMPTZ NULL,
  completed_at TIMESTAMPTZ NULL,
  exit_code INTEGER NULL,
  fail_reason TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS command_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  command_job_id UUID NOT NULL REFERENCES command_jobs(id) ON DELETE CASCADE,
  host_agent_id UUID NOT NULL,
  dispatched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ NULL,
  finished_at TIMESTAMPTZ NULL,
  exit_code INTEGER NULL,
  timed_out BOOLEAN NOT NULL DEFAULT FALSE,
  killed BOOLEAN NOT NULL DEFAULT FALSE,
  cpu_time_ms BIGINT NULL,
  wall_time_ms BIGINT NULL,
  output_bytes BIGINT NOT NULL DEFAULT 0,
  output_digest_sha256 TEXT NULL
);

CREATE TABLE IF NOT EXISTS command_output_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  command_attempt_id UUID NOT NULL REFERENCES command_attempts(id) ON DELETE CASCADE,
  seq_no INTEGER NOT NULL,
  stream_type TEXT NOT NULL CHECK (stream_type IN ('stdout', 'stderr')),
  payload_ciphertext_ref TEXT NOT NULL,
  payload_size INTEGER NOT NULL CHECK (payload_size >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(command_attempt_id, seq_no, stream_type)
);

CREATE TABLE IF NOT EXISTS command_policy_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  command_job_id UUID NOT NULL REFERENCES command_jobs(id) ON DELETE CASCADE,
  rule_name TEXT NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('allow', 'deny', 'stepup')),
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_command_jobs_tenant_status_created
  ON command_jobs (tenant_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_command_jobs_endpoint_status_created
  ON command_jobs (endpoint_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_command_jobs_operator_created
  ON command_jobs (operator_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_command_attempts_job_dispatched
  ON command_attempts (command_job_id, dispatched_at DESC);

CREATE INDEX IF NOT EXISTS idx_command_output_chunks_attempt_seq
  ON command_output_chunks (command_attempt_id, seq_no);

CREATE INDEX IF NOT EXISTS idx_command_policy_logs_job_created
  ON command_policy_logs (command_job_id, created_at DESC);
