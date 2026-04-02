import { NextRequest, NextResponse } from "next/server";
import { getClientApiKey } from "@/lib/sheets";
import {
  getCampaignLeads,
  getCampaignReplies,
  getCampaignSequence,
  getSentEmails,
  buildLastSentMap,
} from "@/lib/instantly";
import { extractVariables, validateLeadVariables } from "@/lib/variables";
import { validateEmail } from "@/lib/email-validator";

export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const pin = request.headers.get("x-pin")?.trim();
  if (!pin || pin !== (process.env.RELAUNCH_PIN ?? "").trim()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: {
    campaignId: string;
    clientId: string;
    includeReplied?: boolean;
    minDaysSinceContact?: number;
    excludeMissingVars?: boolean;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.campaignId || !body.clientId) {
    return NextResponse.json(
      { error: "Missing campaignId or clientId" },
      { status: 400 }
    );
  }

  try {
    const apiKey = await getClientApiKey(body.clientId);

    const [leads, replies] = await Promise.all([
      getCampaignLeads(apiKey, body.campaignId),
      getCampaignReplies(apiKey, body.campaignId),
    ]);

    const repliedEmails = new Set(replies.map((r) => r.lead_email));

    let filteredLeads = body.includeReplied
      ? leads
      : leads.filter((l) => !repliedEmails.has(l.email));

    // Date filter
    if (body.minDaysSinceContact && body.minDaysSinceContact > 0) {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - body.minDaysSinceContact);

      const sentEmails = await getSentEmails(apiKey, body.campaignId);
      const lastSentMap = buildLastSentMap(sentEmails);

      filteredLeads = filteredLeads.filter((l) => {
        const lastSent = lastSentMap.get(l.email);
        if (!lastSent) return true;
        return lastSent <= cutoffDate;
      });
    }

    // Variable filter
    if (body.excludeMissingVars) {
      const steps = await getCampaignSequence(apiKey, body.campaignId);
      const variables = extractVariables(steps);

      if (variables.length > 0) {
        filteredLeads = filteredLeads.filter(
          (l) => validateLeadVariables(l, variables).length === 0
        );
      }
    }

    // Validate emails
    const emailsToValidate = filteredLeads.map((l) => ({
      leadEmail: l.email,
      email: l.email,
    }));

    const CONCURRENCY = 5;
    const results: { leadEmail: string; email: string; status: string }[] = [];
    for (let i = 0; i < emailsToValidate.length; i += CONCURRENCY) {
      const batch = emailsToValidate.slice(i, i + CONCURRENCY);
      const batchResults = await Promise.all(
        batch.map(async ({ leadEmail, email }) => {
          const result = await validateEmail(email);
          return { leadEmail, email, status: result.status };
        })
      );
      results.push(...batchResults);
    }

    return NextResponse.json({ results });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
