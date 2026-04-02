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
import { startVerification, recheckVerification } from "@/lib/email-validator";

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

  // Stream validation results via SSE
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        const BATCH_SIZE = 5;
        const pendingEmails: { leadEmail: string; email: string }[] = [];

        // Preflight: verify API key works
        try {
          const preflight = await startVerification(
            emailsToValidate[0].email
          );
          if (preflight.status === "unknown") {
            const errorEvent = `data: ${JSON.stringify({
              type: "error",
              message:
                "Instantly API key may be invalid — first email returned unknown.",
            })}\n\n`;
            controller.enqueue(encoder.encode(errorEvent));
            for (const { leadEmail, email } of emailsToValidate) {
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({ leadEmail, email, status: "unknown" })}\n\n`
                )
              );
            }
            return;
          }
          if (preflight.status === "pending") {
            pendingEmails.push(emailsToValidate[0]);
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
              `data: ${JSON.stringify({ type: "error", message: `API key check failed: ${msg}` })}\n\n`
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

        // Pass 1: Fire remaining verification POSTs
        const remaining = emailsToValidate.slice(1);
        for (let i = 0; i < remaining.length; i += BATCH_SIZE) {
          const batch = remaining.slice(i, i + BATCH_SIZE);
          const results = await Promise.all(
            batch.map(async ({ leadEmail, email }) => {
              try {
                const result = await startVerification(email);
                return { leadEmail, email, status: result.status };
              } catch {
                return { leadEmail, email, status: "unknown" as const };
              }
            })
          );

          for (const result of results) {
            if (result.status === "pending") {
              pendingEmails.push({
                leadEmail: result.leadEmail,
                email: result.email,
              });
            }
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify(result)}\n\n`)
            );
          }
        }

        // Pass 2: Resolve pending emails
        if (pendingEmails.length > 0) {
          const RETRY_BATCH_SIZE = 10;
          const MAX_ROUNDS = 8;
          const INITIAL_WAIT_MS = 15000;
          const RETRY_WAIT_MS = 8000;

          let stillPending = [...pendingEmails];
          await new Promise((r) => setTimeout(r, INITIAL_WAIT_MS));

          for (
            let round = 0;
            round < MAX_ROUNDS && stillPending.length > 0;
            round++
          ) {
            const nextPending: { leadEmail: string; email: string }[] = [];

            for (let i = 0; i < stillPending.length; i += RETRY_BATCH_SIZE) {
              const batch = stillPending.slice(i, i + RETRY_BATCH_SIZE);
              const results = await Promise.all(
                batch.map(async ({ leadEmail, email }) => {
                  try {
                    const result = await recheckVerification(email);
                    return { leadEmail, email, status: result.status };
                  } catch {
                    return { leadEmail, email, status: "unknown" as const };
                  }
                })
              );

              for (const result of results) {
                if (result.status === "pending") {
                  nextPending.push({
                    leadEmail: result.leadEmail,
                    email: result.email,
                  });
                } else {
                  controller.enqueue(
                    encoder.encode(`data: ${JSON.stringify(result)}\n\n`)
                  );
                }
              }
            }

            stillPending = nextPending;

            if (stillPending.length > 0 && round < MAX_ROUNDS - 1) {
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({
                    type: "progress",
                    round: round + 1,
                    maxRounds: MAX_ROUNDS,
                    stillPending: stillPending.length,
                  })}\n\n`
                )
              );
              await new Promise((r) => setTimeout(r, RETRY_WAIT_MS));
            }
          }

          // Still pending after all rounds -> unknown
          for (const { leadEmail, email } of stillPending) {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ leadEmail, email, status: "unknown" })}\n\n`
              )
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
