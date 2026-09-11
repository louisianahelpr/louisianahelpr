import fs from 'node:fs';
const text = fs.readFileSync(process.env.HOME + '/.lh-sweep/poster/.env', 'utf8');
const env = {}; for (const l of text.split('\n')) { const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, ''); }
export const URL_ = env.VITE_SUPABASE_URL; export const KEY = env.SUPABASE_SERVICE_ROLE_KEY || env.SERVICE_ROLE_KEY;
export async function get(table, q) { const r = await fetch(`${URL_}/rest/v1/${table}?${q}`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } }); if (!r.ok) throw new Error(await r.text()); return r.json(); }
export async function post(table, rows) { const r = await fetch(`${URL_}/rest/v1/${table}`, { method: 'POST', headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation' }, body: JSON.stringify(rows) }); if (!r.ok) throw new Error(await r.text()); return r.json(); }
export async function del(table, q) { const r = await fetch(`${URL_}/rest/v1/${table}?${q}`, { method: 'DELETE', headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, Prefer: 'return=representation' } }); if (!r.ok) throw new Error(await r.text()); return r.json(); }
export async function patch(table, q, body) { const r = await fetch(`${URL_}/rest/v1/${table}?${q}`, { method: 'PATCH', headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation' }, body: JSON.stringify(body) }); if (!r.ok) throw new Error(await r.text()); return r.json(); }
