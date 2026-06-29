import { NextResponse } from "next/server";
import { extractContact } from "@/app/lib/contact-extractor";
import { googleVisionOcr } from "@/app/lib/ocr";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const eventName = String(formData.get("eventName") || "Business Card Event");
    const files = formData.getAll("files").filter((entry): entry is File => entry instanceof File);

    if (files.length === 0) {
      return NextResponse.json({ error: "Upload at least one image file." }, { status: 400 });
    }

    const drafts = [];
    for (const file of files) {
      const imageBytes = Buffer.from(await file.arrayBuffer());
      const rawText = await googleVisionOcr(imageBytes);
      const draft = await extractContact(rawText, eventName, file.name);
      drafts.push(draft);
    }

    return NextResponse.json({ drafts });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Card processing failed." },
      { status: 500 }
    );
  }
}
