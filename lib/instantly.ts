import { cacheGet, cacheSet } from "./cache";

const BASE_URL = "https://api.instantly.ai/api/v2";
const TTL = 5 * 60 * 1000; // 5 minutes

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
  campaign?: string;     // campaign ID this lead belongs to (Instantly v2 field)
  campaign_id?: string;
  [key: string]: unknown;
}

export interface Email {
  id: string;
  campaign_id: string;
  lead: string;           // actual lead email address (Instantly v2 field name)
  email_type: string;
  timestamp_email?: string;   // actual send timestamp (Instantly v2 field name)
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

export interface BlockEntry {
  id: string;
  entry: string;
  type?: "email" | "domain";
  [key: string]: unknown;
}

// --- Exported functions ---

export async function listCampaigns(
  apiKey: string
): Promise<Campaign[]> {
  return fetchAllPaginated<Campaign>(apiKey, "/campaigns");
}

export async function getBlocklist(apiKey: string): Promise<Set<string>> {
  const key = `blocklist:${apiKey.slice(-8)}`;
  const cached = cacheGet<Set<string>>(key);
  if (cached) return cached;
  // /block-list-entries does not accept query params — call it directly
  const res = await instantlyFetch(apiKey, "/block-list-entries");
  if (!res.ok) {
    // If the endpoint isn't available, return an empty set rather than breaking the relaunch
    return new Set();
  }
  const json = await res.json();
  const entries: BlockEntry[] = json.items ?? json.data ?? json ?? [];
  const blocked = new Set(entries.map((e) => e.entry.toLowerCase()));
  cacheSet(key, blocked, TTL);
  return blocked;
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
  // /leads/list POST with campaign_id in the body does not filter by campaign —
  // it returns all workspace leads. However, each lead object has a 'campaign'
  // field with the campaign ID it belongs to. Fetch all workspace leads (cached)
  // and filter by that field.
  const leadsKey = `workspace-leads:${apiKey.slice(-8)}`;
  let allLeads = cacheGet<Lead[]>(leadsKey);
  if (!allLeads) {
    allLeads = await fetchAllPaginated<Lead>(apiKey, "/leads/list", "POST", {});
    cacheSet(leadsKey, allLeads, TTL);
  }

  return allLeads.filter((l) => l.campaign === campaignId);
}

export async function getCampaignReplies(
  apiKey: string,
  campaignId: string
): Promise<Email[]> {
  const key = `replies:${campaignId}:${apiKey.slice(-8)}`;
  const cached = cacheGet<Email[]>(key);
  if (cached) return cached;
  const emails = await fetchAllPaginated<Email>(
    apiKey,
    `/emails?campaign_id=${campaignId}&email_type=received`
  );
  cacheSet(key, emails, TTL);
  return emails;
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
  const key = `sent:${campaignId}:${apiKey.slice(-8)}`;
  const cached = cacheGet<Email[]>(key);
  if (cached) return cached;
  const emails = await fetchAllPaginated<Email>(
    apiKey,
    `/emails?campaign_id=${campaignId}&email_type=sent`
  );
  cacheSet(key, emails, TTL);
  return emails;
}

/**
 * Build a map of lead email → last sent date from sent emails.
 * Instantly doesn't have lead IDs in the same way — we key by email address.
 */
export function buildLastSentMap(
  emails: Email[]
): Map<string, Date> {
  const lastSentMap = new Map<string, Date>();

  for (const email of emails) {
    const sentAt = email.timestamp_email ?? email.timestamp_created;
    if (sentAt && email.lead) {
      const sentDate = new Date(sentAt);
      const existing = lastSentMap.get(email.lead);
      if (!existing || sentDate > existing) {
        lastSentMap.set(email.lead, sentDate);
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
    body: JSON.stringify({}),
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
