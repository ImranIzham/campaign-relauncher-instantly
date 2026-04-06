import { NextRequest, NextResponse } from "next/server";
import { getClientApiKey } from "@/lib/sheets";
import { createCampaign, type CreateCampaignPayload, type CampaignSequenceStep } from "@/lib/instantly";

export const maxDuration = 60;

// Instantly campaign defaults (confirmed by Imran)
const DEFAULT_SCHEDULE = {
  timezone: "America/New_York",
  days: {
    sunday: false,
    monday: true,
    tuesday: true,
    wednesday: true,
    thursday: true,
    friday: true,
    saturday: false,
  },
  timing: { from: "08:00", to: "17:00" },
};

interface EmailStep {
  stepNumber: number;
  variant: string | null;
  threadType: "new" | "reply";
  subject: string;
  body: string;
}

export async function POST(req: NextRequest) {
  const pin = req.headers.get("x-pin");
  if (!pin || pin !== process.env.RELAUNCH_PIN) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const {
    clientId,
    campaignName,
    emails,
    senderEmails,
    schedule,
    dailyLimit = 1000,
    stopOnReply = true,
    stopOnAutoReply = false,
    linkTracking = false,
    openTracking = false,
  } = await req.json();

  if (!clientId) {
    return NextResponse.json({ error: "clientId is required" }, { status: 400 });
  }
  if (!campaignName) {
    return NextResponse.json({ error: "campaignName is required" }, { status: 400 });
  }
  if (!emails || !Array.isArray(emails) || emails.length === 0) {
    return NextResponse.json({ error: "emails array is required" }, { status: 400 });
  }

  try {
    const apiKey = await getClientApiKey(clientId);

    // Group emails by step number, collect variants
    const stepMap = new Map<number, EmailStep[]>();
    for (const email of emails as EmailStep[]) {
      const existing = stepMap.get(email.stepNumber) || [];
      existing.push(email);
      stepMap.set(email.stepNumber, existing);
    }

    // Build sequence steps in order
    const steps: CampaignSequenceStep[] = [];
    const sortedSteps = [...stepMap.entries()].sort(([a], [b]) => a - b);

    for (let i = 0; i < sortedSteps.length; i++) {
      const [, emailVariants] = sortedSteps[i];
      const primary = emailVariants[0];

      const step: CampaignSequenceStep = {
        subject: primary.subject,
        email_body: wrapHtml(primary.body),
        type: "email",
        wait: i === 0 ? 1 : getWaitDays(i),
      };

      // Add A/B variants if present
      if (emailVariants.length > 1) {
        step.variants = emailVariants.slice(1).map((v) => ({
          subject: v.subject,
          email_body: wrapHtml(v.body),
        }));
      }

      steps.push(step);
    }

    const payload: CreateCampaignPayload = {
      name: campaignName,
      campaign_schedule: schedule || DEFAULT_SCHEDULE,
      sequences: [{ steps }],
      daily_limit: dailyLimit,
      stop_on_reply: stopOnReply,
      stop_on_auto_reply: stopOnAutoReply,
      link_tracking: linkTracking,
      open_tracking: openTracking,
    };

    if (senderEmails && Array.isArray(senderEmails) && senderEmails.length > 0) {
      payload.email_list = senderEmails;
    }

    const campaign = await createCampaign(apiKey, payload);

    return NextResponse.json({
      id: campaign.id,
      name: campaign.name,
      status: campaign.status,
      stepsCreated: steps.length,
      variantsIncluded: steps.filter((s) => s.variants && s.variants.length > 0).length,
      url: `https://app.instantly.ai/app/campaign/${campaign.id}`,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Campaign creation failed" },
      { status: 500 }
    );
  }
}

function wrapHtml(text: string): string {
  return text
    .split("\n\n")
    .map((p) => `<div>${p.replace(/\n/g, "<br />")}</div>`)
    .join("<div><br /></div>");
}

function getWaitDays(stepIndex: number): number {
  // Default delays: step 2 = 3 days, step 3 = 2 days, step 4 = 3 days
  const defaults = [1, 3, 2, 3];
  return defaults[stepIndex] ?? 2;
}
