#!/usr/bin/env node
/**
 * Seed del endpoint registry para entornos de desarrollo.
 * Registra endpoints de prueba vía POST /api/v1/endpoints.
 *
 * Uso:
 *   node scripts/seed-endpoints.mjs
 *
 * Variables de entorno:
 *   CONTROL_PLANE_URL  (default: http://localhost:3000)
 *   ADMIN_API_KEY      (default: dev-insecure-key-change-in-prod)
 */

const BASE_URL = process.env.CONTROL_PLANE_URL ?? "http://localhost:3000";
const API_KEY  = process.env.ADMIN_API_KEY ?? "dev-insecure-key-change-in-prod";

const SEED_ENDPOINTS = [
  {
    endpointId:              "endpoint-1",
    installProfile:          "support_full",
    licenseStatus:           "active",
    unattendedEnabled:       false,
    maxActiveControlSessions: 1,
  },
  {
    endpointId:              "endpoint-2",
    installProfile:          "support_limited_no_folders",
    licenseStatus:           "active",
    unattendedEnabled:       true,
    maxActiveControlSessions: 1,
  },
  {
    endpointId:              "endpoint-restricted",
    installProfile:          "remote_only",
    licenseStatus:           "active",
    unattendedEnabled:       false,
    maxActiveControlSessions: 1,
  },
  {
    endpointId:              "endpoint-inactive",
    installProfile:          "support_full",
    licenseStatus:           "inactive",
    unattendedEnabled:       false,
    maxActiveControlSessions: 1,
  },
];

async function registerEndpoint(endpoint) {
  const res = await fetch(`${BASE_URL}/api/v1/endpoints`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": API_KEY,
    },
    body: JSON.stringify(endpoint),
  });

  const body = await res.json();

  if (res.ok) {
    console.log(`  ✓ ${endpoint.endpointId} (${endpoint.installProfile})`);
  } else {
    console.error(`  ✗ ${endpoint.endpointId}: ${body.message ?? body.code ?? res.status}`);
  }
}

async function healthCheck() {
  const res = await fetch(`${BASE_URL}/health`).catch(() => null);
  if (!res || !res.ok) {
    console.error(`✗ Cannot reach control-plane at ${BASE_URL}`);
    console.error("  Start the server first: npm run dev");
    process.exit(1);
  }
}

async function main() {
  console.log(`\nSeed: ${BASE_URL}\n`);

  await healthCheck();

  console.log("Registering endpoints:");
  for (const endpoint of SEED_ENDPOINTS) {
    await registerEndpoint(endpoint);
  }

  console.log("\nVerifying:");
  const listRes = await fetch(`${BASE_URL}/api/v1/endpoints`, {
    headers: { "x-api-key": API_KEY },
  });
  const list = await listRes.json();
  console.log(`  ${list.count} endpoints registered\n`);
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
