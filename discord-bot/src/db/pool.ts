import { Pool, QueryResultRow } from 'pg';

let _pool: Pool | null = null;

/** Lazily create the read-only Postgres pool. */
export function getPool(): Pool {
  if (_pool) return _pool;
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error('DATABASE_URL not set (read-only Supabase connection string)');

  // Control TLS explicitly. Newer pg treats sslmode=require as verify-full, which
  // rejects Supabase's pooler cert chain — so strip sslmode from the URL and set
  // rejectUnauthorized:false ourselves (standard for Supabase from node-postgres).
  const wantSsl = /sslmode=/i.test(raw) || (process.env.DB_SSL || '').toLowerCase() === 'true';
  let cs = raw;
  try {
    const u = new URL(raw);
    u.searchParams.delete('sslmode');
    cs = u.toString();
  } catch {
    /* leave as-is if it isn't a parseable URL */
  }
  _pool = new Pool({
    connectionString: cs,
    ssl: wantSsl ? { rejectUnauthorized: false } : undefined,
    max: 5,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
    statement_timeout: 10_000,
    query_timeout: 12_000,
    application_name: 'elyon-discord-bot',
  });
  _pool.on('error', (e) => console.error('[db] idle client error:', e.message));
  return _pool;
}

/** Run a parameterised query and return the rows. The role is SELECT-only — writes are impossible. */
export async function q<T extends QueryResultRow = any>(text: string, params: unknown[] = []): Promise<T[]> {
  const res = await getPool().query<T>(text, params as any[]);
  return res.rows;
}

/** Quick connectivity check used at boot. */
export async function pingDb(): Promise<void> {
  await q('SELECT 1 AS ok');
}
