"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import { useAuth } from "../../(shared)/components/auth-gate";
import { Spinner, StepIndicator, Row } from "../../(shared)/components/ui";

// --- Types ---

interface ClientOption {
  id: string;
  name: string;
  created_at: string;
}

interface ParsedEmail {
  stepNumber: number;
  variant: string | null;
  threadType: "new" | "reply";
  subject: string;
  body: string;
  variables: string[];
}

interface SpintaxEmail extends ParsedEmail {
  spintaxSubject: string;
  spintaxBody: string;
}

interface SpamResult {
  stepNumber: number;
  variant: string | null;
  score: "great" | "okay" | "poor";
  spamWords: Array<{ word: string; category: string; count: number }>;
  totalFound: number;
}

interface SenderAccount {
  id: string;
  email: string;
  status: string;
}

type CreatorStep =
  | "select-client"
  | "paste-copy"
  | "parsing"
  | "review-parsed"
  | "spintax"
  | "checking-spam"
  | "review-spam"
  | "configure"
  | "preview-final"
  | "creating"
  | "done"
  | "error";

export default function CreatorPage() {
  const { pin } = useAuth();

  // Client
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [selectedClientId, setSelectedClientId] = useState("");
  const [showAddClient, setShowAddClient] = useState(false);
  const [newClientName, setNewClientName] = useState("");
  const [newClientApiKey, setNewClientApiKey] = useState("");
  const [clientLoading, setClientLoading] = useState(false);
  const [clientError, setClientError] = useState("");

  // Wizard
  const [step, setStep] = useState<CreatorStep>("select-client");
  const [error, setError] = useState("");

  // Copy
  const [rawCopy, setRawCopy] = useState("");
  const [parsedEmails, setParsedEmails] = useState<ParsedEmail[]>([]);
  const [allVariables, setAllVariables] = useState<string[]>([]);
  const [hasVariants, setHasVariants] = useState(false);

  // Spintax
  const [spintaxEmails, setSpintaxEmails] = useState<SpintaxEmail[]>([]);
  const [useSpintax, setUseSpintax] = useState(true);
  const [spintaxErrors, setSpintaxErrors] = useState<Record<string, string[]>>({});

  // Spam
  const [spamResults, setSpamResults] = useState<SpamResult[]>([]);
  const [spamFixed, setSpamFixed] = useState(false);

  // Configure
  const [campaignName, setCampaignName] = useState("");
  const [senderAccounts, setSenderAccounts] = useState<SenderAccount[]>([]);
  const [selectedSenders, setSelectedSenders] = useState<string[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(false);

  // Result
  const [result, setResult] = useState<{ id: string; name: string; url: string; stepsCreated: number } | null>(null);

  const selectedClientName = clients.find((c) => c.id === selectedClientId)?.name ?? "";

  // The emails that will be used for the campaign (spintax or original)
  const finalEmails = useMemo(() => {
    if (useSpintax && spintaxEmails.length > 0) {
      return spintaxEmails.map((e) => ({
        stepNumber: e.stepNumber,
        variant: e.variant,
        threadType: e.threadType,
        subject: e.spintaxSubject,
        body: e.spintaxBody,
        variables: e.variables,
      }));
    }
    return parsedEmails;
  }, [useSpintax, spintaxEmails, parsedEmails]);

  // Fetch clients
  useEffect(() => {
    fetchClients();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchClients = async () => {
    try {
      const res = await fetch("/api/clients", { headers: { "x-pin": pin } });
      if (res.ok) {
        const data = await res.json();
        setClients(data.clients ?? []);
      }
    } catch { /* silent */ }
  };

  const handleAddClient = async () => {
    if (!newClientName.trim() || !newClientApiKey.trim()) return;
    setClientLoading(true);
    setClientError("");
    try {
      const res = await fetch("/api/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-pin": pin },
        body: JSON.stringify({ name: newClientName.trim(), apiKey: newClientApiKey.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      await fetchClients();
      setSelectedClientId(data.client.id);
      setShowAddClient(false);
      setNewClientName("");
      setNewClientApiKey("");
    } catch (err) {
      setClientError(err instanceof Error ? err.message : "Failed to add client");
    } finally {
      setClientLoading(false);
    }
  };

  // Parse copy
  const handleParse = useCallback(async () => {
    setError("");
    setStep("parsing");
    try {
      const res = await fetch("/api/creator/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-pin": pin },
        body: JSON.stringify({ rawText: rawCopy }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setParsedEmails(data.emails);
      setAllVariables(data.variables);
      setHasVariants(data.hasVariants);
      setCampaignName(`${selectedClientName} — ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" })}`);
      setStep("review-parsed");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Parse failed");
      setStep("error");
    }
  }, [rawCopy, pin, selectedClientName]);

  // Initialize spintax step — pre-fill with original copy
  const initSpintax = useCallback(() => {
    setSpintaxEmails(parsedEmails.map((e) => ({ ...e, spintaxSubject: e.subject, spintaxBody: e.body })));
    setSpintaxErrors({});
    setStep("spintax");
  }, [parsedEmails]);

  // Build Claude Code prompt for spintax generation
  const buildClaudePrompt = useCallback((): string => {
    const emailBlocks = parsedEmails.map((e) =>
      `Step ${e.stepNumber}${e.variant ?? ""} (${e.threadType === "new" ? "New Thread" : "Reply"})\nSubject: ${e.subject}\n\n${e.body}`
    ).join("\n\n---\n\n");
    return `Add spintax to these cold emails. Use Instantly format: {{RANDOM | original | var1 | var2 | var3}}

Rules:
- 3 variations per sentence (4 total including original)
- Preserve {{variable}} tokens exactly as-is
- Don't spin lines ≤3 words, greetings, sign-offs, or lines with numbers/metrics
- Return the complete emails with spintax applied, using the same Step headers

${emailBlocks}`;
  }, [parsedEmails]);

  // Validate spintax for a single email field, update errors state
  const validateSpintaxField = useCallback(async (key: string, subject: string, body: string) => {
    try {
      const res = await fetch("/api/creator/spintax", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-pin": pin },
        body: JSON.stringify({
          emails: [{ stepNumber: 0, variant: null, subject, body }],
        }),
      });
      const data = await res.json();
      const result = data.emails?.[0];
      setSpintaxErrors((prev) => ({ ...prev, [key]: result?.errors ?? [] }));
    } catch {
      // silent — validation is best-effort
    }
  }, [pin]);

  // Spam check
  const handleSpamCheck = useCallback(async () => {
    setStep("checking-spam");
    try {
      const emailsToCheck = finalEmails.map((e) => ({
        stepNumber: e.stepNumber,
        variant: e.variant,
        subject: e.subject,
        body: e.body,
      }));
      const res = await fetch("/api/creator/spam-check", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-pin": pin },
        body: JSON.stringify({ emails: emailsToCheck }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setSpamResults(data.emails);
      setSpamFixed(false);
      setStep("review-spam");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Spam check failed");
      setStep("error");
    }
  }, [finalEmails, pin]);

  // Spam fix
  const handleSpamFix = useCallback(async () => {
    const allSpamWords = [...new Set(spamResults.flatMap((r) => r.spamWords.map((w) => w.word)))];
    if (allSpamWords.length === 0) return;

    try {
      const emailsToFix = finalEmails.map((e) => ({
        stepNumber: e.stepNumber,
        variant: e.variant,
        subject: e.subject,
        body: e.body,
      }));
      const res = await fetch("/api/creator/spam-fix", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-pin": pin },
        body: JSON.stringify({ emails: emailsToFix, spamWords: allSpamWords }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      // Update the emails with fixed versions
      if (useSpintax && spintaxEmails.length > 0) {
        setSpintaxEmails((prev) =>
          prev.map((e) => {
            const fixed = data.emails.find((f: { stepNumber: number; variant: string | null }) => f.stepNumber === e.stepNumber && f.variant === e.variant);
            return fixed ? { ...e, spintaxSubject: fixed.subject, spintaxBody: fixed.body } : e;
          })
        );
      } else {
        setParsedEmails((prev) =>
          prev.map((e) => {
            const fixed = data.emails.find((f: { stepNumber: number; variant: string | null }) => f.stepNumber === e.stepNumber && f.variant === e.variant);
            return fixed ? { ...e, subject: fixed.subject, body: fixed.body } : e;
          })
        );
      }
      setSpamFixed(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Spam fix failed");
    }
  }, [spamResults, finalEmails, useSpintax, spintaxEmails, pin]);

  // Fetch sender accounts
  const fetchAccounts = useCallback(async () => {
    setAccountsLoading(true);
    try {
      const res = await fetch(`/api/creator/accounts?clientId=${selectedClientId}`, {
        headers: { "x-pin": pin },
      });
      if (res.ok) {
        const data = await res.json();
        setSenderAccounts(data.accounts ?? []);
      }
    } catch { /* silent */ }
    finally { setAccountsLoading(false); }
  }, [selectedClientId, pin]);

  // Create campaign
  const handleCreateCampaign = useCallback(async () => {
    setStep("creating");
    setError("");
    try {
      const res = await fetch("/api/creator/create-campaign", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-pin": pin },
        body: JSON.stringify({
          clientId: selectedClientId,
          campaignName,
          emails: finalEmails,
          senderEmails: selectedSenders,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setResult(data);
      setStep("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Campaign creation failed");
      setStep("error");
    }
  }, [pin, selectedClientId, campaignName, finalEmails, selectedSenders]);

  const reset = () => {
    setRawCopy("");
    setParsedEmails([]);
    setSpintaxEmails([]);
    setSpintaxErrors({});
    setSpamResults([]);
    setResult(null);
    setStep("select-client");
    setError("");
    setSpamFixed(false);
    setUseSpintax(true);
    setSelectedSenders([]);
    setCampaignName("");
  };

  // Step indicator
  const stepLabels = ["Client", "Paste", "Parse", "Spintax", "Spam", "Configure", "Create"];
  const stepIndex =
    step === "select-client" ? 0
    : step === "paste-copy" ? 1
    : step === "parsing" || step === "review-parsed" ? 2
    : step === "spintax" ? 3
    : step === "checking-spam" || step === "review-spam" ? 4
    : step === "configure" || step === "preview-final" ? 5
    : step === "creating" || step === "done" ? 6
    : 0;

  return (
    <div className="bg-[#1C1E21] border border-[#262626] rounded-2xl p-8">
      {step !== "error" && <StepIndicator labels={stepLabels} currentIndex={stepIndex} />}

      {/* ========== SELECT CLIENT ========== */}
      {step === "select-client" && (
        <div className="space-y-4">
          <div>
            <label className="text-[#B3B3B3] text-sm block mb-2">Select Client</label>
            {clients.length > 0 ? (
              <select value={selectedClientId} onChange={(e) => { setSelectedClientId(e.target.value); setShowAddClient(false); setClientError(""); }}
                className="w-full bg-[#0A0A0A] border border-[#262626] rounded-lg px-4 py-3 text-white focus:outline-none focus:border-[#02E481]">
                <option value="">Choose a client...</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            ) : (
              <p className="text-[#808080] text-sm">No clients saved yet. Add one below.</p>
            )}
          </div>
          <div className="border-t border-[#262626] pt-4">
            {!showAddClient ? (
              <button onClick={() => setShowAddClient(true)} className="text-sm text-[#B3B3B3] hover:text-[#02E481] transition">+ Add New Client</button>
            ) : (
              <div className="space-y-3 bg-[#0A0A0A]/30 border border-[#262626]/50 rounded-xl p-4">
                <p className="text-[#808080] text-xs uppercase tracking-wider font-medium">New Client</p>
                <input type="text" placeholder="Client name" value={newClientName} onChange={(e) => setNewClientName(e.target.value)}
                  className="w-full bg-[#0A0A0A] border border-[#262626] rounded-lg px-4 py-2.5 text-white text-sm placeholder:text-[#808080] focus:outline-none focus:border-[#02E481]" />
                <input type="password" placeholder="Instantly API key" value={newClientApiKey} onChange={(e) => setNewClientApiKey(e.target.value)}
                  className="w-full bg-[#0A0A0A] border border-[#262626] rounded-lg px-4 py-2.5 text-white text-sm placeholder:text-[#808080] focus:outline-none focus:border-[#02E481] font-mono" />
                {clientError && <p className="text-red-400 text-sm">{clientError}</p>}
                <div className="flex gap-2">
                  <button onClick={() => { setShowAddClient(false); setClientError(""); }}
                    className="px-4 py-2 bg-[#0A0A0A] border border-[#262626] text-[#B3B3B3] text-sm rounded-lg hover:bg-[#262626] transition">Cancel</button>
                  <button onClick={handleAddClient} disabled={!newClientName.trim() || !newClientApiKey.trim() || clientLoading}
                    className="flex-1 bg-[#02E481] text-[#071018] text-sm font-semibold rounded-lg py-2 hover:bg-[#00c96e] transition disabled:opacity-30 disabled:cursor-not-allowed">
                    {clientLoading ? "Validating key..." : "Save Client"}
                  </button>
                </div>
              </div>
            )}
          </div>
          <button onClick={() => setStep("paste-copy")} disabled={!selectedClientId}
            className="w-full bg-[#02E481] text-[#071018] font-semibold rounded-lg py-3 hover:bg-[#00c96e] transition disabled:opacity-30 disabled:cursor-not-allowed">
            Continue with {selectedClientName || "client"}
          </button>
        </div>
      )}

      {/* ========== PASTE COPY ========== */}
      {step === "paste-copy" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between bg-[#0A0A0A]/50 border border-[#262626]/50 rounded-lg px-4 py-2">
            <span className="text-[#B3B3B3] text-sm">Client: <span className="text-white font-medium">{selectedClientName}</span></span>
            <button onClick={() => setStep("select-client")} className="text-[#808080] text-xs hover:text-[#02E481] transition">Change</button>
          </div>
          <div>
            <label className="text-[#B3B3B3] text-sm block mb-2">Paste Email Copy</label>
            <textarea
              value={rawCopy}
              onChange={(e) => setRawCopy(e.target.value)}
              placeholder={`Email 1A (New Thread)\nSubject: Quick question about {{company_name}}\n\nHi {{first_name}},\n\n...\n\nEmail 1B (New Thread)\nSubject: ...\n\nEmail 2 (Reply)\nSubject: Re:\n...\n\nEmail 3 (New Thread)\nSubject: ...\n...\n\nEmail 4 (Reply)\nSubject: Re:\n...`}
              rows={16}
              className="w-full bg-[#0A0A0A] border border-[#262626] rounded-lg px-4 py-3 text-white text-sm font-mono placeholder:text-[#808080]/50 focus:outline-none focus:border-[#02E481] resize-y"
            />
            <p className="text-[#808080] text-xs mt-1">
              Each email should start with a header like &quot;Email 1 (New Thread)&quot; or &quot;Step 1A&quot;. Use A/B suffixes for split test variants.
            </p>
          </div>
          <button onClick={handleParse} disabled={!rawCopy.trim()}
            className="w-full bg-[#02E481] text-[#071018] font-semibold rounded-lg py-3 hover:bg-[#00c96e] transition disabled:opacity-30 disabled:cursor-not-allowed">
            Parse Copy
          </button>
        </div>
      )}

      {/* ========== PARSING ========== */}
      {step === "parsing" && <Spinner text="Parsing email copy..." />}

      {/* ========== REVIEW PARSED ========== */}
      {step === "review-parsed" && (
        <div className="space-y-4">
          <div className="bg-[#0A0A0A]/50 border border-[#262626]/50 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-[#808080] text-xs uppercase tracking-wider font-medium">Parsed Structure</p>
              <div className="flex gap-2 text-xs">
                <span className="text-[#B3B3B3]">{parsedEmails.length} emails</span>
                {hasVariants && <span className="text-amber-400">Split tests detected</span>}
              </div>
            </div>
            {allVariables.length > 0 && (
              <p className="text-[#B3B3B3] text-sm">Variables: {allVariables.map((v) => `{{${v}}}`).join(", ")}</p>
            )}
          </div>

          {parsedEmails.map((email, i) => (
            <div key={i} className="border border-[#262626] rounded-xl overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2 bg-[#111111]/50">
                <span className="text-white text-sm font-medium">
                  Step {email.stepNumber}{email.variant || ""} — {email.threadType === "new" ? "New Thread" : "Reply"}
                </span>
              </div>
              <div className="px-4 py-3 space-y-2">
                <div>
                  <span className="text-[#808080] text-xs">Subject:</span>
                  <p className="text-white text-sm">{email.subject}</p>
                </div>
                <div>
                  <span className="text-[#808080] text-xs">Body:</span>
                  <p className="text-[#B3B3B3] text-sm whitespace-pre-wrap">{email.body}</p>
                </div>
              </div>
            </div>
          ))}

          <div className="flex gap-3">
            <button onClick={() => setStep("paste-copy")} className="px-4 py-3 bg-[#0A0A0A] border border-[#262626] text-[#B3B3B3] font-medium rounded-lg hover:bg-[#262626] transition text-sm">Back</button>
            <button onClick={initSpintax}
              className="flex-1 bg-[#02E481] text-[#071018] font-semibold rounded-lg py-3 hover:bg-[#00c96e] transition">
              Add Spintax
            </button>
            <button onClick={() => { setUseSpintax(false); handleSpamCheck(); }}
              className="px-4 py-3 bg-[#0A0A0A] border border-[#262626] text-[#B3B3B3] font-medium rounded-lg hover:bg-[#262626] transition text-sm">
              Skip Spintax
            </button>
          </div>
        </div>
      )}

      {/* ========== SPINTAX (manual paste/validate) ========== */}
      {step === "spintax" && (
        <div className="space-y-4">
          <div className="bg-[#0A0A0A]/50 border border-[#262626]/50 rounded-xl p-4 space-y-3">
            <p className="text-[#808080] text-xs uppercase tracking-wider font-medium">Add Spintax</p>
            <p className="text-[#B3B3B3] text-sm">
              Copy the prompt below, paste it into Claude Code, then paste each email&apos;s output back here.{" "}
              Format: <code className="text-[#02E481] text-xs">{`{{RANDOM | original | var1 | var2 | var3}}`}</code>
            </p>
            <button
              onClick={() => {
                const prompt = buildClaudePrompt();
                navigator.clipboard.writeText(prompt).catch(() => {});
              }}
              className="w-full bg-[#02E481]/10 border border-[#02E481]/30 text-[#02E481] text-sm font-medium rounded-lg py-2.5 hover:bg-[#02E481]/20 transition">
              Copy Prompt for Claude Code
            </button>
          </div>

          {spintaxEmails.map((email, i) => {
            const key = `${email.stepNumber}-${email.variant ?? ""}`;
            const errors = spintaxErrors[key] ?? [];
            const hasContent = email.spintaxSubject !== email.subject || email.spintaxBody !== email.body;
            return (
              <div key={i} className="border border-[#262626] rounded-xl overflow-hidden">
                <div className="flex items-center justify-between px-4 py-2 bg-[#111111]/50">
                  <span className="text-white text-sm font-medium">
                    Step {email.stepNumber}{email.variant || ""} — {email.threadType === "new" ? "New Thread" : "Reply"}
                  </span>
                  {hasContent && errors.length === 0 && (
                    <span className="text-xs text-green-400">Valid</span>
                  )}
                  {errors.length > 0 && (
                    <span className="text-xs text-red-400">{errors.length} error{errors.length > 1 ? "s" : ""}</span>
                  )}
                </div>
                <div className="px-4 py-3 space-y-3">
                  <div>
                    <label className="text-[#808080] text-xs block mb-1">Subject</label>
                    <textarea
                      rows={2}
                      value={email.spintaxSubject}
                      onChange={(e) => {
                        const val = e.target.value;
                        setSpintaxEmails((prev) => prev.map((x, j) => j === i ? { ...x, spintaxSubject: val } : x));
                      }}
                      onBlur={() => validateSpintaxField(key, email.spintaxSubject, email.spintaxBody)}
                      className="w-full bg-[#0A0A0A] border border-[#262626] rounded-lg px-3 py-2 text-white text-sm font-mono placeholder:text-[#808080]/50 focus:outline-none focus:border-[#02E481] resize-y"
                    />
                  </div>
                  <div>
                    <label className="text-[#808080] text-xs block mb-1">Body</label>
                    <textarea
                      rows={6}
                      value={email.spintaxBody}
                      onChange={(e) => {
                        const val = e.target.value;
                        setSpintaxEmails((prev) => prev.map((x, j) => j === i ? { ...x, spintaxBody: val } : x));
                      }}
                      onBlur={() => validateSpintaxField(key, email.spintaxSubject, email.spintaxBody)}
                      className="w-full bg-[#0A0A0A] border border-[#262626] rounded-lg px-3 py-2 text-white text-sm font-mono placeholder:text-[#808080]/50 focus:outline-none focus:border-[#02E481] resize-y"
                    />
                  </div>
                  {errors.length > 0 && (
                    <ul className="text-red-400 text-xs space-y-0.5 pl-1">
                      {errors.map((e, ei) => <li key={ei}>• {e}</li>)}
                    </ul>
                  )}
                </div>
              </div>
            );
          })}

          <div className="flex gap-3">
            <button onClick={() => setStep("review-parsed")}
              className="px-4 py-3 bg-[#0A0A0A] border border-[#262626] text-[#B3B3B3] font-medium rounded-lg hover:bg-[#262626] transition text-sm">Back</button>
            <button onClick={() => { setUseSpintax(false); handleSpamCheck(); }}
              className="px-4 py-3 bg-[#0A0A0A] border border-[#262626] text-[#B3B3B3] font-medium rounded-lg hover:bg-[#262626] transition text-sm">
              Skip
            </button>
            <button onClick={() => { setUseSpintax(true); handleSpamCheck(); }}
              className="flex-1 bg-[#02E481] text-[#071018] font-semibold rounded-lg py-3 hover:bg-[#00c96e] transition">
              Use Spintax &amp; Check Spam
            </button>
          </div>
        </div>
      )}

      {/* ========== CHECKING SPAM ========== */}
      {step === "checking-spam" && <Spinner text="Checking for spam words..." />}

      {/* ========== REVIEW SPAM ========== */}
      {step === "review-spam" && (
        <div className="space-y-4">
          {(() => {
            const allSpamWords = [...new Set(spamResults.flatMap((r) => r.spamWords.map((w) => w.word)))];
            const overallScore = spamResults.some((r) => r.score === "poor") ? "poor" : spamResults.some((r) => r.score === "okay") ? "okay" : "great";
            return (
              <>
                <div className={`rounded-xl p-4 border ${overallScore === "great" ? "bg-green-500/10 border-green-500/20" : overallScore === "okay" ? "bg-amber-500/10 border-amber-500/20" : "bg-red-500/10 border-red-500/20"}`}>
                  <div className="flex items-center justify-between">
                    <p className={`text-sm font-medium ${overallScore === "great" ? "text-green-400" : overallScore === "okay" ? "text-amber-400" : "text-red-400"}`}>
                      Spam Score: {overallScore.toUpperCase()}
                    </p>
                    <span className="text-[#808080] text-xs">{allSpamWords.length} spam words found</span>
                  </div>
                  {allSpamWords.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {allSpamWords.map((w) => (
                        <span key={w} className="text-xs px-2 py-0.5 rounded bg-red-500/15 text-red-400">{w}</span>
                      ))}
                    </div>
                  )}
                </div>

                {allSpamWords.length > 0 && !spamFixed && (
                  <button onClick={handleSpamFix}
                    className="w-full bg-amber-500/20 border border-amber-500/30 text-amber-400 font-medium rounded-lg py-3 hover:bg-amber-500/30 transition text-sm">
                    Auto-Fix Spam Words (Cyrillic replacement)
                  </button>
                )}
                {spamFixed && (
                  <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-3">
                    <p className="text-green-400 text-sm">Spam words fixed with Unicode character replacements. Visually identical but bypasses spam filters.</p>
                  </div>
                )}
              </>
            );
          })()}

          <div className="flex gap-3">
            <button onClick={() => setStep(useSpintax ? "spintax" : "review-parsed")}
              className="px-4 py-3 bg-[#0A0A0A] border border-[#262626] text-[#B3B3B3] font-medium rounded-lg hover:bg-[#262626] transition text-sm">Back</button>
            <button onClick={() => { fetchAccounts(); setStep("configure"); }}
              className="flex-1 bg-[#02E481] text-[#071018] font-semibold rounded-lg py-3 hover:bg-[#00c96e] transition">
              Configure Campaign
            </button>
          </div>
        </div>
      )}

      {/* ========== CONFIGURE ========== */}
      {step === "configure" && (
        <div className="space-y-4">
          <div>
            <label className="text-[#B3B3B3] text-sm block mb-2">Campaign Name</label>
            <input type="text" value={campaignName} onChange={(e) => setCampaignName(e.target.value)}
              className="w-full bg-[#0A0A0A] border border-[#262626] rounded-lg px-4 py-3 text-white text-sm placeholder:text-[#808080] focus:outline-none focus:border-[#02E481]" />
          </div>

          <div>
            <label className="text-[#B3B3B3] text-sm block mb-2">Sender Accounts</label>
            {accountsLoading ? (
              <div className="flex items-center gap-2 py-3 px-4 bg-[#111111] border border-[#262626] rounded-lg">
                <div className="w-4 h-4 border-2 border-[#262626] border-t-[#02E481] rounded-full animate-spin" />
                <span className="text-[#808080] text-sm">Loading accounts...</span>
              </div>
            ) : senderAccounts.length > 0 ? (
              <div className="space-y-1 max-h-[200px] overflow-y-auto border border-[#262626] rounded-lg p-2">
                <button onClick={() => setSelectedSenders(selectedSenders.length === senderAccounts.length ? [] : senderAccounts.map((a) => a.email))}
                  className="text-xs text-[#808080] hover:text-[#02E481] transition mb-1">
                  {selectedSenders.length === senderAccounts.length ? "Deselect all" : "Select all"}
                </button>
                {senderAccounts.map((a) => (
                  <label key={a.id} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-[#262626]/30 cursor-pointer">
                    <input type="checkbox" checked={selectedSenders.includes(a.email)}
                      onChange={(e) => {
                        if (e.target.checked) setSelectedSenders([...selectedSenders, a.email]);
                        else setSelectedSenders(selectedSenders.filter((s) => s !== a.email));
                      }}
                      className="w-4 h-4 rounded border-[#262626] bg-[#111111] accent-white" />
                    <span className="text-[#B3B3B3] text-sm font-mono">{a.email}</span>
                  </label>
                ))}
              </div>
            ) : (
              <p className="text-[#808080] text-sm">No active sender accounts found. Campaign will be created without senders.</p>
            )}
            {selectedSenders.length > 0 && (
              <p className="text-[#808080] text-xs mt-1">{selectedSenders.length} sender(s) selected</p>
            )}
          </div>

          <div className="border border-[#262626] rounded-xl p-4 space-y-2">
            <p className="text-[#808080] text-xs uppercase tracking-wider font-medium">Defaults</p>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <Row label="Daily limit" value="1,000" />
              <Row label="Stop on reply" value="Yes" />
              <Row label="Tracking" value="Off" />
              <Row label="Schedule" value="Mon-Fri 8am-5pm EST" />
            </div>
          </div>

          <div className="flex gap-3">
            <button onClick={() => setStep("review-spam")}
              className="px-4 py-3 bg-[#0A0A0A] border border-[#262626] text-[#B3B3B3] font-medium rounded-lg hover:bg-[#262626] transition text-sm">Back</button>
            <button onClick={() => setStep("preview-final")} disabled={!campaignName.trim()}
              className="flex-1 bg-[#02E481] text-[#071018] font-semibold rounded-lg py-3 hover:bg-[#00c96e] transition disabled:opacity-30 disabled:cursor-not-allowed">
              Preview &amp; Create
            </button>
          </div>
        </div>
      )}

      {/* ========== PREVIEW FINAL ========== */}
      {step === "preview-final" && (
        <div className="space-y-4">
          <div className="bg-[#0A0A0A]/50 border border-amber-500/30 rounded-xl p-5 space-y-4">
            <p className="text-amber-400 text-sm font-medium uppercase tracking-wider">Confirm Campaign Creation</p>
            <div className="space-y-1.5 text-sm">
              <Row label="Client" value={selectedClientName} />
              <Row label="Campaign" value={campaignName} />
              <Row label="Emails" value={`${finalEmails.length} steps`} />
              <Row label="Spintax" value={useSpintax ? "Applied" : "Skipped"} />
              <Row label="Senders" value={selectedSenders.length > 0 ? `${selectedSenders.length} accounts` : "None (add later)"} />
            </div>
          </div>

          {finalEmails.map((email, i) => (
            <div key={i} className="border border-[#262626] rounded-xl overflow-hidden">
              <div className="px-4 py-2 bg-[#111111]/50">
                <span className="text-white text-sm font-medium">Step {email.stepNumber}{email.variant || ""} — {email.threadType === "new" ? "New Thread" : "Reply"}</span>
              </div>
              <div className="px-4 py-3 space-y-1">
                <p className="text-white text-sm"><span className="text-[#808080]">Subject:</span> {email.subject}</p>
                <p className="text-[#B3B3B3] text-xs whitespace-pre-wrap font-mono mt-1">{email.body}</p>
              </div>
            </div>
          ))}

          <div className="flex gap-3">
            <button onClick={() => setStep("configure")}
              className="px-4 py-3 bg-[#0A0A0A] border border-[#262626] text-[#B3B3B3] font-medium rounded-lg hover:bg-[#262626] transition text-sm">Back</button>
            <button onClick={handleCreateCampaign}
              className="flex-1 bg-[#02E481] text-[#071018] font-semibold rounded-lg py-3 hover:bg-[#00c96e] transition">
              Create Campaign on Instantly
            </button>
          </div>
        </div>
      )}

      {/* ========== CREATING ========== */}
      {step === "creating" && <Spinner text="Creating campaign on Instantly..." />}

      {/* ========== DONE ========== */}
      {step === "done" && result && (
        <div className="space-y-4">
          <div className="bg-[#0A0A0A]/50 border border-[#262626]/50 rounded-xl p-5 space-y-4">
            <div className="flex items-center gap-2">
              <span className="text-green-400 text-lg">&#10003;</span>
              <p className="text-white font-medium">Campaign created successfully</p>
            </div>
            <div className="space-y-2 text-sm">
              <Row label="Campaign" value={result.name} />
              <Row label="Steps" value={String(result.stepsCreated)} />
              <Row label="ID" value={result.id} />
            </div>
            <a href={result.url} target="_blank" rel="noopener noreferrer"
              className="block text-center text-sm text-blue-400 hover:text-blue-300 underline underline-offset-2">
              Open in Instantly &rarr;
            </a>
          </div>
          <button onClick={reset} className="w-full bg-[#0A0A0A] border border-[#262626] text-white font-medium rounded-lg py-3 hover:bg-[#262626] transition">
            Create Another
          </button>
        </div>
      )}

      {/* ========== ERROR ========== */}
      {(step === "error" || error) && (
        <div className="space-y-4">
          <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4">
            <p className="text-red-400 text-sm">{error}</p>
          </div>
          <button onClick={reset} className="w-full bg-[#0A0A0A] border border-[#262626] text-white font-medium rounded-lg py-3 hover:bg-[#262626] transition">
            Start Over
          </button>
        </div>
      )}
    </div>
  );
}
