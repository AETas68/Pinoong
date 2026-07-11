// server/btp-nvl-sync.js
//
// MODULE DÙNG CHUNG — đảm bảo Danh Mục NVL và "🍲 Nhóm BTP" luôn khớp với
// data.btp_recipes (2 file BTP Khạp Khun / Pinoong), BẤT KỂ dữ liệu đến từ
// đâu: BTP tự lưu (save-dish/produce/delete), khởi động server, hay CHÍNH
// bản lưu toàn bộ app từ trình duyệt (PUT /api/state).
//
// LÝ DO CẦN FILE NÀY: trình duyệt giữ TOÀN BỘ dữ liệu app trong bộ nhớ và
// gửi lại NGUYÊN XI mỗi lần lưu (kể cả khi bạn chỉ sửa 1 ô ở tab khác). Nếu
// tab đó đang cầm dữ liệu CŨ (trước khi 1 món BTP mới được thêm ở thiết bị
// khác, hoặc trước khi server tự dọn nhóm), bản lưu đó sẽ VÔ TÌNH ghi đè
// mất thay đổi BTP vừa rồi. Để tránh mất dữ liệu, hàm reconcileBtpNvl() ở
// đây được gọi lại NGAY TRƯỚC KHI LƯU, ở MỌI đường lưu — nên dù client gửi
// dữ liệu cũ đến đâu, server luôn tự sửa lại đúng trước khi ghi vào DB.
//
// AN TOÀN: không bao giờ đổi giá NVL đã có sẵn — chỉ set giá (ước tính theo
// công thức) khi tạo dòng NVL HOÀN TOÀN MỚI cho 1 món BTP chưa từng có.

function normName(s) {
  return String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function unitType(dvt) {
  const u = (dvt || '').trim().toLowerCase();
  return (u === 'kg' || u === 'lít' || u === 'lit' || u === 'l') ? 'mass' : 'count';
}

function calcRecipeCostEstimate(dish, nvlList) {
  let total = 0;
  for (const ing of (dish.ingredients || [])) {
    const nvlItem = nvlList.find(n => normName(n.ten) === normName(ing.ten));
    if (!nvlItem) continue;
    const qty = (Number(ing.dinh_luong) || 0) / (unitType(nvlItem.dvt) === 'mass' ? 1000 : 1);
    total += qty * (Number(nvlItem.gia) || 0) * (1 + (Number(ing.hao_hut) || 0));
  }
  return total;
}

/**
 * Đồng bộ lại data.nvl cho khớp data.btp_recipes.{khapkhun,pinoong}:
 *   1. NVL nào đang gắn "🍲 Nhóm BTP" nhưng KHÔNG còn món nào trong 2 file
 *      BTP dùng tên đó -> chuyển sang "📦 Nhóm Hàng Khô" (không xoá).
 *   2. Món BTP nào đang có công thức mà CHƯA có dòng NVL tương ứng -> tạo
 *      mới, nhóm "🍲 Nhóm BTP", giá ước tính theo công thức hiện có.
 *   3. Món BTP nào có dòng NVL nhưng bị lệch nhóm (do bị ghi đè từ client
 *      cũ) -> trả lại đúng "🍲 Nhóm BTP" (KHÔNG đổi giá).
 * Trả về true nếu có thay đổi.
 */
function reconcileBtpNvl(data) {
  if (!Array.isArray(data.nvl)) data.nvl = [];
  if (!data.btp_recipes) return false;
  let changed = false;

  // Gom món BTP theo tên (không phân biệt hoa/thường, khoảng trắng) — nếu
  // trùng tên ở cả 2 chi nhánh, ưu tiên công thức có nhiều nguyên liệu hơn
  // để ước tính giá sát hơn (chỉ dùng khi cần TẠO MỚI, không ảnh hưởng gì
  // đến giá đã có sẵn).
  const dishByName = new Map();
  for (const branch of ['khapkhun', 'pinoong']) {
    for (const d of (data.btp_recipes[branch] || [])) {
      if (!d || !d.name) continue;
      const key = normName(d.name);
      const prev = dishByName.get(key);
      if (!prev || (d.ingredients || []).length > (prev.ingredients || []).length) {
        dishByName.set(key, d);
      }
    }
  }

  // 1. Đẩy ra khỏi Nhóm BTP những NVL không còn khớp món BTP nào
  for (const n of data.nvl) {
    if (n.nhom === '🍲 Nhóm BTP' && !dishByName.has(normName(n.ten))) {
      n.nhom = '📦 Nhóm Hàng Khô';
      changed = true;
    }
  }

  // 2 & 3. Đảm bảo mọi món BTP hiện có đều có đúng 1 dòng NVL, đúng nhóm
  for (const [key, dish] of dishByName) {
    let row = data.nvl.find(n => normName(n.ten) === key);
    if (!row) {
      const total = calcRecipeCostEstimate(dish, data.nvl);
      const gia = dish.output_qty > 0 ? +(total / dish.output_qty).toFixed(2) : 0;
      const maxId = Math.max(0, ...data.nvl.map(n => n.id || 0));
      data.nvl.push({ id: maxId + 1, ten: dish.name, dvt: dish.output_unit || 'kg', gia, nhom: '🍲 Nhóm BTP' });
      changed = true;
    } else if (row.nhom !== '🍲 Nhóm BTP') {
      row.nhom = '🍲 Nhóm BTP';
      changed = true;
    }
  }

  return changed;
}

module.exports = { normName, reconcileBtpNvl, calcRecipeCostEstimate };
