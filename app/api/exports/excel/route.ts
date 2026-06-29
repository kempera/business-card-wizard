import { contactsExcel } from "@/app/lib/exporters";
import { listContacts } from "@/app/lib/db";

export const runtime = "nodejs";

export async function GET() {
  const contacts = await listContacts();
  const excel = await contactsExcel(contacts);
  return new Response(new Uint8Array(excel), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": 'attachment; filename="business-card-wizard.xlsx"'
    }
  });
}
