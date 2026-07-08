// server/users.js
const express = require('express');
const bcrypt = require('bcryptjs');
const { pool } = require('./db');
const { requireAuth, requireAdmin, requireSuperAdmin } = require('./auth');

const router = express.Router();

// Danh sach nguoi dung (khong tra ve mat khau)
router.get('/', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, username, ten, role, is_superadmin, created_at FROM users ORDER BY id ASC'
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// [ĐÃ FIX LỖI] Them nguoi dung moi - Thay the toàn bộ 'name' thành 'ten'
router.post('/', requireAuth, requireAdmin, async (req, res) => {
  const { username, password, ten, role } = req.body;
  if (!username || !password || !ten) {
    return res.status(400).json({ error: 'Thiếu thông tin tài khoản hoặc tên hiển thị' });
  }
  if (!['admin', 'staff', 'bep', 'phucvu', 'thungan'].includes(role)) {
    return res.status(400).json({ error: 'Vai trò không hợp lệ' });
  }
  try {
    const hash = await bcrypt.hash(password, 10);
    // FIX: Thay column name thành ten trong câu lệnh INSERT và RETURNING
    const { rows } = await pool.query(
      'INSERT INTO users (username, password_hash, ten, role) VALUES ($1,$2,$3,$4) RETURNING id, username, ten, role',
      [username.trim(), hash, ten.trim(), role]
    );
    res.json(rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Tài khoản này đã tồn tại' });
    res.status(500).json({ error: e.message });
  }
});

// [ĐÃ FIX LỖI] Cap nhat (doi ten / vai tro / reset mat khau)
router.put('/:id', requireAuth, requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { ten, role, password } = req.body; // FIX: Lấy biến 'ten' thay vì 'name' từ request body
  try {
    const targetRes = await pool.query('SELECT is_superadmin FROM users WHERE id = $1', [id]);
    if (targetRes.rows.length === 0) {
      return res.status(404).json({ error: 'Không tìm thấy tài khoản' });
    }
    const isTargetSuper = targetRes.rows[0].is_superadmin;
    const isSelf = parseInt(id, 10) === req.user.id;
    // Khong ai duoc sua tai khoan Super Admin, tru chinh Super Admin do tu sua minh
    if (isTargetSuper && !(isSelf && req.user.is_superadmin)) {
      return res.status(403).json({ error: 'Tài khoản Super Admin được bảo vệ, không thể chỉnh sửa' });
    }
    if (ten) await pool.query('UPDATE users SET ten = $1 WHERE id = $2', [ten, id]);
    if (role && ['admin', 'staff', 'bep', 'phucvu', 'thungan'].includes(role)) {
      await pool.query('UPDATE users SET role = $1 WHERE id = $2', [role, id]);
    }
    if (password) {
      const hash = await bcrypt.hash(password, 10);
      await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, id]);
    }
    res.json({ message: 'Đã cập nhật thành công thông tin người dùng!' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Xoa nguoi dung — chi Super Admin moi co quyen xoa
router.delete('/:id', requireAuth, requireSuperAdmin, async (req, res) => {
  const { id } = req.params;
  if (parseInt(id, 10) === req.user.id) {
    return res.status(400).json({ error: 'Không thể tự xoá chính mình' });
  }
  try {
    const target = await pool.query('SELECT role, is_superadmin FROM users WHERE id = $1', [id]);
    if (target.rows.length === 0) {
      return res.status(404).json({ error: 'Không tìm thấy tài khoản' });
    }
    if (target.rows[0].is_superadmin) {
      return res.status(403).json({ error: 'Không thể xoá tài khoản Super Admin' });
    }
    const { rows } = await pool.query("SELECT COUNT(*)::int AS c FROM users WHERE role = 'admin'");
    if (target.rows[0]?.role === 'admin' && rows[0].c <= 1) {
      return res.status(400).json({ error: 'Phải có ít nhất 1 tài khoản Quản lý' });
    }
    await pool.query('DELETE FROM users WHERE id = $1', [id]);
    res.json({ message: 'Đã xoá tài khoản thành công!' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
