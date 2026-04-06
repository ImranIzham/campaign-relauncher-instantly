"use client";

import { useState, useEffect, createContext, useContext } from "react";

interface AuthContextType {
  pin: string;
  authenticated: boolean;
}

const AuthContext = createContext<AuthContextType>({ pin: "", authenticated: false });

export function useAuth() {
  return useContext(AuthContext);
}

export function AuthGate({ children }: { children: React.ReactNode }) {
  const [pin, setPin] = useState(() => {
    if (typeof window !== "undefined") return sessionStorage.getItem("relauncher_pin") ?? "";
    return "";
  });
  const [authenticated, setAuthenticated] = useState(() => {
    if (typeof window !== "undefined") return sessionStorage.getItem("relauncher_auth") === "1";
    return false;
  });
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

  if (!authenticated) {
    return (
      <div className="min-h-screen bg-[#181819] flex items-center justify-center p-4">
        <form
          onSubmit={handleAuth}
          className="bg-[#1C1E21] border border-[#262626] rounded-2xl p-8 w-full max-w-sm"
        >
          <div className="text-center mb-6">
            <img src="/logo.png" alt="Understory" className="h-8 mx-auto" />
            <p className="text-[#808080] text-sm mt-2">
              Campaign Tools
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

  return (
    <AuthContext.Provider value={{ pin, authenticated }}>
      {children}
    </AuthContext.Provider>
  );
}
