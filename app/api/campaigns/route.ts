import { NextRequest, NextResponse } from "next/server";
import { getClientApiKey } from "@/lib/sheets";
import { listCampaigns } from "@/lib/instantly";

function checkPin(request: NextRequest): boolean {
  const pin = request.headers.get("x-pin")?.trim();
  return !!pin && pin === (process.env.RELAUNCH_PIN ?? "").trim();
}

export async function GET(request: NextRequest) {
  if (!checkPin(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const clientId = request.nextUrl.searchParams.get("clientId");
  if (!clientId) {
    return NextResponse.json(
      { error: "clientId is required" },
      { status: 400 }
    );
  }

  try {
    const apiKey = await getClientApiKey(clientId);
    const campaigns = await listCampaigns(apiKey);

    // Return only id, name, status — never expose the API key
    return NextResponse.json({
      campaigns: campaigns.map((c) => ({
        id: c.id,
        name: c.name,
        status: c.status,
      })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
