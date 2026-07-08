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
let matKhauHeThongBtp = {
    khapkhun: "khapkhun2026",
    pinoong: "pinoong2026"
};

// Mảng lưu trữ lịch sử xuất bán BTP của các quán truyền về để làm báo cáo P&L gom chung
if (!global.btpExportLogs) {
    global.btpExportLogs = [];
}

/**
 * API 1: Kiểm tra và trả mật khẩu chuẩn về cho các file BTP dưới ổ C đối chiếu xác thực
 * Đường dẫn gọi: GET https://onrender.com
 */
app.get('/api/btp/secure-check', function(req, res) {
    const chiNhanh = req.query.branch;
    if (!chiNhanh || !matKhauHeThongBtp[chiNhanh]) {
        return res.status(400).json({ success: false, message: "Chi nhánh không hợp lệ hoặc chưa cấu hình mật khẩu!" });
    }
    // Trả mật khẩu chính xác về trình duyệt để file ổ C chạy logic so khớp
    res.json({ success: true, secure_key: matKhauHeThongBtp[chiNhanh] });
});

/**
 * API 2: Nhận mật khẩu mới do Super Admin thay đổi từ giao diện Dashboard trên Render
 * Đường dẫn gọi: POST https://onrender.com
 */
app.post('/api/btp/secure-update', function(req, res) {
    const passMoiKhapKhun = req.body.passKhapKhun;
    const passMoiPinoong = req.body.passPinoong;
    
    // Cập nhật đè lên cấu hình bảo mật cũ nếu Admin có nhập mật khẩu mới
    if (passMoiKhapKhun && passMoiKhapKhun.trim() !== "") matKhauHeThongBtp.khapkhun = passMoiKhapKhun.trim();
    if (passMoiPinoong && passMoiPinoong.trim() !== "") matKhauHeThongBtp.pinoong = passMoiPinoong.trim();
    
    res.json({ success: true, message: "Hệ thống trung tâm đã lưu mật khẩu file BTP mới thành công!" });
});

/**
 * API 3: Xuất toàn bộ bảng giá và số lượng tồn kho NVL dùng chung truyền về cho file BTP ở ổ C
 * Đường dẫn gọi: GET https://onrender.com
 */
app.get('/api/btp/get-nvl-shared', function(req, res) {
    // Đọc danh sách NVL hiện tại của bạn từ bộ nhớ Server hoặc Database
    let danhSachKhoNvlTongHop = [];
    
    if (typeof global.nvlList !== 'undefined') {
        danhSachKhoNvlTongHop = global.nvlList;
    } else if (typeof state !== 'undefined' && state.nvl) {
        danhSachKhoNvlTongHop = state.nvl;
    } else {
        // Nếu server khởi động lại chưa có dữ liệu, trả về mảng rỗng để không bị sập file dưới máy
        danhSachKhoNvlTongHop = [];
    }
    
    res.json({ success: true, nvlList: danhSachKhoNvlTongHop });
});

/**
 * API 4: Nhận hóa đơn xuất bán BTP từ dưới máy và chạy logic tự động khấu trừ kho tổng thực tế
 * Đường dẫn gọi: POST https://onrender.com
 */
app.post('/api/btp/export-sync', function(req, res) {
    const chiNhanhGui = req.body.branch;
    const donHang = req.body.orderData;
    
    // Lấy mảng dữ liệu kho gốc đang vận hành trên server Render của bạn
    let mangKhoNvlThucTe = [];
    if (typeof global.nvlList !== 'undefined') mangKhoNvlThucTe = global.nvlList;
    else if (typeof state !== 'undefined' && state.nvl) mangKhoNvlThucTe = state.nvl;

    // Tiến hành chạy thuật toán bóc tách công thức và trừ kho liên thông
    if (donHang && Array.isArray(donHang.congThuc) && mangKhoNvlThucTe.length > 0) {
        donHang.congThuc.forEach(function(itemNvlDung) {
            // Tìm nguyên liệu trong kho tổng dựa trên tên gọi trùng khớp hoàn toàn
            let nvlGocTrongKho = mangKhoNvlThucTe.find(function(n) { return n.name === itemNvlDung.name; });
            
            if (nvlGocTrongKho) {
                let dinhLuongSuDung = parseFloat(itemNvlDung.qty || 0);
                
                // Quy đổi đơn vị: Nếu đơn vị tính là kg hoặc lít thì chia cho 1000 theo đúng công thức gốc tại file BTP của bạn
                let donViTinh = (nvlGocTrongKho.unit || '').trim().toLowerCase();
                if (donViTinh === 'kg' || donViTinh === 'lít' || donViTinh === 'lit' || donViTinh === 'l') {
                    dinhLuongSuDung = dinhLuongSuDung / 1000;
                }
                
                // Công thức tính lượng hao hụt thực tế = Định lượng dùng * (1 + % hao hụt) * số lượng mẻ xuất bán
                let luongHaoHutMoiMe = dinhLuongSuDung * (1 + parseFloat(itemNvlDung.waste || 0));
                let tongKhoiLuongTruKho = luongHaoHutMoiMe * parseFloat(donHang.qty || 1);
                
                // Khấu trừ thẳng vào tồn kho tổng hợp, khống chế mức sàn bằng 0 để không bị lỗi âm kho
                nvlGocTrongKho.stock = Math.max(0, parseFloat(nvlGocTrongKho.stock || 0) - tongKhoiLuongTruKho);
            }
        });

        // Ghi lại mảng kho mới sau khi trừ vào bộ lưu trữ cốt lõi của hệ thống Render
        if (typeof global.nvlList !== 'undefined') global.nvlList = mangKhoNvlThucTe;
        else if (typeof state !== 'undefined' && state.nvl) state.nvl = mangKhoNvlThucTe;
        
        // Đẩy hóa đơn này vào danh sách lịch sử gộp chung để phục vụ báo cáo tài chính P&L tổng
        global.btpExportLogs.unshift({
            branch: chiNhanhGui,
            date: donHang.date,
            dish_name: donHang.dish_name,
            qty: donHang.qty,
            unit: donHang.unit,
            von_nvl: donHang.von_nvl,
            doanh_thu: donHang.doanh_thu,
            ln: donHang.ln,
            note: donHang.note
        });
    }
    
    res.json({ success: true, message: "Hệ thống trung tâm Render đã ghi nhận đơn bán BTP và tự động khấu trừ kho thành công!" });
});
// =====================================================================================

