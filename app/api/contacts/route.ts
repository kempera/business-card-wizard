import { NextResponse } from "next/server";
import { featureStatus } from "@/app/lib/config";
import { listContacts, saveReviewedContact } from "@/app/lib/db";

export const runtime = "nodejs";

export async function GET() {
  try {
    const contacts = await listContacts();
    return NextResponse.json({ contacts, features: featureStatus() });
  } catch (error) {
    return NextResponse.json(
      {
        contacts: [],
        features: featureStatus(),
        error: error instanceof Error ? error.message : "Could not load contacts."
      },
      { status: 503 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const result = await saveReviewedContact(body);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not save contact." },
      { status: 500 }
    );
  }
}
