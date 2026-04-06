import { NextRequest, NextResponse } from "next/server";
import { checkSpam } from "@/lib/creator/spam-checker";

export async function POST(req: NextRequest) {
  const pin = req.headers.get("x-pin");
  if (!pin || pin !== process.env.RELAUNCH_PIN) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { emails } = await req.json();
  if (!emails || !Array.isArray(emails)) {
    return NextResponse.json({ error: "emails array is required" }, { status: 400 });
  }

  const results = emails.map((email: { stepNumber: number; variant: string | null; subject: string; body: string }) => {
    const fullText = `${email.subject}\n${email.body}`;
    const result = checkSpam(fullText);
    return {
      stepNumber: email.stepNumber,
      variant: email.variant,
      ...result,
    };
  });

  const overallScore = results.some((r: { score: string }) => r.score === "poor")
    ? "poor"
    : results.some((r: { score: string }) => r.score === "okay")
      ? "okay"
      : "great";

  return NextResponse.json({ overallScore, emails: results });
}
