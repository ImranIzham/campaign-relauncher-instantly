/**
 * Sync clients from Google Sheets to local ~/workspace/understory-clients/ folder.
 *
 * Usage: npx tsx scripts/sync-clients.ts
 *
 * Requires these env vars (from .env.local):
 *   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN, GOOGLE_SHEETS_SPREADSHEET_ID
 */

import { google } from "googleapis";
import { writeFileSync, mkdirSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { config } from "dotenv";

// Load env vars from .env.local
config({ path: join(__dirname, "..", ".env.local") });

const CLIENTS_DIR = join(__dirname, "..", "..", "understory-clients");
const API_DIR = join(CLIENTS_DIR, "api");

async function main() {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN, GOOGLE_SHEETS_SPREADSHEET_ID } = process.env;

  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REFRESH_TOKEN || !GOOGLE_SHEETS_SPREADSHEET_ID) {
    console.error("Missing required Google environment variables. Check .env.local");
    process.exit(1);
  }

  const oauth2Client = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET);
  oauth2Client.setCredentials({ refresh_token: GOOGLE_REFRESH_TOKEN });

  const sheets = google.sheets({ version: "v4", auth: oauth2Client });

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: GOOGLE_SHEETS_SPREADSHEET_ID,
    range: "Clients!A2:C",
  });

  const rows = res.data.values;
  if (!rows || rows.length === 0) {
    console.log("No clients found in Google Sheets.");
    return;
  }

  // Ensure base dirs exist
  if (!existsSync(CLIENTS_DIR)) {
    mkdirSync(CLIENTS_DIR, { recursive: true });
  }
  if (!existsSync(API_DIR)) {
    mkdirSync(API_DIR, { recursive: true });
  }

  let synced = 0;
  for (let i = 0; i < rows.length; i++) {
    const [name, apiKey, createdAt] = rows[i];
    if (!name || !apiKey) continue;

    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
    const clientDir = join(CLIENTS_DIR, `client-${slug}`);

    if (!existsSync(clientDir)) {
      mkdirSync(clientDir, { recursive: true });
    }

    // Preserve locally-set fields that aren't sourced from the sheet — e.g.
    // `active` and `reporting_day` (consumed by scripts/weekly-report-runner.sh).
    // Otherwise each sync would wipe the weekly-report config.
    const configPath = join(clientDir, "config.json");
    let preserved: Record<string, unknown> = {};
    if (existsSync(configPath)) {
      try {
        const existing = JSON.parse(readFileSync(configPath, "utf8"));
        for (const k of ["active", "reporting_day"]) {
          if (k in existing) preserved[k] = existing[k];
        }
      } catch { /* ignore parse errors — will overwrite */ }
    }

    const config = {
      name,
      instantly_api_key: apiKey,
      sheets_row_id: String(i + 2), // row 2+ (1-indexed, skip header)
      created_at: createdAt || null,
      synced_at: new Date().toISOString(),
      ...preserved,
    };

    writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");

    // Also write to api/{slug}.json for quick Claude Code lookup
    const apiEntry = {
      name,
      slug,
      instantly_api_key: apiKey,
      synced_at: config.synced_at,
    };
    writeFileSync(join(API_DIR, `${slug}.json`), JSON.stringify(apiEntry, null, 2) + "\n");

    console.log(`  Synced: ${name} → client-${slug}/config.json + api/${slug}.json`);
    synced++;
  }

  console.log(`\nDone. ${synced} client(s) synced to ${CLIENTS_DIR}`);
}

main().catch((err) => {
  console.error("Sync failed:", err.message);
  process.exit(1);
});
