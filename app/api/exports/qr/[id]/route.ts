import { NextResponse } from "next/server";
import { getContact } from "@/app/lib/db";
import { contactQrPng } from "@/app/lib/exporters";

type RouteContext = { params: Promise<{ id: string }> };

export const runtime = "nodejs";

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const contact = await getContact(id);
  if (!contact) return NextResponse.json({ error: "Contact not found." }, { status: 404 });
  const png = await contactQrPng(contact);
  return new Response(new Uint8Array(png), {
    headers: {
      "content-type": "image/png",
      "content-disposition": `inline; filename="${id}.png"`
    }
  });
}
