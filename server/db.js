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
    
    // Sử dụng giải pháp mã hóa an toàn có sẵn trong Node.js (crypto), không lo lỗi thiếu thư viện
    const crypto = require('crypto');
    const hashedPassword = crypto.createHash('sha256').update(adminPass).digest('hex');

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
