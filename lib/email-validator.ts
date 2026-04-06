const BOUNCEBAN_BASE_URL = "https://api.bounceban.com/v1";

export type VerificationStatus = "valid" | "invalid" | "risky" | "catch-all" | "unknown";

interface BounceBanResponse {
  email: string;
  result: "deliverable" | "undeliverable" | "risky" | string;
  status: "success" | string;
  is_accept_all: boolean;
  is_disposable: boolean;
  is_free: boolean;
  is_role: boolean;
  score: number;
  smtp_provider?: string;
  mx_records?: string[];
  credits_consumed?: number;
  credits_remaining?: number;
}

export interface EmailValidationResult {
  email: string;
  status: VerificationStatus;
}

function getApiKey(): string {
  const key = process.env.BOUNCEBAN_API_KEY;
  if (!key) {
    throw new Error("BOUNCEBAN_API_KEY is not configured");
  }
  return key;
}

function mapStatus(data: BounceBanResponse): VerificationStatus {
  if (data.status !== "success") return "unknown";
  if (data.result === "deliverable") {
    return data.is_accept_all ? "catch-all" : "valid";
  }
  if (data.result === "undeliverable") return "invalid";
  if (data.result === "risky") return "risky";
  return "unknown";
}

export async function verifyEmail(email: string): Promise<EmailValidationResult> {
  const apiKey = getApiKey();

  const res = await fetch(
    `${BOUNCEBAN_BASE_URL}/verify/single?email=${encodeURIComponent(email)}`,
    {
      headers: { Authorization: apiKey },
    }
  );

  const text = await res.text();

  if (!res.ok) {
    console.error(`BounceBan verification failed for ${email}: ${res.status} ${text}`);
    return { email, status: "unknown" };
  }

  let data: BounceBanResponse;
  try {
    data = JSON.parse(text);
  } catch {
    console.error(`BounceBan returned non-JSON for ${email}: ${text.slice(0, 500)}`);
    return { email, status: "unknown" };
  }

  return { email, status: mapStatus(data) };
}

// Alias kept for backwards compatibility with validate-emails/route.ts
export const validateEmail = verifyEmail;
