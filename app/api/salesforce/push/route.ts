import { NextResponse } from "next/server";
import { getContact, listContacts } from "@/app/lib/db";
import { pushContactsToSalesforce } from "@/app/lib/salesforce";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { ids?: string[] };
    const contacts = body.ids?.length
      ? (await Promise.all(body.ids.map((id) => getContact(id)))).filter((contact) => contact !== null)
      : await listContacts();

    const results = await pushContactsToSalesforce(contacts);
    return NextResponse.json({ results });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Salesforce push failed." },
      { status: 500 }
    );
  }
}
