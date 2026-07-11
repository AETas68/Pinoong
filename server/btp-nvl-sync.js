// server/btp-nvl-sync.js
//
// MODULE DUY NHẤT chịu trách nhiệm đồng bộ Danh Mục NVL <-> 2 file BTP.
// QUY TẮC CHUẨN (chỉ định nghĩa 1 lần ở đây, dùng lại ở mọi nơi):
//
//   1. "🍲 Nhóm BTP" trong Danh Mục NVL CHỈ được chứa đúng những món đang
//      có công thức thật ở data.btp_recipes.khapkhun hoặc .pinoong. Món
//      nào không còn công thức -> bị đẩy ra "📦 Nhóm Hàng Khô" (không xoá).
//
//   2. Mỗi món BTP đang có công thức LUÔN có đúng 1 dòng NVL cùng tên,
//      cùng ĐVT, nhóm "🍲 Nhóm BTP".
//
//   3. GIÁ của dòng NVL đó:
//        - Nếu CHƯA từng "Sản Xuất Mẻ" (nguồn giá = 'uoc_tinh'): giá luôn
//          được TÍNH LẠI SỐNG từ công thức hiện tại (định lượng NVL thô ×
//          giá NVL thô hiện tại ÷ SL danh nghĩa/mẻ) — mọi chỉnh sửa công
//          thức trong file BTP phản ánh ngay vào NVL, đúng yêu cầu.
//        - Nếu ĐÃ từng "Sản Xuất Mẻ" (nguồn giá = 'san_xuat'): giữ nguyên
//          giá THẬT từ lần sản xuất gần nhất (chính xác hơn vì phản ánh
//          đúng hao hụt thực tế lúc nấu) — không bị hàm này ghi đè.
//
// HÀM reconcileBtpNvl() được gọi ở MỌI nơi dữ liệu đi qua: đọc (GET
// /api/state, GET /api/btp/recipes), ghi (PUT /api/state, mọi API trong
// server/btp.js), và lúc khởi động server (server/db.js) — để dù dữ liệu
// đến/đi từ đâu, Nhóm BTP luôn đúng ngay lập tức, không phụ thuộc thứ tự
// thao tác hay dữ liệu cũ trình duyệt gửi lên.

function normName(s) {
  return String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function unitType(dvt) {
  const u = (dvt || '').trim().toLowerCase();
  return (u === 'kg' || u === 'lít' || u === 'lit' || u === 'l') ? 'mass' : 'count';
}

/** Giá vốn cả mẻ theo công thức, dùng giá NVL thô HIỆN TẠI trong data.nvl. */
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

function estimatedUnitPrice(dish, nvlList) {
  const total = calcRecipeCostEstimate(dish, nvlList);
  return dish.output_qty > 0 ? +(total / dish.output_qty).toFixed(2) : 0;
}

/**
 * Đồng bộ lại data.nvl cho khớp data.btp_recipes.{khapkhun,pinoong} theo
 * đúng 3 quy tắc ở đầu file. Trả về true nếu có bất kỳ thay đổi nào.
 * AN TOÀN: không bao giờ đụng tới giá đã được "Sản Xuất Mẻ" xác nhận.
 */
function reconcileBtpNvl(data) {
  if (!Array.isArray(data.nvl)) data.nvl = [];
  if (!data.btp_recipes) return false;
  let changed = false;

  // Gom món BTP theo tên (không phân biệt hoa/thường, khoảng trắng) — nếu
  // trùng tên ở cả 2 chi nhánh, ưu tiên công thức có nhiều nguyên liệu hơn
  // (chỉ ảnh hưởng tới việc TÍNH GIÁ ƯỚC TÍNH, không ảnh hưởng gì khác).
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

  // 2. Đảm bảo mọi món BTP hiện có đều có đúng 1 dòng NVL, đúng nhóm,
  //    đúng ĐVT, và giá luôn sống theo công thức nếu chưa từng sản xuất.
  for (const [key, dish] of dishByName) {
    let row = data.nvl.find(n => normName(n.ten) === key);
    const dvt = dish.output_unit || 'kg';

    if (!row) {
      const maxId = Math.max(0, ...data.nvl.map(n => n.id || 0));
      row = {
        id: maxId + 1,
        ten: dish.name,
        dvt,
        gia: estimatedUnitPrice(dish, data.nvl),
        nhom: '🍲 Nhóm BTP',
        btp_gia_nguon: 'uoc_tinh',
      };
      data.nvl.push(row);
      changed = true;
      continue;
    }

    if (row.nhom !== '🍲 Nhóm BTP') { row.nhom = '🍲 Nhóm BTP'; changed = true; }
    if (row.dvt !== dvt) { row.dvt = dvt; changed = true; }

    // Dòng NVL cũ (tạo trước khi có cơ chế theo dõi nguồn giá) chưa có
    // btp_gia_nguon -> coi như 'uoc_tinh' để bắt đầu tính sống từ đây.
    if (!row.btp_gia_nguon) row.btp_gia_nguon = 'uoc_tinh';

    if (row.btp_gia_nguon === 'uoc_tinh') {
      const gia = estimatedUnitPrice(dish, data.nvl);
      if (row.gia !== gia) { row.gia = gia; changed = true; }
    }
    // Nếu btp_gia_nguon === 'san_xuat': giữ nguyên giá thật, không đụng vào.
  }

  return changed;
}

/** Gọi ngay sau khi 1 mẻ BTP được "Sản Xuất" thành công — đánh dấu giá này
 * là giá THẬT, để reconcileBtpNvl() không ghi đè bằng giá ước tính nữa. */
function markBtpGiaSanXuat(nvlRow, gia) {
  nvlRow.gia = gia;
  nvlRow.btp_gia_nguon = 'san_xuat';
  nvlRow.nhom = '🍲 Nhóm BTP';
}

module.exports = { normName, reconcileBtpNvl, calcRecipeCostEstimate, estimatedUnitPrice, markBtpGiaSanXuat };
