import { env, requireEnv } from "./config";
import { salesforceLeadPayload } from "./contact-normalization";
import { setContactSalesforceId } from "./db";
import type { ContactRecord, SalesforcePushResult } from "./types";

interface SalesforceTokenResponse {
  access_token: string;
  instance_url: string;
}

async function salesforceToken(): Promise<SalesforceTokenResponse> {
  const loginUrl = env("SALESFORCE_LOGIN_URL", "https://login.salesforce.com").replace(/\/$/, "");
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: requireEnv("SALESFORCE_CLIENT_ID"),
    client_secret: requireEnv("SALESFORCE_CLIENT_SECRET"),
    refresh_token: requireEnv("SALESFORCE_REFRESH_TOKEN")
  });

  const response = await fetch(`${loginUrl}/services/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body
  });

  if (!response.ok) {
    throw new Error(`Salesforce OAuth failed: ${await response.text()}`);
  }

  return (await response.json()) as SalesforceTokenResponse;
}

export async function pushContactsToSalesforce(contacts: ContactRecord[]): Promise<SalesforcePushResult[]> {
  const token = await salesforceToken();
  const apiVersion = env("SALESFORCE_API_VERSION", "60.0");
  const linkedInField = env("SALESFORCE_LINKEDIN_FIELD", "LinkedIn_Profile__c");
  const results: SalesforcePushResult[] = [];

  for (const contact of contacts) {
    try {
      const payload = salesforceLeadPayload(contact);
      if (contact.linkedin_url && linkedInField) payload[linkedInField] = contact.linkedin_url;
      const response = await fetch(
        `${token.instance_url}/services/data/v${apiVersion}/sobjects/Lead`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${token.access_token}`,
            "content-type": "application/json"
          },
          body: JSON.stringify(payload)
        }
      );
      const body = (await response.json()) as { id?: string; errors?: Array<{ message?: string }> } | Array<{ message?: string }>;

      if (!response.ok) {
        const message = Array.isArray(body)
          ? body.map((entry) => entry.message).filter(Boolean).join("; ")
          : body.errors?.map((entry) => entry.message).filter(Boolean).join("; ");
        throw new Error(message || `Salesforce returned HTTP ${response.status}`);
      }

      const salesforceId = Array.isArray(body) ? "" : body.id || "";
      if (salesforceId) await setContactSalesforceId(contact.id, salesforceId);
      results.push({ contactId: contact.id, ok: true, salesforceId });
    } catch (error) {
      results.push({
        contactId: contact.id,
        ok: false,
        error: error instanceof Error ? error.message : "Unknown Salesforce error"
      });
    }
  }

  return results;
}
