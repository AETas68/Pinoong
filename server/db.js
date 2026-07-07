const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

// Hàm khởi tạo hệ thống và sửa lỗi đồng bộ mật khẩu gốc
async function initSchema() {
  try {
    // 1. Tạo bảng users và bảng state nếu chưa có để đảm bảo an toàn cho dự án
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

    console.log('✅ Khởi tạo và kiểm tra cấu trúc bảng thành công!');

    // 2. Đồng bộ tài khoản Super Admin cố định mật khẩu trực tiếp, bỏ qua cơ chế băm tự động bị lệch
    // Tài khoản: Khapkhun | Mật khẩu: 123456
    // Chuỗi password bên dưới là mã hóa Bcryptjs chuẩn 100% của chuỗi '123456'
    const adminUser = 'Khapkhun';
    const secureHash = '$2a$10$EuyzD64YpIofmBv.M9.YreeYgI348D51aX.mC6O96eL/3n/YfWp7W';

    await pool.query(`
      INSERT INTO users (username, password, role)
      VALUES ($1, $2, 'Super Admin')
      ON CONFLICT (username)
      DO UPDATE SET password = $2, role = 'Super Admin';
    `, [adminUser, secureHash]);
    
    console.log(`🔑 Tài khoản Super Admin [${adminUser}] với mật khẩu mặc định đã được tạo cứng thành công!`);

    // 3. Thiết lập sẵn bản đồ 14 Tab chạy ngầm
    await pool.query('TRUNCATE TABLE state CASCADE;');
    await pool.query(`
      INSERT INTO state (data) VALUES ('{"activeTab":"dashboard","allowedTabs":["dashboard","banhang","nvl","inventory","menu","bantaicho","chamcong","chiphi","haohut","huyhang","tonkho","baocao","dubaodoanhthu","users"]}');
    `);
    console.log('🧹 Hệ thống đã được làm sạch và sẵn sàng hiển thị đầy đủ Menu!');

  } catch (err) {
    console.error('❌ Lỗi quét khởi tạo hệ thống:', err);
  }
}

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool,
  initSchema
};
