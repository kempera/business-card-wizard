import { env } from "./config";
import type { ContactRecord } from "./types";

/**
 * NinjaPear (formerly Proxycurl) — person profile enrichment.
 * Endpoint: GET /api/v2/employee/profile
 * Inputs: work_email  OR  (first_name + last_name + employer_website)
 * Auth:   Bearer token via NINJAPEAR_API_KEY (falls back to PROXYCURL_API_KEY for legacy .env files)
 * Docs:   https://nubela.co/docs
 */
async function ninjapearEnrich(contact: ContactRecord): Promise<Record<string, unknown>> {
  const apiKey = env("NINJAPEAR_API_KEY") || env("PROXYCURL_API_KEY");
  if (!apiKey) throw new Error("NINJAPEAR_API_KEY not configured.");

  const url = new URL("https://nubela.co/api/v2/employee/profile");

  // Prefer email lookup; fall back to name + company website
  if (contact.email) {
    url.searchParams.set("work_email", contact.email);
  } else if (contact.first_name && contact.last_name && contact.website) {
    url.searchParams.set("first_name", contact.first_name);
    url.searchParams.set("last_name", contact.last_name);
    url.searchParams.set("employer_website", contact.website);
  } else if (contact.first_name && contact.last_name && contact.company) {
    // Derive a best-effort domain from company name
    const domain = contact.company
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "")
      .replace(/\s+/g, "") + ".com";
    url.searchParams.set("first_name", contact.first_name);
    url.searchParams.set("last_name", contact.last_name);
    url.searchParams.set("employer_website", domain);
  } else {
    return {
      configured: true,
      enriched: false,
      message: "Insufficient contact data for enrichment (need email or name+company)."
    };
  }

  const response = await fetch(url.toString(), {
    headers: { authorization: `Bearer ${apiKey}` }
  });

  const payload = (await response.json()) as Record<string, unknown>;

  if (!response.ok) {
    const msg = typeof payload.error === "string" ? payload.error : JSON.stringify(payload);
    throw new Error(`NinjaPear enrichment failed (HTTP ${response.status}): ${msg}`);
  }

  return {
    provider: "ninjapear",
    fetched_at: new Date().toISOString(),
    enrichment_status: response.headers.get("X-NinjaPear-Enrichment-Status") || "complete",
    profile: payload
  };
}

/**
 * Custom webhook enrichment fallback.
 * POST the full contact record to any configured webhook URL; expects JSON back.
 */
async function webhookEnrich(contact: ContactRecord): Promise<Record<string, unknown>> {
  const webhook = env("LINKEDIN_ENRICHMENT_WEBHOOK_URL");
  if (!webhook) throw new Error("LINKEDIN_ENRICHMENT_WEBHOOK_URL not configured.");

  const token = env("LINKEDIN_ENRICHMENT_WEBHOOK_TOKEN");
  const response = await fetch(webhook, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {})
    },
    body: JSON.stringify({ contact })
  });

  const payload = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(`LinkedIn enrichment webhook failed: ${JSON.stringify(payload)}`);
  }

  return { provider: "webhook", fetched_at: new Date().toISOString(), profile: payload };
}

/**
 * Main enrichment entry point.
 * Priority: NinjaPear API → custom webhook → not configured.
 */
export async function enrichLinkedIn(contact: ContactRecord): Promise<Record<string, unknown>> {
  const hasNinjaPear = Boolean(env("NINJAPEAR_API_KEY") || env("PROXYCURL_API_KEY"));
  const hasWebhook = Boolean(env("LINKEDIN_ENRICHMENT_WEBHOOK_URL"));

  if (!hasNinjaPear && !hasWebhook) {
    return {
      configured: false,
      message: "Set NINJAPEAR_API_KEY or LINKEDIN_ENRICHMENT_WEBHOOK_URL to enable enrichment."
    };
  }

  if (hasNinjaPear) {
    return ninjapearEnrich(contact);
  }

  return webhookEnrich(contact);
}
