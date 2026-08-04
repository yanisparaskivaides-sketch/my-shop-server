const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// --- БАЗА ДАННЫХ ---
async function initDB() {
  try {
    // Пользователи (с добавленным балансом)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100),
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        role VARCHAR(20) DEFAULT 'user',
        balance INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    // Товары
    await pool.query(`
      CREATE TABLE IF NOT EXISTS products (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        price INTEGER NOT NULL,
        image_url TEXT,
        description TEXT
      );
    `);
    console.log("✅ БД готова (с балансом)");
  } catch (err) {
    console.error("Ошибка БД:", err.message);
  }
}
initDB();

// --- РЕГИСТРАЦИЯ И ВХОД ---
app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Заполните email и пароль' });
    
    const exists = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (exists.rows.length > 0) return res.status(400).json({ error: 'Email уже занят' });

    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash(password, salt);

    // Добавили balance в запрос
    const user = await pool.query(
      'INSERT INTO users (name, email, password_hash, balance) VALUES ($1, $2, $3, $4) RETURNING id, name, email, role, balance',
      [name || 'Покупатель', email, hash, 0]
    );

    const token = jwt.sign(
      { id: user.rows[0].id, email: user.rows[0].email, role: user.rows[0].role },
      process.env.JWT_SECRET,
      { expiresIn: '30d' }
    );
    res.json({ token, user: user.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (user.rows.length === 0) return res.status(400).json({ error: 'Неверный логин или пароль' });

    const valid = await bcrypt.compare(password, user.rows[0].password_hash);
    if (!valid) return res.status(400).json({ error: 'Неверный логин или пароль' });

    const token = jwt.sign(
      { id: user.rows[0].id, email: user.rows[0].email, role: user.rows[0].role },
      process.env.JWT_SECRET,
      { expiresIn: '30d' }
    );
    res.json({ token, user: { id: user.rows[0].id, name: user.rows[0].name, email: user.rows[0].email, role: user.rows[0].role, balance: user.rows[0].balance } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- ТОВАРЫ ---
app.get('/api/products', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM products ORDER BY id ASC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ДОБАВЛЕНИЕ ТОВАРА (ДЛЯ АДМИНА)
app.post('/api/admin/products', async (req, res) => {
  try {
    const { name, price, image_url, description } = req.body;
    const result = await pool.query(
      'INSERT INTO products (name, price, image_url, description) VALUES ($1, $2, $3, $4) RETURNING *',
      [name, price, image_url || '', description || '']
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/admin/products/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM products WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- МОНЕТЫ (БАЛАНС) ДЛЯ БОТА И ВИТРИНЫ ---

// Получить баланс пользователя по Email
app.get('/api/user/balance/:email', async (req, res) => {
  try {
    const { email } = req.params;
    const user = await pool.query('SELECT balance FROM users WHERE email = $1', [email]);
    if (user.rows.length === 0) return res.status(404).json({ error: 'Пользователь не найден' });
    res.json({ balance: user.rows[0].balance });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Выдать монеты (Секретная команда для Discord бота)
app.post('/api/admin/give-coins', async (req, res) => {
  try {
    const { email, amount } = req.body;
    if (!email || !amount) return res.status(400).json({ error: 'Укажите email и количество монет' });

    const updated = await pool.query(
      'UPDATE users SET balance = balance + $1 WHERE email = $2 RETURNING balance',
      [amount, email]
    );
    
    if (updated.rows.length === 0) return res.status(404).json({ error: 'Пользователь не найден' });
    
    res.json({ message: `✅ Выдано ${amount} монет`, new_balance: updated.rows[0].balance });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/', (req, res) => {
  res.json({ message: '🛒 Full Shop API работает! (с балансом)' });
});

app.listen(PORT, () => {
  console.log(`✅ Сервер запущен на порту ${PORT}`);
});
