// server/db.js
// Ket noi PostgreSQL + khoi tao / tu vá cau truc bang du lieu khi server khoi dong.
// File nay duoc viet de AN TOAN chay lai nhieu lan (idempotent) va KHONG lam mat
// du lieu nguoi dung / du lieu app da co san tren Render, ke ca khi bang da ton tai
// voi cau truc cu (thieu cot) tu cac lan deploy truoc.

const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('localhost')
    ? false
    : { rejectUnauthorized: false }
});

async function initSchema() {
  // ------------------------------------------------------------------
  // 1. BANG users
  // ------------------------------------------------------------------
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      role TEXT NOT NULL DEFAULT 'staff',
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);

  // Vá cho database CŨ (đã tồn tại từ trước với schema thiếu cột) —
  // đây chính là nguyên nhân gây lỗi "không đăng nhập được".
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS name TEXT;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_superadmin BOOLEAN NOT NULL DEFAULT false;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();`);

  // Neu ban dau bang co cot "password" (kieu VARCHAR NOT NULL, luu thuong)
  // thi go bo rang buoc NOT NULL de khong chan viec tao user moi (chi dung password_hash tu nay).
  await pool.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'users' AND column_name = 'password'
      ) THEN
        ALTER TABLE users ALTER COLUMN password DROP NOT NULL;
      END IF;
    END $$;
  `);

  // Neu co user cu bi thieu "name", tam thoi dien = username de khong bi rong tren giao dien
  await pool.query(`UPDATE users SET name = username WHERE name IS NULL;`);

  // ------------------------------------------------------------------
  // 2. BANG app_state  (LƯU Ý: tên phải khớp với server/state.js — đây là
  //    lỗi thứ 2 đã gây crash ngay sau khi đăng nhập ở bản cũ, vì bản cũ
  //    tạo bảng tên "state" trong khi state.js lại đọc bảng "app_state")
  // ------------------------------------------------------------------
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_state (
      id INTEGER PRIMARY KEY DEFAULT 1,
      data JSONB NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT now(),
      updated_by TEXT,
      CONSTRAINT single_row CHECK (id = 1)
    );
  `);

  const stateRes = await pool.query('SELECT id FROM app_state WHERE id = 1');
  if (stateRes.rows.length === 0) {
    await pool.query(
      'INSERT INTO app_state (id, data, updated_by) VALUES (1, $1, $2)',
      [JSON.stringify({}), 'system']
    );
  }

  // ------------------------------------------------------------------
  // 3. (ĐÃ BỎ) Trước đây ở đây có 3 bảng SQL riêng cho NVL/công thức BTP
  //    (nvl_kho, btp_recipes, btp_export_logs). Đã loại bỏ vì trùng lặp
  //    với dữ liệu NVL/menu/tồn kho vốn đã sống trong app_state.data
  //    (S.nvl, S.menu, S.inventory...) — xem server/btp.js bản mới để
  //    biết công thức BTP giờ được lưu ở đâu (data.btp_recipes,
  //    data.btp_production, bên trong CHÍNH bảng app_state).
  // ------------------------------------------------------------------

  // ------------------------------------------------------------------
  // 4. BANG btp_branch_auth — mật khẩu RIÊNG cho từng file BTP,
  //    lưu dạng HASH trong DB (không hardcode trong code / không lộ trong
  //    biến môi trường công khai), do Super Admin cấp/đổi qua giao diện.
  //    (Đây vẫn cần một bảng SQL thật sự — vì đây là quyền truy cập cần
  //    máy chủ tự kiểm tra độc lập, không thể để trong app_state vì bất kỳ
  //    ai đăng nhập cũng có thể ghi đè app_state.)
  // ------------------------------------------------------------------
  await pool.query(`
    CREATE TABLE IF NOT EXISTS btp_branch_auth (
      branch TEXT PRIMARY KEY,
      password_hash TEXT NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT now(),
      updated_by TEXT
    );
  `);

  // ------------------------------------------------------------------
  // 5. Seed tài khoản quản lý đầu tiên NẾU bảng users đang trống hẳn
  //    (an toàn: không đụng tới user đã có sẵn)
  // ------------------------------------------------------------------
  const { rows: userCountRows } = await pool.query('SELECT COUNT(*)::int AS c FROM users');
  if (userCountRows[0].c === 0) {
    const username = process.env.ADMIN_USERNAME || 'admin';
    const password = process.env.ADMIN_PASSWORD || 'admin123';
    const hash = await bcrypt.hash(password, 10);
    await pool.query(
      'INSERT INTO users (username, password_hash, name, role, is_superadmin) VALUES ($1,$2,$3,$4,true)',
      [username, hash, 'Quản lý', 'admin', true]
    );
    console.log(`✅ Đã tạo tài khoản quản lý đầu tiên — username: "${username}"`);
    console.log('⚠️  Hãy đổi mật khẩu này ngay sau khi đăng nhập lần đầu (mục Người Dùng)!');
  }

  // Nếu database cũ có user "Khapkhun" với cột password (plaintext) từ bản lỗi
  // trước đây và CHƯA có password_hash -> cấp lại password_hash hợp lệ để
  // không ai còn phải dùng cổng hậu (backdoor) nữa. Mật khẩu tạm lấy theo
  // ADMIN_PASSWORD (hoặc "admin123" nếu chưa đặt) — đổi ngay sau khi login.
  await pool.query(`
    UPDATE users
    SET password_hash = COALESCE(password_hash, $1)
    WHERE password_hash IS NULL
  `, [await bcrypt.hash(process.env.ADMIN_PASSWORD || 'admin123', 10)]);

  // ------------------------------------------------------------------
  // 8. Nếu chưa ai là Super Admin, phong tài khoản admin lâu đời nhất
  // ------------------------------------------------------------------
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

  // ------------------------------------------------------------------
  // 9. Seed mật khẩu mặc định cho 2 file BTP nếu chưa từng được đặt
  //    (BẮT BUỘC đổi ngay sau khi deploy lần đầu, xem hướng dẫn bên dưới)
  // ------------------------------------------------------------------
  const defaultBtpPass = {
    khapkhun: process.env.BTP_PASS_KHAPKHUN_INIT || 'doimatkhaunay-kk',
    pinoong: process.env.BTP_PASS_PINOONG_INIT || 'doimatkhaunay-pn'
  };
  for (const branch of Object.keys(defaultBtpPass)) {
    const exists = await pool.query('SELECT branch FROM btp_branch_auth WHERE branch = $1', [branch]);
    if (exists.rows.length === 0) {
      const hash = await bcrypt.hash(defaultBtpPass[branch], 10);
      await pool.query(
        'INSERT INTO btp_branch_auth (branch, password_hash, updated_by) VALUES ($1,$2,$3)',
        [branch, hash, 'system-seed']
      );
      console.log(`🔑 Đã tạo mật khẩu mặc định cho file BTP "${branch}" — vui lòng đổi ngay.`);
    }
  }

  console.log('✅ initSchema hoàn tất — cấu trúc database đã đồng bộ với code.');
}

module.exports = { pool, initSchema };
