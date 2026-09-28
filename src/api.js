export async function api(path, method = 'GET', body) {
  const res = await fetch('/api' + path, {
    method,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) {
    const error = new Error(data.error || 'Request failed');
    error.status = res.status;
    throw error;
  }
  return data;
}
export const uid = () => crypto.randomUUID();
export const label = (p) => p?.title || 'Untitled';
export const canEdit = (p) => ['owner', 'edit'].includes(p?.permission);
export function plain(html) {
  const el = document.createElement('div');
  el.innerHTML = html;
  return el.textContent || '';
}
export function escapeHTML(value) {
  const el = document.createElement('div');
  el.textContent = value;
  return el.innerHTML;
}
