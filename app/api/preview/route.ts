import { NextRequest, NextResponse } from "next/server";
import { getClientApiKey } from "@/lib/supabase";
import {
  getCampaign,
  getCampaignLeads,
  getCampaignReplies,
  getCampaignSequence,
  getSentEmails,
  buildLastSentMap,
} from "@/lib/instantly";
import { extractVariables, validateLeadVariables } from "@/lib/variables";

export async function GET(request: NextRequest) {
  const pin = request.headers.get("x-pin")?.trim();
  if (!pin || pin !== (process.env.RELAUNCH_PIN ?? "").trim()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const id = request.nextUrl.searchParams.get("id");
  const clientId = request.nextUrl.searchParams.get("clientId");
  const includeReplied =
    request.nextUrl.searchParams.get("includeReplied") === "true";
  const minDaysSinceContact = request.nextUrl.searchParams.get(
    "minDaysSinceContact"
  );

  if (!id) {
    return NextResponse.json(
      { error: "Missing campaign ID" },
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

    const [campaign, leads, replies, sequenceSteps] = await Promise.all([
      getCampaign(apiKey, id),
      getCampaignLeads(apiKey, id),
      getCampaignReplies(apiKey, id),
      getCampaignSequence(apiKey, id).catch(() => []),
    ]);

    // Build set of emails that replied (Instantly uses email addresses, not lead IDs)
    const repliedEmails = new Set(replies.map((r) => r.lead_email));

    // Filter pipeline: reply filter -> date filter
    let filteredLeads = includeReplied
      ? leads
      : leads.filter((l) => !repliedEmails.has(l.email));

    // Date filter using sent emails
    let dateFilteredCount = 0;
    if (minDaysSinceContact && Number(minDaysSinceContact) > 0) {
      const minDays = Number(minDaysSinceContact);
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - minDays);

      const sentEmails = await getSentEmails(apiKey, id);
      const lastSentMap = buildLastSentMap(sentEmails);

      const beforeCount = filteredLeads.length;
      filteredLeads = filteredLeads.filter((l) => {
        const lastSent = lastSentMap.get(l.email);
        if (!lastSent) return true; // never sent -> include
        return lastSent <= cutoffDate;
      });
      dateFilteredCount = beforeCount - filteredLeads.length;
    }

    // Variable validation
    const variablesUsed = extractVariables(sequenceSteps);
    let leadsWithMissingVars = 0;
    const missingVarBreakdown: Record<string, number> = {};

    const leadsData = filteredLeads.map((lead) => {
      const missingVars =
        variablesUsed.length > 0
          ? validateLeadVariables(lead, variablesUsed)
          : [];

      if (missingVars.length > 0) {
        leadsWithMissingVars++;
        for (const varName of missingVars) {
          missingVarBreakdown[varName] =
            (missingVarBreakdown[varName] || 0) + 1;
        }
      }

      // Extract custom fields
      const {
        id: leadId,
        email,
        first_name,
        last_name,
        company_name,
        campaign_id,
        created_at,
        updated_at,
        status,
        ...allExtra
      } = lead as Record<string, unknown>;

      const customFields: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(allExtra)) {
        if (
          value !== null &&
          value !== undefined &&
          typeof value !== "object"
        ) {
          customFields[key] = value;
        }
      }

      return {
        id: leadId ?? email, // Use email as fallback ID
        email,
        firstName: (first_name as string) || "",
        lastName: (last_name as string) || "",
        company: (company_name as string) || "",
        missingVars,
        customFields,
      };
    });

    return NextResponse.json({
      clientId,
      campaign: {
        id: campaign.id,
        name: campaign.name,
        status: campaign.status,
      },
      totalLeads: leads.length,
      totalReplied: repliedEmails.size,
      leadsToRelaunch: filteredLeads.length,
      dateFilteredCount,
      variablesUsed,
      leadsWithMissingVars,
      missingVarBreakdown,
      leads: leadsData,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    const status = message.includes("404") ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
