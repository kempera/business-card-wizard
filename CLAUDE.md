# Business Card Wizard v2

This repo is being migrated from a Streamlit prototype (`legacy/`) to a Next.js app-router application.

## Key commands
- `npm run lint`
- `npm run typecheck`
- `npm run build`

## Architecture
- Next.js App Router UI in `app/page.tsx`.
- API routes under `app/api/**`.
- Postgres persistence through `app/lib/db.ts`; schema in `db/schema.sql`.
- Google Vision OCR in `app/lib/ocr.ts`.
- OpenAI-compatible LLM extraction in `app/lib/contact-extractor.ts`.
- Salesforce REST push in `app/lib/salesforce.ts`.
- Optional LinkedIn enrichment in `app/lib/enrichment.ts`.

## Safety
- Never commit `.env` or credentials.
- Salesforce, LLM, OCR, and enrichment should fail with actionable configuration errors if secrets are missing.
- Keep the app usable in development without external services where possible, but production should set `APP_AUTH_PASSWORD`.
