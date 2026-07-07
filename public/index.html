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
app.use(express.json({ limit: '15mb' }));

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

io.on('connection', (socket) => {
  console.log(`🔌 ${socket.user?.name || 'unknown'} đã kết nối (${socket.id})`);

  // 🎯 KHÓA CỨNG QUYỀN LỰC TẠI ĐÂY:
  // Định nghĩa sẵn dải 14 Tab chuẩn chỉnh viết cả chữ hoa lẫn chữ thường để Front-end nhận diện 100%
  const fullTabs = [
    "Dashboard", "Bán Hàng", "Danh Mục NVL", "Nhập Hàng", "Menu & Công Thức", 
    "Menu Tại Chỗ", "Chấm Công", "Chi Phí", "Hao Hụt", "Hủy Hàng", "Tồn Kho", 
    "Báo Cáo", "Dự Báo DT", "Người Dùng", "dashboard", "banhang", "nvl", 
    "inventory", "menu", "bantaicho", "chamcong", "chiphi", "haohut", "huyhang", 
    "tonkho", "baocao", "dubaodoanhthu", "users"
  ];

  // Bắt bất kỳ lệnh đòi đồng bộ (sync, get-state, load) nào từ Front-end gửi lên
  socket.onAny((eventName, ...args) => {
    if (socket.user?.role === 'admin' || socket.user?.role === 'Super Admin') {
      // Nếu Front-end gửi tín hiệu lên đòi lấy trạng thái, Server chặn lại và ép trả về 14 Tab
      socket.emit('state-updated', {
        data: { activeTab: "Dashboard", allowedTabs: fullTabs },
        updated_at: new Date(),
        updated_by: 'Hệ thống Cứu hộ tối cao'
      });
    }
  });

  // Gửi ngay lập tức khi vừa kết nối thành công để giao diện đứng im luôn
  if (socket.user?.role === 'admin' || socket.user?.role === 'Super Admin') {
    socket.emit('state-updated', {
      data: { activeTab: "Dashboard", allowedTabs: fullTabs },
      updated_at: new Date(),
      updated_by: 'Hệ thống Cứu hộ tối cao'
    });
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
