# SecAudit E2E Launch Checklist

Date: 2026-07-08
Owner: control-plane + controller-electron

## Goal
Validate full SecAudit launch flow in production-like conditions:
1. create audit plan,
2. create drift baseline,
3. compute risk score,
4. detect drifts,
5. dispatch alerts,
6. verify cooldown behavior.

## Pre-flight
- Node 22 available.
- Environment variables defined where needed:
  - `SLACK_WEBHOOK_URL`
  - `TEAMS_WEBHOOK_URL`
  - `SMTP_URL`
  - `ALERT_FROM_ADDRESS`
  - `ALERT_RECIPIENTS`
  - `ALERT_RECIPIENTS_CRITICAL`
- Admin API key configured (`ADMIN_API_KEY`) for alert event checks.
- Services running:
  - control-plane API
  - controller-electron (for SecAudit UI smoke)

## Automated Validation
Run from `apps/control-plane`:

```powershell
npm run build
npm test -- src/services/secaudit-drift-service.test.ts
npm test -- src/services/drift-alert-service.test.ts
npm test -- src/api/secaudit-routes.test.ts
```

Expected:
- Build succeeds (0 TypeScript errors).
- Drift service tests pass.
- Drift alert service tests pass.
- SecAudit routes tests pass including E2E cooldown case.

## Manual E2E Smoke (API)
1. Create plan:
   - `POST /api/v1/secaudit/plans`
2. Create baseline:
   - `POST /api/v1/secaudit/baselines`
3. Trigger drift (pass -> fail):
   - `POST /api/v1/secaudit/risk-score/:planId`
4. Query drifts:
   - `GET /api/v1/secaudit/drifts/:planId`
5. Query alert events:
   - `GET /api/v1/alerts/events` with `x-api-key`
6. Repeat risk-score within 1h:
   - confirm no duplicate drift alert event due to cooldown.

## Manual E2E Smoke (UI)
From SecAudit panel in Electron:
1. Run audit plan.
2. Confirm Risk & Drift panel appears after plan execution.
3. Confirm score, severity, trend sparkline, critical drifts and recommendations render.
4. Confirm refresh works and panel polls each 60 seconds.

## Release Gate (Go/No-Go)
- [ ] Build green in control-plane.
- [ ] Build green in controller-electron.
- [ ] Critical tests green (drift + alert + routes).
- [ ] Manual webhook delivery observed in Slack/Teams/Email.
- [ ] Cooldown verified (no alert storm).
- [ ] SecAudit UI smoke validated.
- [ ] Runbook shared with operations.

## Rollback Plan
If issues appear post-release:
1. Disable alert channels by unsetting webhook/SMTP env vars.
2. Revert to prior release tag.
3. Re-run build + focused tests.
4. Re-enable channels gradually (Slack -> Teams -> Email).
