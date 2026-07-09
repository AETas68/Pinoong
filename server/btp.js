// server/btp.js
// API RIÊNG cho tính năng "2 file BTP dùng chung NVL / Menu / Chi phí".
// Toàn bộ dữ liệu được lưu vào PostgreSQL (KHÔNG dùng biến global trong RAM
// như bản cũ) — vì Render có thể khởi động lại server bất cứ lúc nào
// (deploy mới, sleep do rảnh trên gói free, crash...), và biến global sẽ
// bị XÓA SẠCH mỗi lần restart. Dữ liệu công thức BTP và tồn kho phải nằm
// trong database mới an toàn.

const express = require('express');
const bcrypt = require('bcryptjs');
const { pool } = require('./db');
const { requireAuth, requireSuperAdmin } = require('./auth');

const router = express.Router();

const VALID_BRANCHES = ['khapkhun', 'pinoong'];

function validBranch(b) {
  return VALID_BRANCHES.includes(b);
}

// =====================================================================
// A. MẬT KHẨU RIÊNG CHO TỪNG FILE BTP
// =====================================================================

// Kiểm tra mật khẩu chi nhánh để mở khóa giao diện nhập công thức.
// POST /api/btp/secure-check   body: { branch, password }
router.post('/secure-check', requireAuth, async (req, res) => {
  const { branch, password } = req.body;
  if (!validBranch(branch)) {
    return res.status(400).json({ success: false, message: 'Chi nhánh không hợp lệ!' });
  }
  try {
    const { rows } = await pool.query(
      'SELECT password_hash FROM btp_branch_auth WHERE branch = $1',
      [branch]
    );
    if (rows.length === 0) {
      return res.json({ success: false, message: 'Chưa cấu hình mật khẩu cho chi nhánh này!' });
    }
    const ok = await bcrypt.compare(password || '', rows[0].password_hash);
    if (!ok) return res.json({ success: false, message: 'Mật khẩu không chính xác!' });
    res.json({ success: true, message: 'Xác thực thành công!' });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// Super Admin cấp / đổi mật khẩu cho từng file BTP.
// POST /api/btp/secure-update   body: { passKhapKhun, passPinoong }
// (LƯU Ý viết hoa chữ K trong "passKhapKhun" — phải khớp CHÍNH XÁC với
//  key mà front-end index.html đang gửi lên, JS phân biệt hoa/thường)
router.post('/secure-update', requireAuth, requireSuperAdmin, async (req, res) => {
  const { passKhapKhun, passPinoong } = req.body;
  try {
    if (passKhapKhun && passKhapKhun.trim()) {
      const hash = await bcrypt.hash(passKhapKhun.trim(), 10);
      await pool.query(
        `INSERT INTO btp_branch_auth (branch, password_hash, updated_by)
         VALUES ('khapkhun', $1, $2)
         ON CONFLICT (branch) DO UPDATE SET password_hash = $1, updated_at = now(), updated_by = $2`,
        [hash, req.user.name]
      );
    }
    if (passPinoong && passPinoong.trim()) {
      const hash = await bcrypt.hash(passPinoong.trim(), 10);
      await pool.query(
        `INSERT INTO btp_branch_auth (branch, password_hash, updated_by)
         VALUES ('pinoong', $1, $2)
         ON CONFLICT (branch) DO UPDATE SET password_hash = $1, updated_at = now(), updated_by = $2`,
        [hash, req.user.name]
      );
    }
    res.json({ success: true, message: 'Đã lưu mật khẩu file BTP mới!' });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// =====================================================================
// B. KHO NGUYÊN VẬT LIỆU DÙNG CHUNG (nguồn sự thật duy nhất)
// =====================================================================

// Lấy toàn bộ kho NVL chung — cả 2 file BTP đều đọc từ đây để chọn nguyên
// liệu và biết đơn giá / tồn kho hiện tại.
// GET /api/btp/nvl-shared
router.get('/nvl-shared', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM nvl_kho ORDER BY nhom, ten');
    res.json({ success: true, nvlList: rows });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// Đồng bộ / nạp lại toàn bộ kho NVL chung (dùng khi import từ menu có sẵn,
// hoặc khi admin sửa danh mục NVL ở tab "Danh Mục NVL").
// POST /api/btp/nvl-shared/sync   body: { items: [{ten, dvt, gia, ton, nhom}, ...] }
router.post('/nvl-shared/sync', requireAuth, async (req, res) => {
  const { items } = req.body;
  if (!Array.isArray(items)) {
    return res.status(400).json({ success: false, message: 'Thiếu danh sách NVL' });
  }
  try {
    for (const it of items) {
      if (!it.ten) continue;
      await pool.query(
        `INSERT INTO nvl_kho (ten, dvt, gia, ton, nhom)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (ten) DO UPDATE SET
           dvt = $2, gia = $3, nhom = $5, updated_at = now()`,
        [it.ten, it.dvt || '', it.gia || 0, it.ton || 0, it.nhom || '']
      );
    }
    res.json({ success: true, message: 'Đã đồng bộ kho NVL chung' });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// =====================================================================
// C. CÔNG THỨC BTP THEO TỪNG CHI NHÁNH (2 file riêng, 1 bảng chung)
// =====================================================================

// GET /api/btp/list?branch=khapkhun
router.get('/list', requireAuth, async (req, res) => {
  const branch = req.query.branch;
  if (!validBranch(branch)) {
    return res.status(400).json({ success: false, message: 'Chi nhánh không hợp lệ!' });
  }
  try {
    const { rows } = await pool.query(
      'SELECT * FROM btp_recipes WHERE branch = $1 ORDER BY name',
      [branch]
    );
    res.json({ success: true, dishes: rows });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// POST /api/btp/save-dish  body: { id?, branch, name, output_unit, cost_price, suggested_price, ingredients }
router.post('/save-dish', requireAuth, async (req, res) => {
  const { id, branch, name, output_unit, cost_price, suggested_price, ingredients } = req.body;
  if (!validBranch(branch)) {
    return res.status(400).json({ success: false, message: 'Chi nhánh không hợp lệ!' });
  }
  if (!name) {
    return res.status(400).json({ success: false, message: 'Thiếu tên món BTP' });
  }
  try {
    if (id) {
      await pool.query(
        `UPDATE btp_recipes SET
           name = $1, output_unit = $2, cost_price = $3,
           suggested_price = $4, ingredients = $5, updated_at = now()
         WHERE id = $6 AND branch = $7`,
        [name, output_unit, cost_price || 0, suggested_price || 0, JSON.stringify(ingredients || []), id, branch]
      );
    } else {
      await pool.query(
        `INSERT INTO btp_recipes (branch, name, output_unit, cost_price, suggested_price, ingredients)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [branch, name, output_unit, cost_price || 0, suggested_price || 0, JSON.stringify(ingredients || [])]
      );
    }
    res.json({ success: true, message: 'Đã lưu công thức BTP!' });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// DELETE /api/btp/dish/:id?branch=khapkhun
router.delete('/dish/:id', requireAuth, async (req, res) => {
  const { branch } = req.query;
  if (!validBranch(branch)) {
    return res.status(400).json({ success: false, message: 'Chi nhánh không hợp lệ!' });
  }
  try {
    await pool.query('DELETE FROM btp_recipes WHERE id = $1 AND branch = $2', [req.params.id, branch]);
    res.json({ success: true, message: 'Đã xóa công thức BTP' });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// =====================================================================
// D. XUẤT BÁN BTP -> TRỪ KHO NVL CHUNG + GHI NHẬT KÝ P&L
// =====================================================================

// POST /api/btp/submit-export
// body: { branch, orderData: { btp_dish_id, qty, date } }
//
// QUAN TRỌNG: front-end CHỈ gửi id món BTP + số mẻ xuất, KHÔNG gửi kèm
// công thức / giá vốn / doanh thu (không được tin dữ liệu đó nếu client
// gửi lên, vì có thể bị sửa tay qua devtools). Server tự tra công thức
// (bảng btp_recipes) và đơn giá NVL hiện tại (bảng nvl_kho) để tính đúng.
router.post('/submit-export', requireAuth, async (req, res) => {
  const branch = req.body.branch;
  const donHang = req.body.orderData || {};
  if (!validBranch(branch)) {
    return res.status(400).json({ success: false, message: 'Chi nhánh không hợp lệ!' });
  }
  const soMe = parseFloat(donHang.qty || 0);
  if (!donHang.btp_dish_id || !soMe || soMe <= 0) {
    return res.status(400).json({ success: false, message: 'Thiếu món BTP hoặc số mẻ xuất không hợp lệ' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Lấy đúng công thức của món BTP thuộc đúng chi nhánh
    const recipeRes = await client.query(
      'SELECT * FROM btp_recipes WHERE id = $1 AND branch = $2',
      [donHang.btp_dish_id, branch]
    );
    if (recipeRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Không tìm thấy công thức BTP này' });
    }
    const recipe = recipeRes.rows[0];
    const ingredients = Array.isArray(recipe.ingredients) ? recipe.ingredients : [];

    // 2. Với từng nguyên liệu trong công thức: trừ kho NVL chung + cộng dồn giá vốn thật
    let tongVonNvl = 0;
    for (const itemNvlDung of ingredients) {
      const { rows } = await client.query(
        'SELECT * FROM nvl_kho WHERE LOWER(ten) = LOWER($1) FOR UPDATE',
        [(itemNvlDung.name || itemNvlDung.ten || '').trim()]
      );
      if (rows.length === 0) continue; // NVL chưa có trong kho chung -> bỏ qua, không chặn cả đơn
      const nvlGoc = rows[0];

      let dinhLuongSuDung = parseFloat(itemNvlDung.qty || itemNvlDung.dinh_luong || 0);
      const donViTinh = (nvlGoc.dvt || '').trim().toLowerCase();
      if (['kg', 'lít', 'lit', 'l'].includes(donViTinh)) {
        dinhLuongSuDung = dinhLuongSuDung / 1000; // quy đổi gram/ml -> kg/lít
      }

      const haoHutMoiMe = dinhLuongSuDung * (1 + parseFloat(itemNvlDung.waste || 0));
      const tongTru = haoHutMoiMe * soMe;

      tongVonNvl += tongTru * parseFloat(nvlGoc.gia || 0);

      await client.query(
        'UPDATE nvl_kho SET ton = GREATEST(0, ton - $1), updated_at = now() WHERE id = $2',
        [tongTru, nvlGoc.id]
      );
    }

    // 3. Doanh thu lấy theo giá bán đề xuất của công thức (suggested_price) x số mẻ.
    //    Nếu quán bán theo giá khác (ví dụ giá bán lẻ trên menu), sửa lại chỗ này
    //    để lấy đúng giá bán thực tế đã cấu hình trong Menu & Công Thức.
    const doanhThu = parseFloat(recipe.suggested_price || 0) * soMe;
    const loiNhuan = doanhThu - tongVonNvl;

    await client.query(
      `INSERT INTO btp_export_logs (branch, dish_name, qty, unit, von_nvl, doanh_thu, ln, note)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [branch, recipe.name, soMe, recipe.output_unit, tongVonNvl, doanhThu, loiNhuan, donHang.note || null]
    );

    await client.query('COMMIT');
    res.json({
      success: true,
      message: 'Đã khấu trừ kho NVL chung và ghi nhận vào báo cáo P&L!',
      von_nvl: tongVonNvl,
      doanh_thu: doanhThu,
      ln: loiNhuan
    });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ success: false, message: e.message });
  } finally {
    client.release();
  }
});

// =====================================================================
// E. BÁO CÁO P&L GỘP CHUNG CẢ 2 CHI NHÁNH
// =====================================================================

// GET /api/btp/report/pnl?from=YYYY-MM-DD&to=YYYY-MM-DD
router.get('/report/pnl', requireAuth, async (req, res) => {
  const { from, to } = req.query;
  try {
    const params = [];
    let where = '';
    if (from) { params.push(from); where += ` AND created_at >= $${params.length}`; }
    if (to) { params.push(to); where += ` AND created_at < ($${params.length}::date + 1)`; }

    const byBranch = await pool.query(
      `SELECT branch,
              COALESCE(SUM(doanh_thu),0) AS doanh_thu,
              COALESCE(SUM(von_nvl),0)   AS chi_phi,
              COALESCE(SUM(ln),0)        AS loi_nhuan,
              COUNT(*)                    AS so_don
       FROM btp_export_logs
       WHERE 1=1 ${where}
       GROUP BY branch`,
      params
    );

    const total = byBranch.rows.reduce((acc, r) => ({
      doanh_thu: acc.doanh_thu + Number(r.doanh_thu),
      chi_phi: acc.chi_phi + Number(r.chi_phi),
      loi_nhuan: acc.loi_nhuan + Number(r.loi_nhuan),
      so_don: acc.so_don + Number(r.so_don)
    }), { doanh_thu: 0, chi_phi: 0, loi_nhuan: 0, so_don: 0 });

    res.json({ success: true, byBranch: byBranch.rows, total });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

module.exports = router;
