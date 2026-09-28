CREATE TABLE IF NOT EXISTS workspace_versions (workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id), version TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS presence (connection_id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), page_id TEXT NOT NULL REFERENCES pages(id), updated_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS presence_page ON presence(page_id,updated_at);
