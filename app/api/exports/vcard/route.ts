import { getContact, listContacts } from "@/app/lib/db";
import { contactsVCard } from "@/app/lib/exporters";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const ids = (url.searchParams.get("ids") || "").split(",").map((id) => id.trim()).filter(Boolean);
  const contacts = ids.length
    ? (await Promise.all(ids.map((id) => getContact(id)))).filter((contact) => contact !== null)
    : await listContacts();

  return new Response(contactsVCard(contacts), {
    headers: {
      "content-type": "text/vcard; charset=utf-8",
      "content-disposition": 'attachment; filename="business-card-wizard.vcf"'
    }
  });
}
