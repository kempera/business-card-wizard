import { randomUUID } from "crypto";
import { readFile } from "fs/promises";
import { join } from "path";
import { Pool, type QueryResultRow } from "pg";
import { ConfigurationError, requireEnv } from "./config";
import {
  normalizeEmail,
  normalizePhone,
  withContactDefaults
} from "./contact-normalization";
import type { ContactDraft, ContactRecord, SaveContactResult } from "./types";

let pool: Pool | null = null;
let schemaReady = false;

function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: requireEnv("DATABASE_URL"),
      max: 5,
      idleTimeoutMillis: 30_000
    });
  }
  return pool;
}

export async function ensureSchema(): Promise<void> {
  if (schemaReady) return;
  const schema = await readFile(join(process.cwd(), "db", "schema.sql"), "utf8");
  await getPool().query(schema);
  schemaReady = true;
}

function mapContact(row: QueryResultRow): ContactRecord {
  return {
    id: String(row.id),
    event_name: row.event_name || "",
    source: row.source || "Upload",
    file_name: row.file_name || "",
    name: row.name || "",
    first_name: row.first_name || "",
    last_name: row.last_name || "",
    company: row.company || "",
    title: row.title || "",
    email: row.email || "",
    normalized_email: row.normalized_email || "",
    phone: row.phone || "",
    normalized_phone: row.normalized_phone || "",
    mobile: row.mobile || "",
    website: row.website || "",
    linkedin_url: row.linkedin_url || "",
    status: row.status || "New",
    confidence: Number(row.confidence || 0),
    raw_text: row.raw_text || "",
    tags: Array.isArray(row.tags) ? row.tags : [],
    notes: row.notes || "",
    follow_up_date: row.follow_up_date ? String(row.follow_up_date).slice(0, 10) : null,
    extraction_mode: row.extraction_mode || "regex_fallback",
    warnings: Array.isArray(row.warnings) ? row.warnings : [],
    enriched_json: row.enriched_json || null,
    salesforce_id: row.salesforce_id || "",
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    updated_at: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at)
  };
}

export async function listContacts(): Promise<ContactRecord[]> {
  await ensureSchema();
  const result = await getPool().query("SELECT * FROM contacts ORDER BY created_at DESC");
  return result.rows.map(mapContact);
}

export async function getContact(id: string): Promise<ContactRecord | null> {
  await ensureSchema();
  const result = await getPool().query("SELECT * FROM contacts WHERE id = $1", [id]);
  return result.rows[0] ? mapContact(result.rows[0]) : null;
}

async function findDuplicate(input: ContactDraft, excludeId?: string): Promise<ContactRecord | null> {
  const clauses: string[] = [];
  const values: string[] = [];
  const normalizedEmail = normalizeEmail(input.email);
  const normalizedPhone = normalizePhone(input.mobile || input.phone);

  if (normalizedEmail) {
    values.push(normalizedEmail);
    clauses.push(`normalized_email = $${values.length}`);
  }
  if (normalizedPhone) {
    values.push(normalizedPhone);
    clauses.push(`normalized_phone = $${values.length}`);
  }
  if (input.linkedin_url) {
    values.push(input.linkedin_url);
    clauses.push(`linkedin_url = $${values.length}`);
  }

  if (excludeId) {
    values.push(excludeId);
    clauses.push(`id <> $${values.length}`);
  }

  if (clauses.length === 0 || (excludeId && clauses.length === 1)) return null;

  const duplicateWhere = excludeId
    ? `(${clauses.slice(0, -1).join(" OR ")}) AND ${clauses[clauses.length - 1]}`
    : clauses.join(" OR ");

  const result = await getPool().query(
    `SELECT * FROM contacts WHERE ${duplicateWhere} ORDER BY updated_at DESC LIMIT 1`,
    values
  );
  return result.rows[0] ? mapContact(result.rows[0]) : null;
}

const contactColumns = [
  "id",
  "event_name",
  "source",
  "file_name",
  "name",
  "first_name",
  "last_name",
  "company",
  "title",
  "email",
  "normalized_email",
  "phone",
  "normalized_phone",
  "mobile",
  "website",
  "linkedin_url",
  "status",
  "confidence",
  "raw_text",
  "tags",
  "notes",
  "follow_up_date",
  "extraction_mode",
  "warnings"
] as const;

function contactValues(id: string, input: ContactDraft): unknown[] {
  return [
    id,
    input.event_name,
    input.source,
    input.file_name,
    input.name,
    input.first_name,
    input.last_name,
    input.company,
    input.title,
    input.email,
    normalizeEmail(input.email),
    input.phone,
    normalizePhone(input.mobile || input.phone),
    input.mobile,
    input.website,
    input.linkedin_url,
    input.status,
    input.confidence,
    input.raw_text,
    input.tags,
    input.notes,
    input.follow_up_date,
    input.extraction_mode,
    input.warnings
  ];
}

export async function saveReviewedContact(input: Partial<ContactDraft> & { id?: string }): Promise<SaveContactResult> {
  await ensureSchema();
  const contact = withContactDefaults(input);
  const id = input.id || randomUUID();
  const duplicate = await findDuplicate(contact, input.id);
  const targetId = duplicate?.id || id;
  const action = input.id ? "updated" : duplicate ? "deduped" : "created";

  const values = contactValues(targetId, contact);
  const placeholders = contactColumns.map((_, index) => `$${index + 1}`).join(", ");
  const updates = contactColumns
    .filter((column) => column !== "id")
    .map((column) => `${column} = EXCLUDED.${column}`)
    .join(", ");

  const result = await getPool().query(
    `INSERT INTO contacts (${contactColumns.join(", ")})
     VALUES (${placeholders})
     ON CONFLICT (id) DO UPDATE SET ${updates}, updated_at = NOW()
     RETURNING *`,
    values
  );

  return {
    action,
    duplicateOf: duplicate?.id,
    contact: mapContact(result.rows[0])
  };
}

export async function updateContact(id: string, patch: Partial<ContactDraft> & Record<string, unknown>): Promise<ContactRecord> {
  await ensureSchema();
  const existing = await getContact(id);
  if (!existing) throw new ConfigurationError(`Contact not found: ${id}`);

  // Dashboard edits should update this exact contact, not trigger dedupe/merge behavior.
  const contact = withContactDefaults({ ...existing, ...patch });
  const values = contactValues(id, contact);
  const updates = contactColumns
    .filter((column) => column !== "id")
    .map((column) => `${column} = EXCLUDED.${column}`)
    .join(", ");

  const result = await getPool().query(
    `INSERT INTO contacts (${contactColumns.join(", ")})
     VALUES (${contactColumns.map((_, index) => `$${index + 1}`).join(", ")})
     ON CONFLICT (id) DO UPDATE SET ${updates}, updated_at = NOW()
     RETURNING *`,
    values
  );
  return mapContact(result.rows[0]);
}

export async function setContactSalesforceId(id: string, salesforceId: string): Promise<void> {
  await ensureSchema();
  await getPool().query(
    "UPDATE contacts SET salesforce_id = $2, status = 'Pushed to Salesforce', updated_at = NOW() WHERE id = $1",
    [id, salesforceId]
  );
}

export async function setContactEnrichment(id: string, enrichment: Record<string, unknown>): Promise<ContactRecord> {
  await ensureSchema();
  const result = await getPool().query(
    "UPDATE contacts SET enriched_json = $2, updated_at = NOW() WHERE id = $1 RETURNING *",
    [id, enrichment]
  );
  return mapContact(result.rows[0]);
}

export async function deleteContact(id: string): Promise<void> {
  await ensureSchema();
  await getPool().query("DELETE FROM contacts WHERE id = $1", [id]);
}
