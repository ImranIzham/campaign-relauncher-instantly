import { NextRequest, NextResponse } from "next/server";
import { validateSpintax } from "@/lib/creator/spintax";

/**
 * Spintax validator — accepts pre-written spintax (generated externally, e.g. via Claude Code)
 * and validates the format. No AI API calls.
 */
export async function POST(req: NextRequest) {
  const pin = req.headers.get("x-pin");
  if (!pin || pin !== process.env.RELAUNCH_PIN) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { emails } = await req.json();
  if (!emails || !Array.isArray(emails)) {
    return NextResponse.json({ error: "emails array is required" }, { status: 400 });
  }

  const results = emails.map((email: {
    stepNumber: number;
    variant: string | null;
    subject: string;
    body: string;
  }) => {
    const subjectValidation = validateSpintax(email.subject);
    const bodyValidation = validateSpintax(email.body);
    const errors = [...subjectValidation.errors, ...bodyValidation.errors];

    return {
      stepNumber: email.stepNumber,
      variant: email.variant,
      subject: email.subject,
      body: email.body,
      valid: errors.length === 0,
      errors,
    };
  });

  const allValid = results.every((r: { valid: boolean }) => r.valid);
  return NextResponse.json({ emails: results, allValid });
}
