const express = require('express');
const { pool } = require('./db');
const { requireAuth } = require('./auth');
const { reconcileBtpNvl, filterBtpSecrets } = require('./btp-nvl-sync');

module.exports = function (io) {
  const router = express.Router();

  // 1. KHÓA CỨNG DANH SÁCH 14 TAB ĐỂ FRONT-END KHÔNG THỂ ẨN MENU CỦA ADMIN
  const fullTabs = [
    "Dashboard", "Bán Hàng", "Danh Mục NVL", "Nhập Hàng", "Menu & Công Thức",
    "Menu Tại Chỗ", "Chấm Công", "Chi Phí", "Hao Hụt", "Hủy Hàng", "Tồn Kho",
    "Báo Cáo", "Dự Báo DT", "Người Dùng", "dashboard", "banhang", "nvl",
    "inventory", "menu", "bantaicho", "chamcong", "chiphi", "haohut", "huyhang",
    "tonkho", "baocao", "dubaodoanhthu", "users"
  ];

  // Lay toan bo du lieu (S object) hien dang luu tren server
  router.get('/', requireAuth, async (req, res) => {
    try {
      const { rows } = await pool.query('SELECT data, updated_at, updated_by FROM app_state WHERE id = 1');
      let responseData = { activeTab: "Dashboard", allowedTabs: fullTabs };
      let updated_at = rows[0]?.updated_at || null;

      if (rows && rows[0]) {
        try {
          let dbData = typeof rows[0].data === 'string' ? JSON.parse(rows[0].data) : rows[0].data;

          if (reconcileBtpNvl(dbData)) {
            console.log('🍲 [GET /api/state] Đã tự đồng bộ lại Nhóm BTP trong NVL.');
            // 🔒 KHÔNG cập nhật updated_at ở đây (đây là dọn dẹp nội bộ, không phải chỉnh sửa của người dùng).
            // 🩹 [v13.1] Ghi lại trong giao dịch có khoá dòng và tính lại trên dữ liệu MỚI NHẤT:
            // trước đây GET đọc bản cũ rồi ghi đè lên, nếu đúng lúc đó có người lưu (PUT) thì bản
            // PUT bị GET xoá mất.
            const gc = await pool.connect();
            try {
              await gc.query('BEGIN');
              const { rows: lockRows } = await gc.query('SELECT data FROM app_state WHERE id = 1 FOR UPDATE');
              const lockRaw = lockRows[0]?.data;
              const latest = lockRaw ? (typeof lockRaw === 'string' ? JSON.parse(lockRaw) : lockRaw) : dbData;
              if (reconcileBtpNvl(latest)) {
                await gc.query(`UPDATE app_state SET data = $1 WHERE id = 1`, [JSON.stringify(latest)]);
              }
              await gc.query('COMMIT');
              dbData = latest;
            } catch (txErr) {
              try { await gc.query('ROLLBACK'); } catch (_) {}
              throw txErr;
            } finally {
              gc.release();
            }
          }

          responseData = { ...dbData, allowedTabs: fullTabs };
        } catch (e) {
          console.error("Lỗi phân tích JSON dữ liệu cũ:", e.message);
        }
      }

      responseData = filterBtpSecrets(responseData, req.user);

      res.json({
        data: responseData,
        updated_at,
        updated_by: rows[0]?.updated_by || null
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Luu toan bo du lieu, roi bao cho cac thiet bi khac dang mo app biet de cap nhat
  router.put('/', requireAuth, async (req, res) => {
    const { data, base_updated_at, force } = req.body;

    if (!data || typeof data !== 'object') {
      return res.status(400).json({ error: 'Dữ liệu không hợp lệ' });
    }

    // 🩹 [v13.1] Dùng 1 giao dịch + khoá dòng (FOR UPDATE): trước đây bước "đọc rồi so sánh
    // updated_at" và bước "ghi" nằm ở 2 truy vấn rời nhau, 2 người lưu cùng lúc đều có thể
    // vượt qua kiểm tra và người sau ghi đè người trước.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: curRows } = await client.query('SELECT data, updated_at FROM app_state WHERE id = 1 FOR UPDATE');
      const curRaw = curRows[0]?.data;
      const currentData = curRaw ? (typeof curRaw === 'string' ? JSON.parse(curRaw) : curRaw) : {};
      const currentUpdatedAt = curRows[0]?.updated_at || null;

      const currentTs = currentUpdatedAt ? new Date(currentUpdatedAt).getTime() : null;
      const baseTs = base_updated_at ? new Date(base_updated_at).getTime() : null;
      const serverHasData = Array.isArray(currentData.nvl) && currentData.nvl.length > 0;

      // Chốt 1: mốc thời gian lệch -> có người khác đã lưu mới hơn.
      if (currentTs !== null && baseTs !== null && currentTs !== baseTs) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          error: 'CONFLICT_STALE_DATA',
          message: 'Dữ liệu trên server đã được người khác cập nhật sau khi bạn tải trang. Vui lòng tải lại (F5) để lấy bản mới nhất rồi nhập lại thao tác, để không ghi đè mất dữ liệu của người khác.',
          server_updated_at: currentUpdatedAt
        });
      }

      // Chốt 2 [v13.1]: KHÔNG cho ghi "mù". Trước đây thiếu base_updated_at chỉ ghi log rồi vẫn
      // cho lưu -> máy dùng bản lưu tạm cũ (do server ngủ đông/mạng chập chờn/đổi thiết bị)
      // ghi đè mất dữ liệu mới trên server. Giờ phải gửi base_updated_at, hoặc force:true
      // (chỉ dùng cho "Phục hồi từ file sao lưu" — thao tác có chủ đích).
      if (baseTs === null && currentTs !== null && serverHasData && !force) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          error: 'CONFLICT_STALE_DATA',
          message: 'Máy này chưa đồng bộ với server nên không được lưu đè. Hệ thống sẽ tự tải bản mới nhất và hợp nhất thay đổi của bạn.',
          server_updated_at: currentUpdatedAt
        });
      }

      // Chốt 3 [v13.1]: không cho ghi một khối dữ liệu RỖNG/thiếu NVL đè lên server đang có dữ liệu thật
      // (nguồn gốc của hiện tượng số liệu "về 0đ").
      const incomingHasNvl = Array.isArray(data.nvl) && data.nvl.length > 0;
      if (serverHasData && !incomingHasNvl && !force) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: 'REFUSE_EMPTY_OVERWRITE',
          message: 'Từ chối lưu: dữ liệu gửi lên đang trống/thiếu Danh Mục NVL trong khi server đã có dữ liệu. Hãy tải lại trang (F5).'
        });
      }

      // 🔒🩹 CHỐT AN TOÀN CHỐNG MẤT DỮ LIỆU BTP (giữ nguyên như cũ)
      const isSuper = !!req.user.is_superadmin;
      const perm = currentData.user_btp_tabs?.[req.user.id] || [];
      const canKK = isSuper || perm.includes('btp-khapkhun');
      const canPN = isSuper || perm.includes('btp-pinoong');

      if (!canKK || !canPN) {
        if (!canKK) {
          data.btp_recipes = { ...(data.btp_recipes || {}), khapkhun: currentData.btp_recipes?.khapkhun || [] };
          data.btp_recipes_deleted = { ...(data.btp_recipes_deleted || {}), khapkhun: currentData.btp_recipes_deleted?.khapkhun || [] };
        }
        if (!canPN) {
          data.btp_recipes = { ...(data.btp_recipes || {}), pinoong: currentData.btp_recipes?.pinoong || [] };
          data.btp_recipes_deleted = { ...(data.btp_recipes_deleted || {}), pinoong: currentData.btp_recipes_deleted?.pinoong || [] };
        }

        const mergedProd = {};
        const allMk = new Set([...Object.keys(currentData.btp_production || {}), ...Object.keys(data.btp_production || {})]);
        for (const mk of allMk) {
          const giuLai = (currentData.btp_production?.[mk] || []).filter(e => e.branch === 'khapkhun' ? !canKK : e.branch === 'pinoong' ? !canPN : false);
          const gopMoi = (data.btp_production?.[mk] || []).filter(e => e.branch === 'khapkhun' ? canKK : e.branch === 'pinoong' ? canPN : true);
          mergedProd[mk] = [...giuLai, ...gopMoi];
        }
        data.btp_production = mergedProd;
      }

      data.allowedTabs = fullTabs;

      reconcileBtpNvl(data);

      const { rows } = await client.query(
        `INSERT INTO app_state (id, data, updated_at, updated_by)
         VALUES (1, $1, now(), $2)
         ON CONFLICT (id)
         DO UPDATE SET data = $1, updated_at = now(), updated_by = $2
         RETURNING updated_at`,
        [JSON.stringify(data), req.user.name]
      );
      await client.query('COMMIT');
      const updated_at = rows[0].updated_at;

      const senderSocketId = req.headers['x-socket-id'];
      io.sockets.sockets.forEach((s) => {
        if (s.id !== senderSocketId) {
          const filteredForThisUser = filterBtpSecrets(data, s.user);
          s.emit('state-updated', { data: filteredForThisUser, updated_at, updated_by: req.user.name });
        }
      });

      res.json({ updated_at, updated_by: req.user.name });
    } catch (e) {
      try { await client.query('ROLLBACK'); } catch (_) {}
      res.status(500).json({ error: e.message });
    } finally {
      client.release();
    }
  });

  return router;
};
