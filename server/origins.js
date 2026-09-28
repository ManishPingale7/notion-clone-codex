import { readFileSync } from 'node:fs';

// Only explicitly configured origins are trusted across the hosting proxy.
// Reading this small file on demand lets the host accept a new Vercel alias
// without restarting a running database or disconnecting collaborators.
export function allowedOrigin(origin, host, protocol = 'http') {
  if (!origin) return true;
  if (origin === `${protocol}://${host}`) return true;
  const origins = (process.env.ALLOWED_ORIGINS || '').split(',').map((value) => value.trim());
  if (process.env.ALLOWED_ORIGINS_FILE) {
    try {
      const configured = JSON.parse(readFileSync(process.env.ALLOWED_ORIGINS_FILE, 'utf8'));
      if (Array.isArray(configured)) origins.push(...configured);
    } catch {
      // Fail closed if the hosting configuration is missing or malformed.
    }
  }
  return origins.includes(origin);
}
