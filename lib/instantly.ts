const BASE_URL = "https://api.instantly.ai/api/v2";

async function instantlyFetch(
  apiKey: string,
  endpoint: string,
  options?: RequestInit
): Promise<Response> {
  const url = `${BASE_URL}${endpoint}`;
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    ...options?.headers,
  };

  const res = await fetch(url, { ...options, headers });

  if (res.status === 429) {
    // Rate limited — wait and retry once
    await new Promise((r) => setTimeout(r, 2000));
    return fetch(url, { ...options, headers });
  }

  return res;
}

/** Cursor-based pagination helper for Instantly v2 API */
async function fetchAllPaginated<T>(
  apiKey: string,
  endpoint: string,
  method: "GET" | "POST" = "GET",
  body?: Record<string, unknown>
): Promise<T[]> {
  const allItems: T[] = [];
  let startingAfter: string | undefined;

  while (true) {
    let res: Response;

    if (method === "POST") {
      res = await instantlyFetch(apiKey, endpoint, {
        method: "POST",
        body: JSON.stringify({
          ...body,
          limit: 100,
          ...(startingAfter ? { starting_after: startingAfter } : {}),
        }),
      });
    } else {
      const params = new URLSearchParams({ limit: "100" });
      if (startingAfter) params.set("starting_after", startingAfter);
      const sep = endpoint.includes("?") ? "&" : "?";
      res = await instantlyFetch(apiKey, `${endpoint}${sep}${params}`);
    }

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Instantly API error (${res.status}): ${text}`);
    }

    const json = await res.json();
    const items: T[] = json.items ?? json.data ?? [];
    if (items.length === 0) break;

    allItems.push(...items);
    startingAfter = json.next_starting_after;
    if (!startingAfter) break;
  }

  return allItems;
}

// --- Types ---

export interface Campaign {
  id: string;
  name: string;
  status: string;
  created_at?: string;
  [key: string]: unknown;
}

export interface Lead {
  id?: string;
  email: string;
  first_name?: string;
  last_name?: string;
  company_name?: string;
  campaign_id?: string;
  [key: string]: unknown;
}

export interface Email {
  id: string;
  campaign_id: string;
  lead_email: string;
  email_type: string;
  timestamp_sent?: string;
  timestamp_created?: string;
  [key: string]: unknown;
}

export interface SequenceStep {
  id: string;
  email_subject: string;
  email_body: string;
  wait_in_days?: number;
  order?: number;
  [key: string]: unknown;
}

export interface Subsequence {
  id: string;
  campaign_id: string;
  steps: SequenceStep[];
  [key: string]: unknown;
}

// --- Exported functions ---

export async function listCampaigns(
  apiKey: string
): Promise<Campaign[]> {
  return fetchAllPaginated<Campaign>(apiKey, "/campaigns");
}

export async function getCampaign(
  apiKey: string,
  id: string
): Promise<Campaign> {
  const res = await instantlyFetch(apiKey, `/campaigns/${id}`);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to get campaign ${id}: ${res.status} — ${text}`);
  }
  return res.json();
}

export async function getCampaignLeads(
  apiKey: string,
  campaignId: string
): Promise<Lead[]> {
  // /leads/list ignores campaign_id and returns all workspace leads.
  // Instead: get leads that actually received emails in this campaign,
  // then look up their full data from the workspace lead list.
  const sentEmails = await fetchAllPaginated<Email>(
    apiKey,
    `/emails?campaign_id=${campaignId}&email_type=sent`
  );

  const campaignLeadEmails = new Set(
    sentEmails.map((e) => e.lead_email).filter((e): e is string => !!e)
  );

  if (campaignLeadEmails.size === 0) return [];

  // Fetch workspace leads and filter to only this campaign's leads
  const allLeads = await fetchAllPaginated<Lead>(apiKey, "/leads/list", "POST", {});
  return allLeads.filter((l) => campaignLeadEmails.has(l.email));
}

export async function getCampaignReplies(
  apiKey: string,
  campaignId: string
): Promise<Email[]> {
  return fetchAllPaginated<Email>(
    apiKey,
    `/emails?campaign_id=${campaignId}&email_type=received`
  );
}

export async function getCampaignSequence(
  apiKey: string,
  campaignId: string
): Promise<SequenceStep[]> {
  const res = await instantlyFetch(
    apiKey,
    `/campaign-subsequences?campaign_id=${campaignId}`
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `Failed to get sequence for campaign ${campaignId}: ${res.status} — ${text}`
    );
  }
  const json = await res.json();
  const subsequences: Subsequence[] = json.items ?? json.data ?? json ?? [];

  // The first subsequence contains the email steps
  if (Array.isArray(subsequences) && subsequences.length > 0) {
    return subsequences[0].steps ?? [];
  }

  return [];
}

export async function getSentEmails(
  apiKey: string,
  campaignId: string
): Promise<Email[]> {
  return fetchAllPaginated<Email>(
    apiKey,
    `/emails?campaign_id=${campaignId}&email_type=sent`
  );
}

/**
 * Build a map of lead_email → last sent date from sent emails.
 * Instantly doesn't have lead IDs in the same way — we key by email address.
 */
export function buildLastSentMap(
  emails: Email[]
): Map<string, Date> {
  const lastSentMap = new Map<string, Date>();

  for (const email of emails) {
    const sentAt = email.timestamp_sent ?? email.timestamp_created;
    if (sentAt && email.lead_email) {
      const sentDate = new Date(sentAt);
      const existing = lastSentMap.get(email.lead_email);
      if (!existing || sentDate > existing) {
        lastSentMap.set(email.lead_email, sentDate);
      }
    }
  }

  return lastSentMap;
}

export async function duplicateCampaign(
  apiKey: string,
  id: string
): Promise<{ id: string; name: string }> {
  const res = await instantlyFetch(apiKey, `/campaigns/${id}/duplicate`, {
    method: "POST",
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `Failed to duplicate campaign ${id}: ${res.status} — ${text}`
    );
  }
  return res.json();
}

/**
 * Add leads to a campaign. Instantly's /leads/add takes full lead objects
 * (not just IDs) and supports up to 1000 per batch.
 */
// --- Campaign Creation ---

export interface CampaignSchedule {
  timezone?: string;
  days?: Record<string, boolean>;
  timing?: { from: string; to: string };
}

export interface CampaignSequenceStep {
  subject: string;
  email_body: string;
  type?: string;
  wait?: number;
  variants?: Array<{ subject: string; email_body: string }>;
}

export interface CreateCampaignPayload {
  name: string;
  campaign_schedule?: CampaignSchedule;
  sequences?: Array<{ steps: CampaignSequenceStep[] }>;
  daily_limit?: number;
  stop_on_reply?: boolean;
  stop_on_auto_reply?: boolean;
  link_tracking?: boolean;
  open_tracking?: boolean;
  email_list?: string[];
}

export async function createCampaign(
  apiKey: string,
  payload: CreateCampaignPayload
): Promise<Campaign> {
  const res = await instantlyFetch(apiKey, "/campaigns", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to create campaign: ${res.status} — ${text}`);
  }
  return res.json();
}

export async function activateCampaign(
  apiKey: string,
  id: string
): Promise<void> {
  const res = await instantlyFetch(apiKey, `/campaigns/${id}/activate`, {
    method: "POST",
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to activate campaign ${id}: ${res.status} — ${text}`);
  }
}

export interface Account {
  id: string;
  email: string;
  status: string;
  [key: string]: unknown;
}

export async function listAccounts(
  apiKey: string
): Promise<Account[]> {
  return fetchAllPaginated<Account>(apiKey, "/accounts");
}

export async function addLeadsToCampaign(
  apiKey: string,
  campaignId: string,
  leads: Lead[]
): Promise<{ attached: number; failed: number }> {
  const BATCH_SIZE = 1000;
  let totalAttached = 0;
  let totalFailed = 0;

  for (let i = 0; i < leads.length; i += BATCH_SIZE) {
    const batch = leads.slice(i, i + BATCH_SIZE);

    // Build lead payloads with all available fields
    const leadPayloads = batch.map((lead) => {
      const payload: Record<string, unknown> = { email: lead.email };
      if (lead.first_name) payload.first_name = lead.first_name;
      if (lead.last_name) payload.last_name = lead.last_name;
      if (lead.company_name) payload.company_name = lead.company_name;

      // Include all custom fields
      for (const [key, value] of Object.entries(lead)) {
        if (
          !["id", "email", "first_name", "last_name", "company_name", "campaign_id", "created_at", "updated_at", "status"].includes(key) &&
          value !== null &&
          value !== undefined &&
          typeof value !== "object"
        ) {
          payload[key] = value;
        }
      }

      return payload;
    });

    const res = await instantlyFetch(apiKey, "/leads/add", {
      method: "POST",
      body: JSON.stringify({
        campaign_id: campaignId,
        leads: leadPayloads,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      console.error(
        `Batch ${Math.floor(i / BATCH_SIZE) + 1} failed: ${res.status} — ${text}`
      );
      totalFailed += batch.length;
    } else {
      totalAttached += batch.length;
    }
  }

  return { attached: totalAttached, failed: totalFailed };
}
