import { NextRequest, NextResponse } from "next/server";
import { listClients, addClient } from "@/lib/supabase";

function checkPin(request: NextRequest): boolean {
  const pin = request.headers.get("x-pin")?.trim();
  return !!pin && pin === (process.env.RELAUNCH_PIN ?? "").trim();
}

export async function GET(request: NextRequest) {
  if (!checkPin(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const clients = await listClients();
    return NextResponse.json({ clients });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  if (!checkPin(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { name?: string; apiKey?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { name, apiKey } = body;
  if (!name || !apiKey) {
    return NextResponse.json(
      { error: "Both name and apiKey are required" },
      { status: 400 }
    );
  }

  try {
    // Validate the API key by making a test call to Instantly
    const testRes = await fetch(
      "https://api.instantly.ai/api/v2/campaigns?limit=1",
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
      }
    );

    if (!testRes.ok) {
      return NextResponse.json(
        { error: "Invalid Instantly API key — test call failed" },
        { status: 400 }
      );
    }

    const client = await addClient(name.trim(), apiKey.trim());
    return NextResponse.json({ client }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
