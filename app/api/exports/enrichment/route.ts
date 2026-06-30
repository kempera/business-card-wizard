import { NextResponse } from "next/server";
import { getContact, listContacts } from "@/app/lib/db";

export const runtime = "nodejs";

/** GET /api/exports/enrichment          → all enriched contacts as JSON array
 *  GET /api/exports/enrichment?id=...   → single contact enrichment JSON
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (id) {
    const contact = await getContact(id);
    if (!contact) return NextResponse.json({ error: "Contact not found." }, { status: 404 });
    if (!contact.enriched_json) return NextResponse.json({ error: "No enrichment data for this contact." }, { status: 404 });
    return new Response(JSON.stringify({
      id: contact.id,
      name: contact.name || `${contact.first_name} ${contact.last_name}`.trim(),
      email: contact.email,
      company: contact.company,
      enriched_at: contact.updated_at,
      enrichment: contact.enriched_json
    }, null, 2), {
      headers: {
        "content-type": "application/json",
        "content-disposition": `attachment; filename="enrichment-${contact.id.slice(0, 8)}.json"`
      }
    });
  }

  // All enriched contacts
  const contacts = await listContacts();
  const enriched = contacts
    .filter((c) => c.enriched_json)
    .map((c) => ({
      id: c.id,
      name: c.name || `${c.first_name} ${c.last_name}`.trim(),
      email: c.email,
      company: c.company,
      title: c.title,
      linkedin_url: c.linkedin_url,
      enriched_at: c.updated_at,
      enrichment: c.enriched_json
    }));

  return new Response(JSON.stringify(enriched, null, 2), {
    headers: {
      "content-type": "application/json",
      "content-disposition": "attachment; filename=\"enrichment-export.json\""
    }
  });
}
