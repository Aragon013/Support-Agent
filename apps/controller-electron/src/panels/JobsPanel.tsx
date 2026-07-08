import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { RefreshCw, CheckCircle2, XCircle, Clock, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/cn";
import { apiUrl, BACKEND_URL } from "@/lib/backend-url";

type JobStatus =
  | "queued" | "dispatched" | "running" | "streaming"
  | "verifying" | "completed" | "failed" | "cancelled"
  | "blocked" | "mfa_pending" | "policy_check" | "created";

interface Job {
  id: string;
  status: JobStatus;
  catalogCommandId: string;
  tenantId: string;
  endpointId: string;
  riskLevel: string;
  createdAt: string;
}

const STATUS_ICON: Partial<Record<JobStatus, React.ElementType>> = {
  completed: CheckCircle2,
  failed:    XCircle,
  cancelled: XCircle,
  blocked:   AlertTriangle,
  queued:    Clock,
};

const STATUS_COLOR: Partial<Record<JobStatus, string>> = {
  completed:   "text-success",
  failed:      "text-danger",
  cancelled:   "text-slate-500",
  blocked:     "text-warn",
  queued:      "text-accent",
  running:     "text-brand",
  dispatched:  "text-brand",
  mfa_pending: "text-warn",
};

export function JobsPanel() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  const fetchJobs = async () => {
    setLoading(true);
    try {
      const res = await fetch(apiUrl("/api/v1/commands/jobs"));
      if (res.ok) {
        const body = await res.json() as { items: Job[] };
        setJobs(body.items ?? []);
      }
    } catch {
      // server may not be running in dev preview
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchJobs();

    const ws = new WebSocket(
      `${BACKEND_URL.replace(/^http/, "ws")}/api/v1/commands/events/ws?tenantId=tenant-1`,
    );
    wsRef.current = ws;

    ws.onmessage = (ev) => {
      try {
        const frame = JSON.parse(ev.data as string) as {
          type: string;
          event?: { jobId: string; status: JobStatus };
        };
        if (frame.type === "command.job.event" && frame.event) {
          const { jobId, status } = frame.event;
          setJobs((prev) =>
            prev.map((j) => (j.id === jobId ? { ...j, status } : j)),
          );
        }
      } catch {
        // ignore malformed frame
      }
    };

    return () => {
      ws.close();
    };
  }, []);

  return (
    <div className="flex flex-col gap-4 p-6 text-slate-900">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Command Queue</h2>
          <p className="mt-0.5 text-sm text-slate-600">Track command progress and outcomes.</p>
        </div>
        <button onClick={fetchJobs} className="tv-button-soft px-3 py-1.5 text-xs">
          <RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin")} />
          Refresh Queue
        </button>
      </div>

      {jobs.length === 0 ? (
        <div className="tv-empty flex flex-col items-center justify-center py-20">
          <Clock className="w-10 h-10 mb-3" />
          <p className="text-sm">No commands yet. Run a command to start.</p>
        </div>
      ) : (
        <div className="grid gap-2">
          <AnimatePresence initial={false}>
            {jobs.map((job) => {
              const Icon = STATUS_ICON[job.status] ?? Clock;
              const color = STATUS_COLOR[job.status] ?? "text-slate-400";
              const isActive = ["queued","dispatched","running","streaming","verifying"].includes(job.status);

              return (
                <motion.div
                  key={job.id}
                  layout
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.97 }}
                  className="tv-card flex items-center gap-4 px-4 py-3"
                >
                  <div className={cn("shrink-0", color)}>
                    {isActive ? (
                      <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin block" />
                    ) : (
                      <Icon className="w-4 h-4" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="truncate text-sm font-medium text-slate-900">
                      {job.catalogCommandId}
                    </p>
                    <p className="truncate font-mono text-xs text-slate-500">{job.id}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className={cn("text-xs font-semibold capitalize", color)}>
                      {job.status.replace("_", " ")}
                    </p>
                    <p className="text-xs text-slate-600">
                      {new Date(job.createdAt).toLocaleTimeString()}
                    </p>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
