const INSTANTLY_BASE_URL = "https://api.instantly.ai/api/v2";

export type VerificationStatus = "valid" | "invalid" | "risky" | "catch-all" | "unknown" | "pending";

interface InstantlyResponse {
  verification_status: "valid" | "verified" | "invalid" | "risky" | "pending";
  catch_all?: boolean;
}

export interface EmailValidationResult {
  email: string;
  status: VerificationStatus;
}

function getApiKey(): string {
  const key = process.env.INSTANTLY_API_KEY;
  if (!key) {
    console.error("INSTANTLY_API_KEY is not set in environment variables");
    throw new Error("INSTANTLY_API_KEY is not configured");
  }
  return key;
}

/**
 * POST to start verification — returns immediately, no retries for pending.
 */
export async function startVerification(email: string): Promise<EmailValidationResult> {
  const apiKey = getApiKey();

  const res = await fetch(`${INSTANTLY_BASE_URL}/email-verification`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email }),
  });

  const text = await res.text();

  if (!res.ok) {
    console.error(`Instantly verification POST failed for ${email}: ${res.status} ${text}`);
    return { email, status: "unknown" };
  }

  let data: InstantlyResponse;
  try {
    data = JSON.parse(text);
  } catch {
    console.error(`Instantly POST returned non-JSON for ${email}: ${text.slice(0, 500)}`);
    return { email, status: "unknown" };
  }

  return { email, status: mapStatus(data) };
}

/**
 * GET to check a pending verification's current status.
 */
export async function checkVerification(email: string): Promise<EmailValidationResult> {
  const apiKey = getApiKey();

  const res = await fetch(
    `${INSTANTLY_BASE_URL}/email-verification/${encodeURIComponent(email)}`,
    {
      headers: { Authorization: `Bearer ${apiKey}` },
    }
  );

  const text = await res.text();

  if (!res.ok) {
    console.error(`Instantly verification GET failed for ${email}: ${res.status} ${text}`);
    return { email, status: "unknown" };
  }

  let data: InstantlyResponse;
  try {
    data = JSON.parse(text);
  } catch {
    console.error(`Instantly GET returned non-JSON for ${email}: ${text.slice(0, 500)}`);
    return { email, status: "unknown" };
  }

  return { email, status: mapStatus(data) };
}

/**
 * Re-POST to check a pending verification. Instantly returns cached results
 * for already-verified emails, making this more reliable than GET for retries.
 */
export async function recheckVerification(email: string): Promise<EmailValidationResult> {
  return startVerification(email);
}

function mapStatus(data: InstantlyResponse): VerificationStatus {
  if (data.verification_status === "pending") return "pending";
  const isValid = data.verification_status === "valid" || data.verification_status === "verified";
  if (isValid && data.catch_all) return "catch-all";
  if (isValid) return "valid";
  if (data.verification_status === "invalid") return "invalid";
  if (data.verification_status === "risky") return "risky";
  return "unknown";
}

/**
 * Validate a single email with inline retries.
 */
export async function validateEmail(email: string): Promise<EmailValidationResult> {
  const result = await startVerification(email);
  if (result.status !== "pending") return result;

  // Retry twice with 3s gaps
  for (let i = 0; i < 2; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const check = await checkVerification(email);
    if (check.status !== "pending") return check;
  }

  return { email, status: "unknown" };
}
