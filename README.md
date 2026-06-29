# Business Card Wizard v2

AI-powered business-card capture and CRM pipeline.

## What v2 implements

- **A — LLM extraction:** Google Vision OCR text is parsed by an OpenAI-compatible LLM endpoint, with a regex fallback.
- **B — Persistent storage:** Postgres via `DATABASE_URL`; `docker-compose.hostinger.yml` is ready for Hostinger VPS deployment.
- **C — Review UI:** OCR/LLM drafts are editable before saving.
- **D — Salesforce:** Real OAuth refresh-token Salesforce Lead creation via REST API.
- **F — Camera input:** Mobile browser camera capture through `accept="image/*" capture="environment"`.
- **G — Deduplication:** Reviewed saves update existing contacts by normalized email, phone, or LinkedIn URL.
- **H — Batch progress:** Sequential processing progress bar.
- **I — Tags/follow-up:** Tags, statuses, notes, follow-up dates, filters, and dashboard metrics.
- **J — LinkedIn enrichment:** Optional Proxycurl or generic webhook enrichment stored as JSON.
- **K — Authentication:** Basic auth middleware via `APP_AUTH_USER` / `APP_AUTH_PASSWORD`.
- **L — Next.js migration:** Full-stack Next.js app replaces the Streamlit prototype, which remains in `legacy/`.
- **M — vCard/QR:** Excel cube, all-contact vCard export, per-contact vCard, and per-contact QR PNG.

## Local setup

```bash
npm install
cp .env.example .env
# edit .env
npm run dev
```

At minimum for real processing you need:

```bash
DATABASE_URL=postgres://...
GOOGLE_VISION_API_KEY=...
LLM_API_KEY=...
```

If `LLM_API_KEY` is missing, the app falls back to regex extraction and shows a warning.

## Hostinger storage/deployment

The app is designed to run on Andreas's Hostinger VPS with Docker Compose:

```bash
cp .env.example .env
# set POSTGRES_PASSWORD and app/API secrets
npm install
npm run build
docker compose -f docker-compose.hostinger.yml up -d --build
```

The compose file binds the app to `127.0.0.1:3007` so a reverse proxy such as Traefik or Cloudflare Tunnel can publish it safely.

## Salesforce setup

Create a Salesforce Connected App and place these in `.env`:

```bash
SALESFORCE_LOGIN_URL=https://login.salesforce.com
SALESFORCE_CLIENT_ID=...
SALESFORCE_CLIENT_SECRET=...
SALESFORCE_REFRESH_TOKEN=...
SALESFORCE_API_VERSION=60.0
SALESFORCE_LINKEDIN_FIELD=LinkedIn_Profile__c
```

The API creates `Lead` records and maps LinkedIn to `LinkedIn_Profile__c` by default.

## LinkedIn enrichment setup

Choose one:

```bash
PROXYCURL_API_KEY=...
```

or:

```bash
LINKEDIN_ENRICHMENT_WEBHOOK_URL=https://...
LINKEDIN_ENRICHMENT_WEBHOOK_TOKEN=...
```

The webhook receives `{ contact }` and can return any JSON profile payload.

## Verification

```bash
npm run lint
npm run typecheck
npm run build
```

## Legacy prototype

The original Streamlit app and Python requirements are preserved in `legacy/` for comparison.
