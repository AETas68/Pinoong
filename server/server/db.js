// server/db.js
// Ket noi PostgreSQL + khoi tao bang du lieu (chay tu dong khi server khoi dong)
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('localhost')
    ? false
    : { rejectUnauthorized: false }
});

async function initSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'staff',
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);

  // Them cot is_superadmin neu chua co (cho cac DB da tao truoc do)
  await pool.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS is_superadmin BOOLEAN NOT NULL DEFAULT false;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_state (
      id INTEGER PRIMARY KEY DEFAULT 1,
      data JSONB NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT now(),
      updated_by TEXT,
      CONSTRAINT single_row CHECK (id = 1)
    );
  `);

  // Seed tai khoan quan ly dau tien neu chua co user nao
  const { rows } = await pool.query('SELECT COUNT(*)::int AS c FROM users');
  if (rows[0].c === 0) {
    const username = process.env.ADMIN_USERNAME || 'admin';
    const password = process.env.ADMIN_PASSWORD || 'admin123';
    const hash = await bcrypt.hash(password, 10);
    await pool.query(
      'INSERT INTO users (username, password_hash, name, role, is_superadmin) VALUES ($1,$2,$3,$4,true)',
      [username, hash, 'Quản lý', 'admin']
    );
    console.log(`✅ Đã tạo tài khoản quản lý đầu tiên — username: "${username}" / password: "${password}"`);
    console.log('⚠️  Hãy đổi mật khẩu này sau khi đăng nhập lần đầu (mục Người Dùng)!');
  }

  // Neu chua co ai la Super Admin (vi du DB da tao tu truoc khi co tinh nang nay),
  // tu dong phong tai khoan admin lau doi nhat thanh Super Admin.
  const superCheck = await pool.query('SELECT COUNT(*)::int AS c FROM users WHERE is_superadmin = true');
  if (superCheck.rows[0].c === 0) {
    const { rows: oldestAdmin } = await pool.query(
      "SELECT id, username FROM users WHERE role = 'admin' ORDER BY id ASC LIMIT 1"
    );
    if (oldestAdmin.length > 0) {
      await pool.query('UPDATE users SET is_superadmin = true WHERE id = $1', [oldestAdmin[0].id]);
      console.log(`🔐 Đã phong tài khoản "${oldestAdmin[0].username}" thành Super Admin.`);
    }
  }

  // Seed app_state rong neu chua co
  const stateRes = await pool.query('SELECT id FROM app_state WHERE id = 1');
  if (stateRes.rows.length === 0) {
    await pool.query(
      'INSERT INTO app_state (id, data, updated_by) VALUES (1, $1, $2)',
      [JSON.stringify({}), 'system']
    );
  }
}

module.exports = { pool, initSchema };
