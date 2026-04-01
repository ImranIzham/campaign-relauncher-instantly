import { createClient, SupabaseClient } from "@supabase/supabase-js";

let _supabase: SupabaseClient | null = null;

function getSupabase(): SupabaseClient {
  if (!_supabase) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_KEY;
    if (!url || !key) {
      throw new Error("SUPABASE_URL and SUPABASE_SERVICE_KEY are required");
    }
    _supabase = createClient(url, key);
  }
  return _supabase;
}

export interface RelauncherClient {
  id: string;
  name: string;
  instantly_api_key?: string;
  created_at: string;
}

/** Returns id + name only — never exposes API keys to the frontend */
export async function listClients(): Promise<
  Pick<RelauncherClient, "id" | "name" | "created_at">[]
> {
  const { data, error } = await getSupabase()
    .from("relauncher_clients")
    .select("id, name, created_at")
    .order("name");

  if (error) throw new Error(`Supabase error: ${error.message}`);
  return data ?? [];
}

/** Server-side only — fetches the API key for a specific client */
export async function getClientApiKey(clientId: string): Promise<string> {
  const { data, error } = await getSupabase()
    .from("relauncher_clients")
    .select("instantly_api_key")
    .eq("id", clientId)
    .single();

  if (error || !data) throw new Error("Client not found");
  return data.instantly_api_key;
}

/** Add a new client. Returns the full record (minus API key for safety). */
export async function addClient(
  name: string,
  apiKey: string
): Promise<Pick<RelauncherClient, "id" | "name" | "created_at">> {
  const { data, error } = await getSupabase()
    .from("relauncher_clients")
    .insert({ name, instantly_api_key: apiKey })
    .select("id, name, created_at")
    .single();

  if (error) throw new Error(`Failed to add client: ${error.message}`);
  return data;
}
