// server/btp.js  (PHIÊN BẢN 2 — đã chỉnh lại cho khớp đúng kiến trúc thật của app)
//
// QUAN TRỌNG — đọc trước khi sửa tiếp:
// Toàn bộ dữ liệu app (S.nvl, S.menu, S.inventory, S.ton_data, S.ban_hang, ...)
// được lưu chung trong MỘT bản ghi JSON duy nhất ở bảng `app_state` (xem state.js).
// Vì vậy module BTP này KHÔNG tạo bảng NVL / tồn kho riêng nữa (bản trước đó
// đã làm vậy — sai, vì tạo ra 2 nguồn sự thật khác nhau cho cùng một dữ liệu
// NVL, phá vỡ đúng nguyên tắc "dùng chung 1 nguồn NVL" mà bạn yêu cầu).
//
// Thay vào đó, BTP đọc/ghi TRỰC TIẾP vào field `data.btp_recipes`,
// `data.btp_production` bên trong CÙNG bản ghi app_state mà state.js đang dùng,
// và khi "xuất mẻ BTP" thì tạo thêm 1 dòng "nhập kho" vào `data.inventory`
// (đúng schema mà tab "Nhập Hàng" đang dùng) — để BTP tự động trở thành một
// NVL bình thường trong tồn kho, dùng được để lên công thức món ăn hoàn chỉnh
// trong S.menu, đúng như bạn mô tả.
//
// Phần DUY NHẤT vẫn cần bảng SQL riêng là mật khẩu của 2 file BTP
// (`btp_branch_auth`) — vì đây là quyền truy cập cần được máy chủ kiểm tra
// độc lập, không thể đặt trong JSON blob mà ai đăng nhập cũng ghi đè được.

const express = require('express');
const bcrypt = require('bcryptjs');
const { pool } = require('./db');
const { requireAuth, requireSuperAdmin } = require('./auth');

const VALID_BRANCHES = ['khapkhun', 'pinoong'];
function validBranch(b) { return VALID_BRANCHES.includes(b); }

function mkey(thang, nam) {
  return `${nam}-${String(thang).padStart(2, '0')}`;
}

module.exports = function (io) {
  const router = express.Router();

  async function loadState(client) {
    const { rows } = await client.query('SELECT data FROM app_state WHERE id = 1 FOR UPDATE');
    if (rows.length === 0) return {};
    const raw = rows[0].data;
    return typeof raw === 'string' ? JSON.parse(raw) : (raw || {});
  }

  async function saveState(client, data, updatedBy, senderSocketId) {
    const { rows } = await client.query(
      `UPDATE app_state SET data = $1, updated_at = now(), updated_by = $2 WHERE id = 1 RETURNING updated_at`,
      [JSON.stringify(data), updatedBy]
    );
    const updated_at = rows[0]?.updated_at;
    io.sockets.sockets.forEach((s) => {
      if (s.id !== senderSocketId) {
        s.emit('state-updated', { data, updated_at, updated_by: updatedBy });
      }
    });
    return updated_at;
  }

  // =====================================================================
  // A. MẬT KHẨU RIÊNG CHO TỪNG FILE BTP (bảng SQL riêng — đúng, giữ nguyên)
  // =====================================================================

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
        return res.json({ success: false, message: 'Chưa cấu hình mật khẩu cho chi nhánh này! Vào mục Super Admin để đặt.' });
      }
      const ok = await bcrypt.compare(password || '', rows[0].password_hash);
      if (!ok) return res.json({ success: false, message: 'Mật khẩu không chính xác!' });
      res.json({ success: true, message: 'Xác thực thành công!' });
    } catch (e) {
      res.status(500).json({ success: false, message: e.message });
    }
  });

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
  // B. CÔNG THỨC BTP THEO TỪNG CHI NHÁNH — sống trong app_state.data.btp_recipes
  //    Cấu trúc: data.btp_recipes = { khapkhun: [ {id,name,output_unit,
  //              output_qty, suggested_price, ingredients:[{ten,dinh_luong,
  //              hao_hut}] } ], pinoong: [ ... ] }
  //    "dinh_luong" tính theo GAM/ML cho 1 mẻ — cùng đơn vị với S.menu[i]
  //    .nguyen_lieu[j].dinh_luong để bạn dùng chung 1 kiểu nhập liệu quen thuộc.
  // =====================================================================

  router.get('/recipes', requireAuth, async (req, res) => {
    const { branch } = req.query;
    if (!validBranch(branch)) {
      return res.status(400).json({ success: false, message: 'Chi nhánh không hợp lệ!' });
    }
    try {
      const { rows } = await pool.query('SELECT data FROM app_state WHERE id = 1');
      const raw = rows[0]?.data;
      const data = typeof raw === 'string' ? JSON.parse(raw) : (raw || {});
      const list = data.btp_recipes?.[branch] || [];
      res.json({ success: true, dishes: list });
    } catch (e) {
      res.status(500).json({ success: false, message: e.message });
    }
  });

  router.post('/save-dish', requireAuth, async (req, res) => {
    const { branch, dish } = req.body;
    if (!validBranch(branch)) {
      return res.status(400).json({ success: false, message: 'Chi nhánh không hợp lệ!' });
    }
    if (!dish || !dish.name) {
      return res.status(400).json({ success: false, message: 'Thiếu tên món BTP' });
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const data = await loadState(client);
      if (!data.btp_recipes) data.btp_recipes = { khapkhun: [], pinoong: [] };
      if (!data.btp_recipes[branch]) data.btp_recipes[branch] = [];

      const list = data.btp_recipes[branch];
      if (dish.id) {
        const idx = list.findIndex(d => d.id === dish.id);
        if (idx >= 0) list[idx] = { ...list[idx], ...dish };
        else list.push(dish);
      } else {
        const maxId = Math.max(0, ...list.map(d => d.id || 0));
        dish.id = maxId + 1;
        list.push(dish);
      }

      await saveState(client, data, req.user.name, req.headers['x-socket-id']);
      await client.query('COMMIT');
      res.json({ success: true, message: 'Đã lưu công thức BTP!', dish });
    } catch (e) {
      await client.query('ROLLBACK');
      res.status(500).json({ success: false, message: e.message });
    } finally {
      client.release();
    }
  });

  router.delete('/dish/:id', requireAuth, async (req, res) => {
    const { branch } = req.query;
    if (!validBranch(branch)) {
      return res.status(400).json({ success: false, message: 'Chi nhánh không hợp lệ!' });
    }
    const id = parseInt(req.params.id);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const data = await loadState(client);
      if (data.btp_recipes?.[branch]) {
        data.btp_recipes[branch] = data.btp_recipes[branch].filter(d => d.id !== id);
      }
      await saveState(client, data, req.user.name, req.headers['x-socket-id']);
      await client.query('COMMIT');
      res.json({ success: true, message: 'Đã xóa công thức BTP' });
    } catch (e) {
      await client.query('ROLLBACK');
      res.status(500).json({ success: false, message: e.message });
    } finally {
      client.release();
    }
  });

  // =====================================================================
  // C. "XUẤT MẺ BTP" = SẢN XUẤT NỘI BỘ, KHÔNG PHẢI BÁN HÀNG
  //    - Trừ NVL thô (ghi vào data.btp_production[mk] — cộng vào "xuất" khi
  //      tính tồn kho, xem hướng dẫn chỉnh _xuatThangMK ở front-end bên dưới)
  //    - Cộng chính món BTP đó vào data.inventory[mk] (y hệt một phiếu nhập
  //      hàng bình thường) -> nó tự nhiên trở thành 1 NVL có tồn kho, dùng
  //      được ngay trong "Menu & Công Thức" như bạn mô tả.
  //    - KHÔNG ghi doanh thu — doanh thu chỉ phát sinh khi bán món hoàn
  //      chỉnh cho khách ở tab Bán Hàng (đã có sẵn, không đụng tới).
  // =====================================================================

  router.post('/produce', requireAuth, async (req, res) => {
    const { branch, dish_id, qty, thang, nam } = req.body;
    if (!validBranch(branch)) {
      return res.status(400).json({ success: false, message: 'Chi nhánh không hợp lệ!' });
    }
    const soMe = parseFloat(qty || 0);
    if (!dish_id || !soMe || soMe <= 0) {
      return res.status(400).json({ success: false, message: 'Thiếu món BTP hoặc số mẻ không hợp lệ' });
    }
    const mk = mkey(thang || (new Date().getMonth() + 1), nam || new Date().getFullYear());

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const data = await loadState(client);

      const recipe = (data.btp_recipes?.[branch] || []).find(d => d.id === dish_id);
      if (!recipe) {
        await client.query('ROLLBACK');
        return res.status(404).json({ success: false, message: 'Không tìm thấy công thức BTP này' });
      }

      const nvlList = data.nvl || [];
      if (!data.btp_production) data.btp_production = {};
      if (!data.btp_production[mk]) data.btp_production[mk] = [];
      if (!data.inventory) data.inventory = {};
      if (!data.inventory[mk]) data.inventory[mk] = [];

      let tongVon = 0;
      for (const ing of (recipe.ingredients || [])) {
        const nvlGoc = nvlList.find(n => n.ten === ing.ten) ||
                        nvlList.find(n => (n.ten || '').toLowerCase() === (ing.ten || '').toLowerCase());
        const dinhLuongMe = parseFloat(ing.dinh_luong || 0) / 1000;
        const haoHut = parseFloat(ing.hao_hut || 0) / 100;
        const tongDung = dinhLuongMe * (1 + haoHut) * soMe;

        data.btp_production[mk].push({
          ten: ing.ten,
          sl: tongDung,
          branch,
          btp_dish: recipe.name,
          ngay: new Date().toISOString().slice(0, 10)
        });

        if (nvlGoc) tongVon += tongDung * (parseFloat(nvlGoc.gia) || 0);
      }

      const soLuongRa = parseFloat(recipe.output_qty || soMe);
      data.inventory[mk].push({
        ten: recipe.name,
        sl: soLuongRa,
        gia: soLuongRa > 0 ? +(tongVon / soLuongRa).toFixed(2) : 0,
        branch,
        loai: 'san_xuat_btp',
        ngay: new Date().toISOString().slice(0, 10)
      });

      await saveState(client, data, req.user.name, req.headers['x-socket-id']);
      await client.query('COMMIT');
      res.json({
        success: true,
        message: `Đã sản xuất ${soMe} mẻ "${recipe.name}" — trừ NVL thô và nhập kho BTP thành công!`,
        von_nvl: tongVon
      });
    } catch (e) {
      await client.query('ROLLBACK');
      res.status(500).json({ success: false, message: e.message });
    } finally {
      client.release();
    }
  });

  // =====================================================================
  // D. BÁO CÁO CHI PHÍ SẢN XUẤT BTP THEO CHI NHÁNH (không phải doanh thu —
  //    doanh thu thật lấy từ tab Bán Hàng/Báo Cáo sẵn có của bạn)
  // =====================================================================

  router.get('/production-report', requireAuth, async (req, res) => {
    const { mk } = req.query; // vd 2026-07
    try {
      const { rows } = await pool.query('SELECT data FROM app_state WHERE id = 1');
      const raw = rows[0]?.data;
      const data = typeof raw === 'string' ? JSON.parse(raw) : (raw || {});
      const entries = (mk ? (data.btp_production?.[mk] || []) : Object.values(data.btp_production || {}).flat());
      const nvlList = data.nvl || [];
      const byBranch = {};
      for (const e of entries) {
        const nvlGoc = nvlList.find(n => n.ten === e.ten);
        const cost = (parseFloat(e.sl) || 0) * (parseFloat(nvlGoc?.gia) || 0);
        byBranch[e.branch] = (byBranch[e.branch] || 0) + cost;
      }
      res.json({ success: true, byBranch, entries: entries.length });
    } catch (e) {
      res.status(500).json({ success: false, message: e.message });
    }
  });

  return router;
};
