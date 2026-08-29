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
            // 🔒 QUAN TRỌNG: KHÔNG cập nhật updated_at ở đây. Đây là thao tác
            // dọn dẹp nội bộ tự động (đồng bộ Nhóm BTP), không phải một
            // chỉnh sửa thật của người dùng. Nếu tính vào updated_at, MỌI
            // client khác đang cầm bản cũ hơn vài giây (kể cả chính người
            // vừa mở trang) sẽ bị hệ thống coi là "dữ liệu cũ" và bị TỪ CHỐI
            // LƯU OAN ở lần lưu tiếp theo — dù không có ai thực sự sửa gì.
            // Đây chính là nguyên nhân gây cảnh báo "dữ liệu vừa được người
            // khác cập nhật" lặp lại liên tục dù chỉ có 1 người đang dùng.
            await pool.query(
              `UPDATE app_state SET data = $1 WHERE id = 1`,
              [JSON.stringify(dbData)]
            );
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
    const { data, base_updated_at } = req.body;

    if (!data || typeof data !== 'object') {
      return res.status(400).json({ error: 'Dữ liệu không hợp lệ' });
    }

    try {
      const { rows: curRows } = await pool.query('SELECT data, updated_at FROM app_state WHERE id = 1');
      const curRaw = curRows[0]?.data;
      const currentData = curRaw ? (typeof curRaw === 'string' ? JSON.parse(curRaw) : curRaw) : {};
      const currentUpdatedAt = curRows[0]?.updated_at || null;

      // 🔒🛑 CHỐT AN TOÀN CHỐNG MẤT DỮ LIỆU (MỚI): mỗi lần lưu, trình duyệt gửi
      // lên NGUYÊN KHỐI dữ liệu app mà nó đang cầm trong bộ nhớ. Nếu trong lúc
      // client này đang mở app, một thiết bị/tab KHÁC đã lưu dữ liệu mới hơn lên
      // server (ví dụ: nhân viên vừa nhập kho buổi tối), mà client này lại lưu
      // đè lên bằng bản CŨ đang cầm (ví dụ do auto-save mỗi 2 phút của 1 tab bỏ
      // quên từ trước) — dữ liệu mới sẽ bị XOÁ MẤT hoàn toàn, không có cách nào
      // khôi phục. Đây chính là nguyên nhân "tối nhập, sáng mất dữ liệu".
      //
      // Cách chặn: client phải gửi kèm `base_updated_at` = thời điểm `updated_at`
      // mà nó đã tải dữ liệu về lần gần nhất (giá trị này server trả về ở mọi lần
      // GET /api/state và mọi sự kiện socket 'state-updated'). Nếu thời điểm đó
      // khác với `updated_at` MỚI NHẤT thực tế trên server ngay lúc này, nghĩa là
      // đã có người khác lưu dữ liệu mới hơn trong lúc client này chưa kịp tải lại
      // → từ chối lưu, yêu cầu tải lại dữ liệu mới nhất trước khi lưu tiếp.
      const currentTs = currentUpdatedAt ? new Date(currentUpdatedAt).getTime() : null;
      const baseTs = base_updated_at ? new Date(base_updated_at).getTime() : null;

      if (currentTs !== null && baseTs !== null && currentTs !== baseTs) {
        return res.status(409).json({
          error: 'CONFLICT_STALE_DATA',
          message: 'Dữ liệu trên server đã được người khác cập nhật sau khi bạn tải trang. Vui lòng tải lại (F5) để lấy bản mới nhất rồi nhập lại thao tác, để không ghi đè mất dữ liệu của người khác.',
          server_updated_at: currentUpdatedAt
        });
      }

      if (baseTs === null && currentTs !== null) {
        // Client cũ (chưa được cập nhật để gửi base_updated_at) — vẫn cho lưu để
        // không phá vỡ hoạt động, nhưng ghi log cảnh báo để biết cần nâng cấp front-end.
        console.warn('⚠️ [PUT /api/state] Client không gửi base_updated_at — không thể kiểm tra xung đột ghi đè. Hãy cập nhật front-end để gửi kèm giá trị này.');
      }

      // 🔒🩹 CHỐT AN TOÀN CHỐNG MẤT DỮ LIỆU BTP (giữ nguyên như cũ): vì GET
      // /api/state đã lọc rỗng btp_recipes/btp_production của chi nhánh mà người
      // này KHÔNG có quyền xem — nếu họ lưu bất kỳ thay đổi nào khác, trình duyệt
      // vẫn gửi lên nguyên khối dữ liệu đang cầm (rỗng ở phần đó), và nếu lưu
      // thẳng sẽ xoá mất dữ liệu thật trên server. Đọc lại dữ liệu hiện có trên
      // server trước khi ghi, và với mỗi chi nhánh người này không có quyền, luôn
      // giữ nguyên bản trên server, bỏ qua hoàn toàn phần họ gửi lên cho chi nhánh đó.
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

      const { rows } = await pool.query(
        `INSERT INTO app_state (id, data, updated_at, updated_by)
         VALUES (1, $1, now(), $2)
         ON CONFLICT (id)
         DO UPDATE SET data = $1, updated_at = now(), updated_by = $2
         RETURNING updated_at`,
        [JSON.stringify(data), req.user.name]
      );
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
      res.status(500).json({ error: e.message });
    }
  });

  return router;
};
