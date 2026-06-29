import { NextResponse } from "next/server";
import { deleteContact, updateContact } from "@/app/lib/db";

type RouteContext = { params: Promise<{ id: string }> };

export const runtime = "nodejs";

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const body = await request.json();
    const contact = await updateContact(id, body);
    return NextResponse.json({ contact });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not update contact." },
      { status: 500 }
    );
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    await deleteContact(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not delete contact." },
      { status: 500 }
    );
  }
}
