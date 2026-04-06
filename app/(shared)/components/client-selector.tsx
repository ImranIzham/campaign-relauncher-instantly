"use client";

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "./auth-gate";

export interface ClientOption {
  id: string;
  name: string;
  created_at: string;
}

interface ClientSelectorProps {
  onClientSelect: (clientId: string, clientName: string) => void;
  selectedClientId?: string;
}

export function ClientSelector({ onClientSelect, selectedClientId: initialClientId }: ClientSelectorProps) {
  const { pin } = useAuth();
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [selectedClientId, setSelectedClientId] = useState(initialClientId ?? "");
  const [showAddClient, setShowAddClient] = useState(false);
  const [newClientName, setNewClientName] = useState("");
  const [newClientApiKey, setNewClientApiKey] = useState("");
  const [clientLoading, setClientLoading] = useState(false);
  const [clientError, setClientError] = useState("");

  const fetchClients = useCallback(async () => {
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
  }, [pin]);

  useEffect(() => {
    fetchClients();
  }, [fetchClients]);

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

  const selectedClientName = clients.find((c) => c.id === selectedClientId)?.name ?? "";

  return (
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
        onClick={() => onClientSelect(selectedClientId, selectedClientName)}
        disabled={!selectedClientId}
        className="w-full bg-[#02E481] text-[#071018] font-semibold rounded-lg py-3 hover:bg-[#00c96e] transition disabled:opacity-30 disabled:cursor-not-allowed"
      >
        Continue with {selectedClientName || "client"}
      </button>
    </div>
  );
}
