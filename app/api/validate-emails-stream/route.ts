import { NextRequest } from "next/server";
import { getClientApiKey } from "@/lib/sheets";
import {
  getCampaignLeads,
  getCampaignReplies,
  getCampaignSequence,
  getSentEmails,
  buildLastSentMap,
} from "@/lib/instantly";
import { extractVariables, validateLeadVariables } from "@/lib/variables";
import { verifyEmail } from "@/lib/email-validator";

export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const pin = request.headers.get("x-pin")?.trim();
  if (!pin || pin !== (process.env.RELAUNCH_PIN ?? "").trim()) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  let body: {
    campaignId: string;
    clientId: string;
    includeReplied?: boolean;
    minDaysSinceContact?: number;
    excludeMissingVars?: boolean;
    leadEmails?: string[];
  };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!body.campaignId || !body.clientId) {
    return new Response(
      JSON.stringify({ error: "Missing campaignId or clientId" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  // Fetch and filter leads before starting the stream
  let emailsToValidate: { leadEmail: string; email: string }[];

  if (body.leadEmails && body.leadEmails.length > 0) {
    // Fast path: frontend already computed the filtered list — zero Instantly API calls
    emailsToValidate = body.leadEmails.map((email) => ({ leadEmail: email, email }));
  } else if (Array.isArray(body.leadEmails) && body.leadEmails.length === 0) {
    return new Response("data: [DONE]\n\n", {
      headers: { "Content-Type": "text/event-stream" },
    });
  } else {
    // Fallback: re-derive from Instantly (should not be hit in normal flow)
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

      if (body.excludeMissingVars) {
        const steps = await getCampaignSequence(apiKey, body.campaignId);
        const variables = extractVariables(steps);

        if (variables.length > 0) {
          filteredLeads = filteredLeads.filter(
            (l) => validateLeadVariables(l, variables).length === 0
          );
        }
      }

      emailsToValidate = filteredLeads.map((l) => ({
        leadEmail: l.email,
        email: l.email,
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return new Response(JSON.stringify({ error: message }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  // Stream validation results via SSE
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        const BATCH_SIZE = 5;

        // Preflight: verify API key works with first email
        try {
          const preflight = await verifyEmail(emailsToValidate[0].email);
          if (preflight.status === "unknown") {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({
                  type: "error",
                  message: "BounceBan API key may be invalid — first email returned unknown.",
                })}\n\n`
              )
            );
            for (const { leadEmail, email } of emailsToValidate) {
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({ leadEmail, email, status: "unknown" })}\n\n`
                )
              );
            }
            return;
          }
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                leadEmail: emailsToValidate[0].leadEmail,
                email: emailsToValidate[0].email,
                status: preflight.status,
              })}\n\n`
            )
          );
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Unknown error";
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ type: "error", message: `BounceBan API check failed: ${msg}` })}\n\n`
            )
          );
          for (const { leadEmail, email } of emailsToValidate) {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ leadEmail, email, status: "unknown" })}\n\n`
              )
            );
          }
          return;
        }

        // Single pass: verify remaining emails in batches
        const remaining = emailsToValidate.slice(1);
        for (let i = 0; i < remaining.length; i += BATCH_SIZE) {
          const batch = remaining.slice(i, i + BATCH_SIZE);
          const results = await Promise.all(
            batch.map(async ({ leadEmail, email }) => {
              try {
                const result = await verifyEmail(email);
                return { leadEmail, email, status: result.status };
              } catch {
                return { leadEmail, email, status: "unknown" as const };
              }
            })
          );

          for (const result of results) {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify(result)}\n\n`)
            );
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Stream error";
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ type: "error", message: msg })}\n\n`
          )
        );
      } finally {
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
