import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const pin = String(body.pin ?? "").trim();
  const expected = (process.env.RELAUNCH_PIN ?? "").trim();

  if (!expected) {
    return NextResponse.json(
      { error: "Server misconfigured" },
      { status: 500 }
    );
  }

  if (pin !== expected) {
    return NextResponse.json({ error: "Invalid PIN" }, { status: 401 });
  }

  return NextResponse.json({ ok: true });
}
