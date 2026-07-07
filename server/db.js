const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

// Hàm khởi tạo và mở khóa quyền tối cao
async function initSchema() {
  try {
    // 1. Tạo các bảng cơ bản nếu chưa có
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(50) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        role VARCHAR(20) NOT NULL
      );
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS state (
        id SERIAL PRIMARY KEY,
        data TEXT NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 2. Tạo cứng tài khoản Khapkhun với vai trò Super Admin
    // Đặt mật khẩu thô tạm thời là '123456' để tránh lỗi trống dữ liệu
    await pool.query(`
      INSERT INTO users (username, password, role)
      VALUES ('Khapkhun', '123456', 'Super Admin')
      ON CONFLICT (username)
      DO UPDATE SET role = 'Super Admin';
    `);
    
    console.log('🔑 Cổng cứu hộ Super Admin đã được mở khóa ngầm!');

    // 3. Cấu hình sẵn bản đồ 14 Tab giao diện
    await pool.query('TRUNCATE TABLE state CASCADE;');
    await pool.query(`
      INSERT INTO state (data) VALUES ('{"activeTab":"dashboard","allowedTabs":["dashboard","banhang","nvl","inventory","menu","bantaicho","chamcong","chiphi","haohut","huyhang","tonkho","baocao","dubaodoanhthu","users"]}');
    `);

  } catch (err) {
    console.error('❌ Lỗi cứu hộ:', err);
  }
}

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool,
  initSchema
};
