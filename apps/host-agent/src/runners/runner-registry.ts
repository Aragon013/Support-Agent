import {
  runSystemInfo,
  runFirewallStatus,
  runServiceRestart,
  runNetworkReset,
} from "./catalog-runners.js";
import type { RunnerResult } from "../types.js";

type RunnerFn = (params: Record<string, unknown>) => Promise<RunnerResult>;

const REGISTRY = new Map<string, RunnerFn>([
  ["diagnostic.system.info",    runSystemInfo],
  ["security.firewall.status",  runFirewallStatus],
  ["maintenance.service.restart", runServiceRestart],
  ["maintenance.network.reset", runNetworkReset],
]);

export function findRunner(commandId: string): RunnerFn | undefined {
  return REGISTRY.get(commandId);
}

export function registeredCommandIds(): string[] {
  return [...REGISTRY.keys()];
}
