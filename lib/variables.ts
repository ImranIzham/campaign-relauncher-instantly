import type { SequenceStep, Lead } from "./instantly";

const VAR_REGEX = /\{\{(\w+)\}\}/g;

/**
 * Extract unique variable names from all sequence step subjects and bodies.
 */
export function extractVariables(steps: SequenceStep[]): string[] {
  if (!Array.isArray(steps)) return [];
  const vars = new Set<string>();

  for (const step of steps) {
    const texts = [step.email_subject || "", step.email_body || ""];
    for (const text of texts) {
      let match;
      while ((match = VAR_REGEX.exec(text)) !== null) {
        vars.add(match[1]);
      }
    }
  }

  return Array.from(vars);
}

/**
 * Check which required variables are missing/empty for a lead.
 * Returns array of missing variable names.
 */
export function validateLeadVariables(
  lead: Lead,
  requiredVars: string[]
): string[] {
  const missing: string[] = [];

  for (const varName of requiredVars) {
    const fieldName = mapVarToField(varName);
    const value = lead[fieldName];

    if (value === undefined || value === null || value === "") {
      missing.push(varName);
    }
  }

  return missing;
}

/**
 * Map template variable names to lead object field names.
 * Instantly uses company_name instead of company.
 */
function mapVarToField(varName: string): string {
  if (varName === "company") return "company_name";
  return varName;
}
