ALTER TABLE pages ADD COLUMN public_token TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS pages_public_token ON pages(public_token) WHERE public_token IS NOT NULL;
