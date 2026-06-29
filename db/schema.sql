CREATE TABLE IF NOT EXISTS contacts (
  id TEXT PRIMARY KEY,
  event_name TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'Upload',
  file_name TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL DEFAULT '',
  first_name TEXT NOT NULL DEFAULT '',
  last_name TEXT NOT NULL DEFAULT '',
  company TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  normalized_email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  normalized_phone TEXT NOT NULL DEFAULT '',
  mobile TEXT NOT NULL DEFAULT '',
  website TEXT NOT NULL DEFAULT '',
  linkedin_url TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'New',
  confidence INTEGER NOT NULL DEFAULT 0,
  raw_text TEXT NOT NULL DEFAULT '',
  tags TEXT[] NOT NULL DEFAULT '{}',
  notes TEXT NOT NULL DEFAULT '',
  follow_up_date DATE,
  extraction_mode TEXT NOT NULL DEFAULT 'llm',
  warnings TEXT[] NOT NULL DEFAULT '{}',
  enriched_json JSONB,
  salesforce_id TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS contacts_normalized_email_unique
  ON contacts (normalized_email)
  WHERE normalized_email <> '';

CREATE INDEX IF NOT EXISTS contacts_normalized_phone_idx
  ON contacts (normalized_phone)
  WHERE normalized_phone <> '';

CREATE INDEX IF NOT EXISTS contacts_linkedin_url_idx
  ON contacts (linkedin_url)
  WHERE linkedin_url <> '';

CREATE INDEX IF NOT EXISTS contacts_event_name_idx ON contacts (event_name);
CREATE INDEX IF NOT EXISTS contacts_status_idx ON contacts (status);
CREATE INDEX IF NOT EXISTS contacts_created_at_idx ON contacts (created_at DESC);
