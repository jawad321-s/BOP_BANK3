// Creates the fresh, uniquely named E2E database (never touches existing databases).
import pg from 'pg';
const name = process.env.E2E_DB;
if (!name || !name.startsWith('bitaqati_e2e_')) throw new Error('E2E_DB must start with bitaqati_e2e_');
const c = new pg.Client({ connectionString: process.env.E2E_ADMIN_DB_URL ?? 'postgresql://bitaqati:bitaqati@localhost:5432/postgres' });
await c.connect();
await c.query(`CREATE DATABASE "${name}"`);
await c.end();
console.log('created', name);
