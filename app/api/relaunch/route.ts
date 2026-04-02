import { NextRequest, NextResponse } from "next/server";
import { getClientApiKey } from "@/lib/sheets";
import {
  getCampaign,
  getCampaignLeads,
  getCampaignReplies,
  getSentEmails,
  buildLastSentMap,
  duplicateCampaign,
  addLeadsToCampaign,
} from "@/lib/instantly";

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const pin = request.headers.get("x-pin")?.trim();
  if (!pin || pin !== (process.env.RELAUNCH_PIN ?? "").trim()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: {
    campaignId?: string;
    clientId?: string;
    includeReplied?: boolean;
    minDaysSinceContact?: number;
    excludeMissingVars?: boolean;
    excludeLeadEmails?: string[];
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { campaignId, clientId } = body;
  if (!campaignId) {
    return NextResponse.json(
      { error: "Missing campaignId" },
      { status: 400 }
    );
  }
  if (!clientId) {
    return NextResponse.json(
      { error: "Missing clientId" },
      { status: 400 }
    );
  }

  try {
    const apiKey = await getClientApiKey(clientId);

    // Step 1: Get campaign details
    const campaign = await getCampaign(apiKey, campaignId);

    // Step 2: Get all leads and replies in parallel
    const [leads, replies] = await Promise.all([
      getCampaignLeads(apiKey, campaignId),
      getCampaignReplies(apiKey, campaignId),
    ]);

    // Filter pipeline: reply filter -> date filter -> variable filter -> exclude list
    const repliedEmails = new Set(replies.map((r) => r.lead_email));

    let filteredLeads = body.includeReplied
      ? leads
      : leads.filter((l) => !repliedEmails.has(l.email));

    // Date filter using sent emails
    if (body.minDaysSinceContact && body.minDaysSinceContact > 0) {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - body.minDaysSinceContact);

      const sentEmails = await getSentEmails(apiKey, campaignId);
      const lastSentMap = buildLastSentMap(sentEmails);

      filteredLeads = filteredLeads.filter((l) => {
        const lastSent = lastSentMap.get(l.email);
        if (!lastSent) return true;
        return lastSent <= cutoffDate;
      });
    }

    // Variable validation filter
    if (body.excludeMissingVars) {
      const { getCampaignSequence } = await import("@/lib/instantly");
      const { extractVariables, validateLeadVariables } = await import(
        "@/lib/variables"
      );

      const steps = await getCampaignSequence(apiKey, campaignId);
      const variables = extractVariables(steps);

      if (variables.length > 0) {
        filteredLeads = filteredLeads.filter(
          (l) => validateLeadVariables(l, variables).length === 0
        );
      }
    }

    // Exclude list (from email validation on frontend) — uses emails, not IDs
    if (body.excludeLeadEmails && body.excludeLeadEmails.length > 0) {
      const excludeSet = new Set(body.excludeLeadEmails);
      filteredLeads = filteredLeads.filter((l) => !excludeSet.has(l.email));
    }

    if (filteredLeads.length === 0) {
      return NextResponse.json({
        originalCampaign: campaign.name,
        originalId: campaign.id,
        newCampaignId: null,
        totalLeads: leads.length,
        totalReplied: repliedEmails.size,
        leadsRelaunched: 0,
        message: "No leads to relaunch after applying filters",
      });
    }

    // Duplicate campaign
    const newCampaign = await duplicateCampaign(apiKey, campaignId);

    // Attach filtered leads to new campaign (full lead objects)
    const { attached, failed } = await addLeadsToCampaign(
      apiKey,
      newCampaign.id,
      filteredLeads
    );

    return NextResponse.json({
      originalCampaign: campaign.name,
      originalId: campaign.id,
      newCampaignId: newCampaign.id,
      newCampaignName: newCampaign.name,
      totalLeads: leads.length,
      totalReplied: repliedEmails.size,
      leadsRelaunched: attached,
      leadsFailed: failed,
      message:
        failed > 0
          ? `Relaunch complete with ${failed} lead(s) that failed to attach. New campaign ID: ${newCampaign.id}`
          : "Relaunch complete",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";

    if (message.includes("attach") || message.includes("leads/add")) {
      return NextResponse.json(
        {
          error: message,
          hint: "The campaign may have been duplicated. Check Instantly for the new campaign.",
        },
        { status: 500 }
      );
    }

    const status = message.includes("404") ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
