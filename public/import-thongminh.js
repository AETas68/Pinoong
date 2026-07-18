// ═══════════════════════════════════════════════════════════════
// 📁 IMPORT THÔNG MINH — tự đọc Bill NVL / Chi Phí / Hủy Hàng / Chấm Công
// từ file Excel, ảnh (OCR) hoặc PDF, rồi đồng bộ vào đúng tab.
// File này CHẠY SAU script chính (cần S, saveData, mkey, sortAZ, fmt...
// đã tồn tại trong window khi các hàm bên dưới thực sự được gọi).
// ═══════════════════════════════════════════════════════════════

let _impLoai = 'nvl';          // nvl | chiphi | huyhang | chamcong
let _impRows = [];             // các dòng đã parse, đang chờ xem trước / sửa / lưu
let _impRowSeq = 0;

// ── Từ khoá đoán Nhóm NVL khi tạo NVL mới từ import ──────────────
const IMP_NHOM_KEYWORDS = [
  ['🥬 Nhóm Rau Củ', ['rau','cải','cà chua','cà rốt','hành','tỏi','ớt','chanh','bắp','khoai','dưa','giá đỗ','ngò','ngải','bí','đậu que','đậu bắp','nấm','xà lách','bầu']],
  ['🥩 Nhóm Thịt & Cá', ['thịt','heo','bò','gà','vịt','cá','tôm','mực','xương','sườn','ba chỉ','nạc','giò','chả lụa']],
  ['📦 Nhóm Hàng Khô', ['bún','hủ tiếu','mì','bánh phở','bánh tráng','gạo','đường','bột','khô','miến']],
  ['🧂 Nhóm Gia Vị', ['muối','tiêu','nước mắm','sa tế','tương','dầu ăn','giấm','bột ngọt','hạt nêm','me','sả','riềng','nước cốt dừa']],
  ['🍢 Nhóm Món Thêm', ['trứng','chả','viên','xúc xích']],
];
function guessNhomNVL(ten) {
  const t = (ten || '').toLowerCase();
  for (const [nhom, kws] of IMP_NHOM_KEYWORDS) {
    if (kws.some(k => t.includes(k))) return nhom;
  }
  return '📦 Nhóm Hàng Khô';
}

// ── So khớp gần đúng tên NVL / Nhân viên đã có trong hệ thống ────
function impNormalize(s) {
  return (s || '').toString().normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();
}
function impLevenshtein(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
  return dp[m][n];
}
// Trả về NVL khớp nhất trong S.nvl (hoặc null nếu không đủ giống)
function impMatchNVL(ten) {
  const q = impNormalize(ten);
  if (!q) return null;
  let exact = S.nvl.find(n => impNormalize(n.ten) === q);
  if (exact) return exact;
  let best = null, bestScore = 0;
  for (const n of S.nvl) {
    const cand = impNormalize(n.ten);
    const dist = impLevenshtein(q, cand);
    const score = 1 - dist / Math.max(q.length, cand.length, 1);
    if (score > bestScore) { bestScore = score; best = n; }
  }
  return bestScore >= 0.72 ? best : null;
}
function impMatchStaff(ten) {
  const q = impNormalize(ten);
  if (!q) return null;
  let exact = (S.staff || []).find(n => impNormalize(n.ten) === q);
  if (exact) return exact;
  let best = null, bestScore = 0;
  for (const n of (S.staff || [])) {
    const cand = impNormalize(n.ten);
    const dist = impLevenshtein(q, cand);
    const score = 1 - dist / Math.max(q.length, cand.length, 1);
    if (score > bestScore) { bestScore = score; best = n; }
  }
  return bestScore >= 0.72 ? best : null;
}

// ── Chuẩn hoá ngày về YYYY-MM-DD, hỗ trợ dd/mm/yyyy, dd-mm-yyyy, yyyy-mm-dd ──
function impParseDate(str) {
  if (!str) return null;
  const s = String(str).trim();
  let m = s.match(/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
  if (m) return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
  m = s.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (m) {
    let y = m[3].length === 2 ? '20' + m[3] : m[3];
    return `${y}-${String(m[2]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
  }
  return null;
}
// Tìm ngày chứng từ xuất hiện đầu tiên trong cả đoạn text OCR
function impFindGlobalDate(text) {
  const m = text.match(/(\d{1,4}[\/\-]\d{1,2}[\/\-]\d{1,4})/);
  return m ? impParseDate(m[1]) : null;
}
function impMoneyToNumber(str) {
  if (typeof str === 'number') return str;
  if (!str) return 0;
  const cleaned = String(str).replace(/[^\d.,]/g, '');
  // Ưu tiên coi dấu chấm/phẩy là phân cách nghìn (kiểu VN: 25.000)
  const noSep = cleaned.replace(/[.,](?=\d{3}(\D|$))/g, '');
  const num = parseFloat(noSep.replace(',', '.'));
  return isNaN(num) ? 0 : num;
}

// ══════════ TAB & FILE INPUT ══════════
function onImportLoaiChange() {
  _impLoai = document.getElementById('imp-loai').value;
  const hintEl = document.getElementById('imp-loai-hint');
  const hints = {
    nvl: '🚚 Sẽ đọc: tên NVL, số lượng, đơn vị, đơn giá, ngày nhập → lưu vào tab Nhập Hàng.',
    chiphi: '💸 Sẽ đọc: tên khoản chi, số tiền → lưu vào tab Chi Phí (bạn chọn Nhóm/Loại trước khi lưu).',
    huyhang: '🗑 Sẽ đọc: tên NVL, số lượng, ngày, lý do (nếu có) → lưu vào tab Hủy Hàng.',
    chamcong: '👥 Sẽ đọc: tên nhân viên, ngày, số giờ công → lưu vào tab Chấm Công.'
  };
  if (hintEl) hintEl.textContent = hints[_impLoai] || '';
  _impRows = [];
  renderImportPreview();
}

async function onImportFilesSelected() {
  const input = document.getElementById('imp-files');
  const files = Array.from(input.files || []);
  if (!files.length) return;
  const statusEl = document.getElementById('imp-status');
  const progEl = document.getElementById('imp-progress');

  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    if (statusEl) statusEl.textContent = `⏳ Đang xử lý (${i + 1}/${files.length}): ${f.name}...`;
    try {
      const ext = (f.name.split('.').pop() || '').toLowerCase();
      let newRows = [];
      if (['xlsx', 'xls', 'csv'].includes(ext)) {
        newRows = await impParseExcelFile(f);
      } else if (['png', 'jpg', 'jpeg', 'webp'].includes(ext)) {
        const text = await impOcrImage(f, progEl);
        newRows = impParseTextToRows(text);
      } else if (ext === 'pdf') {
        const text = await impExtractPdfText(f, progEl);
        newRows = impParseTextToRows(text);
      } else {
        alert(`⚠️ Không hỗ trợ định dạng file: ${f.name}`);
        continue;
      }
      newRows.forEach(r => { r._id = ++_impRowSeq; r._include = true; r._source = f.name; });
      _impRows = _impRows.concat(newRows);
    } catch (err) {
      console.error(err);
      alert(`❌ Lỗi đọc file ${f.name}: ${err.message}`);
    }
  }
  if (progEl) progEl.innerHTML = '';
  if (statusEl) statusEl.textContent = `✅ Đã đọc xong ${files.length} file — ${_impRows.length} dòng dữ liệu tìm được. Kiểm tra & sửa bên dưới trước khi Lưu.`;
  input.value = '';
  renderImportPreview();
}

// ══════════ ĐỌC EXCEL / CSV (SheetJS) ══════════
const IMP_COL_ALIASES = {
  ngay: ['ngày', 'ngay', 'date'],
  ten: ['tên nvl', 'ten nvl', 'tên hàng', 'tên', 'ten', 'sản phẩm', 'mặt hàng', 'name', 'khoản chi', 'nội dung'],
  sl: ['số lượng', 'so luong', 'sl', 'qty', 'quantity'],
  dvt: ['đvt', 'dvt', 'đơn vị', 'don vi', 'unit'],
  gia: ['đơn giá', 'don gia', 'giá', 'gia', 'price', 'unit price'],
  thanh_tien: ['thành tiền', 'thanh tien', 'total', 'tổng tiền', 'so tien', 'số tiền'],
  ly_do: ['lý do', 'ly do', 'reason'],
  nhom: ['nhóm', 'nhom', 'group'],
  loai: ['loại', 'loai', 'type'],
  nhan_vien: ['nhân viên', 'nhan vien', 'họ tên', 'ho ten', 'staff', 'tên nv'],
  gio: ['số giờ', 'giờ công', 'gio', 'giờ', 'hours', 'công']
};
function impDetectCol(headerRow) {
  const map = {};
  headerRow.forEach((h, idx) => {
    const hn = impNormalize(h);
    if (!hn) return;
    for (const [key, aliases] of Object.entries(IMP_COL_ALIASES)) {
      if (map[key] !== undefined) continue;
      if (aliases.some(a => hn.includes(a))) map[key] = idx;
    }
  });
  return map;
}
async function impParseExcelFile(file) {
  if (typeof XLSX === 'undefined') throw new Error('Thư viện đọc Excel (SheetJS) chưa được tải.');
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array', cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  if (!raw.length) return [];

  // Tìm dòng tiêu đề: dòng đầu tiên khớp được >=2 cột đã biết
  let headerIdx = 0, cols = {};
  for (let i = 0; i < Math.min(raw.length, 5); i++) {
    const m = impDetectCol(raw[i]);
    if (Object.keys(m).length >= 2) { headerIdx = i; cols = m; break; }
  }
  const rows = [];
  for (let i = headerIdx + 1; i < raw.length; i++) {
    const r = raw[i];
    if (!r || r.every(c => c === '' || c === null || c === undefined)) continue;
    const get = k => cols[k] !== undefined ? r[cols[k]] : '';
    if (_impLoai === 'chamcong') {
      // Hỗ trợ 2 kiểu: (tên, ngày, giờ) hoặc (tên, cột theo từng ngày trong tháng)
      if (cols.nhan_vien !== undefined && cols.gio !== undefined) {
        rows.push(impMakeRow({ nhan_vien: get('nhan_vien'), ngay: impParseDate(get('ngay')) || '', gio: impMoneyToNumber(get('gio')) }));
      } else if (cols.nhan_vien !== undefined) {
        // Kiểu bảng rộng: cột 1 là tên NV, các cột còn lại là ngày 1..31
        const tenNV = r[cols.nhan_vien];
        raw[headerIdx].forEach((h, ci) => {
          if (ci === cols.nhan_vien) return;
          const day = parseInt(h);
          const val = parseFloat(r[ci]);
          if (day >= 1 && day <= 31 && !isNaN(val) && val > 0) {
            rows.push(impMakeRow({ nhan_vien: tenNV, ngay_so: day, gio: val }));
          }
        });
      }
    } else if (_impLoai === 'chiphi') {
      rows.push(impMakeRow({
        ten: get('ten'), so_tien: impMoneyToNumber(get('thanh_tien') || get('gia')),
        nhom: get('nhom'), loai: get('loai')
      }));
    } else {
      // nvl / huyhang
      const sl = impMoneyToNumber(get('sl')) || 1;
      const gia = impMoneyToNumber(get('gia'));
      rows.push(impMakeRow({
        ngay: impParseDate(get('ngay')) || '', ten: get('ten'), sl, dvt: get('dvt') || '',
        gia: gia || (impMoneyToNumber(get('thanh_tien')) && sl ? impMoneyToNumber(get('thanh_tien')) / sl : 0),
        ly_do: get('ly_do') || ''
      }));
    }
  }
  return rows.filter(r => r.ten || r.nhan_vien);
}

// ══════════ OCR ẢNH (Tesseract.js) ══════════
async function impOcrImage(file, progEl) {
  if (typeof Tesseract === 'undefined') throw new Error('Thư viện OCR (Tesseract.js) chưa được tải.');
  const { data } = await Tesseract.recognize(file, 'vie+eng', {
    logger: m => {
      if (progEl && m.status === 'recognizing text') {
        progEl.innerHTML = `<div class="fs11 txt-gray">🔎 Đang nhận diện chữ: ${Math.round((m.progress || 0) * 100)}%</div>`;
      }
    }
  });
  return data.text || '';
}

// ══════════ ĐỌC PDF (pdf.js) — ưu tiên lớp text số, nếu rỗng thì OCR ảnh trang ══════════
async function impExtractPdfText(file, progEl) {
  if (typeof pdfjsLib === 'undefined') throw new Error('Thư viện đọc PDF (pdf.js) chưa được tải.');
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  let fullText = '';
  for (let p = 1; p <= pdf.numPages; p++) {
    if (progEl) progEl.innerHTML = `<div class="fs11 txt-gray">📄 Đang đọc trang ${p}/${pdf.numPages}...</div>`;
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const pageText = content.items.map(it => it.str).join(' ');
    if (pageText.trim().length > 20) {
      fullText += '\n' + pageText;
    } else {
      // Không có lớp text (PDF scan) → render ra ảnh rồi OCR
      const viewport = page.getViewport({ scale: 2 });
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width; canvas.height = viewport.height;
      await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
      const blob = await new Promise(res => canvas.toBlob(res, 'image/png'));
      const ocrText = await impOcrImage(blob, progEl);
      fullText += '\n' + ocrText;
    }
  }
  return fullText;
}

// ══════════ PHÂN TÍCH VĂN BẢN OCR THÀNH CÁC DÒNG DỮ LIỆU (rule-based) ══════════
const IMP_SKIP_LINE_KEYWORDS = ['stt', 'tổng cộng', 'tong cong', 'cộng', 'ký tên', 'ky ten', 'người bán', 'người mua', 'hóa đơn', 'hoa don', 'biên bản'];
function impMakeRow(fields) {
  return Object.assign({ ngay: '', ten: '', sl: 1, dvt: '', gia: 0, so_tien: 0, ly_do: '', nhom: '', loai: '', nhan_vien: '', gio: 0, ngay_so: null }, fields);
}
function impParseTextToRows(text) {
  const rows = [];
  const globalDate = impFindGlobalDate(text) || new Date().toISOString().slice(0, 10);
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

  for (const line of lines) {
    const low = line.toLowerCase();
    if (line.length < 3) continue;
    if (IMP_SKIP_LINE_KEYWORDS.some(k => low.includes(k))) continue;

    if (_impLoai === 'chamcong') {
      // "Tên nhân viên   8"  hoặc  "Tên nhân viên   7.5 giờ"
      const m = line.match(/^([^\d]{3,}?)\s+(\d{1,2}(?:[.,]\d+)?)\s*(?:h|giờ|gio)?\s*$/i);
      if (m) {
        rows.push(impMakeRow({ nhan_vien: m[1].trim(), ngay: globalDate, gio: parseFloat(m[2].replace(',', '.')) }));
      }
      continue;
    }

    // NVL / Hủy Hàng / Chi Phí: tìm [tên] ... [số lượng]? [đvt]? ... [giá/tiền]
    const m = line.match(/^(.+?)\s+(\d+(?:[.,]\d+)?)\s*(kg|g|gr|lít|l|ml|hộp|thùng|bó|quả|trái|cái|chai|gói|con|kí)?\s*[xX*]?\s*(\d{1,3}(?:[.,]\d{3})+|\d{4,})\s*(?:đ|vnd|₫)?\s*$/i);
    if (m) {
      const ten = m[1].replace(/[-–.:]+$/, '').trim();
      const sl = parseFloat(m[2].replace(',', '.')) || 1;
      const dvt = m[3] || '';
      const giaOrTong = impMoneyToNumber(m[4]);
      // Nếu số cuối đã lớn hơn nhiều so với sl*10 → khả năng đó là THÀNH TIỀN, suy ra đơn giá
      const gia = giaOrTong / sl > 200 ? giaOrTong / sl : giaOrTong;
      if (_impLoai === 'chiphi') {
        rows.push(impMakeRow({ ten, so_tien: giaOrTong }));
      } else {
        rows.push(impMakeRow({ ngay: globalDate, ten, sl, dvt, gia: Math.round(gia) }));
      }
      continue;
    }

    // Dòng chỉ có [tên] ... [số tiền] — dùng cho Chi Phí hoặc fallback
    const m2 = line.match(/^(.+?)\s+(\d{1,3}(?:[.,]\d{3})+|\d{4,})\s*(?:đ|vnd|₫)?\s*$/i);
    if (m2 && _impLoai === 'chiphi') {
      rows.push(impMakeRow({ ten: m2[1].trim(), so_tien: impMoneyToNumber(m2[2]) }));
    }
  }
  return rows;
}

// ══════════ BẢNG XEM TRƯỚC / SỬA ══════════
function renderImportPreview() {
  const el = document.getElementById('imp-preview');
  if (!el) return;
  if (!_impRows.length) { el.innerHTML = ''; return; }

  const nvlOpts = () => sortAZ(S.nvl).map(n => `<option value="${n.ten}">`).join('');
  let head = '', body = '';

  if (_impLoai === 'chamcong') {
    head = `<th>✓</th><th>Nhân Viên</th><th>Khớp NV</th><th>Ngày</th><th>Số Giờ</th><th>Nguồn File</th><th></th>`;
    body = _impRows.map((r, i) => {
      const match = impMatchStaff(r.nhan_vien);
      return `<tr>
        <td><input type="checkbox" ${r._include ? 'checked' : ''} onchange="impRowSet(${i},'_include',this.checked)"></td>
        <td><input value="${r.nhan_vien || ''}" style="width:150px" onchange="impRowSet(${i},'nhan_vien',this.value)"></td>
        <td>${match ? `✅ ${match.ten}` : `<span style="color:var(--amber)">🆕 NV mới</span>`}</td>
        <td><input type="date" value="${r.ngay || ''}" onchange="impRowSet(${i},'ngay',this.value)"></td>
        <td><input type="number" step="0.5" value="${r.gio || 0}" style="width:70px" onchange="impRowSet(${i},'gio',parseFloat(this.value)||0)"></td>
        <td class="fs11 txt-gray">${r._source || ''}</td>
        <td><button class="btn btn-outline btn-sm" onclick="impRemoveRow(${i})">🗑</button></td>
      </tr>`;
    }).join('');
  } else if (_impLoai === 'chiphi') {
    head = `<th>✓</th><th>Tên Khoản Chi</th><th>Nhóm</th><th>Loại</th><th>Số Tiền</th><th>Nguồn File</th><th></th>`;
    body = _impRows.map((r, i) => `<tr>
        <td><input type="checkbox" ${r._include ? 'checked' : ''} onchange="impRowSet(${i},'_include',this.checked)"></td>
        <td><input value="${r.ten || ''}" style="width:180px" onchange="impRowSet(${i},'ten',this.value)"></td>
        <td><select onchange="impRowSet(${i},'nhom',this.value)">
          ${['Mặt Bằng', 'Nhân Sự', 'Điện Nước Gas', 'Marketing', 'Vận Hành', 'Khấu Hao', 'Khác'].map(g => `<option ${r.nhom === g ? 'selected' : ''}>${g}</option>`).join('')}
        </select></td>
        <td><select onchange="impRowSet(${i},'loai',this.value)">
          <option value="co_dinh" ${r.loai === 'co_dinh' ? 'selected' : ''}>Cố Định</option>
          <option value="bien_phi" ${r.loai !== 'co_dinh' ? 'selected' : ''}>Biến Phí</option>
        </select></td>
        <td><input type="number" value="${r.so_tien || 0}" style="width:110px" onchange="impRowSet(${i},'so_tien',parseFloat(this.value)||0)"></td>
        <td class="fs11 txt-gray">${r._source || ''}</td>
        <td><button class="btn btn-outline btn-sm" onclick="impRemoveRow(${i})">🗑</button></td>
      </tr>`).join('');
  } else {
    // nvl | huyhang
    const showLyDo = _impLoai === 'huyhang';
    head = `<th>✓</th><th>Ngày</th><th>Tên NVL</th><th>Khớp NVL</th><th>SL</th><th>ĐVT</th><th>Đơn Giá</th>${showLyDo ? '<th>Lý Do</th>' : ''}<th>Nguồn File</th><th></th>`;
    body = _impRows.map((r, i) => {
      const match = impMatchNVL(r.ten);
      return `<tr>
        <td><input type="checkbox" ${r._include ? 'checked' : ''} onchange="impRowSet(${i},'_include',this.checked)"></td>
        <td><input type="date" value="${r.ngay || ''}" style="width:130px" onchange="impRowSet(${i},'ngay',this.value)"></td>
        <td><input list="imp-nvl-datalist" value="${r.ten || ''}" style="width:160px" onchange="impRowSet(${i},'ten',this.value)"></td>
        <td>${match ? `✅ ${match.ten}` : `<span style="color:var(--amber)">🆕 NVL mới (${guessNhomNVL(r.ten)})</span>`}</td>
        <td><input type="number" value="${r.sl || 0}" style="width:70px" onchange="impRowSet(${i},'sl',parseFloat(this.value)||0)"></td>
        <td><input value="${r.dvt || match?.dvt || ''}" style="width:60px" onchange="impRowSet(${i},'dvt',this.value)"></td>
        <td><input type="number" value="${r.gia || 0}" style="width:100px" onchange="impRowSet(${i},'gia',parseFloat(this.value)||0)"></td>
        ${showLyDo ? `<td><select onchange="impRowSet(${i},'ly_do',this.value)">
          ${['🔥 Hỏng / Hư tự nhiên', '❌ Lỗi chế biến', '⏰ Hết hạn sử dụng', '🍳 Cháy / Quá lửa', '💧 Đổ vỡ / Rò rỉ', '📦 Bao bì hỏng', '❓ Lý do khác'].map(l => `<option ${r.ly_do === l ? 'selected' : ''}>${l}</option>`).join('')}
        </select></td>` : ''}
        <td class="fs11 txt-gray">${r._source || ''}</td>
        <td><button class="btn btn-outline btn-sm" onclick="impRemoveRow(${i})">🗑</button></td>
      </tr>`;
    }).join('');
  }

  el.innerHTML = `
    <datalist id="imp-nvl-datalist">${nvlOpts()}</datalist>
    <div class="alert alert-info mb8 fs12">📋 Tìm được <strong>${_impRows.length}</strong> dòng. Kiểm tra/sửa các ô bên dưới, bỏ tick dòng nào không muốn lưu, rồi bấm <strong>Lưu Tất Cả</strong>.</div>
    <div class="tbl-wrap"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>
    <div class="mt12 flex-center" style="gap:8px">
      <button class="btn btn-teal" onclick="saveAllImportRows()">💾 Lưu Tất Cả Vào Hệ Thống</button>
      <button class="btn btn-outline" onclick="_impRows=[];renderImportPreview();">✖ Xoá Bảng Xem Trước</button>
    </div>`;
}
function impRowSet(i, field, val) { if (_impRows[i]) { _impRows[i][field] = val; if (['ten', 'sl', 'gia'].includes(field)) renderImportPreview(); } }
function impRemoveRow(i) { _impRows.splice(i, 1); renderImportPreview(); }

// ══════════ LƯU VÀO HỆ THỐNG ══════════
function saveAllImportRows() {
  const rows = _impRows.filter(r => r._include);
  if (!rows.length) { alert('Không có dòng nào được chọn để lưu!'); return; }
  let added = 0;

  if (_impLoai === 'nvl' || _impLoai === 'huyhang') {
    rows.forEach(r => {
      if (!r.ten || !r.ngay) return;
      let nvl = impMatchNVL(r.ten);
      if (!nvl) {
        const newId = Math.max(0, ...S.nvl.map(n => n.id)) + 1;
        nvl = { id: newId, ten: r.ten.trim(), dvt: r.dvt || 'kg', gia: r.gia || 0, gia_chuan: r.gia || 0, gia_chuan_ngay: new Date().toISOString().slice(0, 10), gia_chuan_auto: false, nhom: guessNhomNVL(r.ten), khong_quan_ly_ton: false };
        S.nvl.push(nvl);
      }
      const thang = parseInt(r.ngay.split('-')[1]), nam = parseInt(r.ngay.split('-')[0]);
      const mk = mkey(thang, nam);
      if (_impLoai === 'nvl') {
        if (!S.inventory) S.inventory = {};
        if (!S.inventory[mk]) S.inventory[mk] = [];
        const giaChuan = nvl.gia_chuan || nvl.gia || 0;
        const pct = giaChuan > 0 && r.gia > 0 ? (r.gia - giaChuan) / giaChuan : 0;
        S.inventory[mk].push({
          id: Date.now() + added, date: r.ngay, ten: nvl.ten, dvt: r.dvt || nvl.dvt, sl: r.sl || 0,
          don_gia: r.gia || 0, thanh_tien: (r.sl || 0) * (r.gia || 0), nhom: nvl.nhom,
          ghichu: `Import tự động (${r._source || ''})`, gia_chuan_ref: giaChuan, pct_vs_chuan: pct,
          warn_level: pct > 0 ? (getPriceWarnLevel(pct)?.label || null) : null, tu_import: true
        });
        if (r.gia > 0) nvl.gia = r.gia;
      } else {
        if (!S.huy_hang) S.huy_hang = {};
        if (!S.huy_hang[mk]) S.huy_hang[mk] = [];
        S.huy_hang[mk].push({
          ngay: r.ngay, ten: nvl.ten, dvt: r.dvt || nvl.dvt, sl: r.sl || 0,
          gia: r.gia || nvl.gia || 0, thanh_tien: (r.sl || 0) * (r.gia || nvl.gia || 0),
          ly_do: r.ly_do || '❓ Lý do khác', nguoi: '', tu_import: true
        });
      }
      added++;
    });
    if (_impLoai === 'nvl' && typeof autoUpdateGiaChuan === 'function') autoUpdateGiaChuan();
  } else if (_impLoai === 'chiphi') {
    rows.forEach(r => {
      if (!r.ten || !r.so_tien) return;
      S.chi_phi.push({ ten: r.ten.trim(), nhom: r.nhom || 'Khác', loai: r.loai || 'bien_phi', so_tien: r.so_tien, thang: S.thang, nam: S.nam });
      added++;
    });
  } else if (_impLoai === 'chamcong') {
    rows.forEach(r => {
      if (!r.nhan_vien) return;
      let nv = impMatchStaff(r.nhan_vien);
      if (!nv) {
        const newId = Math.max(0, ...(S.staff || []).map(n => n.id), 0) + 1;
        nv = { id: newId, ten: r.nhan_vien.trim(), chuc_vu: '', luong_gio: 0, luong_ngay: 0 };
        if (!S.staff) S.staff = [];
        S.staff.push(nv);
      }
      let ngay = r.ngay, dayNum = r.ngay_so;
      if (!dayNum && ngay) dayNum = parseInt(ngay.split('-')[2]);
      const thang = ngay ? parseInt(ngay.split('-')[1]) : S.thang;
      const nam = ngay ? parseInt(ngay.split('-')[0]) : S.nam;
      if (!dayNum) return;
      const mk = mkey(thang, nam);
      const key = `${mk}-${nv.id}`;
      if (!S.cham_cong) S.cham_cong = {};
      if (!S.cham_cong[key]) S.cham_cong[key] = new Array(31).fill(0);
      S.cham_cong[key][dayNum - 1] = r.gio || 0;
      added++;
    });
  }

  saveData();
  _impRows = [];
  renderImportPreview();
  const statusEl = document.getElementById('imp-status');
  if (statusEl) statusEl.textContent = `✅ Đã lưu ${added} dòng vào hệ thống! Vào tab tương ứng để kiểm tra.`;
  // Cập nhật lại tab đích nếu đang mở sẵn ở tab khác
  if (document.getElementById('page-inventory')?.classList.contains('on') && typeof renderInventory === 'function') renderInventory();
  if (document.getElementById('page-huyhang')?.classList.contains('on') && typeof renderHuyHang === 'function') renderHuyHang();
  if (document.getElementById('page-chiphi')?.classList.contains('on') && typeof renderChiPhi === 'function') renderChiPhi();
  if (document.getElementById('page-chamcong')?.classList.contains('on') && typeof renderChamCong === 'function') renderChamCong();
  if (document.getElementById('page-nvl')?.classList.contains('on') && typeof renderNVL === 'function') renderNVL();
  if (typeof renderDashboard === 'function') renderDashboard();
  if (typeof refreshNVLDatalist === 'function') refreshNVLDatalist();
}

function renderImport() {
  const sel = document.getElementById('imp-loai');
  if (sel) _impLoai = sel.value;
  onImportLoaiChange();
}
