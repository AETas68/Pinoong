const { Pool } = require('pg');

// Kết nối tới cơ sở dữ liệu Neon qua biến Render
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Hàm tự động khởi tạo bảng và sửa lỗi phân quyền
async function initDB() {
  try {
    // 1. Tạo bảng users nếu chưa có
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(50) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        role VARCHAR(20) NOT NULL
      );
    `);

    // 2. Tạo bảng lưu trữ trạng thái dữ liệu (state) nếu chưa có
    await pool.query(`
      CREATE TABLE IF NOT EXISTS state (
        id SERIAL PRIMARY KEY,
        data TEXT NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    console.log('✅ Cấu trúc bảng Database đã được kiểm tra thành công!');

    // 3. CODE SỬA LỖI ĐẶC BIỆT: Luôn cập nhật hoặc chèn mới tài khoản Admin tối cao từ Render
    const adminUser = process.env.ADMIN_USERNAME || 'admin';
    const adminPass = process.env.ADMIN_PASSWORD || 'MatKhauManh123';
    
    // Sử dụng thư viện bcrypt của dự án để mã hóa mật khẩu bảo mật
    const bcrypt = require('bcrypt');
    const hashedPassword = await bcrypt.hash(adminPass, 10);

    // Lệnh ép cập nhật tài khoản theo thông tin mới nhất trên Render
    const userQuery = `
      INSERT INTO users (username, password, role)
      VALUES ($1, $2, 'Quản lý')
      ON CONFLICT (username)
      DO UPDATE SET password = $2, role = 'Quản lý';
    `;
    await pool.query(userQuery, [adminUser, hashedPassword]);
    console.log(`🔄 Tài khoản Admin [${adminUser}] đã được đồng bộ chuẩn xác từ Render!`);

    // 4. RESET CẤU HÌNH GIAO DIỆN BỊ LỖI
    // Xóa dữ liệu cấu hình cũ bị kẹt trong bảng state để ép giao diện tải lại toàn bộ Tab cho Quản lý
    await pool.query('TRUNCATE TABLE state CASCADE;');
    console.log('🧹 Đã dọn sạch bộ nhớ đệm giao diện lỗi thành công!');

  } catch (err) {
    console.error('❌ Lỗi khởi tạo cơ sở dữ liệu:', err);
  }
}

// Khởi chạy hàm quét lỗi ngay khi server khởi động
initDB();

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool
};
const { Pool } = require('pg');

// Kết nối tới cơ sở dữ liệu Neon qua biến Render
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Hàm tự động khởi tạo bảng và sửa lỗi phân quyền
async function initDB() {
  try {
    // 1. Tạo bảng users nếu chưa có
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(50) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        role VARCHAR(20) NOT NULL
      );
    `);

    // 2. Tạo bảng lưu trữ trạng thái dữ liệu (state) nếu chưa có
    await pool.query(`
      CREATE TABLE IF NOT EXISTS state (
        id SERIAL PRIMARY KEY,
        data TEXT NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    console.log('✅ Cấu trúc bảng Database đã được kiểm tra thành công!');

    // 3. CODE SỬA LỖI ĐẶC BIỆT: Luôn cập nhật hoặc chèn mới tài khoản Admin tối cao từ Render
    const adminUser = process.env.ADMIN_USERNAME || 'admin';
    const adminPass = process.env.ADMIN_PASSWORD || 'MatKhauManh123';
    
    // SỬA LỖI TẠI ĐÂY: Sử dụng thư viện bảo mật nhẹ sẵn có trong hệ thống thay vì bcrypt nặng
    let hashedPassword = adminPass;
    try {
      // Thử dùng thư viện có sẵn của dự án để khớp hoàn toàn với file đăng nhập auth.js của bạn
      const bcryptjs = require('bcryptjs');
      hashedPassword = await bcryptjs.hash(adminPass, 10);
    } catch (e) {
      // Nếu không có bcryptjs, hệ thống dùng giải pháp dự phòng có sẵn trong Node.js (crypto)
      const crypto = require('crypto');
      hashedPassword = crypto.createHash('sha256').update(adminPass).digest('hex');
    }

    // Lệnh ép cập nhật tài khoản theo thông tin mới nhất trên Render
    const userQuery = `
      INSERT INTO users (username, password, role)
      VALUES ($1, $2, 'Quản lý')
      ON CONFLICT (username)
      DO UPDATE SET password = $2, role = 'Quản lý';
    `;
    await pool.query(userQuery, [adminUser, hashedPassword]);
    console.log(`🔄 Tài khoản Admin [${adminUser}] đã được đồng bộ chuẩn xác từ Render!`);

    // 4. RESET CẤU HÌNH GIAO DIỆN BỊ LỖI
    // Xóa dữ liệu cấu hình cũ bị kẹt trong bảng state để ép giao diện tải lại toàn bộ Tab cho Quản lý
    await pool.query('TRUNCATE TABLE state CASCADE;');
    console.log('🧹 Đã dọn sạch bộ nhớ đệm giao diện lỗi thành công!');

  } catch (err) {
    console.error('❌ Lỗi khởi tạo cơ sở dữ liệu:', err);
  }
}

// Khởi chạy hàm quét lỗi ngay khi server khởi động
initDB();

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool
};
