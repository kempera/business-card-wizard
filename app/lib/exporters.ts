import ExcelJS from "exceljs";
import QRCode from "qrcode";
import { appUrl } from "./config";
import type { ContactRecord } from "./types";

export async function contactsExcel(contacts: ContactRecord[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Business Card Wizard";
  workbook.created = new Date();

  const contactsSheet = workbook.addWorksheet("Contacts");
  contactsSheet.columns = [
    { header: "Name", key: "name", width: 24 },
    { header: "Company", key: "company", width: 28 },
    { header: "Title", key: "title", width: 28 },
    { header: "Email", key: "email", width: 30 },
    { header: "Phone", key: "phone", width: 20 },
    { header: "Mobile", key: "mobile", width: 20 },
    { header: "LinkedIn", key: "linkedin_url", width: 36 },
    { header: "Status", key: "status", width: 20 },
    { header: "Tags", key: "tags", width: 24 },
    { header: "Follow-up", key: "follow_up_date", width: 16 },
    { header: "Event", key: "event_name", width: 24 },
    { header: "Confidence", key: "confidence", width: 14 }
  ];
  contacts.forEach((contact) => contactsSheet.addRow({ ...contact, tags: contact.tags.join(", ") }));
  contactsSheet.getRow(1).font = { bold: true };

  const sfSheet = workbook.addWorksheet("Salesforce Leads");
  sfSheet.columns = [
    { header: "FirstName", key: "first_name", width: 20 },
    { header: "LastName", key: "last_name", width: 20 },
    { header: "Company", key: "company", width: 28 },
    { header: "Title", key: "title", width: 28 },
    { header: "Email", key: "email", width: 30 },
    { header: "Phone", key: "phone", width: 20 },
    { header: "MobilePhone", key: "mobile", width: 20 },
    { header: "LinkedIn_Profile__c", key: "linkedin_url", width: 36 },
    { header: "Status", key: "status", width: 20 },
    { header: "LeadSource", key: "event_name", width: 24 }
  ];
  contacts.forEach((contact) => sfSheet.addRow(contact));
  sfSheet.getRow(1).font = { bold: true };

  const eventSheet = workbook.addWorksheet("Event Cube");
  eventSheet.columns = [
    { header: "Event", key: "event", width: 32 },
    { header: "Contacts", key: "count", width: 12 },
    { header: "Avg Confidence", key: "confidence", width: 16 }
  ];
  const grouped = new Map<string, ContactRecord[]>();
  contacts.forEach((contact) => grouped.set(contact.event_name, [...(grouped.get(contact.event_name) || []), contact]));
  grouped.forEach((items, event) => {
    eventSheet.addRow({
      event,
      count: items.length,
      confidence: Math.round(items.reduce((sum, item) => sum + item.confidence, 0) / items.length)
    });
  });
  eventSheet.getRow(1).font = { bold: true };

  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}

function escapeVCard(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
}

export function contactVCard(contact: ContactRecord): string {
  const lines = [
    "BEGIN:VCARD",
    "VERSION:3.0",
    `N:${escapeVCard(contact.last_name)};${escapeVCard(contact.first_name)};;;`,
    `FN:${escapeVCard(contact.name || `${contact.first_name} ${contact.last_name}`.trim())}`
  ];
  if (contact.company) lines.push(`ORG:${escapeVCard(contact.company)}`);
  if (contact.title) lines.push(`TITLE:${escapeVCard(contact.title)}`);
  if (contact.email) lines.push(`EMAIL;TYPE=WORK:${escapeVCard(contact.email)}`);
  if (contact.phone) lines.push(`TEL;TYPE=WORK:${escapeVCard(contact.phone)}`);
  if (contact.mobile) lines.push(`TEL;TYPE=CELL:${escapeVCard(contact.mobile)}`);
  if (contact.website) lines.push(`URL:${escapeVCard(contact.website)}`);
  if (contact.linkedin_url) lines.push(`URL;TYPE=LinkedIn:${escapeVCard(contact.linkedin_url)}`);
  if (contact.notes) lines.push(`NOTE:${escapeVCard(contact.notes)}`);
  lines.push("END:VCARD");
  return `${lines.join("\r\n")}\r\n`;
}

export function contactsVCard(contacts: ContactRecord[]): string {
  return contacts.map(contactVCard).join("\r\n");
}

export async function contactQrPng(contact: ContactRecord): Promise<Buffer> {
  return QRCode.toBuffer(contactVCard(contact), {
    type: "png",
    errorCorrectionLevel: "M",
    margin: 1,
    width: 512
  });
}

export function contactShareUrl(contact: ContactRecord): string {
  return `${appUrl()}/api/exports/vcard?ids=${encodeURIComponent(contact.id)}`;
}
