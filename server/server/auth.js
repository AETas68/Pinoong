// server/auth.js
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool } = require('./db');

const router = express.Router();
const SECRET = process.env.JWT_SECRET || 'doi-secret-nay-trong-file-.env';

function signToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, name: user.name, role: user.role, is_superadmin: !!user.is_superadmin },
    SECRET,
    { expiresIn: '30d' }
  );
}

function requireAuth(req, res, next) {
  const header = req.headers['authorization'];
  if (!header) return res.status(401).json({ error: 'Chưa đăng nhập' });
  const token = header.split(' ')[1];
  jwt.verify(token, SECRET, (err, decoded) => {
    if (err) return res.status(403).json({ error: 'Phiên đăng nhập hết hạn, vui lòng đăng nhập lại' });
    req.user = decoded;
    next();
  });
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Chỉ Quản lý mới có quyền này' });
  }
  next();
}

function requireSuperAdmin(req, res, next) {
  if (!req.user?.is_superadmin) {
    return res.status(403).json({ error: 'Chỉ Super Admin mới có quyền này' });
  }
  next();
}

// ------------------- LOGIN -------------------
router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Thiếu tài khoản hoặc mật khẩu' });
  try {
    const { rows } = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    if (rows.length === 0) return res.status(401).json({ error: 'Sai tài khoản hoặc mật khẩu' });
    const user = rows[0];
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Sai tài khoản hoặc mật khẩu' });
    const token = signToken(user);
    res.json({
      token,
      user: { id: user.id, username: user.username, name: user.name, role: user.role, is_superadmin: !!user.is_superadmin }
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ------------------- ĐỔI MẬT KHẨU CỦA CHÍNH MÌNH -------------------
router.post('/change-password', requireAuth, async (req, res) => {
  const { old_password, new_password } = req.body;
  if (!new_password || new_password.length < 4) {
    return res.status(400).json({ error: 'Mật khẩu mới phải từ 4 ký tự trở lên' });
  }
  try {
    const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [req.user.id]);
    const user = rows[0];
    const ok = await bcrypt.compare(old_password || '', user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Mật khẩu hiện tại không đúng' });
    const hash = await bcrypt.hash(new_password, 10);
    await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, req.user.id]);
    res.json({ message: 'Đã đổi mật khẩu' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = { router, requireAuth, requireAdmin, requireSuperAdmin };
// =====================================================================================
// [BỔ SUNG] CÁC API LIÊN THÔNG DỮ LIỆU KHO VÀ ĐIỀU KHIỂN BẢO MẬT FILE BTP CHO 2 CƠ SỞ
// =====================================================================================

// 1. Cấu hình mật khẩu gốc ban đầu cho 2 quán (Mật khẩu mặc định, Admin có thể đổi trên web)
// =====================================================================================
// [ĐÃ FIX LỖI] API LIÊN THÔNG DỮ LIỆU KHO VÀ ĐIỀU KHIỂN BẢO MẬT FILE BTP CHUẨN JSON
// =====================================================================================

// Mật khẩu cố định dự phòng ban đầu nếu admin chưa cấu hình trên giao diện
let matKhauHeThongBtp = {
    khapkhun: "khapkhun2026",
    pinoong: "pinoong2026"
};

/**
 * [ĐÃ FIX LỖI] API 1: Xác thực mật khẩu chi nhánh 
 * Nhận cả phương thức gửi dữ liệu Query và Body từ các trình duyệt
 */
router.get('/api/btp/secure-check', function(req, res) {
    const chiNhanh = req.query.branch || req.body.branch;
    
    let correctKey = "";
    if (chiNhanh === 'khapkhun') {
        correctKey = process.env.BTP_PASS_KHAPKHUN || matKhauHeThongBtp.khapkhun;
    } else if (chiNhanh === 'pinoong') {
        correctKey = process.env.BTP_PASS_PINOONG || matKhauHeThongBtp.pinoong;
    } else {
        return res.status(400).json({ success: false, message: "Chi nhánh không hợp lệ!" });
    }
    
    res.json({ success: true, secure_key: correctKey });
});

/**
 * [ĐÃ FIX LỖI] API 2: Nhận cập nhật mật khẩu mới từ Super Admin trên giao diện Web Render
 */
router.post('/api/btp/secure-update', function(req, res) {
    const passMoiKhapKhun = req.body.passKhapKhun;
    const passMoiPinoong = req.body.passPinoong;
    
    if (passMoiKhapKhun && passMoiKhapKhun.trim() !== "") matKhauHeThongBtp.khapkhun = passMoiKhapKhun.trim();
    if (passMoiPinoong && passMoiPinoong.trim() !== "") matKhauHeThongBtp.pinoong = passMoiPinoong.trim();
    
    res.json({ success: true, message: "Hệ thống trung tâm đã lưu mật khẩu file BTP mới thành công!" });
});

/**
 * [ĐÃ FIX LỖI] API 3: Truy xuất kho nguyên vật liệu tổng hợp chuyển về cho file BTP
 */
router.get('/api/btp/get-nvl-shared', function(req, res) {
    let databaseKhoNVL = [];
    
    if (typeof global.nvlList !== 'undefined' && global.nvlList.length > 0) {
        databaseKhoNVL = global.nvlList;
    } else if (typeof state !== 'undefined' && state.nvl && state.nvl.length > 0) {
        databaseKhoNVL = state.nvl;
    } else if (typeof INITIAL_NVL !== 'undefined') {
        databaseKhoNVL = INITIAL_NVL;
    }
    
    res.json({ success: true, nvlList: databaseKhoNVL });
});

    res.json({ success: true, message: "Hệ thống trung tâm Render đã ghi nhận đơn bán BTP và tự động khấu trừ kho thành công!" });
});
// =====================================================================================

