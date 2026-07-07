const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

// SỬA LỖI TẠI ĐÂY: Đổi tên hàm thành initSchema để khớp chính xác với file server/index.js
async function initSchema() {
  try {
    // 1. Tạo bảng users và bảng state nếu chưa có để tránh lỗi sập server
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

    // 2. Đồng bộ chuẩn xác tài khoản từ Render theo đúng thư viện bcryptjs gốc của bạn
    const adminUser = process.env.ADMIN_USERNAME || 'admin';
    const adminPass = process.env.ADMIN_PASSWORD || 'MatKhauManh123';
    
    const bcryptjs = require('bcryptjs');
    const hashedPassword = await bcryptjs.hash(adminPass, 10);

    // Ép cập nhật tài khoản Quản lý tối cao
    await pool.query(`
      INSERT INTO users (username, password, role)
      VALUES ($1, $2, 'Quản lý')
      ON CONFLICT (username)
      DO UPDATE SET password = $2, role = 'Quản lý';
    `, [adminUser, hashedPassword]);
    
    console.log(`🔄 Đã đồng bộ tài khoản Admin [${adminUser}] chuẩn mã hóa gốc!`);

    // 3. Xóa cấu hình hiển thị menu cũ đang bị lỗi khóa tab
    await pool.query('TRUNCATE TABLE state CASCADE;');
    console.log('🧹 Đã dọn sạch bộ nhớ đệm giao diện lỗi!');

  } catch (err) {
    console.error('❌ Lỗi quét hệ thống:', err);
  }
}

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool,
  initSchema // Xuất hàm này ra cho file index.js gọi dùng lúc khởi động
};
