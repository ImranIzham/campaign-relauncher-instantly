import { NextRequest, NextResponse } from "next/server";
import { getClientApiKey } from "@/lib/sheets";
import { listAccounts } from "@/lib/instantly";

export async function GET(req: NextRequest) {
  const pin = req.headers.get("x-pin");
  if (!pin || pin !== process.env.RELAUNCH_PIN) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const clientId = req.nextUrl.searchParams.get("clientId");
  if (!clientId) {
    return NextResponse.json({ error: "clientId is required" }, { status: 400 });
  }

  try {
    const apiKey = await getClientApiKey(clientId);
    const accounts = await listAccounts(apiKey);

    // Return only active accounts with essential fields
    const senders = accounts
      .filter((a) => a.status === "active" || a.status === "running")
      .map((a) => ({
        id: a.id,
        email: a.email,
        status: a.status,
      }));

    return NextResponse.json({ accounts: senders });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to list accounts" },
      { status: 500 }
    );
  }
}
