import type { FeatureStatus } from "./types";

export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigurationError";
  }
}

export function env(name: string, fallback = ""): string {
  return process.env[name]?.trim() || fallback;
}

export function requireEnv(name: string): string {
  const value = env(name);
  if (!value) {
    throw new ConfigurationError(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function appUrl(): string {
  return env("NEXT_PUBLIC_APP_URL", "http://localhost:3000").replace(/\/$/, "");
}

export function featureStatus(): FeatureStatus {
  return {
    database: Boolean(env("DATABASE_URL")),
    googleVision: Boolean(env("GOOGLE_VISION_API_KEY")),
    llmExtraction: Boolean(env("LLM_API_KEY")),
    salesforce: Boolean(
      env("SALESFORCE_CLIENT_ID") &&
        env("SALESFORCE_CLIENT_SECRET") &&
        env("SALESFORCE_REFRESH_TOKEN")
    ),
    linkedinEnrichment: Boolean(
      env("LINKEDIN_ENRICHMENT_WEBHOOK_URL") || env("PROXYCURL_API_KEY")
    ),
    auth: Boolean(env("APP_AUTH_PASSWORD"))
  };
}
