import { env } from "./config";
import { splitName, withContactDefaults } from "./contact-normalization";
import type { ContactDraft } from "./types";

interface LlmContactPayload {
  name?: string;
  first_name?: string;
  last_name?: string;
  company?: string;
  title?: string;
  email?: string;
  phone?: string;
  mobile?: string;
  website?: string;
  linkedin_url?: string;
  confidence?: number;
  tags?: string[];
  notes?: string;
  warnings?: string[];
}

function extractJson(text: string): LlmContactPayload {
  try {
    return JSON.parse(text) as LlmContactPayload;
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("LLM did not return JSON");
    return JSON.parse(match[0]) as LlmContactPayload;
  }
}

function regexFallback(rawText: string, eventName: string, fileName: string, warning?: string): ContactDraft {
  const lines = rawText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const flat = lines.join(" ");
  const email = flat.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/)?.[0] || "";
  const website = flat.match(/(https?:\/\/)?(www\.)?[A-Za-z0-9-]+\.[A-Za-z]{2,}(\/[A-Za-z0-9._~:/?#[\]@!$&'()*+,;=%-]*)?/i)?.[0] || "";
  const linkedin = flat.match(/(https?:\/\/)?(www\.)?linkedin\.com\/[A-Za-z0-9_\-/%]+/i)?.[0] || "";
  const phoneMatches = Array.from(flat.matchAll(/\+?\d[\d\s()./-]{7,}\d/g)).map((match) => match[0].trim());
  const company = lines.find((line) => /gmbh|ag|llc|ltd|inc|group|bank|capital|partners|consulting|solutions|technology|systems|services|corp|company|holdings/i.test(line)) || "";
  const title = lines.find((line) => /manager|director|partner|analyst|associate|consultant|ceo|cfo|cto|president|sales|business development|investment|principal|founder|owner|head|lead/i.test(line)) || "";
  const name = lines.find((line) => line !== company && line !== title && !/@|linkedin|www\.|http|\d/.test(line) && line.split(/\s+/).length <= 4) || "";
  const split = splitName(name);
  let confidence = 35;
  if (email) confidence += 20;
  if (phoneMatches.length) confidence += 15;
  if (name) confidence += 15;
  if (company) confidence += 10;

  return withContactDefaults({
    event_name: eventName,
    source: "Upload",
    file_name: fileName,
    name,
    first_name: split.first_name,
    last_name: split.last_name,
    company,
    title,
    email,
    phone: phoneMatches[0] || "",
    mobile: phoneMatches.find((phone) => /(^|\D)(\+49|0)?1[567]/.test(phone.replace(/\s/g, ""))) || "",
    website,
    linkedin_url: linkedin,
    status: "New",
    confidence: Math.min(confidence, 85),
    raw_text: rawText,
    tags: [],
    notes: "",
    follow_up_date: null,
    extraction_mode: "regex_fallback",
    warnings: [warning || "LLM extraction not configured; used regex fallback."]
  });
}

export async function extractContact(rawText: string, eventName: string, fileName: string): Promise<ContactDraft> {
  const apiKey = env("LLM_API_KEY");
  if (!apiKey) return regexFallback(rawText, eventName, fileName);

  const baseUrl = env("LLM_BASE_URL", "https://api.openai.com/v1").replace(/\/$/, "");
  const model = env("LLM_MODEL", "gpt-4o-mini");
  const prompt = `Extract one business-card contact from OCR text. Return strict JSON only with keys: name, first_name, last_name, company, title, email, phone, mobile, website, linkedin_url, confidence (0-100), tags array, notes, warnings array. Prefer empty strings over guesses. OCR text:\n\n${rawText}`;

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You are a CRM data quality expert. Extract business-card contact data accurately. Do not invent missing values. Return only valid JSON."
          },
          { role: "user", content: prompt }
        ]
      })
    });

    if (!response.ok) {
      throw new Error(`LLM extraction failed with HTTP ${response.status}: ${await response.text()}`);
    }

    const json = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = json.choices?.[0]?.message?.content || "{}";
    const parsed = extractJson(content);
    const merged = withContactDefaults({
      ...parsed,
      event_name: eventName,
      source: "Upload",
      file_name: fileName,
      raw_text: rawText,
      status: "New",
      extraction_mode: "llm",
      confidence: parsed.confidence ?? 80,
      warnings: parsed.warnings || []
    });

    if (!merged.last_name && merged.name) {
      const split = splitName(merged.name);
      merged.first_name = split.first_name;
      merged.last_name = split.last_name;
    }

    return merged;
  } catch (error) {
    return regexFallback(
      rawText,
      eventName,
      fileName,
      error instanceof Error ? `LLM failed: ${error.message}; used regex fallback.` : "LLM failed; used regex fallback."
    );
  }
}
