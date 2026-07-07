import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  AlertTriangle,
  ArrowRight,
  BadgeInfo,
  Bot,
  CheckCircle2,
  CircleSlash,
  CloudAlert,
  Cpu,
  Flame,
  Globe,
  HardDrive,
  MonitorCheck,
  Network,
  RefreshCw,
  Server,
  ShieldCheck,
  Wrench,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { resolveInstallProfile, type InstallProfile } from "./install-profile";

type CommandRisk = "low" | "medium" | "high";

type CommandCatalogItem = {
  id: string;
  label: string;
  description: string;
  risk: CommandRisk;
  category: "triage" | "remediation" | "escalation";
  params?: Array<{
    key: string;
    type: "text" | "select";
    placeholder?: string;
    options?: readonly string[];
    required?: boolean;
  }>;
  preview?: string;
};

type JobStatus =
  | "created"
  | "policy_check"
  | "mfa_pending"
  | "queued"
  | "dispatched"
  | "running"
  | "streaming"
  | "verifying"
  | "completed"
  | "failed"
  | "blocked"
  | "cancelled";

type JobRecord = {
  id: string;
  status: JobStatus;
  catalogCommandId: string;
  tenantId: string;
  endpointId: string;
  riskLevel: string;
  createdAt: string;
};

type JobEnvelope =
  | { v: 1; kind: "command.init"; commandId: string; params: Record<string, unknown> }
  | { v: 1; kind: "command.stdout"; chunk: string; stream: "stdout" }
  | { v: 1; kind: "command.stderr"; chunk: string; stream: "stderr" }
  | { v: 1; kind: "command.exit"; exitCode: number }
  | { v: 1; kind: "command.abort"; reason: string };

type ProbeResult = {
  hostname: string;
  platform: string;
  release: string;
  arch: string;
  cpus: number;
  totalMemoryMb: number;
  freeMemoryMb: number;
  uptimeSeconds: number;
  nodeVersion: string;
};

type EndpointSessionPolicy = {
  endpointId: string;
  unattendedEnabled: boolean;
  requiresUserConsent: boolean;
  maxActiveControlSessions: number;
  installProfile?: InstallProfile;
  supportCommandsAllowed?: boolean;
  folderActionsAllowed?: boolean;
};

type SupportCard = {
  icon: React.ElementType;
  title: string;
  body: string;
  tone: string;
};

const SESSION_HANDOFF_KEY = "rsp.sessions.handoff.v1";

type SessionCapability = "screen" | "input" | "clipboard";

type SessionStatus =
  | "requested"
  | "pending_host"
  | "pending_approval"
  | "signaling"
  | "connecting_p2p"
  | "connected_p2p"
  | "connected_relay"
  | "reconnecting"
  | "ended"
  | "failed";

type SessionHandoffRecord = {
  sessionId: string;
  status: SessionStatus;
  endpointId: string;
  approvalMode?: string;
  routeMode?: string;
  requestedCapabilities?: SessionCapability[];
  updatedAt: string;
};

type SessionStatusTick = {
  status: SessionStatus;
  at: string;
};

const SESSION_STATUS_BADGE: Record<SessionStatus, string> = {
  requested: "border-slate-600/60 bg-surface-900 text-slate-300",
  pending_host: "border-slate-600/60 bg-surface-900 text-slate-300",
  pending_approval: "border-warn/40 bg-warn/10 text-warn",
  signaling: "border-brand/40 bg-brand/10 text-brand",
  connecting_p2p: "border-brand/40 bg-brand/10 text-brand",
  connected_p2p: "border-success/40 bg-success/10 text-success",
  connected_relay: "border-accent/40 bg-accent/10 text-accent",
  reconnecting: "border-warn/40 bg-warn/10 text-warn",
  ended: "border-slate-700 bg-surface-900 text-slate-500",
  failed: "border-danger/40 bg-danger/10 text-danger",
};

type RecentJobSummary = {
  jobId: string;
  summary: string;
  at: string;
  commandId: string;
  status: JobStatus;
};

type SuggestedAction = {
  actionType: "command" | "session";
  label: string;
  rationale: string;
  commandId?: string;
  params?: Record<string, string>;
  sessionMode?: "view" | "control";
  tone: "recommended" | "follow_up" | "escalation";
};

const CATALOG: CommandCatalogItem[] = [
  {
    id: "diagnostic.system.info",
    label: "System Info",
    description: "Collect hostname, OS, memory, CPU and runtime details.",
    risk: "low",
    category: "triage",
    preview: "Best first probe for any endpoint",
  },
  {
    id: "security.firewall.status",
    label: "Firewall Status",
    description: "Inspect the active firewall profile state.",
    risk: "low",
    category: "triage",
    params: [{ key: "profile", type: "select", options: ["domain", "private", "public"], required: true }],
    preview: "Useful when connectivity is weird",
  },
  {
    id: "maintenance.service.restart",
    label: "Restart Service",
    description: "Restart one of the pre-approved services safely.",
    risk: "medium",
    category: "remediation",
    params: [{ key: "serviceId", type: "select", options: ["Spooler", "wuauserv", "BITS", "WinRM", "EventLog", "Schedule"], required: true }],
    preview: "Quick fix for print/update/remote-service issues",
  },
  {
    id: "maintenance.network.reset",
    label: "Network Reset",
    description: "Run a controlled stack reset workflow.",
    risk: "high",
    category: "escalation",
    params: [{ key: "mode", type: "select", options: ["soft", "full"], required: true }],
    preview: "Escalation path for stubborn network problems",
  },
];

const COMMAND_FILTERS = ["all", "triage", "remediation", "escalation"] as const;

type CommandFilter = (typeof COMMAND_FILTERS)[number];

const FILTER_LABEL: Record<CommandFilter, string> = {
  all: "All",
  triage: "Triage",
  remediation: "Remediation",
  escalation: "Escalation",
};

function hasRecentAction(recentJobs: RecentJobSummary[], commandId: string): boolean {
  return recentJobs.some((job) => job.commandId === commandId);
}

function buildSuggestedActions(
  probe: ProbeResult | null,
  recentJobs: RecentJobSummary[],
  activeJob: JobRecord | null,
  jobTranscript: string[],
  error: string | null,
): SuggestedAction[] {
  const transcriptText = jobTranscript.join("\n").toLowerCase();
  const hasRemoteFailureSignal =
    transcriptText.includes("connection refused") ||
    transcriptText.includes("timed out") ||
    transcriptText.includes("access denied") ||
    transcriptText.includes("unreachable") ||
    (activeJob?.status === "failed") ||
    (activeJob?.status === "blocked") ||
    Boolean(error);

  if (!probe) {
    return [
      {
        actionType: "command",
        commandId: "diagnostic.system.info",
        label: "Run System Info first",
        rationale: "Collect identity, platform, memory and uptime before choosing remediation.",
        tone: "recommended",
      },
    ];
  }

  const recommendations: SuggestedAction[] = [];
  const firewallChecked = hasRecentAction(recentJobs, "security.firewall.status");
  const networkResetTried = hasRecentAction(recentJobs, "maintenance.network.reset");
  const restartTried = hasRecentAction(recentJobs, "maintenance.service.restart");

  if (probe.platform === "win32" && !firewallChecked) {
    recommendations.push({
      actionType: "command",
      commandId: "security.firewall.status",
      label: "Check firewall posture",
      rationale: "Windows endpoint detected. Firewall state is the fastest next check for connectivity issues.",
      params: { profile: "public" },
      tone: "recommended",
    });
  }

  if (probe.uptimeSeconds >= 7 * 24 * 60 * 60 && !restartTried) {
    recommendations.push({
      actionType: "command",
      commandId: "maintenance.service.restart",
      label: "Restart WinRM safely",
      rationale: "This endpoint has been up for over 7 days. A controlled WinRM restart is a reasonable follow-up if remote actions feel stale.",
      params: { serviceId: "WinRM" },
      tone: "follow_up",
    });
  }

  if (probe.platform === "win32" && firewallChecked && !networkResetTried) {
    recommendations.push({
      actionType: "command",
      commandId: "maintenance.network.reset",
      label: "Escalate to soft network reset",
      rationale: "If firewall looks normal and connectivity still fails, a soft reset is the next escalation path.",
      params: { mode: "soft" },
      tone: "escalation",
    });
  }

  if (probe.freeMemoryMb <= 1024 && !restartTried) {
    recommendations.push({
      actionType: "command",
      commandId: "maintenance.service.restart",
      label: "Restart a core service",
      rationale: "Free memory is low. Restarting a scoped service may recover stability without a broader intervention.",
      params: { serviceId: "BITS" },
      tone: "follow_up",
    });
  }

  if (hasRemoteFailureSignal) {
    recommendations.unshift({
      actionType: "session",
      sessionMode: "control",
      label: "Start control session now",
      rationale: "The latest command flow indicates a blocked or failing remote action. Switch to an interactive control session to inspect directly.",
      tone: "recommended",
    });
    recommendations.push({
      actionType: "session",
      sessionMode: "view",
      label: "Open a view-only session",
      rationale: "Use a safe visual check first when the host is reachable but command output is unreliable or incomplete.",
      tone: "follow_up",
    });
  }

  return recommendations.slice(0, 4);
}

const SUGGESTION_TONE: Record<SuggestedAction["tone"], string> = {
  recommended: "border-brand/30 bg-brand/10 text-brand",
  follow_up: "border-warn/30 bg-warn/10 text-warn",
  escalation: "border-danger/30 bg-danger/10 text-danger",
};

const RISK_BADGE: Record<CommandRisk, string> = {
  low: "bg-success/15 text-success border-success/30",
  medium: "bg-warn/15 text-warn border-warn/30",
  high: "bg-danger/15 text-danger border-danger/30",
};

const SUPPORTED_PLATFORMS: SupportCard[] = [
  {
    icon: MonitorCheck,
    title: "Windows",
    body: "Full support target for screen, input and the command runners.",
    tone: "border-brand/30 bg-brand/10 text-brand",
  },
  {
    icon: Globe,
    title: "macOS",
    body: "Cross-platform capture/input path is enabled; system info works as a first probe.",
    tone: "border-accent/30 bg-accent/10 text-accent",
  },
  {
    icon: CloudAlert,
    title: "Linux",
    body: "Capture/input path is available; Windows-only maintenance commands remain gated.",
    tone: "border-slate-700 bg-surface-900 text-slate-300",
  },
];

const PROFILE_BADGE: Record<InstallProfile, string> = {
  remote_only: "border-danger/40 bg-danger/10 text-danger",
  support_limited_no_folders: "border-warn/40 bg-warn/10 text-warn",
  support_full: "border-success/40 bg-success/10 text-success",
};

function profileLabel(profile: InstallProfile): string {
  if (profile === "remote_only") {
    return "Remote Only";
  }
  if (profile === "support_limited_no_folders") {
    return "Support Limited (No Folders)";
  }
  return "Support Full";
}

function commandPermission(profile: InstallProfile, commandId: string): { allowed: boolean; reason?: string } {
  if (profile === "remote_only") {
    return {
      allowed: false,
      reason: "This endpoint was installed as Remote Only. Support commands are blocked by policy.",
    };
  }

  if (profile === "support_limited_no_folders" && commandId.startsWith("filesystem.")) {
    return {
      allowed: false,
      reason: "Folder and file operations are blocked by this installation profile.",
    };
  }

  return { allowed: true };
}

function parseProbeInfo(stdout: string[]): ProbeResult | null {
  for (const line of stdout) {
    try {
      const parsed = JSON.parse(line) as ProbeResult;
      if (parsed && typeof parsed.hostname === "string" && typeof parsed.platform === "string") {
        return parsed;
      }
    } catch {
      // ignore non-JSON lines
    }
  }
  return null;
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) {
    return `${days}d ${hours}h ${minutes}m`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

function formatJobSummary(job: JobRecord): string {
  return `${job.catalogCommandId} · ${job.status.replaceAll("_", " ")}`;
}

export function SupportPanel() {
  const [tenantId, setTenantId] = useState("");
  const [operatorId, setOperatorId] = useState("");
  const [target, setTarget] = useState("");
  const [selectedCommand, setSelectedCommand] = useState(CATALOG[0].id);
  const [params, setParams] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [activeJob, setActiveJob] = useState<JobRecord | null>(null);
  const [probeInfo, setProbeInfo] = useState<ProbeResult | null>(null);
  const [jobTranscript, setJobTranscript] = useState<string[]>([]);
  const [recentJobs, setRecentJobs] = useState<RecentJobSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [commandHint, setCommandHint] = useState<string>("Enter an IP, hostname or endpoint id, then probe the machine.");
  const [installProfile, setInstallProfile] = useState<InstallProfile>("support_full");
  const [policyLoading, setPolicyLoading] = useState(false);
  const [policyError, setPolicyError] = useState<string | null>(null);
  const [catalogFilter, setCatalogFilter] = useState<CommandFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [sessionBusy, setSessionBusy] = useState(false);
  const [supportSession, setSupportSession] = useState<SessionHandoffRecord | null>(null);
  const [sessionTimeline, setSessionTimeline] = useState<SessionStatusTick[]>([]);

  const command = useMemo(
    () => CATALOG.find((item) => item.id === selectedCommand) ?? CATALOG[0],
    [selectedCommand],
  );
  const currentParams = command.params ?? [];

  const selectedPermission = useMemo(
    () => commandPermission(installProfile, command.id),
    [installProfile, command.id],
  );

  const visibleCatalog = useMemo(
    () => CATALOG.filter(
      (item) => (
        (catalogFilter === "all" || item.category === catalogFilter) &&
        (searchQuery === "" || 
         item.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
         item.description.toLowerCase().includes(searchQuery.toLowerCase()))
      )
    ),
    [catalogFilter, searchQuery],
  );

  const hasTarget = target.trim().length > 0;
  const requiredParamsMissing = useMemo(
    () => currentParams
      .filter((param) => param.required)
      .some((param) => !(params[param.key] ?? "").trim()),
    [currentParams, params],
  );

  const canExecuteSelected = hasTarget && selectedPermission.allowed && !requiredParamsMissing && !loading;
  const suggestedActions = useMemo(
    () => buildSuggestedActions(probeInfo, recentJobs, activeJob, jobTranscript, error),
    [probeInfo, recentJobs, activeJob, jobTranscript, error],
  );

  const executeDisabledReason = !hasTarget
    ? "Set a target endpoint first."
    : !selectedPermission.allowed
      ? (selectedPermission.reason ?? "Command blocked by policy.")
      : requiredParamsMissing
        ? "Fill all required command parameters."
        : undefined;

  const openSessions = (mode: "view" | "control", sessionRecord?: SessionHandoffRecord) => {
    const payload = {
      tenantId,
      endpointId: target.trim(),
      operatorId,
      accessMode: mode,
      unattended: false,
      selectedSessionId: sessionRecord?.sessionId,
      sessionRecord,
      createdAt: new Date().toISOString(),
    };

    localStorage.setItem(SESSION_HANDOFF_KEY, JSON.stringify(payload));
    window.dispatchEvent(new CustomEvent("rsp:navigate-sessions"));
  };

  const createSessionFromSupport = async (mode: "view" | "control", options?: { openSessions?: boolean }) => {
    if (!target.trim()) {
      setError("Enter an IP, hostname or endpoint id first.");
      return;
    }

    setSessionBusy(true);
    setError(null);

    try {
      const res = await fetch("http://localhost:3000/api/v1/sessions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-operator-role": "tech",
          "x-endpoint-status": "online",
          "x-endpoint-unattended": "false",
          "x-endpoint-install-profile": installProfile,
        },
        body: JSON.stringify({
          tenantId,
          endpointId: target,
          operatorId,
          accessMode: mode,
          requestedCapabilities: mode === "control" ? ["screen", "input", "clipboard"] : ["screen"],
        }),
      });

      const body = await res.json() as {
        sessionId?: string;
        status?: SessionStatus;
        approvalMode?: string;
        routeMode?: string;
        requestedCapabilities?: SessionCapability[];
        code?: string;
        reason?: string;
      };

      if (!res.ok || !body.sessionId || !body.status) {
        throw new Error(body.reason ?? body.code ?? `http_${res.status}`);
      }

      const sessionRecord: SessionHandoffRecord = {
        sessionId: body.sessionId,
        status: body.status,
        endpointId: target,
        approvalMode: body.approvalMode,
        routeMode: body.routeMode,
        requestedCapabilities: body.requestedCapabilities,
        updatedAt: new Date().toISOString(),
      };
      setSupportSession(sessionRecord);
      setSessionTimeline([{ status: sessionRecord.status, at: new Date().toISOString() }]);
      setCommandHint(`Session ${sessionRecord.sessionId} created (${sessionRecord.status.replaceAll("_", " ")}).`);

      if (options?.openSessions) {
        openSessions(mode, sessionRecord);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSessionBusy(false);
    }
  };

  const applySuggestedAction = (suggestion: SuggestedAction) => {
    if (suggestion.actionType === "session") {
      void createSessionFromSupport(suggestion.sessionMode ?? "view", { openSessions: false });
      return;
    }

    if (!suggestion.commandId) {
      return;
    }

    setSelectedCommand(suggestion.commandId);
    setParams(suggestion.params ?? {});
    setCommandHint(suggestion.rationale);
  };

  useEffect(() => {
    const endpointId = target.trim();
    if (!endpointId) {
      setPolicyError(null);
      return;
    }

    const controller = new AbortController();

    const loadPolicy = async () => {
      setPolicyLoading(true);
      setPolicyError(null);

      try {
        const res = await fetch(
          `http://localhost:3000/api/v1/endpoints/${encodeURIComponent(endpointId)}/session-policy`,
          { signal: controller.signal },
        );
        if (!res.ok) {
          throw new Error(`policy_http_${res.status}`);
        }

        const body = await res.json() as EndpointSessionPolicy;
        setInstallProfile(resolveInstallProfile(body.installProfile));
      } catch (err) {
        if (controller.signal.aborted) {
          return;
        }
        setPolicyError(err instanceof Error ? err.message : String(err));
        setInstallProfile(resolveInstallProfile(undefined));
      } finally {
        if (!controller.signal.aborted) {
          setPolicyLoading(false);
        }
      }
    };

    void loadPolicy();

    return () => {
      controller.abort();
    };
  }, [target]);

  useEffect(() => {
    if (!supportSession) {
      return;
    }

    if (supportSession.status === "ended" || supportSession.status === "failed") {
      return;
    }

    const timer = setInterval(() => {
      void (async () => {
        try {
          const res = await fetch(`http://localhost:3000/api/v1/sessions/${supportSession.sessionId}`);
          if (!res.ok) {
            return;
          }

          const body = await res.json() as {
            id: string;
            status: SessionStatus;
            endpointId?: string;
            approvalMode?: string;
            routeMode?: string;
            requestedCapabilities?: SessionCapability[];
          };

          setSupportSession((prev) => {
            if (!prev || prev.sessionId !== body.id) {
              return prev;
            }

            if (prev.status !== body.status) {
              setSessionTimeline((old) => [
                { status: body.status, at: new Date().toISOString() },
                ...old,
              ].slice(0, 8));
            }

            return {
              ...prev,
              status: body.status,
              endpointId: body.endpointId ?? prev.endpointId,
              approvalMode: body.approvalMode ?? prev.approvalMode,
              routeMode: body.routeMode ?? prev.routeMode,
              requestedCapabilities: body.requestedCapabilities ?? prev.requestedCapabilities,
              updatedAt: new Date().toISOString(),
            };
          });
        } catch {
          // keep last known session state when polling fails
        }
      })();
    }, 2000);

    return () => {
      clearInterval(timer);
    };
  }, [supportSession]);

  const runJob = async (catalogCommandId: string, requestedParams: Record<string, unknown>) => {
    if (!target.trim()) {
      setError("Enter an IP, hostname or endpoint id first.");
      return;
    }

    const permission = commandPermission(installProfile, catalogCommandId);
    if (!permission.allowed) {
      setError(permission.reason ?? "Command blocked by installation profile.");
      return;
    }

    setLoading(true);
    setError(null);
    if (catalogCommandId === "diagnostic.system.info") {
      setProbeInfo(null);
    }
    setJobTranscript([]);
    setActiveJob(null);

    try {
      const response = await fetch("http://localhost:3000/api/v1/commands/jobs", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-operator-role": "tech",
          "x-endpoint-install-profile": installProfile,
        },
        body: JSON.stringify({
          tenantId,
          endpointId: target,
          operatorId,
          catalogCommandId,
          requestedParams,
        }),
      });

      const body = await response.json() as Partial<JobRecord> & { reason?: string; requiresMfa?: boolean };
      if (!response.ok) {
        if (body.reason === "install_profile_remote_only") {
          throw new Error("This endpoint is Remote Only. Support commands are disabled by installation policy.");
        }
        throw new Error(body.reason ?? `http_${response.status}`);
      }

      if (!body.id || !body.status) {
        throw new Error("missing job id/status in response");
      }

      const created: JobRecord = {
        id: body.id,
        status: body.status,
        catalogCommandId,
        tenantId,
        endpointId: target,
        riskLevel: command.risk,
        createdAt: new Date().toISOString(),
      };

      setActiveJob(created);
      setRecentJobs((prev) => [
        {
          jobId: created.id,
          summary: formatJobSummary(created),
          at: created.createdAt,
          commandId: created.catalogCommandId,
          status: created.status,
        },
        ...prev,
      ].slice(0, 6));
      setCommandHint(
        body.requiresMfa
          ? "This action is pending MFA step-up."
          : "Dispatch accepted. Waiting for host-side output...",
      );

      if (body.status === "mfa_pending") {
        return;
      }

      await pollJobUntilTerminal(body.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const pollJobUntilTerminal = async (jobId: string) => {
    const terminalStates = new Set<JobStatus>(["completed", "failed", "cancelled", "blocked"]);

    for (let attempt = 0; attempt < 30; attempt += 1) {
      const jobResponse = await fetch(`http://localhost:3000/api/v1/commands/jobs/${jobId}`);
      if (!jobResponse.ok) {
        throw new Error(`job_poll_failed_${jobResponse.status}`);
      }

      const job = await jobResponse.json() as JobRecord;
      setActiveJob(job);
      setRecentJobs((prev) => prev.map((item) =>
        item.jobId === job.id
          ? { ...item, summary: formatJobSummary(job), status: job.status }
          : item,
      ));

      if (terminalStates.has(job.status)) {
        const transcriptResponse = await fetch(
          `http://localhost:3000/api/v1/commands/jobs/${jobId}/channel-messages`,
        );
        if (transcriptResponse.ok) {
          const transcriptBody = await transcriptResponse.json() as { items: JobEnvelope[] };
          const lines = (transcriptBody.items ?? []).flatMap((item) => {
            if (item.kind === "command.stdout" || item.kind === "command.stderr") {
              return [item.chunk];
            }
            if (item.kind === "command.exit") {
              return [`exitCode=${item.exitCode}`];
            }
            if (item.kind === "command.abort") {
              return [`abort=${item.reason}`];
            }
            return [];
          });
          setJobTranscript(lines);

          if (job.catalogCommandId === "diagnostic.system.info") {
            const stdout = transcriptBody.items
              .filter((item): item is Extract<JobEnvelope, { kind: "command.stdout" }> => item.kind === "command.stdout")
              .map((item) => item.chunk);
            setProbeInfo(parseProbeInfo(stdout));
          }
        }

        setCommandHint(
          job.status === "completed"
            ? "Probe complete. Endpoint details are ready."
            : `Job ended as ${job.status.replaceAll("_", " ")}.`,
        );
        return;
      }

      await new Promise<void>((resolve) => setTimeout(resolve, 900));
    }

    setCommandHint("Still running. Host may be busy or offline.");
  };

  const probeDone = Boolean(probeInfo);

  const suggestedLabel = suggestedActions[0]?.label ?? null;

  const flowSteps = [
    {
      label: "Set target",
      done: hasTarget,
      hint: hasTarget ? "Target selected" : "Missing target",
    },
    {
      label: "Probe endpoint",
      done: probeDone,
      hint: probeDone ? (suggestedLabel ? `Suggested: ${suggestedLabel}` : "Snapshot available") : "Run System Info",
    },
    {
      label: "Execute action",
      done: Boolean(activeJob),
      hint: activeJob ? activeJob.status.replaceAll("_", " ") : "Choose and run command",
    },
  ];

  const sessionBridgePrimaryCta = useMemo(() => {
    if (!supportSession) {
      return null;
    }

    if (supportSession.status === "pending_approval") {
      return {
        label: "Go to Sessions and Approve",
        mode: supportSession.requestedCapabilities?.includes("input") ? "control" as const : "view" as const,
        tone: "border-warn/40 bg-warn/10 text-warn",
      };
    }

    if (supportSession.status === "connected_p2p" || supportSession.status === "connected_relay") {
      return {
        label: "Open Active Session Workspace",
        mode: supportSession.requestedCapabilities?.includes("input") ? "control" as const : "view" as const,
        tone: "border-success/40 bg-success/10 text-success",
      };
    }

    if (supportSession.status === "failed" || supportSession.status === "ended") {
      return {
        label: "Start New Control Session",
        mode: "control" as const,
        tone: "border-danger/40 bg-danger/10 text-danger",
      };
    }

    return {
      label: "Open Session Workspace",
      mode: supportSession.requestedCapabilities?.includes("input") ? "control" as const : "view" as const,
      tone: "border-brand/40 bg-brand/10 text-brand",
    };
  }, [supportSession]);

  const supportPhase = useMemo(() => {
    if (!hasTarget) return "idle";
    if (supportSession && (supportSession.status === "connected_p2p" || supportSession.status === "connected_relay")) {
      return "live_session";
    }
    if (activeJob && activeJob.status !== "completed" && activeJob.status !== "failed" && activeJob.status !== "blocked") {
      return "running_job";
    }
    if (probeDone) return "triage_ready";
    return "target_ready";
  }, [hasTarget, supportSession, activeJob, probeDone]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Enter to execute when the execute button would be enabled
      if (e.key === "Enter" && canExecuteSelected && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        runJob(command.id, Object.fromEntries(Object.entries(params).filter(([, value]) => value.trim().length > 0)));
      }
      // Escape to clear search or error
      if (e.key === "Escape") {
        if (searchQuery) {
          setSearchQuery("");
        } else if (error) {
          setError(null);
        }
      }
      // Ctrl/Cmd+K to focus search
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        const searchInput = document.querySelector("input[placeholder*='Search']") as HTMLInputElement;
        searchInput?.focus();
      }
      // Number keys 1-4 to select command category quickly
      if (e.key >= "1" && e.key <= "4" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const filters: CommandFilter[] = ["all", "triage", "remediation", "escalation"];
        setCatalogFilter(filters[parseInt(e.key) - 1] ?? "all");
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [canExecuteSelected, command.id, params, searchQuery, error]);

  return (
    <div className="flex flex-col gap-4 p-4 lg:p-5 text-slate-900">
      <section className="tv-panel p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-brand/20 bg-brand/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-brand">
              <Bot className="w-3.5 h-3.5" />
              Support Console
            </div>
            <h2 className="mt-2 text-xl font-semibold text-slate-900">Quick Actions</h2>
            <p className="mt-1 text-sm text-slate-600">Use these buttons to run a quick check, open a remote session, or jump to Sessions.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className={cn("rounded-full border px-2.5 py-1 font-semibold uppercase tracking-wide shadow-sm", PROFILE_BADGE[installProfile])}>
              {profileLabel(installProfile)}
            </span>
            <span className="rounded-full border border-blue-100 bg-blue-50 px-2.5 py-1 text-slate-700">
              {policyLoading ? "syncing policy" : "policy synced"}
            </span>
            <span className="rounded-full border border-blue-100 bg-blue-50 px-2.5 py-1 text-slate-700">
              Target: {target || "n/a"}
            </span>
          </div>
        </div>

        <div className="mt-4 grid gap-2 md:grid-cols-3">
          {flowSteps.map((step) => (
            <div
              key={step.label}
              className={cn(
                "rounded-xl border px-3 py-2 text-xs shadow-sm",
                step.done
                  ? "border-success/30 bg-success/10 text-success"
                  : "border-blue-100 bg-blue-50 text-slate-600",
              )}
            >
              <div className="flex items-center gap-2 font-semibold">
                {step.done ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
                {step.label}
              </div>
              <p className="mt-0.5 text-[11px] opacity-90">{step.hint}</p>
            </div>
          ))}
        </div>

        <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <button
            onClick={() => runJob("diagnostic.system.info", {})}
            disabled={!hasTarget || loading || sessionBusy || !commandPermission(installProfile, "diagnostic.system.info").allowed}
            className="tv-button-primary"
            title={commandPermission(installProfile, "diagnostic.system.info").reason}
          >
            <BadgeInfo className="h-4 w-4" />
            Run Probe
          </button>
          <button
            onClick={() => void createSessionFromSupport("control")}
            disabled={!hasTarget || loading || sessionBusy}
            className="tv-button-secondary"
          >
            <MonitorCheck className="h-4 w-4 text-brand" />
            Start Control Session
          </button>
          <button
            onClick={() => void createSessionFromSupport("view")}
            disabled={!hasTarget || loading || sessionBusy}
            className="tv-button-secondary"
          >
            <Globe className="h-4 w-4 text-brand" />
            Start View Session
          </button>
          <button
            onClick={() => openSessions("control")}
            disabled={!hasTarget || loading || sessionBusy}
            className="tv-button-soft"
          >
            <Server className="h-4 w-4" />
            Open Session List
          </button>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
          <span className="rounded-full border border-blue-100 bg-blue-50 px-2.5 py-1 text-slate-700">
            Status: {supportPhase.replaceAll("_", " ")}
          </span>
          {activeJob && (
            <span className="rounded-full border border-blue-100 bg-white px-2.5 py-1 text-slate-700">
              Job: {activeJob.status.replaceAll("_", " ")}
            </span>
          )}
          {supportSession && (
            <span className={cn("rounded-full border px-2.5 py-1", SESSION_STATUS_BADGE[supportSession.status])}>
              Session: {supportSession.status.replaceAll("_", " ")}
            </span>
          )}
        </div>
      </section>

      {policyError && (
        <div className="rounded-2xl border border-warn/30 bg-warn/10 px-4 py-3 text-sm text-warn shadow-sm">
          Could not refresh endpoint policy ({policyError}). Using safe fallback profile.
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-[1.6fr_0.95fr]">
        <section className="space-y-4">
          <div className="tv-panel p-4">
            <p className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">1. Target</p>
            <div className="grid gap-3 md:grid-cols-[1.3fr_0.85fr_0.85fr]">
              <label className="grid gap-1.5">
                <span className="text-xs font-medium text-slate-600">Machine / IP / Hostname</span>
                <input
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                  placeholder="e.g. 10.0.1.42, helpdesk-laptop, ENDPOINT-ACCT-17"
                  className="rounded-xl border border-blue-100 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-brand"
                />
              </label>
              <label className="grid gap-1.5">
                <span className="text-xs font-medium text-slate-600">Tenant</span>
                <input
                  value={tenantId}
                  onChange={(e) => setTenantId(e.target.value)}
                  placeholder="Tenant ID"
                  className="rounded-xl border border-blue-100 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-brand"
                />
              </label>
              <label className="grid gap-1.5">
                <span className="text-xs font-medium text-slate-600">Operator</span>
                <input
                  value={operatorId}
                  onChange={(e) => setOperatorId(e.target.value)}
                  placeholder="Operator ID"
                  className="rounded-xl border border-blue-100 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-brand"
                />
              </label>
            </div>

            <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              <button
                onClick={() => runJob("security.firewall.status", { profile: "public" })}
                disabled={!hasTarget || loading || sessionBusy || !commandPermission(installProfile, "security.firewall.status").allowed}
                className="inline-flex items-center gap-2 rounded-xl border border-blue-100 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm disabled:opacity-50"
                title={commandPermission(installProfile, "security.firewall.status").reason}
              >
                <Flame className="h-4 w-4 text-brand" />
                Check Firewall
              </button>
              <button
                onClick={() => runJob("maintenance.service.restart", { serviceId: params.serviceId ?? "WinRM" })}
                disabled={!hasTarget || loading || sessionBusy || !commandPermission(installProfile, "maintenance.service.restart").allowed}
                className="inline-flex items-center gap-2 rounded-xl border border-blue-100 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm disabled:opacity-50"
                title={commandPermission(installProfile, "maintenance.service.restart").reason}
              >
                <Wrench className="h-4 w-4 text-brand" />
                Restart Service
              </button>
              <button
                onClick={() => runJob("maintenance.network.reset", { mode: params.mode ?? "soft" })}
                disabled={!hasTarget || loading || sessionBusy || !commandPermission(installProfile, "maintenance.network.reset").allowed}
                className="inline-flex items-center gap-2 rounded-xl border border-brand/20 bg-brand/5 px-3 py-2 text-sm font-semibold text-brand disabled:opacity-50"
                title={commandPermission(installProfile, "maintenance.network.reset").reason}
              >
                <Network className="h-4 w-4" />
                Run Network Reset
              </button>
            </div>

            {!hasTarget && (
              <p className="mt-2 text-xs text-amber-600">Set the endpoint target to enable quick actions.</p>
            )}

            {hasTarget && suggestedActions.length > 0 && (
              <div className="mt-4 rounded-2xl border border-blue-100 bg-blue-50/80 p-3 shadow-sm">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                    <ShieldCheck className="h-4 w-4 text-brand" />
                    Suggested Actions
                  </div>
                  <span className="text-[11px] text-slate-500">Based on recent checks</span>
                </div>
                <div className="grid gap-2">
                  {suggestedActions.map((suggestion) => (
                    <button
                      key={`${suggestion.actionType}-${suggestion.commandId ?? suggestion.sessionMode ?? "none"}-${suggestion.label}`}
                      onClick={() => applySuggestedAction(suggestion)}
                      className={cn(
                        "rounded-xl border px-3 py-2 text-left transition hover:border-brand/40",
                        SUGGESTION_TONE[suggestion.tone],
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-slate-900">{suggestion.label}</p>
                        <span className="text-[10px] uppercase tracking-[0.14em] opacity-80">{suggestion.tone.replace("_", " ")}</span>
                      </div>
                      <p className="mt-1 text-xs leading-5 text-slate-700">{suggestion.rationale}</p>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="tv-panel p-4">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">2. Commands</p>
              <RefreshCw className={cn("h-4 w-4 text-slate-400", loading && "animate-spin text-brand")} />
            </div>
            <div className="mb-3 space-y-2">
              <div>
                <input
                  type="text"
                  placeholder="Search commands... (Ctrl/Cmd + K)"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full rounded-lg border border-blue-100 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-brand placeholder:text-slate-400"
                />
              </div>
              <div className="flex flex-wrap gap-2">
                {COMMAND_FILTERS.map((filter, idx) => (
                  <button
                    key={filter}
                    onClick={() => setCatalogFilter(filter)}
                    className={cn(
                      "rounded-lg border px-2.5 py-1 text-xs font-semibold transition shadow-sm",
                      catalogFilter === filter
                        ? "border-brand/60 bg-brand/10 text-brand"
                        : "border-blue-100 bg-white text-slate-700 hover:border-brand/30",
                    )}
                    title={`Press ${idx + 1} for quick access`}
                  >
                    {FILTER_LABEL[filter]} <span className="text-[10px] opacity-60 ml-1">({idx + 1})</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="grid gap-3 lg:grid-cols-2">
              <div className="grid gap-2">
                {visibleCatalog.map((item) => {
                  const isActive = selectedCommand === item.id;
                  return (
                    <button
                      key={item.id}
                      onClick={() => {
                        setSelectedCommand(item.id);
                        setParams({});
                        setCommandHint(item.preview ?? item.description);
                      }}
                      className={cn(
                        "rounded-xl border p-3 text-left transition shadow-sm",
                        isActive
                          ? "border-brand/60 bg-brand/10"
                          : "border-blue-100 bg-white hover:border-brand/30",
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="text-sm font-semibold text-slate-900">{item.label}</p>
                          <p className="mt-1 text-xs text-slate-600">{item.description}</p>
                          <p className="mt-1 text-[11px] uppercase tracking-[0.12em] text-slate-500">{item.category}</p>
                        </div>
                        <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide", RISK_BADGE[item.risk])}>
                          {item.risk}
                        </span>
                      </div>
                    </button>
                  );
                })}
                {!visibleCatalog.length && (
                  <div className="rounded-lg border border-dashed border-blue-100 bg-blue-50/60 px-3 py-5 text-center text-sm text-slate-500">
                    {searchQuery ? (
                      <div>
                        <p>No commands match "{searchQuery}"</p>
                        <p className="mt-1 text-[12px]">Try a different search term or clear filters (Esc)</p>
                      </div>
                    ) : (
                      <p>No commands in this category</p>
                    )}
                  </div>
                )}
              </div>

              <div className="rounded-xl border border-blue-100 bg-blue-50/70 p-3 shadow-sm">
                <h3 className="text-sm font-semibold text-slate-900">{command.label}</h3>
                <p className="mt-1 text-xs text-slate-600">{command.preview ?? command.description}</p>
                <div className="mt-3 grid gap-2">
                  {currentParams.map((param) =>
                    param.type === "select" ? (
                      <label key={param.key} className="grid gap-1">
                        <span className="text-xs font-medium capitalize text-slate-600">{param.key}{param.required ? " *" : ""}</span>
                        <select
                          value={params[param.key] ?? ""}
                          onChange={(e) => setParams((prev) => ({ ...prev, [param.key]: e.target.value }))}
                          className="rounded-lg border border-blue-100 bg-white px-2.5 py-2 text-sm text-slate-900 outline-none focus:border-brand"
                        >
                          <option value="">Select…</option>
                          {(param.options ?? []).map((option) => (
                            <option key={option} value={option}>{option}</option>
                          ))}
                        </select>
                      </label>
                    ) : (
                      <label key={param.key} className="grid gap-1">
                        <span className="text-xs font-medium capitalize text-slate-600">{param.key}{param.required ? " *" : ""}</span>
                        <input
                          type="text"
                          placeholder={param.placeholder ?? ""}
                          value={params[param.key] ?? ""}
                          onChange={(e) => setParams((prev) => ({ ...prev, [param.key]: e.target.value }))}
                          className="rounded-lg border border-blue-100 bg-white px-2.5 py-2 text-sm text-slate-900 outline-none focus:border-brand"
                        />
                      </label>
                    ),
                  )}
                </div>
                <button
                  onClick={() => runJob(command.id, Object.fromEntries(Object.entries(params).filter(([, value]) => value.trim().length > 0)))}
                  disabled={!canExecuteSelected}
                  className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-brand px-3 py-2.5 text-sm font-semibold text-white shadow-sm disabled:opacity-50"
                  title={executeDisabledReason || "Press Enter to execute"}
                >
                  <ArrowRight className="h-4 w-4" />
                  Run Command <span className="text-[10px] opacity-60 ml-1">(Enter)</span>
                </button>
                {executeDisabledReason && (
                  <p className="mt-2 text-xs text-amber-600">{executeDisabledReason}</p>
                )}
              </div>
            </div>

            {!selectedPermission.allowed && (
              <div className="mt-3 rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
                {selectedPermission.reason}
              </div>
            )}
          </div>
        </section>

        <section className="space-y-4 xl:sticky xl:top-4 xl:self-start">
          <div className="tv-panel p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900">Session Status</h3>
              <MonitorCheck className="h-4 w-4 text-brand" />
            </div>
            {supportSession ? (
              <div className="space-y-2">
                {(supportSession.status === "failed" || supportSession.status === "reconnecting") && (
                  <div className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger shadow-sm">
                    Session warning: {supportSession.status.replaceAll("_", " ")}. Open Sessions for details.
                  </div>
                )}
                <div className="rounded-lg border border-blue-100 bg-blue-50/70 px-3 py-2 shadow-sm">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs text-slate-600">Session ID</p>
                    <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide", SESSION_STATUS_BADGE[supportSession.status])}>
                      {supportSession.status.replaceAll("_", " ")}
                    </span>
                  </div>
                  <p className="mt-1 break-all text-sm font-semibold text-slate-900">{supportSession.sessionId}</p>
                  <p className="mt-1 text-xs text-slate-600">endpoint: {supportSession.endpointId}</p>
                  {(supportSession.routeMode || supportSession.approvalMode) && (
                    <p className="mt-1 text-xs text-slate-600">
                      route: {supportSession.routeMode ?? "n/a"} · approval: {supportSession.approvalMode ?? "n/a"}
                    </p>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  {sessionBridgePrimaryCta && (
                    <button
                      onClick={() => {
                        if (supportSession.status === "failed" || supportSession.status === "ended") {
                          void createSessionFromSupport(sessionBridgePrimaryCta.mode, { openSessions: true });
                          return;
                        }
                        openSessions(sessionBridgePrimaryCta.mode, supportSession);
                      }}
                      className={cn("inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold", sessionBridgePrimaryCta.tone)}
                    >
                      {sessionBridgePrimaryCta.label}
                    </button>
                  )}
                </div>
                <div className="rounded-lg border border-blue-100 bg-white px-3 py-2 shadow-sm">
                  <p className="text-xs font-semibold text-slate-900">Recent Session Updates</p>
                  {sessionTimeline.length > 0 ? (
                    <div className="mt-2 space-y-1">
                      {sessionTimeline.map((tick, idx) => (
                        <div key={`${tick.at}-${idx}`} className="flex items-center justify-between gap-2 text-[11px]">
                          <span className={cn("rounded-full border px-2 py-0.5 uppercase tracking-[0.12em]", SESSION_STATUS_BADGE[tick.status])}>
                            {tick.status.replaceAll("_", " ")}
                          </span>
                          <span className="text-slate-500">{new Date(tick.at).toLocaleTimeString()}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-2 text-xs text-slate-500">No updates yet.</p>
                  )}
                </div>
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-blue-100 bg-blue-50/40 px-3 py-5 text-sm text-slate-500">
                No session started yet.
              </div>
            )}
          </div>

          <div className="tv-panel p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900">Device Summary</h3>
              <Cpu className="h-4 w-4 text-brand" />
            </div>
            {probeInfo ? (
              <div className="grid gap-2 text-sm">
                <div className="rounded-lg border border-blue-100 bg-blue-50/70 px-3 py-2 shadow-sm">
                  <p className="text-[11px] uppercase tracking-[0.14em] text-slate-500">Hostname</p>
                  <p className="font-semibold text-slate-900">{probeInfo.hostname}</p>
                </div>
                <div className="rounded-lg border border-blue-100 bg-blue-50/70 px-3 py-2 shadow-sm">
                  <p className="text-[11px] uppercase tracking-[0.14em] text-slate-500">Platform</p>
                  <p className="font-semibold text-slate-900 capitalize">{probeInfo.platform} · {probeInfo.release}</p>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-lg border border-blue-100 bg-white px-3 py-2 shadow-sm">
                    <p className="text-[11px] uppercase tracking-[0.14em] text-slate-500">CPU</p>
                    <p className="font-semibold text-slate-900">{probeInfo.cpus} cores</p>
                  </div>
                  <div className="rounded-lg border border-blue-100 bg-white px-3 py-2 shadow-sm">
                    <p className="text-[11px] uppercase tracking-[0.14em] text-slate-500">Uptime</p>
                    <p className="font-semibold text-slate-900">{formatUptime(probeInfo.uptimeSeconds)}</p>
                  </div>
                </div>
                <div className="rounded-lg border border-blue-100 bg-blue-50/70 px-3 py-2 shadow-sm">
                  <div className="flex items-center justify-between gap-2 text-[11px] uppercase tracking-[0.14em] text-slate-500">
                    <span>Memory</span>
                    <HardDrive className="h-3.5 w-3.5" />
                  </div>
                  <p className="font-semibold text-slate-900">{probeInfo.freeMemoryMb} MB free / {probeInfo.totalMemoryMb} MB total</p>
                </div>
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-blue-100 bg-blue-50/40 px-3 py-6 text-center text-sm text-slate-500">
                {commandHint}
              </div>
            )}
          </div>

          <div className="tv-panel p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900">Platform Notes</h3>
              <Server className="h-4 w-4 text-slate-400" />
            </div>
            <div className="grid gap-2">
              {SUPPORTED_PLATFORMS.map((card) => {
                const Icon = card.icon;
                return (
                  <div key={card.title} className={cn("rounded-xl border p-3", card.tone)}>
                    <div className="flex items-start gap-2">
                      <Icon className="mt-0.5 h-4 w-4" />
                      <div>
                        <p className="text-sm font-semibold text-slate-900">{card.title}</p>
                        <p className="mt-0.5 text-xs leading-5 text-slate-600">{card.body}</p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="tv-panel p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900">Current Command</h3>
              <CheckCircle2 className="h-4 w-4 text-success" />
            </div>
            <AnimatePresence>
              {activeJob ? (
                <motion.div
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  className="space-y-2"
                >
                  <div className="flex items-center justify-between gap-2 rounded-lg border border-blue-100 bg-blue-50/70 px-3 py-2 shadow-sm">
                    <p className="text-sm font-semibold text-slate-900">{formatJobSummary(activeJob)}</p>
                    <span className={cn(
                      "rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                      activeJob.status === "completed"
                        ? "border-success/30 bg-success/10 text-success"
                        : activeJob.status === "failed" || activeJob.status === "blocked"
                          ? "border-danger/30 bg-danger/10 text-danger"
                          : "border-warn/30 bg-warn/10 text-warn",
                    )}>
                      {activeJob.status}
                    </span>
                  </div>
                  {jobTranscript.length > 0 ? (
                    <pre className="max-h-44 overflow-y-auto whitespace-pre-wrap break-all rounded-lg border border-surface-800 bg-black/30 p-2.5 text-[11px] leading-5 text-slate-200">
                      {jobTranscript.join("\n")}
                    </pre>
                  ) : (
                    <p className="text-xs text-slate-500">Waiting for transcript.</p>
                  )}
                </motion.div>
              ) : (
                <div className="rounded-lg border border-dashed border-blue-100 bg-blue-50/40 px-3 py-5 text-sm text-slate-500">
                  No active job yet.
                </div>
              )}
            </AnimatePresence>
          </div>
        </section>
      </div>

      <section className="tv-panel p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-900">Recent Actions</h3>
          <span className="text-xs text-slate-500">Last {Math.min(recentJobs.length, 6)} actions</span>
        </div>
        {recentJobs.length === 0 ? (
          <div className="rounded-xl border border-dashed border-blue-100 bg-blue-50/40 px-4 py-6 text-sm text-slate-500">
            No support actions yet.
          </div>
        ) : (
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {recentJobs.map((item) => (
              <div key={item.jobId} className="rounded-xl border border-blue-100 bg-blue-50/70 px-3 py-2.5 shadow-sm">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium text-slate-900">{item.summary}</p>
                  <span className="text-[11px] text-slate-500">{new Date(item.at).toLocaleTimeString()}</span>
                </div>
                <p className="mt-1 break-all text-xs text-slate-500">{item.jobId}</p>
              </div>
            ))}
          </div>
        )}
      </section>

      {error && (
        <div className="rounded-2xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger shadow-sm">
          <div className="flex items-center gap-2">
            <CircleSlash className="h-4 w-4" />
            {error}
          </div>
        </div>
      )}
    </div>
  );
}
