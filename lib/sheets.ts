import { google } from "googleapis";

function getSheets() {
  const auth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
  auth.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  return google.sheets({ version: "v4", auth });
}

const SPREADSHEET_ID = process.env.GOOGLE_SHEETS_SPREADSHEET_ID!;
const RANGE = "Clients";

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
  const sheets = getSheets();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${RANGE}!A:C`,
  });

  const rows = res.data.values;
  if (!rows || rows.length <= 1) return [];

  // Skip header row
  return rows.slice(1).map((row, i) => ({
    id: String(i + 2), // row number (1-indexed, skip header)
    name: row[0] || "",
    created_at: row[2] || "",
  }));
}

/** Server-side only — fetches the API key for a specific client */
export async function getClientApiKey(clientId: string): Promise<string> {
  const sheets = getSheets();
  const rowNum = parseInt(clientId, 10);
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${RANGE}!B${rowNum}`,
  });

  const val = res.data.values?.[0]?.[0];
  if (!val) throw new Error("Client not found");
  return val;
}

/** Add a new client. Returns the record (minus API key for safety). */
export async function addClient(
  name: string,
  apiKey: string
): Promise<Pick<RelauncherClient, "id" | "name" | "created_at">> {
  const sheets = getSheets();
  const now = new Date().toISOString();

  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: `${RANGE}!A:C`,
    valueInputOption: "RAW",
    requestBody: { values: [[name, apiKey, now]] },
  });

  // Get the new row number
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${RANGE}!A:A`,
  });
  const rowCount = res.data.values?.length ?? 2;

  return { id: String(rowCount), name, created_at: now };
}
