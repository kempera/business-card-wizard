import { env } from "./config";
import type { ContactRecord } from "./types";

export async function enrichLinkedIn(contact: ContactRecord): Promise<Record<string, unknown>> {
  if (!contact.linkedin_url) {
    return { configured: false, message: "Contact has no LinkedIn URL." };
  }

  const proxycurlKey = env("PROXYCURL_API_KEY");
  if (proxycurlKey) {
    const url = new URL("https://nubela.co/proxycurl/api/v2/linkedin");
    url.searchParams.set("url", contact.linkedin_url);
    url.searchParams.set("fallback_to_cache", "on-error");
    const response = await fetch(url, {
      headers: { authorization: `Bearer ${proxycurlKey}` }
    });
    const payload = (await response.json()) as Record<string, unknown>;
    if (!response.ok) throw new Error(`Proxycurl enrichment failed: ${JSON.stringify(payload)}`);
    return { provider: "proxycurl", fetched_at: new Date().toISOString(), profile: payload };
  }

  const webhook = env("LINKEDIN_ENRICHMENT_WEBHOOK_URL");
  if (webhook) {
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
    if (!response.ok) throw new Error(`LinkedIn enrichment webhook failed: ${JSON.stringify(payload)}`);
    return { provider: "webhook", fetched_at: new Date().toISOString(), profile: payload };
  }

  return {
    configured: false,
    message: "Set PROXYCURL_API_KEY or LINKEDIN_ENRICHMENT_WEBHOOK_URL to enable enrichment."
  };
}
