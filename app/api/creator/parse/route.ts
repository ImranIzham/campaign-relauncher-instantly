import { NextRequest, NextResponse } from "next/server";
import { parseCopy } from "@/lib/creator/parser";

export async function POST(req: NextRequest) {
  const pin = req.headers.get("x-pin");
  if (!pin || pin !== process.env.RELAUNCH_PIN) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { rawText } = await req.json();
  if (!rawText || typeof rawText !== "string") {
    return NextResponse.json({ error: "rawText is required" }, { status: 400 });
  }

  try {
    const parsed = parseCopy(rawText);
    if (parsed.emails.length === 0) {
      return NextResponse.json(
        { error: "Could not detect any emails in the pasted copy. Make sure each email starts with a header like 'Email 1 (New Thread)' or 'Step 1'." },
        { status: 400 }
      );
    }
    return NextResponse.json(parsed);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Parse failed" },
      { status: 500 }
    );
  }
}
