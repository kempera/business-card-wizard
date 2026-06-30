import { requireEnv, env } from "./config";

interface GoogleVisionResponse {
  responses?: Array<{ fullTextAnnotation?: { text?: string }; error?: { message?: string } }>;
  error?: { message?: string };
}

export async function googleVisionOcr(imageBytes: Buffer): Promise<string> {
  const apiKey = requireEnv("GOOGLE_VISION_API_KEY");
  const imageBase64 = imageBytes.toString("base64");
  const response = await fetch(`https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      requests: [
        {
          image: { content: imageBase64 },
          features: [{ type: "TEXT_DETECTION" }]
        }
      ]
    })
  });

  const result = (await response.json()) as GoogleVisionResponse;
  const apiError = result.error?.message || result.responses?.[0]?.error?.message;
  if (!response.ok || apiError) {
    throw new Error(apiError || `Google Vision OCR failed with HTTP ${response.status}`);
  }

  return result.responses?.[0]?.fullTextAnnotation?.text || "";
}

/**
 * OpenAI Vision OCR — uses the same LLM_API_KEY already configured for extraction.
 * Sends the image as a base64 data URL to the vision-capable model and asks it to
 * transcribe all visible text exactly as it appears on the card.
 */
export async function openaiVisionOcr(imageBytes: Buffer, mimeType = "image/jpeg"): Promise<string> {
  const apiKey = requireEnv("LLM_API_KEY");
  const baseUrl = env("LLM_BASE_URL", "https://api.openai.com/v1").replace(/\/$/, "");
  const model = env("LLM_MODEL", "gpt-4o-mini");
  const dataUrl = `data:${mimeType};base64,${imageBytes.toString("base64")}`;

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Transcribe every word visible on this business card exactly as printed. Output plain text only, one piece of information per line, no commentary."
            },
            {
              type: "image_url",
              image_url: { url: dataUrl, detail: "high" }
            }
          ]
        }
      ]
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenAI Vision OCR failed with HTTP ${response.status}: ${body.slice(0, 200)}`);
  }

  const json = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return json.choices?.[0]?.message?.content?.trim() || "";
}

/** Pick the best available OCR method and run it. */
export async function runOcr(imageBytes: Buffer, mimeType?: string): Promise<string> {
  if (env("GOOGLE_VISION_API_KEY")) {
    return googleVisionOcr(imageBytes);
  }
  if (env("LLM_API_KEY")) {
    return openaiVisionOcr(imageBytes, mimeType);
  }
  throw new Error(
    "No OCR service configured. Set GOOGLE_VISION_API_KEY or LLM_API_KEY in your environment."
  );
}

