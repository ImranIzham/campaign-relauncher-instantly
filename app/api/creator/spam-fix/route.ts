import { NextRequest, NextResponse } from "next/server";
import { fixSpam } from "@/lib/creator/spam-fixer";

export async function POST(req: NextRequest) {
  const pin = req.headers.get("x-pin");
  if (!pin || pin !== process.env.RELAUNCH_PIN) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { emails, spamWords } = await req.json();
  if (!emails || !Array.isArray(emails)) {
    return NextResponse.json({ error: "emails array is required" }, { status: 400 });
  }
  if (!spamWords || !Array.isArray(spamWords)) {
    return NextResponse.json({ error: "spamWords array is required" }, { status: 400 });
  }

  const results = emails.map((email: { stepNumber: number; variant: string | null; subject: string; body: string }) => {
    const fixedSubject = fixSpam(email.subject, spamWords);
    const fixedBody = fixSpam(email.body, spamWords);
    return {
      stepNumber: email.stepNumber,
      variant: email.variant,
      subject: fixedSubject.fixedText,
      body: fixedBody.fixedText,
      changes: [...fixedSubject.changes, ...fixedBody.changes],
      wordsFixed: fixedSubject.wordsFixed + fixedBody.wordsFixed,
    };
  });

  return NextResponse.json({ emails: results });
}
