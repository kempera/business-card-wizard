import type { ContactDraft, ContactRecord, LeadStatus } from "./types";

const VALID_STATUSES: LeadStatus[] = [
  "New",
  "Reviewed",
  "Qualified",
  "Follow-up",
  "Pushed to Salesforce",
  "Duplicate",
  "Rejected"
];

export function normalizeEmail(email: string | null | undefined): string {
  return (email || "").trim().toLowerCase();
}

export function normalizePhone(phone: string | null | undefined): string {
  return (phone || "").replace(/\D/g, "");
}

export function normalizeLinkedIn(url: string | null | undefined): string {
  const clean = (url || "").trim();
  if (!clean) return "";
  if (/^https?:\/\//i.test(clean)) return clean;
  return `https://${clean}`;
}

export function splitName(name: string): { first_name: string; last_name: string } {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first_name: "", last_name: "" };
  if (parts.length === 1) return { first_name: "", last_name: parts[0] };
  return { first_name: parts.slice(0, -1).join(" "), last_name: parts[parts.length - 1] };
}

export function coerceStatus(status: string | null | undefined): LeadStatus {
  return VALID_STATUSES.includes(status as LeadStatus) ? (status as LeadStatus) : "New";
}

export function cleanTags(tags: string[] | string | null | undefined): string[] {
  const raw = Array.isArray(tags) ? tags : (tags || "").split(",");
  return Array.from(
    new Set(
      raw
        .map((tag) => tag.trim())
        .filter(Boolean)
        .slice(0, 20)
    )
  );
}

export function withContactDefaults(input: Partial<ContactDraft>): ContactDraft {
  const name = (input.name || "").trim();
  const split = splitName(name);
  const firstName = (input.first_name || split.first_name || "").trim();
  const lastName = (input.last_name || split.last_name || name || "").trim();

  return {
    event_name: (input.event_name || "").trim(),
    source: (input.source || "Upload").trim(),
    file_name: (input.file_name || "").trim(),
    name,
    first_name: firstName,
    last_name: lastName,
    company: (input.company || "").trim(),
    title: (input.title || "").trim(),
    email: (input.email || "").trim(),
    phone: (input.phone || "").trim(),
    mobile: (input.mobile || "").trim(),
    website: (input.website || "").trim(),
    linkedin_url: normalizeLinkedIn(input.linkedin_url),
    status: coerceStatus(input.status),
    confidence: Math.max(0, Math.min(100, Math.round(input.confidence || 0))),
    raw_text: input.raw_text || "",
    tags: cleanTags(input.tags),
    notes: input.notes || "",
    follow_up_date: input.follow_up_date || null,
    extraction_mode: input.extraction_mode || "regex_fallback",
    warnings: Array.isArray(input.warnings) ? input.warnings : []
  };
}

export function salesforceLeadPayload(contact: ContactRecord): Record<string, string> {
  const lastName = contact.last_name || contact.name || "Unknown";
  const company = contact.company || "Unknown";
  const payload: Record<string, string> = {
    LastName: lastName,
    Company: company,
    Status: "Open - Not Contacted",
    LeadSource: contact.event_name || "Business Card Wizard"
  };

  if (contact.first_name) payload.FirstName = contact.first_name;
  if (contact.title) payload.Title = contact.title;
  if (contact.email) payload.Email = contact.email;
  if (contact.phone) payload.Phone = contact.phone;
  if (contact.mobile) payload.MobilePhone = contact.mobile;
  if (contact.website) payload.Website = contact.website;
  if (contact.notes || contact.raw_text) {
    payload.Description = [contact.notes, contact.raw_text ? `OCR:\n${contact.raw_text}` : ""]
      .filter(Boolean)
      .join("\n\n")
      .slice(0, 32000);
  }

  return payload;
}
