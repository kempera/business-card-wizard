export type LeadStatus =
  | "New"
  | "Reviewed"
  | "Qualified"
  | "Follow-up"
  | "Pushed to Salesforce"
  | "Duplicate"
  | "Rejected";

export type SaveAction = "created" | "updated" | "deduped";

export interface ContactDraft {
  id?: string;
  event_name: string;
  source: string;
  file_name: string;
  name: string;
  first_name: string;
  last_name: string;
  company: string;
  title: string;
  email: string;
  phone: string;
  mobile: string;
  website: string;
  linkedin_url: string;
  status: LeadStatus;
  confidence: number;
  raw_text: string;
  tags: string[];
  notes: string;
  follow_up_date: string | null;
  extraction_mode: "llm" | "regex_fallback";
  warnings: string[];
}

export interface ContactRecord extends ContactDraft {
  id: string;
  normalized_email: string;
  normalized_phone: string;
  enriched_json: Record<string, unknown> | null;
  salesforce_id: string;
  created_at: string;
  updated_at: string;
}

export interface SaveContactResult {
  action: SaveAction;
  duplicateOf?: string;
  contact: ContactRecord;
}

export interface FeatureStatus {
  database: boolean;
  googleVision: boolean;
  llmExtraction: boolean;
  salesforce: boolean;
  linkedinEnrichment: boolean;
  auth: boolean;
}

export interface SalesforcePushResult {
  contactId: string;
  ok: boolean;
  salesforceId?: string;
  error?: string;
}
