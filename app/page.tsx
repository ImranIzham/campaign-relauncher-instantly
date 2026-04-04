"use client";

import { useState, useMemo, useCallback, useEffect } from "react";

// --- Types ---

interface ClientOption {
  id: string;
  name: string;
  created_at: string;
}

interface CampaignOption {
  id: string;
  name: string;
  status: string;
}

interface LeadRow {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  company: string;
  missingVars: string[];
  customFields?: Record<string, unknown>;
  emailStatus?:
    | "valid"
    | "invalid"
    | "risky"
    | "catch-all"
    | "unknown"
    | "pending";
}

interface PreviewData {
  clientId: string;
  campaign: { id: string; name: string; status: string };
  totalLeads: number;
  totalReplied: number;
  leadsToRelaunch: number;
  dateFilteredCount: number;
  variablesUsed?: string[];
  leadsWithMissingVars?: number;
  missingVarBreakdown?: Record<string, number>;
  leads: LeadRow[];
}

interface RelaunchResult {
  originalCampaign: string;
  originalId: string;
  newCampaignId: string | null;
  newCampaignName?: string;
  totalLeads: number;
  totalReplied: number;
  leadsRelaunched: number;
  leadsFailed?: number;
  message: string;
}

type WizardStep =
  | "select-client"
  | "configure"
  | "previewing"
  | "preview"
  | "validating"
  | "validated"
  | "confirm"
  | "relaunching"
  | "done"
  | "error";

const LAST_CONTACTED_OPTIONS = [
  { label: "No filter", value: 0 },
  { label: "30+ days ago", value: 30 },
  { label: "60+ days ago", value: 60 },
  { label: "90+ days ago", value: 90 },
  { label: "Custom", value: -1 },
];

const RELAUNCH_STEP_LABELS: Record<string, string> = {
  "fetching-leads": "Fetching leads & replies...",
  "fetching-replies": "Computing non-repliers...",
  duplicating: "Duplicating campaign...",
  "attaching-leads": "Attaching leads to new campaign...",
};

type TableFilter = "all" | "missing-vars" | "invalid" | "risky";

function parseCampaignId(input: string): string {
  const trimmed = input.trim();
  const match = trimmed.match(/instantly\.ai\/app\/campaign\/([a-f0-9-]+)/i);
  if (match) return match[1];
  return trimmed;
}

// --- Main Component ---

export default function Home() {
  // Auth — restore from sessionStorage
  const [pin, setPin] = useState(() => {
    if (typeof window !== "undefined") return sessionStorage.getItem("relauncher_pin") ?? "";
    return "";
  });
  const [authenticated, setAuthenticated] = useState(() => {
    if (typeof window !== "undefined") return sessionStorage.getItem("relauncher_auth") === "1";
    return false;
  });

  // Client selection
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [selectedClientId, setSelectedClientId] = useState("");
  const [showAddClient, setShowAddClient] = useState(false);
  const [newClientName, setNewClientName] = useState("");
  const [newClientApiKey, setNewClientApiKey] = useState("");
  const [clientLoading, setClientLoading] = useState(false);
  const [clientError, setClientError] = useState("");

  // Campaign selection
  const [campaigns, setCampaigns] = useState<CampaignOption[]>([]);
  const [campaignsLoading, setCampaignsLoading] = useState(false);
  const [campaignSearch, setCampaignSearch] = useState("");

  // Wizard
  const [wizardStep, setWizardStep] = useState<WizardStep>("select-client");
  const [error, setError] = useState("");

  // Configure step
  const [campaignId, setCampaignId] = useState("");
  const [includeReplied, setIncludeReplied] = useState(false);
  const [lastContactedOption, setLastContactedOption] = useState(0);
  const [customDays, setCustomDays] = useState("");
  const [validateEmails, setValidateEmails] = useState(false);

  // Preview step
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [leads, setLeads] = useState<LeadRow[]>([]);
  const [leadsTableExpanded, setLeadsTableExpanded] = useState(false);
  const [tableFilter, setTableFilter] = useState<TableFilter>("all");

  // Validation step
  const [validationProgress, setValidationProgress] = useState({
    done: 0,
    total: 0,
  });
  const [includeRisky, setIncludeRisky] = useState(true);
  const [includeCatchAll, setIncludeCatchAll] = useState(true);

  // Relaunch step
  const [relaunchStepLabel, setRelaunchStepLabel] = useState("");
  const [result, setResult] = useState<RelaunchResult | null>(null);

  const minDaysSinceContact =
    lastContactedOption === -1
      ? Number(customDays) || 0
      : lastContactedOption;

  const resolvedCampaignId = useMemo(() => parseCampaignId(campaignId), [campaignId]);
  const isUrlInput = campaignId.trim() !== resolvedCampaignId;

  // --- Fetch clients on auth ---
  useEffect(() => {
    if (!authenticated) return;
    fetchClients();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authenticated]);

  const fetchClients = async () => {
    try {
      const res = await fetch("/api/clients", {
        headers: { "x-pin": pin },
      });
      if (res.ok) {
        const data = await res.json();
        setClients(data.clients ?? []);
      }
    } catch {
      // Silently fail — user can still add a client
    }
  };

  const fetchCampaigns = async (clientId: string) => {
    setCampaigns([]);
    setCampaignsLoading(true);
    try {
      const res = await fetch(`/api/campaigns?clientId=${clientId}`, {
        headers: { "x-pin": pin },
      });
      if (res.ok) {
        const data = await res.json();
        setCampaigns(data.campaigns ?? []);
      }
    } catch {
      // Silently fail — user can still paste an ID
    } finally {
      setCampaignsLoading(false);
    }
  };

  // --- Computed values ---

  const filteredCampaigns = useMemo(() => {
    if (!campaignSearch.trim()) return campaigns;
    const q = campaignSearch.toLowerCase();
    return campaigns.filter((c) => c.name.toLowerCase().includes(q));
  }, [campaigns, campaignSearch]);

  const validationSummary = useMemo(() => {
    const statuses = leads.map((l) => l.emailStatus).filter(Boolean);
    if (statuses.length === 0 || statuses.some((s) => s === "pending"))
      return null;
    return {
      valid: leads.filter((l) => l.emailStatus === "valid").length,
      invalid: leads.filter((l) => l.emailStatus === "invalid").length,
      risky: leads.filter((l) => l.emailStatus === "risky").length,
      catchAll: leads.filter((l) => l.emailStatus === "catch-all").length,
      unknown: leads.filter((l) => l.emailStatus === "unknown").length,
    };
  }, [leads]);

  const relaunchCount = useMemo(() => {
    if (wizardStep === "validated" && validationSummary) {
      let count = validationSummary.valid;
      if (includeRisky) count += validationSummary.risky;
      if (includeCatchAll) count += validationSummary.catchAll;
      count += validationSummary.unknown;
      return count;
    }
    return preview?.leadsToRelaunch ?? 0;
  }, [wizardStep, validationSummary, includeRisky, includeCatchAll, preview]);

  const excludeLeadEmails = useMemo(() => {
    if (wizardStep !== "validated") return [];
    const emails: string[] = [];
    for (const lead of leads) {
      if (lead.emailStatus === "invalid") emails.push(lead.email);
      if (!includeRisky && lead.emailStatus === "risky")
        emails.push(lead.email);
      if (!includeCatchAll && lead.emailStatus === "catch-all")
        emails.push(lead.email);
    }
    return emails;
  }, [leads, wizardStep, includeRisky, includeCatchAll]);

  const filteredLeads = useMemo(() => {
    if (tableFilter === "all") return leads;
    if (tableFilter === "missing-vars")
      return leads.filter((l) => l.missingVars.length > 0);
    if (tableFilter === "invalid")
      return leads.filter((l) => l.emailStatus === "invalid");
    if (tableFilter === "risky")
      return leads.filter((l) => l.emailStatus === "risky");
    return leads;
  }, [leads, tableFilter]);

  // --- Handlers ---

  const [authError, setAuthError] = useState("");
  const [authLoading, setAuthLoading] = useState(false);

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pin.length < 4) return;
    setAuthError("");
    setAuthLoading(true);
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin: pin.trim() }),
      });
      if (!res.ok) {
        setAuthError("Incorrect PIN");
        return;
      }
      sessionStorage.setItem("relauncher_pin", pin.trim());
      sessionStorage.setItem("relauncher_auth", "1");
      setAuthenticated(true);
    } catch {
      setAuthError("Connection failed");
    } finally {
      setAuthLoading(false);
    }
  };

  const handleAddClient = async () => {
    if (!newClientName.trim() || !newClientApiKey.trim()) return;
    setClientLoading(true);
    setClientError("");
    try {
      const res = await fetch("/api/clients", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-pin": pin,
        },
        body: JSON.stringify({
          name: newClientName.trim(),
          apiKey: newClientApiKey.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

      // Refresh client list and auto-select new client
      await fetchClients();
      setSelectedClientId(data.client.id);
      setShowAddClient(false);
      setNewClientName("");
      setNewClientApiKey("");
    } catch (err) {
      setClientError(
        err instanceof Error ? err.message : "Failed to add client"
      );
    } finally {
      setClientLoading(false);
    }
  };

  const handlePreview = useCallback(async () => {
    setError("");
    setWizardStep("previewing");

    try {
      const params = new URLSearchParams({
        id: resolvedCampaignId,
        clientId: selectedClientId,
      });
      if (includeReplied) params.set("includeReplied", "true");
      if (minDaysSinceContact > 0)
        params.set("minDaysSinceContact", String(minDaysSinceContact));

      const res = await fetch(`/api/preview?${params}`, {
        headers: { "x-pin": pin },
      });
      const data = await res.json();

      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

      setPreview(data);
      setLeads(
        data.leads.map((l: LeadRow) => ({ ...l, emailStatus: undefined }))
      );
      setLeadsTableExpanded(false);
      setTableFilter("all");
      setWizardStep("preview");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Preview failed");
      setWizardStep("error");
    }
  }, [resolvedCampaignId, selectedClientId, includeReplied, minDaysSinceContact, pin]);

  const handleStreamValidation = useCallback(async () => {
    if (!preview) return;
    setWizardStep("validating");
    setLeadsTableExpanded(true);

    setLeads((prev) =>
      prev.map((l) => ({ ...l, emailStatus: "pending" as const }))
    );
    setValidationProgress({ done: 0, total: leads.length });

    try {
      const res = await fetch("/api/validate-emails-stream", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-pin": pin,
        },
        body: JSON.stringify({
          campaignId: resolvedCampaignId,
          clientId: selectedClientId,
          includeReplied,
          minDaysSinceContact,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || `HTTP ${res.status}`);
      }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let completed = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const data = line.replace(/^data: /, "").trim();
          if (!data || data === "[DONE]") continue;

          try {
            const result = JSON.parse(data);

            if (result.type === "error") {
              console.error("Validation error:", result.message);
              setError(result.message);
              continue;
            }

            if (result.type === "progress") continue;

            // Match by email since Instantly uses email as identifier
            setLeads((prev) =>
              prev.map((l) =>
                l.email === result.email || l.email === result.leadEmail
                  ? { ...l, emailStatus: result.status }
                  : l
              )
            );

            if (result.status !== "pending") {
              completed++;
              setValidationProgress({
                done: completed,
                total: leads.length,
              });
            }
          } catch {
            // skip malformed events
          }
        }
      }

      setWizardStep("validated");
      setIncludeRisky(true);
      setIncludeCatchAll(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Validation failed");
      setWizardStep("error");
    }
  }, [
    preview,
    leads.length,
    pin,
    resolvedCampaignId,
    selectedClientId,
    includeReplied,
    minDaysSinceContact,
  ]);

  const handleRelaunch = useCallback(async () => {
    setError("");
    setResult(null);
    setWizardStep("relaunching");

    const steps = [
      "fetching-leads",
      "fetching-replies",
      "duplicating",
      "attaching-leads",
    ];
    let stepIndex = 0;
    setRelaunchStepLabel(RELAUNCH_STEP_LABELS[steps[0]]);

    const interval = setInterval(() => {
      stepIndex++;
      if (stepIndex < steps.length) {
        setRelaunchStepLabel(RELAUNCH_STEP_LABELS[steps[stepIndex]]);
      }
    }, 3000);

    try {
      const res = await fetch("/api/relaunch", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-pin": pin,
        },
        body: JSON.stringify({
          campaignId: resolvedCampaignId,
          clientId: selectedClientId,
          includeReplied,
          minDaysSinceContact,
          excludeLeadEmails,
        }),
      });

      clearInterval(interval);
      const data = await res.json();

      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

      setResult(data);
      setWizardStep("done");
    } catch (err) {
      clearInterval(interval);
      setError(err instanceof Error ? err.message : "Relaunch failed");
      setWizardStep("error");
    }
  }, [
    pin,
    resolvedCampaignId,
    selectedClientId,
    includeReplied,
    minDaysSinceContact,
    excludeLeadEmails,
  ]);

  const reset = () => {
    setCampaignId("");
    setCampaignSearch("");
    setPreview(null);
    setLeads([]);
    setResult(null);
    setWizardStep("select-client");
    setError("");
    setIncludeReplied(false);
    setLastContactedOption(0);
    setCustomDays("");
    setValidateEmails(false);
    setLeadsTableExpanded(false);
    setTableFilter("all");
    setIncludeRisky(true);
    setIncludeCatchAll(true);
  };

  const selectedClientName =
    clients.find((c) => c.id === selectedClientId)?.name ?? "";
  const selectedCampaignName =
    campaigns.find((c) => c.id === resolvedCampaignId)?.name ?? preview?.campaign.name ?? "";

  // --- PIN Gate ---

  if (!authenticated) {
    return (
      <div className="min-h-screen bg-[#181819] flex items-center justify-center p-4">
        <form
          onSubmit={handleAuth}
          className="bg-[#1C1E21] border border-[#262626] rounded-2xl p-8 w-full max-w-sm"
        >
          <div className="text-center mb-6">
            <h1 className="text-xl font-bold text-[#02E481] font-[var(--font-display)]">Understory</h1>
            <p className="text-[#808080] text-sm mt-1">
              Instantly Relauncher
            </p>
          </div>
          <input
            type="password"
            inputMode="numeric"
            maxLength={8}
            placeholder="Enter PIN"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            className="w-full bg-[#0A0A0A] border border-[#262626] rounded-lg px-4 py-3 text-white text-center text-lg tracking-widest placeholder:text-[#808080] focus:outline-none focus:border-[#02E481]"
          />
          {authError && (
            <p className="text-red-400 text-sm text-center mt-3">
              {authError}
            </p>
          )}
          <button
            type="submit"
            disabled={pin.length < 4 || authLoading}
            className="w-full mt-4 bg-[#02E481] text-[#071018] font-semibold rounded-lg py-3 hover:bg-[#00c96e] transition disabled:opacity-30 disabled:cursor-not-allowed"
          >
            {authLoading ? "Verifying..." : "Enter"}
          </button>
        </form>
      </div>
    );
  }

  // --- Step Indicators ---
  const stepLabels = [
    "Client",
    "Configure",
    "Preview",
    ...(validateEmails ? ["Validate"] : []),
    "Confirm",
    "Relaunch",
  ];
  const baseConfirmIdx = validateEmails ? 4 : 3;
  const currentStepIndex =
    wizardStep === "select-client"
      ? 0
      : wizardStep === "configure"
        ? 1
        : wizardStep === "previewing" || wizardStep === "preview"
          ? 2
          : wizardStep === "validating" || wizardStep === "validated"
            ? 3
            : wizardStep === "confirm"
              ? baseConfirmIdx
              : wizardStep === "relaunching" || wizardStep === "done"
                ? baseConfirmIdx + 1
              : 0;

  // --- Main Wizard UI ---
  return (
    <div className="min-h-screen bg-[#181819] flex items-center justify-center p-4">
      <div className="bg-[#1C1E21] border border-[#262626] rounded-2xl p-8 w-full max-w-5xl">
        {/* Header */}
        <div className="text-center mb-6">
          <h1 className="text-xl font-bold text-[#02E481] font-[var(--font-display)]">Understory</h1>
          <p className="text-[#808080] text-sm mt-1">
            Instantly Relauncher
          </p>
        </div>

        {/* Step Indicator */}
        {wizardStep !== "error" && (
          <div className="flex items-center justify-center gap-2 mb-8">
            {stepLabels.map((label, i) => (
              <div key={label} className="flex items-center gap-2">
                <div
                  className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition ${
                    i === currentStepIndex
                      ? "bg-[#02E481] text-[#071018]"
                      : i < currentStepIndex
                        ? "bg-[#262626] text-[#B3B3B3]"
                        : "bg-[#0A0A0A] text-[#808080]"
                  }`}
                >
                  <span>{i + 1}</span>
                  <span>{label}</span>
                </div>
                {i < stepLabels.length - 1 && (
                  <div
                    className={`w-6 h-px ${i < currentStepIndex ? "bg-[#808080]" : "bg-[#111111]"}`}
                  />
                )}
              </div>
            ))}
          </div>
        )}

        {/* ========== STEP 0: SELECT CLIENT ========== */}
        {wizardStep === "select-client" && (
          <div className="space-y-4">
            <div>
              <label className="text-[#B3B3B3] text-sm block mb-2">
                Select Client
              </label>
              {clients.length > 0 ? (
                <select
                  value={selectedClientId}
                  onChange={(e) => {
                    setSelectedClientId(e.target.value);
                    setShowAddClient(false);
                    setClientError("");
                  }}
                  className="w-full bg-[#0A0A0A] border border-[#262626] rounded-lg px-4 py-3 text-white focus:outline-none focus:border-[#02E481]"
                >
                  <option value="">Choose a client...</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              ) : (
                <p className="text-[#808080] text-sm">
                  No clients saved yet. Add one below.
                </p>
              )}
            </div>

            <div className="border-t border-[#262626] pt-4">
              {!showAddClient ? (
                <button
                  onClick={() => setShowAddClient(true)}
                  className="text-sm text-[#B3B3B3] hover:text-[#02E481] transition"
                >
                  + Add New Client
                </button>
              ) : (
                <div className="space-y-3 bg-[#0A0A0A]/30 border border-[#262626]/50 rounded-xl p-4">
                  <p className="text-[#808080] text-xs uppercase tracking-wider font-medium">
                    New Client
                  </p>
                  <input
                    type="text"
                    placeholder="Client name"
                    value={newClientName}
                    onChange={(e) => setNewClientName(e.target.value)}
                    className="w-full bg-[#0A0A0A] border border-[#262626] rounded-lg px-4 py-2.5 text-white text-sm placeholder:text-[#808080] focus:outline-none focus:border-[#02E481]"
                  />
                  <input
                    type="password"
                    placeholder="Instantly API key"
                    value={newClientApiKey}
                    onChange={(e) => setNewClientApiKey(e.target.value)}
                    className="w-full bg-[#0A0A0A] border border-[#262626] rounded-lg px-4 py-2.5 text-white text-sm placeholder:text-[#808080] focus:outline-none focus:border-[#02E481] font-mono"
                  />
                  {clientError && (
                    <p className="text-red-400 text-sm">{clientError}</p>
                  )}
                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        setShowAddClient(false);
                        setClientError("");
                      }}
                      className="px-4 py-2 bg-[#0A0A0A] border border-[#262626] text-[#B3B3B3] text-sm rounded-lg hover:bg-[#262626] transition"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleAddClient}
                      disabled={
                        !newClientName.trim() ||
                        !newClientApiKey.trim() ||
                        clientLoading
                      }
                      className="flex-1 bg-[#02E481] text-[#071018] text-sm font-semibold rounded-lg py-2 hover:bg-[#00c96e] transition disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      {clientLoading ? "Validating key..." : "Save Client"}
                    </button>
                  </div>
                </div>
              )}
            </div>

            <button
              onClick={() => {
                fetchCampaigns(selectedClientId);
                setWizardStep("configure");
              }}
              disabled={!selectedClientId}
              className="w-full bg-[#02E481] text-[#071018] font-semibold rounded-lg py-3 hover:bg-[#00c96e] transition disabled:opacity-30 disabled:cursor-not-allowed"
            >
              Continue with {selectedClientName || "client"}
            </button>
          </div>
        )}

        {/* ========== STEP 1: CONFIGURE ========== */}
        {wizardStep === "configure" && (
          <div className="space-y-4">
            {/* Client badge */}
            <div className="flex items-center justify-between bg-[#0A0A0A]/50 border border-[#262626]/50 rounded-lg px-4 py-2">
              <span className="text-[#B3B3B3] text-sm">
                Client:{" "}
                <span className="text-white font-medium">
                  {selectedClientName}
                </span>
              </span>
              <button
                onClick={() => setWizardStep("select-client")}
                className="text-[#808080] text-xs hover:text-[#02E481] transition"
              >
                Change
              </button>
            </div>

            <div>
              <label className="text-[#B3B3B3] text-sm block mb-2">
                Campaign
              </label>

              {campaignsLoading ? (
                <div className="flex items-center gap-2 py-3 px-4 bg-[#111111] border border-[#262626] rounded-lg">
                  <div className="w-4 h-4 border-2 border-[#262626] border-t-[#02E481] rounded-full animate-spin" />
                  <span className="text-[#808080] text-sm">Loading campaigns...</span>
                </div>
              ) : campaigns.length > 0 ? (
                <div className="space-y-2">
                  <input
                    type="text"
                    placeholder="Search campaigns..."
                    value={campaignSearch}
                    onChange={(e) => setCampaignSearch(e.target.value)}
                    className="w-full bg-[#111111] border border-[#262626] rounded-lg px-4 py-2.5 text-white text-sm placeholder:text-[#808080] focus:outline-none focus:border-[#02E481]"
                  />
                  <div className="max-h-[240px] overflow-y-auto border border-[#262626] rounded-lg divide-y divide-[#262626]/50">
                    {filteredCampaigns.map((c) => (
                      <button
                        key={c.id}
                        onClick={() => {
                          setCampaignId(c.id);
                          setCampaignSearch("");
                        }}
                        className={`w-full text-left px-4 py-2.5 text-sm transition hover:bg-[#262626]/50 ${
                          resolvedCampaignId === c.id
                            ? "bg-[#02E481]/10 border-l-2 border-l-[#02E481]"
                            : ""
                        }`}
                      >
                        <span className="text-white">{c.name}</span>
                        <span className={`ml-2 text-xs ${
                          c.status === "active" ? "text-green-400" : "text-[#808080]"
                        }`}>
                          {c.status}
                        </span>
                      </button>
                    ))}
                    {filteredCampaigns.length === 0 && (
                      <p className="text-[#808080] text-sm text-center py-3">No campaigns match</p>
                    )}
                  </div>
                </div>
              ) : (
                <input
                  type="text"
                  placeholder="Paste Instantly campaign URL or ID"
                  value={campaignId}
                  onChange={(e) => setCampaignId(e.target.value)}
                  className="w-full bg-[#111111] border border-[#262626] rounded-lg px-4 py-3 text-white placeholder:text-[#808080] focus:outline-none focus:border-[#02E481] font-mono text-sm"
                />
              )}

              {resolvedCampaignId && (
                <p className="text-[#808080] text-xs mt-1.5">
                  {isUrlInput ? "Campaign ID: " : "Selected: "}
                  <span className="text-[#B3B3B3] font-mono">{resolvedCampaignId}</span>
                </p>
              )}
            </div>

            <div className="space-y-3 border border-[#262626] rounded-xl p-4">
              <p className="text-[#808080] text-xs uppercase tracking-wider font-medium">
                Options
              </p>

              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeReplied}
                  onChange={(e) => setIncludeReplied(e.target.checked)}
                  className="mt-0.5 w-4 h-4 rounded border-[#262626] bg-[#111111] text-white accent-white"
                />
                <span className="text-[#B3B3B3] text-sm">
                  Include leads who replied
                  <span className="text-[#808080] block text-xs">
                    For lead magnet campaigns
                  </span>
                </span>
              </label>

              <div className="space-y-2">
                <label className="text-[#B3B3B3] text-sm block">
                  Last contacted
                </label>
                <select
                  value={lastContactedOption}
                  onChange={(e) =>
                    setLastContactedOption(Number(e.target.value))
                  }
                  className="w-full bg-[#111111] border border-[#262626] rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-[#02E481]"
                >
                  {LAST_CONTACTED_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                {lastContactedOption === -1 && (
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      placeholder="Days"
                      value={customDays}
                      onChange={(e) => setCustomDays(e.target.value)}
                      className="w-24 bg-[#111111] border border-[#262626] rounded-lg px-3 py-2 text-white text-sm placeholder:text-[#808080] focus:outline-none focus:border-[#02E481]"
                    />
                    <span className="text-[#B3B3B3] text-sm">+ days ago</span>
                  </div>
                )}
              </div>

              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={validateEmails}
                  onChange={(e) => setValidateEmails(e.target.checked)}
                  className="mt-0.5 w-4 h-4 rounded border-[#262626] bg-[#111111] text-white accent-white"
                />
                <span className="text-[#B3B3B3] text-sm">
                  Validate emails before relaunching
                  <span className="text-[#808080] block text-xs">
                    Checks each email via Instantly API — removes invalid
                    addresses
                  </span>
                </span>
              </label>
            </div>

            <button
              onClick={handlePreview}
              disabled={!resolvedCampaignId}
              className="w-full bg-[#02E481] text-[#071018] font-semibold rounded-lg py-3 hover:bg-[#00c96e] transition disabled:opacity-30 disabled:cursor-not-allowed"
            >
              Preview Campaign
            </button>
          </div>
        )}

        {/* ========== PREVIEWING (loading) ========== */}
        {wizardStep === "previewing" && (
          <div className="text-center py-12">
            <div className="inline-block w-6 h-6 border-2 border-[#262626] border-t-[#02E481] rounded-full animate-spin" />
            <p className="text-[#B3B3B3] text-sm mt-4">
              Fetching campaign from Instantly...
            </p>
          </div>
        )}

        {/* ========== STEP 2: PREVIEW ========== */}
        {(wizardStep === "preview" ||
          wizardStep === "validating" ||
          wizardStep === "validated") &&
          preview && (
            <div className="space-y-4">
              <div className="bg-[#0A0A0A]/50 border border-[#262626]/50 rounded-xl p-5 space-y-4">
                <div>
                  <p className="text-white font-medium">
                    {preview.campaign.name}
                  </p>
                  <p className="text-[#808080] text-sm">
                    ID: {preview.campaign.id} &middot;{" "}
                    <span
                      className={
                        preview.campaign.status === "active"
                          ? "text-green-400"
                          : "text-[#B3B3B3]"
                      }
                    >
                      {preview.campaign.status}
                    </span>
                    {" "}&middot;{" "}
                    <span className="text-[#B3B3B3]">{selectedClientName}</span>
                  </p>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <Stat label="Total Leads" value={preview.totalLeads} />
                  <Stat
                    label="Replied"
                    value={preview.totalReplied}
                    color="text-blue-400"
                  />
                  <Stat
                    label="To Relaunch"
                    value={relaunchCount}
                    color="text-amber-400"
                  />
                </div>

                {preview.dateFilteredCount > 0 && (
                  <p className="text-[#808080] text-xs">
                    {preview.dateFilteredCount} leads excluded (contacted
                    within {minDaysSinceContact} days)
                  </p>
                )}

                {preview.variablesUsed &&
                  preview.variablesUsed.length > 0 && (
                    <div className="border-t border-[#262626]/50 pt-3 space-y-2">
                      <p className="text-[#808080] text-xs uppercase tracking-wider font-medium">
                        Variable Check
                      </p>
                      <p className="text-[#B3B3B3] text-sm">
                        Variables:{" "}
                        {preview.variablesUsed
                          .map((v) => `{{${v}}}`)
                          .join(", ")}
                      </p>
                      {preview.leadsWithMissingVars != null &&
                        preview.leadsWithMissingVars > 0 && (
                          <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3">
                            <p className="text-amber-400 text-sm">
                              {preview.leadsWithMissingVars} leads have
                              missing variables
                            </p>
                            {preview.missingVarBreakdown && (
                              <ul className="mt-1 space-y-0.5">
                                {Object.entries(
                                  preview.missingVarBreakdown
                                ).map(([varName, count]) => (
                                  <li
                                    key={varName}
                                    className="text-[#B3B3B3] text-xs"
                                  >
                                    {varName}: missing for {count} leads
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                        )}
                    </div>
                  )}
              </div>

              {wizardStep === "validating" && (
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-[#B3B3B3]">
                      Validating... {validationProgress.done} /{" "}
                      {validationProgress.total}
                    </span>
                    <span className="text-[#808080]">
                      {validationProgress.total > 0
                        ? Math.round(
                            (validationProgress.done /
                              validationProgress.total) *
                              100
                          )
                        : 0}
                      %
                    </span>
                  </div>
                  <div className="w-full bg-[#111111] rounded-full h-2">
                    <div
                      className="bg-white h-2 rounded-full transition-all duration-300"
                      style={{
                        width: `${
                          validationProgress.total > 0
                            ? (validationProgress.done /
                                validationProgress.total) *
                              100
                            : 0
                        }%`,
                      }}
                    />
                  </div>
                </div>
              )}

              {wizardStep === "validated" && validationSummary && (
                <div className="bg-[#0A0A0A]/50 border border-[#262626]/50 rounded-xl p-4 space-y-3">
                  <p className="text-[#808080] text-xs uppercase tracking-wider font-medium">
                    Validation Results
                  </p>
                  <div className="flex flex-wrap gap-3 text-sm">
                    <span className="text-green-400">
                      Valid: {validationSummary.valid}
                    </span>
                    <span className="text-red-400">
                      Invalid: {validationSummary.invalid}
                    </span>
                    <span className="text-amber-400">
                      Risky: {validationSummary.risky}
                    </span>
                    <span className="text-blue-400">
                      Catch-all: {validationSummary.catchAll}
                    </span>
                    {validationSummary.unknown > 0 && (
                      <span className="text-[#B3B3B3]">
                        Unknown: {validationSummary.unknown}
                      </span>
                    )}
                  </div>
                  <div className="space-y-2 pt-1">
                    {validationSummary.invalid > 0 && (
                      <p className="text-red-400/70 text-xs">
                        {validationSummary.invalid} invalid emails will be
                        excluded
                      </p>
                    )}
                    {validationSummary.risky > 0 && (
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={includeRisky}
                          onChange={(e) => setIncludeRisky(e.target.checked)}
                          className="w-4 h-4 rounded border-[#262626] bg-[#111111] accent-white"
                        />
                        <span className="text-[#B3B3B3] text-sm">
                          Include risky emails ({validationSummary.risky})
                        </span>
                      </label>
                    )}
                    {validationSummary.catchAll > 0 && (
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={includeCatchAll}
                          onChange={(e) =>
                            setIncludeCatchAll(e.target.checked)
                          }
                          className="w-4 h-4 rounded border-[#262626] bg-[#111111] accent-white"
                        />
                        <span className="text-[#B3B3B3] text-sm">
                          Include catch-all emails (
                          {validationSummary.catchAll})
                        </span>
                      </label>
                    )}
                  </div>
                </div>
              )}

              {/* Leads Table */}
              <div className="border border-[#262626] rounded-xl overflow-hidden">
                <button
                  onClick={() => setLeadsTableExpanded(!leadsTableExpanded)}
                  className="w-full flex items-center justify-between px-4 py-3 bg-[#111111]/30 hover:bg-[#111111]/50 transition"
                >
                  <span className="text-[#B3B3B3] text-sm">
                    {leadsTableExpanded ? "Hide" : "View"} {leads.length}{" "}
                    leads
                  </span>
                  <span className="text-[#808080] text-xs">
                    {leadsTableExpanded ? "▲" : "▼"}
                  </span>
                </button>

                {leadsTableExpanded && (
                  <div>
                    <div className="flex gap-2 px-4 py-2 border-t border-[#262626]">
                      {(
                        [
                          { key: "all" as const, label: "All" },
                          {
                            key: "missing-vars" as const,
                            label: "Missing vars",
                          },
                          ...(wizardStep === "validated"
                            ? [
                                {
                                  key: "invalid" as const,
                                  label: "Invalid",
                                },
                                {
                                  key: "risky" as const,
                                  label: "Risky",
                                },
                              ]
                            : []),
                        ] as { key: TableFilter; label: string }[]
                      ).map((chip) => (
                        <button
                          key={chip.key}
                          onClick={() => setTableFilter(chip.key)}
                          className={`px-2.5 py-1 rounded-md text-xs font-medium transition ${
                            tableFilter === chip.key
                              ? "bg-[#02E481] text-white"
                              : "bg-[#111111] text-[#B3B3B3] hover:bg-[#262626]"
                          }`}
                        >
                          {chip.label}
                        </button>
                      ))}
                    </div>

                    <div className="max-h-[400px] overflow-auto">
                      {(() => {
                        const allCustomKeys: string[] = [];
                        const seen = new Set<string>();
                        for (const lead of leads) {
                          if (lead.customFields) {
                            for (const key of Object.keys(
                              lead.customFields
                            )) {
                              if (
                                !seen.has(key) &&
                                lead.customFields[key] != null &&
                                lead.customFields[key] !== ""
                              ) {
                                seen.add(key);
                                allCustomKeys.push(key);
                              }
                            }
                          }
                        }

                        return (
                          <table className="w-full text-sm">
                            <thead className="sticky top-0 bg-[#1C1E21]">
                              <tr className="text-[#808080] text-xs uppercase tracking-wider">
                                <th className="text-left px-4 py-2 font-medium">
                                  Name
                                </th>
                                <th className="text-left px-4 py-2 font-medium">
                                  Email
                                </th>
                                <th className="text-left px-4 py-2 font-medium">
                                  Company
                                </th>
                                {allCustomKeys.map((v) => (
                                  <th
                                    key={v}
                                    className="text-left px-4 py-2 font-medium font-mono"
                                  >
                                    {`{{${v}}}`}
                                  </th>
                                ))}
                                <th className="text-left px-4 py-2 font-medium">
                                  Vars
                                </th>
                                {(wizardStep === "validating" ||
                                  wizardStep === "validated") && (
                                  <th className="text-left px-4 py-2 font-medium">
                                    Email Status
                                  </th>
                                )}
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-[#262626]/50">
                              {filteredLeads.map((lead) => (
                                <tr
                                  key={lead.id}
                                  className={
                                    lead.emailStatus === "invalid"
                                      ? "opacity-40 line-through"
                                      : ""
                                  }
                                >
                                  <td className="px-4 py-2 text-[#B3B3B3] whitespace-nowrap">
                                    {lead.firstName} {lead.lastName}
                                  </td>
                                  <td className="px-4 py-2 text-[#B3B3B3] whitespace-nowrap max-w-[200px] truncate">
                                    {lead.email}
                                  </td>
                                  <td className="px-4 py-2 text-[#B3B3B3] whitespace-nowrap">
                                    {lead.company || (
                                      <span className="text-[#808080]">
                                        &mdash;
                                      </span>
                                    )}
                                  </td>
                                  {allCustomKeys.map((v) => {
                                    const val = lead.customFields?.[v];
                                    return (
                                      <td
                                        key={v}
                                        className="px-4 py-2 whitespace-nowrap max-w-[160px] truncate"
                                      >
                                        {val != null && val !== "" ? (
                                          <span className="text-[#B3B3B3] text-xs">
                                            {String(val)}
                                          </span>
                                        ) : (
                                          <span className="text-red-400 text-xs">
                                            &mdash;
                                          </span>
                                        )}
                                      </td>
                                    );
                                  })}
                                  <td className="px-4 py-2">
                                    {lead.missingVars.length > 0 && (
                                      <div className="flex flex-wrap gap-1">
                                        {lead.missingVars.map((v) => (
                                          <span
                                            key={v}
                                            className="text-xs px-1.5 py-0.5 rounded bg-red-500/15 text-red-400 font-mono"
                                          >
                                            {`{{${v}}}`}
                                          </span>
                                        ))}
                                      </div>
                                    )}
                                  </td>
                                  {(wizardStep === "validating" ||
                                    wizardStep === "validated") && (
                                    <td className="px-4 py-2 whitespace-nowrap">
                                      <StatusBadge
                                        status={lead.emailStatus}
                                      />
                                    </td>
                                  )}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        );
                      })()}
                      {filteredLeads.length === 0 && (
                        <p className="text-[#808080] text-sm text-center py-6">
                          No leads match this filter
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Action Buttons */}
              {wizardStep === "preview" && (
                <div className="flex gap-3">
                  <button
                    onClick={() => setWizardStep("configure")}
                    className="px-4 py-3 bg-[#0A0A0A] border border-[#262626] text-[#B3B3B3] font-medium rounded-lg hover:bg-[#262626] transition text-sm"
                  >
                    Back
                  </button>
                  {validateEmails ? (
                    <button
                      onClick={handleStreamValidation}
                      className="flex-1 bg-[#02E481] text-[#071018] font-semibold rounded-lg py-3 hover:bg-[#00c96e] transition"
                    >
                      Proceed to Validation
                    </button>
                  ) : relaunchCount === 0 ? (
                    <p className="flex-1 text-green-400 text-sm text-center self-center">
                      No leads to relaunch.
                    </p>
                  ) : (
                    <button
                      onClick={() => setWizardStep("confirm")}
                      className="flex-1 bg-[#02E481] text-[#071018] font-semibold rounded-lg py-3 hover:bg-[#00c96e] transition"
                    >
                      Re-launch {relaunchCount.toLocaleString()} Leads
                    </button>
                  )}
                </div>
              )}

              {wizardStep === "validated" && (
                <div className="flex gap-3">
                  <button
                    onClick={() => setWizardStep("preview")}
                    className="px-4 py-3 bg-[#0A0A0A] border border-[#262626] text-[#B3B3B3] font-medium rounded-lg hover:bg-[#262626] transition text-sm"
                  >
                    Back
                  </button>
                  {relaunchCount === 0 ? (
                    <p className="flex-1 text-green-400 text-sm text-center self-center">
                      No leads to relaunch after validation.
                    </p>
                  ) : (
                    <button
                      onClick={() => setWizardStep("confirm")}
                      className="flex-1 bg-[#02E481] text-[#071018] font-semibold rounded-lg py-3 hover:bg-[#00c96e] transition"
                    >
                      Re-launch {relaunchCount.toLocaleString()} Leads
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

        {/* ========== CONFIRM ========== */}
        {wizardStep === "confirm" && preview && (
          <div className="space-y-4">
            <div className="bg-[#0A0A0A]/50 border border-amber-500/30 rounded-xl p-5 space-y-4">
              <p className="text-amber-400 text-sm font-medium uppercase tracking-wider">
                Confirm Relaunch
              </p>
              <p className="text-white">
                This will duplicate{" "}
                <span className="font-semibold">{selectedCampaignName || preview.campaign.name}</span>{" "}
                and add <span className="font-semibold text-amber-400">{relaunchCount.toLocaleString()}</span> leads
                to the new campaign.
              </p>
              <div className="space-y-1.5 text-sm">
                <div className="flex justify-between">
                  <span className="text-[#808080]">Client</span>
                  <span className="text-[#B3B3B3]">{selectedClientName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#808080]">Original campaign</span>
                  <span className="text-[#B3B3B3]">{preview.campaign.name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#808080]">Leads to relaunch</span>
                  <span className="text-amber-400 font-medium">{relaunchCount.toLocaleString()}</span>
                </div>
                {excludeLeadEmails.length > 0 && (
                  <div className="flex justify-between">
                    <span className="text-[#808080]">Excluded (invalid/risky)</span>
                    <span className="text-red-400">{excludeLeadEmails.length}</span>
                  </div>
                )}
              </div>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setWizardStep(validateEmails ? "validated" : "preview")}
                className="px-4 py-3 bg-[#0A0A0A] border border-[#262626] text-[#B3B3B3] font-medium rounded-lg hover:bg-[#262626] transition text-sm"
              >
                Back
              </button>
              <button
                onClick={handleRelaunch}
                className="flex-1 bg-[#02E481] text-[#071018] font-semibold rounded-lg py-3 hover:bg-[#00c96e] transition"
              >
                Confirm &amp; Relaunch
              </button>
            </div>
          </div>
        )}

        {/* ========== RELAUNCHING ========== */}
        {wizardStep === "relaunching" && (
          <div className="text-center py-12">
            <div className="inline-block w-6 h-6 border-2 border-[#262626] border-t-[#02E481] rounded-full animate-spin" />
            <p className="text-[#B3B3B3] text-sm mt-4">{relaunchStepLabel}</p>
          </div>
        )}

        {/* ========== DONE ========== */}
        {wizardStep === "done" && result && (
          <div className="space-y-4">
            <div className="bg-[#0A0A0A]/50 border border-[#262626]/50 rounded-xl p-5 space-y-4">
              <div className="flex items-center gap-2">
                <span className="text-green-400 text-lg">&#10003;</span>
                <p className="text-white font-medium">{result.message}</p>
              </div>

              <div className="space-y-2 text-sm">
                <Row
                  label="Original Campaign"
                  value={`${result.originalCampaign} (${result.originalId})`}
                />
                {result.newCampaignId && (
                  <Row
                    label="New Campaign"
                    value={`${result.newCampaignName || ""} (${result.newCampaignId})`}
                  />
                )}
                <Row
                  label="Total Leads"
                  value={result.totalLeads.toLocaleString()}
                />
                <Row
                  label="Replied"
                  value={result.totalReplied.toLocaleString()}
                />
                <Row
                  label="Leads Relaunched"
                  value={result.leadsRelaunched.toLocaleString()}
                  highlight
                />
                {result.leadsFailed != null && result.leadsFailed > 0 && (
                  <Row
                    label="Failed to Attach"
                    value={result.leadsFailed.toLocaleString()}
                    error
                  />
                )}
              </div>

              {result.newCampaignId && (
                <a
                  href={`https://app.instantly.ai/app/campaign/${result.newCampaignId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block text-center text-sm text-blue-400 hover:text-blue-300 underline underline-offset-2"
                >
                  Open in Instantly &rarr;
                </a>
              )}
            </div>

            <button
              onClick={reset}
              className="w-full bg-[#0A0A0A] border border-[#262626] text-white font-medium rounded-lg py-3 hover:bg-[#262626] transition"
            >
              Start Over
            </button>
          </div>
        )}

        {/* ========== ERROR ========== */}
        {(wizardStep === "error" || error) && (
          <div className="space-y-4">
            <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4">
              <p className="text-red-400 text-sm">{error}</p>
            </div>
            <button
              onClick={reset}
              className="w-full bg-[#0A0A0A] border border-[#262626] text-white font-medium rounded-lg py-3 hover:bg-[#262626] transition"
            >
              Start Over
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// --- Helper Components ---

function StatusBadge({
  status,
}: {
  status?:
    | "valid"
    | "invalid"
    | "risky"
    | "catch-all"
    | "unknown"
    | "pending";
}) {
  if (!status || status === "pending") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-[#808080]">
        <span className="w-2 h-2 rounded-full bg-[#02E481] animate-pulse" />
        Pending
      </span>
    );
  }

  const config = {
    valid: { color: "bg-green-400", text: "text-green-400", label: "Valid" },
    invalid: { color: "bg-red-400", text: "text-red-400", label: "Invalid" },
    risky: {
      color: "bg-amber-400",
      text: "text-amber-400",
      label: "Risky",
    },
    "catch-all": {
      color: "bg-blue-400",
      text: "text-blue-400",
      label: "Catch-all",
    },
    unknown: {
      color: "bg-[#808080]",
      text: "text-[#B3B3B3]",
      label: "Unknown",
    },
  }[status];

  return (
    <span
      className={`inline-flex items-center gap-1.5 text-xs ${config.text}`}
    >
      <span className={`w-2 h-2 rounded-full ${config.color}`} />
      {config.label}
    </span>
  );
}

function Stat({
  label,
  value,
  color = "text-white",
}: {
  label: string;
  value: number;
  color?: string;
}) {
  return (
    <div className="text-center">
      <p className={`text-2xl font-semibold ${color}`}>
        {value.toLocaleString()}
      </p>
      <p className="text-[#808080] text-xs mt-1">{label}</p>
    </div>
  );
}

function Row({
  label,
  value,
  highlight = false,
  error = false,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  error?: boolean;
}) {
  return (
    <div className="flex justify-between">
      <span className="text-[#B3B3B3]">{label}</span>
      <span
        className={
          error
            ? "text-red-400 font-medium"
            : highlight
              ? "text-amber-400 font-medium"
              : "text-white"
        }
      >
        {value}
      </span>
    </div>
  );
}
