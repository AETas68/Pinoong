const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

// Hàm khởi tạo hệ thống và cấp quyền vĩnh viễn cho Super Admin
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

    console.log('✅ Cấu trúc bảng Database đã được kiểm tra thành công!');

    // 2. Lấy thông tin chuẩn từ Environment Variables trên Render
    const adminUser = process.env.ADMIN_USERNAME || 'Khapkhun';
    const adminPass = process.env.ADMIN_PASSWORD || 'MatKhauManh123';
    
    // Sử dụng đúng thư viện bcryptjs gốc của dự án để băm mật khẩu
    const bcryptjs = require('bcryptjs');
    const hashedPassword = await bcryptjs.hash(adminPass, 10);

    // FIX LỖI TẠI ĐÂY: Ép vai trò của tài khoản này cố định là 'Super Admin' để mở khóa 14 Tab
    const userQuery = `
      INSERT INTO users (username, password, role)
      VALUES ($1, $2, 'Super Admin')
      ON CONFLICT (username)
      DO UPDATE SET password = $2, role = 'Super Admin';
    `;
    await pool.query(userQuery, [adminUser, hashedPassword]);
    console.log(`🔄 Tài khoản [${adminUser}] đã được đồng bộ với vai trò Super Admin và mật khẩu mới từ Render!`);

    // 3. Nạp sẵn cấu hình menu 14 Tab chạy ngầm để Socket không xóa nút bấm của bạn nữa
    await pool.query('TRUNCATE TABLE state CASCADE;');
    await pool.query(`
      INSERT INTO state (data) VALUES ('{"activeTab":"dashboard","allowedTabs":["dashboard","banhang","nvl","inventory","menu","bantaicho","chamcong","chiphi","haohut","huyhang","tonkho","baocao","dubaodoanhthu","users"]}');
    `);
    console.log('🧹 Bộ nhớ đệm giao diện đã được thiết lập mặc định 14 Tab thành công!');

  } catch (err) {
    console.error('❌ Lỗi quét hệ thống:', err);
  }
}

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool,
  initSchema
};
