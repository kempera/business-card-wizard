import { requireEnv } from "./config";

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
