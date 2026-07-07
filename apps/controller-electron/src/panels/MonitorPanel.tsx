import { Activity, Wifi, WifiOff } from "lucide-react";
import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/cn";

interface LiveEvent {
  seq: number;
  name: string;
  jobId: string;
  tenantId: string;
  createdAt: string;
}

export function MonitorPanel() {
  const [events, setEvents] = useState<LiveEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    const connect = () => {
      const ws = new WebSocket(
        "ws://localhost:3000/api/v1/commands/events/ws?tenantId=tenant-1",
      );
      wsRef.current = ws;
      ws.onopen  = () => setConnected(true);
      ws.onclose = () => setConnected(false);
      ws.onerror = () => setConnected(false);
      ws.onmessage = (ev) => {
        try {
          const frame = JSON.parse(ev.data as string) as {
            type: string;
            event?: LiveEvent;
          };
          if (frame.type === "command.job.event" && frame.event) {
            setEvents((prev) =>
              [frame.event!, ...prev].slice(0, 100),
            );
          }
        } catch {
          // ignore
        }
      };
    };

    connect();
    return () => wsRef.current?.close();
  }, []);

  return (
    <div className="flex flex-col gap-4 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">Live Monitor</h2>
          <p className="text-sm text-slate-400 mt-0.5">Real-time WS event stream</p>
        </div>
        <div className={cn("flex items-center gap-1.5 text-xs font-medium", connected ? "text-success" : "text-slate-500")}>
          {connected ? <Wifi className="w-3.5 h-3.5" /> : <WifiOff className="w-3.5 h-3.5" />}
          {connected ? "Connected" : "Disconnected"}
        </div>
      </div>

      {events.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-slate-600">
          <Activity className="w-10 h-10 mb-3 animate-pulse-slow" />
          <p className="text-sm">Waiting for events…</p>
        </div>
      ) : (
        <div className="grid gap-1.5 max-h-[calc(100vh-12rem)] overflow-y-auto">
          <AnimatePresence initial={false}>
            {events.map((ev) => (
              <motion.div
                key={`${ev.jobId}-${ev.seq}`}
                initial={{ opacity: 0, x: 12 }}
                animate={{ opacity: 1, x: 0 }}
                className="flex items-center gap-3 px-3 py-2 bg-surface-900 border border-surface-800 rounded-lg text-sm"
              >
                <span className="text-slate-600 font-mono text-xs w-6 shrink-0">{ev.seq}</span>
                <span className="text-accent font-mono text-xs flex-1 truncate">{ev.name}</span>
                <span className="text-slate-600 text-xs font-mono truncate max-w-[8rem]">
                  {ev.jobId.slice(0, 8)}…
                </span>
                <span className="text-slate-600 text-xs">
                  {new Date(ev.createdAt).toLocaleTimeString()}
                </span>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
