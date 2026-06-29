import { NextResponse } from "next/server";
import { getContact, setContactEnrichment } from "@/app/lib/db";
import { enrichLinkedIn } from "@/app/lib/enrichment";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { id?: string };
    if (!body.id) return NextResponse.json({ error: "Missing contact id." }, { status: 400 });
    const contact = await getContact(body.id);
    if (!contact) return NextResponse.json({ error: "Contact not found." }, { status: 404 });
    const enrichment = await enrichLinkedIn(contact);
    const updated = await setContactEnrichment(contact.id, enrichment);
    return NextResponse.json({ enrichment, contact: updated });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "LinkedIn enrichment failed." },
      { status: 500 }
    );
  }
}
