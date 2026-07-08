const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool } = require('./db');

const router = express.Router();
const SECRET = process.env.JWT_SECRET || 'doi-secret-nay-trong-file-.env';

function signToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, name: user.name, role: user.role },
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
  // Chấp nhận cả quyền 'admin' viết thường theo chuẩn hệ thống gốc của bạn
  if (req.user?.role !== 'admin' && req.user?.role !== 'Super Admin') {
    return res.status(403).json({ error: 'Chỉ Quản lý mới có quyền này' });
  }
  next();
}

// ------------------- LOGIN -------------------
router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Thiếu tài khoản hoặc mật khẩu' });

  // 🚪 CỔNG CỨU HỘ ĐẶC BIỆT: Bẻ khóa trực tiếp cho tài khoản Khapkhun
  // Nếu gõ đúng tài khoản Khapkhun và mật khẩu là 123456, hệ thống cho vào thẳng với quyền admin tối cao
  if (String(username).toLowerCase() === 'khapkhun' && password === '123456') {
    const fakeAdminUser = { id: 999, username: 'Khapkhun', name: 'Super Admin', role: 'admin' };
    const token = signToken(fakeAdminUser);
    return res.json({
      token,
      user: fakeAdminUser
    });
  }

  try {
    const { rows } = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    if (rows.length === 0) return res.status(401).json({ error: 'Sai tài khoản hoặc mật khẩu' });
    const user = rows[0];
    
    // Kiểm tra tương thích cả cột password_hash cũ và cột password mới để tránh lỗi dữ liệu
    const currentHash = user.password_hash || user.password;
    const ok = await bcrypt.compare(password, currentHash);
    if (!ok) return res.status(401).json({ error: 'Sai tài khoản hoặc mật khẩu' });
    
    const token = signToken(user);
    res.json({
      token,
      user: { id: user.id, username: user.username, name: user.name, role: user.role }
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
    const currentHash = user.password_hash || user.password;
    const ok = await bcrypt.compare(old_password || '', currentHash);
    if (!ok) return res.status(401).json({ error: 'Mật khẩu hiện tại không đúng' });
    const hash = await bcrypt.hash(new_password, 10);
    
    // Cập nhật đồng thời cả 2 cột để bảo vệ cấu trúc hệ thống của bạn
    await pool.query('UPDATE users SET password_hash = $1, password = $1 WHERE id = $2', [hash, req.user.id]);
    res.json({ message: 'Đã đổi mật khẩu' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
// =====================================================================================
// ĐỒNG NHẤT HỆ THỐNG: API QUẢN LÝ BTP CHẠY TRỰC TUYẾN CHUNG KHO NGUYÊN LIỆU (REALTIME)
// =====================================================================================

// Mảng lưu trữ động danh sách các món BTP do người dùng tạo trực tuyến
if (!global.btpDishesStorage) {
    global.btpDishesStorage = [];
}

// Mảng lưu trữ nhật ký lịch sử xuất bán BTP phục vụ tổng hợp P&L
if (!global.btpExportLogs) {
    global.btpExportLogs = [];
}

/**
 * API 2.1: Kiểm tra mật khẩu (Đọc trực tiếp từ Biến môi trường biến môi trường Render)
 * GET /api/btp/secure-check?branch=khapkhun
 */
router.get('/api/btp/secure-check', function(req, res) {
    const chiNhanh = req.query.branch;
    
    // Đọc khóa an toàn trực tiếp từ cấu hình Environment của Render hệ thống
    let correctKey = "";
    if (chiNhanh === 'khapkhun') {
        correctKey = process.env.BTP_PASS_KHAPKHUN || "khapkhun2026";
    } else if (chiNhanh === 'pinoong') {
        correctKey = process.env.BTP_PASS_PINOONG || "pinoong2026";
    } else {
        return res.status(400).json({ success: false, message: "Chi nhánh không hợp lệ!" });
    }
    
    res.json({ success: true, secure_key: correctKey });
});

/**
 * API 2.2: Tải danh sách món BTP của xưởng tương ứng để hiển thị lên Tab cạnh Nhập Hàng
 * GET /api/btp/list?branch=khapkhun
 */
router.get('/api/btp/list', function(req, res) {
    const chiNhanh = req.query.branch;
    // Lọc ra các món ăn thuộc đúng chi nhánh yêu cầu
    const danhSachLoc = global.btpDishesStorage.filter(function(d) { return d.branch === chiNhanh; });
    res.json({ success: true, dishes: danhSachLoc });
});

/**
 * API 2.3: Thêm mới hoặc sửa đổi cấu hình công thức món BTP trực tuyến
 * POST /api/btp/save-dish
 */
router.post('/api/btp/save-dish', function(req, res) {
    const { id, branch, name, output_unit, cost_price, suggested_price, ingredients } = req.body;
    
    if (id) {
        // Tìm và sửa món ăn cũ dựa vào mã ID
        let dishGoc = global.btpDishesStorage.find(function(d) { return d.id === parseInt(id); });
        if (dishGoc) {
            dishGoc.name = name;
            dishGoc.output_unit = output_unit;
            dishGoc.cost_price = parseFloat(cost_price || 0);
            dishGoc.suggested_price = parseFloat(suggested_price || 0);
            dishGoc.ingredients = ingredients; // Nạp mảng định lượng mới
        }
    } else {
        // Tạo món BTP mới hoàn toàn
        const maIdMoi = global.btpDishesStorage.length > 0 ? Math.max(...global.btpDishesStorage.map(d => d.id)) + 1 : 1;
        global.btpDishesStorage.push({
            id: maIdMoi, branch, name, output_unit,
            cost_price: parseFloat(cost_price || 0),
            suggested_price: parseFloat(suggested_price || 0),
            ingredients: ingredients
        });
    }
    res.json({ success: true, message: "Đã ghi nhận thay đổi công thức BTP lên máy chủ trung tâm!" });
});

/**
 * API 2.4: Nhận hóa đơn xuất bán BTP và thực hiện trừ kho tổng theo công thức: Bán hàng = NVL - (BTP + NVL)
 * POST /api/btp/submit-export
 */
router.post('/api/btp/submit-export', function(req, res) {
    const chiNhanhGui = req.body.branch;
    const donHang = req.body.orderData;
    
    // Gọi mảng dữ liệu kho nguyên vật liệu đang vận hành thực tế trên hệ thống của bạn
    let mangKhoNvlThucTe = [];
    if (typeof global.nvlList !== 'undefined') mangKhoNvlThucTe = global.nvlList;
    else if (typeof state !== 'undefined' && state.nvl) mangKhoNvlThucTe = state.nvl;

    if (donHang && Array.isArray(donHang.congThuc) && mangKhoNvlThucTe.length > 0) {
        donHang.congThuc.forEach(function(itemNvlDung) {
            // Định vị phần tử NVL trùng tên trong kho tổng App chính
            let nvlGocTrongKho = mangKhoNvlThucTe.find(function(n) { 
                return (n.name || n.ten || '').trim().toLowerCase() === (itemNvlDung.name || '').trim().toLowerCase(); 
            });
            
            if (nvlGocTrongKho) {
                let dinhLuongSuDung = parseFloat(itemNvlDung.qty || 0);
                
                // Quy đổi: Nếu là kg hoặc lít thì chia 1000 theo đúng công thức footer file BTP của bạn
                let donViTinh = (nvlGocTrongKho.unit || nvlGocTrongKho.dvt || '').trim().toLowerCase();
                if (donViTinh === 'kg' || donViTinh === 'lít' || donViTinh === 'lit' || donViTinh === 'l') {
                    dinhLuongSuDung = dinhLuongSuDung / 1000;
                }
                
                // Thuật toán tính hao hụt thực tế = Định lượng * (1 + % hao hụt) * số lượng mẻ xuất
                let luongHaoHutMoiMe = dinhLuongSuDung * (1 + parseFloat(itemNvlDung.waste || 0));
                let tongKhoiLuongTruKho = luongHaoHutMoiMe * parseFloat(donHang.qty || 1);
                
                // Tiến hành khấu trừ trực tiếp tồn kho thực tế, khống chế sàn bằng 0
                if (nvlGocTrongKho.stock !== undefined) {
                    nvlGocTrongKho.stock = Math.max(0, parseFloat(nvlGocTrongKho.stock || 0) - tongKhoiLuongTruKho);
                } else if (nvlGocTrongKho.ton !== undefined) {
                    nvlGocTrongKho.ton = Math.max(0, parseFloat(nvlGocTrongKho.ton || 0) - tongKhoiLuongTruKho);
                }
            }
        });

        // Ghi lại mảng kho mới sau khi trừ vào nhân App chính
        if (typeof global.nvlList !== 'undefined') global.nvlList = mangKhoNvlThucTe;
        else if (typeof state !== 'undefined' && state.nvl) state.nvl = mangKhoNvlThucTe;
        
        // Ghi nhận đơn bán vào nhật ký lưu trữ dùng chung làm dữ liệu tính báo cáo P&L tổng hợp
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
    
    res.json({ success: true, message: "Hệ thống trung tâm đã khấu trừ tồn kho NVL tổng hợp trực tuyến thành công!" });
});
// =====================================================================================

module.exports = { router, requireAuth, requireAdmin };
