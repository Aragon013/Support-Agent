import { useEffect, useState, type ElementType } from "react";
import { ShieldCheck, Plus, ClipboardSignature, Gauge, Wifi, Globe, Boxes } from "lucide-react";
import { apiUrl } from "@/lib/backend-url";
import { cn } from "@/lib/cn";

type ScopeKind = "wireless" | "perimeter" | "service";

type Scope = {
  id: string;
  label: string;
  kind: ScopeKind;
  targetRef: string;
  authorizedBy: string;
  expiresAt: string;
  notes?: string;
  limits: {
    maxRps: number;
    maxConcurrency: number;
    maxDurationMinutes: number;
  };
};

type Profile = {
  id: string;
  name: string;
  intensity: "baseline" | "stress" | "extreme";
  description: string;
  utilizationFactor: number;
  burstMultiplier: number;
  burstEverySeconds: number;
  recommendedDurationMinutes: number;
};

type Exercise = {
  id: string;
  scopeId: string;
  profileId: string;
  tenantId: string;
  operatorId: string;
  ticketRef: string;
  rationale: string;
  mode: "dry-run";
  status: "planned";
  createdAt: string;
  plan: {
    targetRps: number;
    burstRps: number;
    concurrency: number;
    durationMinutes: number;
    targetRef: string;
    kind: ScopeKind;
  };
};

const kindIcon: Record<ScopeKind, ElementType> = {
  wireless: Wifi,
  perimeter: Globe,
  service: Boxes,
};

export function ResiliencePanel() {
  const [scopes, setScopes] = useState<Scope[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [scopeLabel, setScopeLabel] = useState("");
  const [scopeKind, setScopeKind] = useState<ScopeKind>("wireless");
  const [targetRef, setTargetRef] = useState("");
  const [authorizedBy, setAuthorizedBy] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [maxRps, setMaxRps] = useState("1000");
  const [maxConcurrency, setMaxConcurrency] = useState("200");
  const [maxDurationMinutes, setMaxDurationMinutes] = useState("20");
  const [notes, setNotes] = useState("");

  const [selectedScopeId, setSelectedScopeId] = useState("");
  const [selectedProfileId, setSelectedProfileId] = useState("stress-guarded");
  const [tenantId, setTenantId] = useState("default");
  const [operatorId, setOperatorId] = useState("operator-1");
  const [ticketRef, setTicketRef] = useState("");
  const [rationale, setRationale] = useState("");
  const [accepted, setAccepted] = useState(false);

  const readAdminApiKey = () => {
    const envKey = (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.VITE_ADMIN_API_KEY;
    if (envKey && envKey.trim().length > 0) return envKey.trim();
    const localKey = window.localStorage.getItem("adminApiKey");
    return localKey && localKey.trim().length > 0 ? localKey.trim() : "";
  };

  const authHeaders = (includeJson = false): Record<string, string> => {
    const headers: Record<string, string> = includeJson ? { "content-type": "application/json" } : {};
    const apiKey = readAdminApiKey();
    if (apiKey) headers["x-api-key"] = apiKey;
    return headers;
  };

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [scopeRes, profileRes, exerciseRes] = await Promise.all([
        fetch(apiUrl("/api/v1/resilience/scopes"), { headers: authHeaders() }),
        fetch(apiUrl("/api/v1/resilience/profiles"), { headers: authHeaders() }),
        fetch(apiUrl("/api/v1/resilience/exercises"), { headers: authHeaders() }),
      ]);
      if (!scopeRes.ok || !profileRes.ok || !exerciseRes.ok) throw new Error("load_failed");
      const scopeBody = (await scopeRes.json()) as { items: Scope[] };
      const profileBody = (await profileRes.json()) as { items: Profile[] };
      const exerciseBody = (await exerciseRes.json()) as { items: Exercise[] };
      setScopes(scopeBody.items ?? []);
      setProfiles(profileBody.items ?? []);
      setExercises(exerciseBody.items ?? []);
      if (!selectedScopeId && scopeBody.items?.[0]?.id) setSelectedScopeId(scopeBody.items[0].id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to load resilience data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const createScope = async () => {
    setError(null);
    try {
      const res = await fetch(apiUrl("/api/v1/resilience/scopes"), {
        method: "POST",
        headers: authHeaders(true),
        body: JSON.stringify({
          label: scopeLabel,
          kind: scopeKind,
          targetRef,
          authorizedBy,
          expiresAt,
          notes,
          limits: {
            maxRps: Number(maxRps),
            maxConcurrency: Number(maxConcurrency),
            maxDurationMinutes: Number(maxDurationMinutes),
          },
        }),
      });
      if (!res.ok) throw new Error(`scope_http_${res.status}`);
      setScopeLabel("");
      setTargetRef("");
      setAuthorizedBy("");
      setExpiresAt("");
      setNotes("");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to create scope");
    }
  };

  const planExercise = async () => {
    if (!accepted) {
      setError("Disclaimer must be accepted before planning.");
      return;
    }
    setError(null);
    try {
      const res = await fetch(apiUrl("/api/v1/resilience/exercises"), {
        method: "POST",
        headers: authHeaders(true),
        body: JSON.stringify({
          scopeId: selectedScopeId,
          profileId: selectedProfileId,
          tenantId,
          operatorId,
          ticketRef,
          rationale,
          disclaimerAccepted: accepted,
          mode: "dry-run",
        }),
      });
      if (!res.ok) throw new Error(`exercise_http_${res.status}`);
      setTicketRef("");
      setRationale("");
      setAccepted(false);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to plan exercise");
    }
  };

  return (
    <div className="flex flex-col gap-5 p-6 text-slate-900">
      <section className="tv-panel p-5">
        <div className="inline-flex items-center gap-2 rounded-full border border-warn/30 bg-warn/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-warn">
          <ShieldCheck className="h-3.5 w-3.5" />
          Resilience Exercises
        </div>
        <h2 className="mt-2 text-xl font-semibold text-slate-900">Defensive Dry-Run Planner</h2>
        <p className="mt-1 text-sm text-slate-600">Authorized scopes only. This module plans resilience exercises and incident choreography without generating network traffic.</p>
        {error ? <p className="mt-2 text-xs text-danger">{error}</p> : null}
      </section>

      <section className="tv-panel grid gap-4 p-4 lg:grid-cols-2">
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900"><Plus className="h-4 w-4" /> Authorized Scope</div>
          <div className="grid gap-2 md:grid-cols-2">
            <input value={scopeLabel} onChange={(e) => setScopeLabel(e.target.value)} placeholder="Label" className="rounded-lg border border-blue-100 bg-white px-2.5 py-2 text-sm" />
            <select value={scopeKind} onChange={(e) => setScopeKind(e.target.value as ScopeKind)} className="rounded-lg border border-blue-100 bg-white px-2.5 py-2 text-sm">
              <option value="wireless">wireless</option>
              <option value="perimeter">perimeter</option>
              <option value="service">service</option>
            </select>
            <input value={targetRef} onChange={(e) => setTargetRef(e.target.value)} placeholder="Target ref (ssid://, service://)" className="rounded-lg border border-blue-100 bg-white px-2.5 py-2 text-sm md:col-span-2" />
            <input value={authorizedBy} onChange={(e) => setAuthorizedBy(e.target.value)} placeholder="Authorized by" className="rounded-lg border border-blue-100 bg-white px-2.5 py-2 text-sm" />
            <input value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} placeholder="Expires at (ISO)" className="rounded-lg border border-blue-100 bg-white px-2.5 py-2 text-sm" />
            <input value={maxRps} onChange={(e) => setMaxRps(e.target.value)} placeholder="Max RPS" className="rounded-lg border border-blue-100 bg-white px-2.5 py-2 text-sm" />
            <input value={maxConcurrency} onChange={(e) => setMaxConcurrency(e.target.value)} placeholder="Max concurrency" className="rounded-lg border border-blue-100 bg-white px-2.5 py-2 text-sm" />
            <input value={maxDurationMinutes} onChange={(e) => setMaxDurationMinutes(e.target.value)} placeholder="Max duration minutes" className="rounded-lg border border-blue-100 bg-white px-2.5 py-2 text-sm" />
            <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes" className="rounded-lg border border-blue-100 bg-white px-2.5 py-2 text-sm md:col-span-2" />
          </div>
          <button onClick={createScope} className="inline-flex items-center gap-1 rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white">Create Scope</button>
        </div>

        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900"><ClipboardSignature className="h-4 w-4" /> Plan Exercise</div>
          <div className="grid gap-2 md:grid-cols-2">
            <select value={selectedScopeId} onChange={(e) => setSelectedScopeId(e.target.value)} className="rounded-lg border border-blue-100 bg-white px-2.5 py-2 text-sm md:col-span-2">
              {scopes.map((scope) => <option key={scope.id} value={scope.id}>{scope.label}</option>)}
            </select>
            <select value={selectedProfileId} onChange={(e) => setSelectedProfileId(e.target.value)} className="rounded-lg border border-blue-100 bg-white px-2.5 py-2 text-sm md:col-span-2">
              {profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
            </select>
            <input value={tenantId} onChange={(e) => setTenantId(e.target.value)} placeholder="Tenant ID" className="rounded-lg border border-blue-100 bg-white px-2.5 py-2 text-sm" />
            <input value={operatorId} onChange={(e) => setOperatorId(e.target.value)} placeholder="Operator ID" className="rounded-lg border border-blue-100 bg-white px-2.5 py-2 text-sm" />
            <input value={ticketRef} onChange={(e) => setTicketRef(e.target.value)} placeholder="Ticket / Change Ref" className="rounded-lg border border-blue-100 bg-white px-2.5 py-2 text-sm md:col-span-2" />
            <textarea value={rationale} onChange={(e) => setRationale(e.target.value)} placeholder="Why this exercise is needed" className="min-h-24 rounded-lg border border-blue-100 bg-white px-2.5 py-2 text-sm md:col-span-2" />
          </div>
          <label className="flex items-start gap-2 text-xs text-slate-600">
            <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} className="mt-0.5" />
            <span>I confirm this scope is authorized, this run is dry-run only, and no disruptive traffic will be generated by this module.</span>
          </label>
          <button onClick={planExercise} className="inline-flex items-center gap-1 rounded-lg bg-warn px-3 py-2 text-sm font-semibold text-surface-950">Plan Dry-Run</button>
        </div>
      </section>

      <section className="tv-panel p-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-900"><Gauge className="h-4 w-4" /> Scopes</div>
        <div className="mt-3 grid gap-2 lg:grid-cols-2">
          {scopes.map((scope) => {
            const Icon = kindIcon[scope.kind];
            return (
              <div key={scope.id} className="rounded-lg border border-blue-100 bg-white p-3">
                <div className="flex items-center gap-2">
                  <Icon className="h-4 w-4 text-brand" />
                  <p className="text-sm font-semibold text-slate-900">{scope.label}</p>
                </div>
                <p className="mt-1 text-[11px] text-slate-500">{scope.kind} · {scope.targetRef}</p>
                <p className="mt-1 text-[11px] text-slate-500">Cap: {scope.limits.maxRps} rps · {scope.limits.maxConcurrency} conc · {scope.limits.maxDurationMinutes} min</p>
                {scope.notes ? <p className="mt-1 text-[11px] text-slate-400">{scope.notes}</p> : null}
              </div>
            );
          })}
        </div>
      </section>

      <section className="tv-panel p-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-900"><Gauge className="h-4 w-4" /> Planned Exercises</div>
        {loading ? <p className="mt-2 text-xs text-slate-500">Loading...</p> : null}
        <div className="mt-3 space-y-2">
          {exercises.length === 0 ? <p className="text-xs text-slate-500">No planned exercises yet.</p> : exercises.map((exercise) => {
            const profile = profiles.find((item) => item.id === exercise.profileId);
            return (
              <div key={exercise.id} className="rounded-lg border border-blue-100 bg-white p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-slate-900">{exercise.ticketRef}</p>
                  <span className={cn("rounded-full border px-2 py-0.5 text-[10px]", "border-warn/30 bg-warn/10 text-warn")}>{exercise.mode}</span>
                </div>
                <p className="text-[11px] text-slate-500">{profile?.name ?? exercise.profileId} · {exercise.plan.kind} · {exercise.plan.targetRef}</p>
                <p className="mt-1 text-[11px] text-slate-500">Plan: {exercise.plan.targetRps} rps base · {exercise.plan.burstRps} burst · {exercise.plan.concurrency} conc · {exercise.plan.durationMinutes} min</p>
                <p className="mt-1 text-[11px] text-slate-400">{exercise.rationale}</p>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
