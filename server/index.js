require('dotenv').config();
const path = require('path');
const http = require('http');
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { Server } = require('socket.io');

const { pool, initSchema } = require('./db');
const { router: authRouter } = require('./auth');
const usersRouter = require('./users');
const stateRouterFactory = require('./state');

const SECRET = process.env.JWT_SECRET || 'doi-secret-nay-trong-file-.env';
const PORT = process.env.PORT || 3000;

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

app.use(cors());
app.use(express.json({ limit: '15mb' })); // du lieu S co the kha lon (menu + ban hang nhieu thang)

// ------------------- API -------------------
app.use('/api/auth', authRouter);
app.use('/api/users', usersRouter);
app.use('/api/state', stateRouterFactory(io));

app.get('/api/health', (req, res) => res.json({ ok: true }));

// ------------------- SOCKET.IO: xac thuc bang JWT -------------------
io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error('Chưa đăng nhập'));
  jwt.verify(token, SECRET, (err, decoded) => {
    if (err) return next(new Error('Phiên đăng nhập hết hạn'));
    socket.user = decoded;
    next();
  });
});

io.on('connection', async (socket) => {
  console.log(`🔌 ${socket.user?.name || 'unknown'} đã kết nối (${socket.id})`);

  // 🚪 HÀM ĐỒNG BỘ CỨU HỘ MỞ KHÓA 14 TAB:
  // Nếu tài khoản kết nối mang quyền quản trị cao nhất, server chủ động ép gửi dữ liệu 14 Tab xuống giao diện
  if (socket.user?.role === 'admin' || socket.user?.role === 'Super Admin') {
    try {
      const fullTabs = [
        "Dashboard", "Bán Hàng", "Danh Mục NVL", "Nhập Hàng", "Menu & Công Thức", 
        "Menu Tại Chỗ", "Chấm Công", "Chi Phí", "Hao Hụt", "Hủy Hàng", "Tồn Kho", 
        "Báo Cáo", "Dự Báo DT", "Người Dùng", "dashboard", "banhang", "nvl", 
        "inventory", "menu", "bantaicho", "chamcong", "chiphi", "haohut", "huyhang", 
        "tonkho", "baocao", "dubaodoanhthu", "users"
      ];
      
      // Đọc dữ liệu thô từ database để bảo vệ cấu hình quán của bạn
      const { rows } = await pool.query('SELECT data FROM app_state WHERE id = 1');
      let currentData = {};
      if (rows[0]?.data) {
        try { currentData = JSON.parse(rows[0].data); } catch(e) {}
      }

      // Ép danh sách allowedTabs luôn đầy đủ 14 Tab, không cho phép bị trống dữ liệu
      currentData.allowedTabs = fullTabs;
      if (!currentData.activeTab) currentData.activeTab = "Dashboard";

      // Bắn tín hiệu real-time giữ chặt 14 Tab cố định trên màn hình trình duyệt của bạn
      socket.emit('state-updated', {
        data: currentData,
        updated_at: new Date(),
        updated_by: 'Hệ thống Cứu hộ'
      });
      console.log(`🎯 Đã kích hoạt cố định vĩnh viễn 14 Tab cho Admin: ${socket.user?.username}`);
    } catch (err) {
      console.error('❌ Lỗi đồng bộ Tab qua Socket:', err.message);
    }
  }

  socket.on('disconnect', () => {
    console.log(`🔌 ${socket.user?.name || 'unknown'} đã ngắt kết nối`);
  });
});

// ------------------- FRONTEND TINH (static) -------------------
app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// ------------------- KHOI DONG -------------------
initSchema()
  .then(() => {
    server.listen(PORT, () => {
      console.log(`🚀 KhạpKhun server đang chạy tại http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('❌ Lỗi khởi tạo database:', err.message);
    process.exit(1);
  });
