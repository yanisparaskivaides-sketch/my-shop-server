const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const axios = require('axios');
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
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        discord_id VARCHAR(255) UNIQUE,
        name VARCHAR(100),
        avatar_url TEXT,
        email VARCHAR(255),
        role VARCHAR(20) DEFAULT 'user',
        balance INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS products (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        price INTEGER NOT NULL,
        image_url TEXT,
        description TEXT
      );
    `);
    console.log("✅ БД готова");
  } catch (err) {
    console.error("Ошибка БД:", err.message);
  }
}
initDB();

// --- МАРШРУТЫ ---

// 1. Получить ссылку для входа через Discord
app.get('/api/auth/discord', (req, res) => {
  const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID;
  const redirectUri = `${process.env.FRONTEND_URL}/auth/discord/callback`;
  const url = `https://discord.com/api/oauth2/authorize?client_id=${DISCORD_CLIENT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=identify`;
  res.json({ url });
});

// 2. Обработка колбэка от Discord (обмен кода на токен и данные)
app.get('/api/auth/discord/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.status(400).json({ error: 'Нет кода авторизации' });

  try {
    // Меняем код на токен
    const tokenResponse = await axios.post('https://discord.com/api/oauth2/token', new URLSearchParams({
      client_id: process.env.DISCORD_CLIENT_ID,
      client_secret: process.env.DISCORD_CLIENT_SECRET,
      code,
      grant_type: 'authorization_code',
      redirect_uri: `${process.env.FRONTEND_URL}/auth/discord/callback`,
    }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });

    const { access_token } = tokenResponse.data;

    // Получаем данные пользователя из Discord
    const userResponse = await axios.get('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${access_token}` },
    });

    const { id, username, avatar } = userResponse.data;

    // Проверяем, есть ли юзер в нашей базе
    let user = await pool.query('SELECT * FROM users WHERE discord_id = $1', [id]);

    let balance = 0;
    if (user.rows.length === 0) {
      // Если нет - создаем с 0 монет
      const avatarUrl = avatar ? `https://cdn.discordapp.com/avatars/${id}/${avatar}.png` : null;
      const newUser = await pool.query(
        'INSERT INTO users (discord_id, name, avatar_url, balance) VALUES ($1, $2, $3, $4) RETURNING id, name, avatar_url, balance',
        [id, username, avatarUrl, 0]
      );
      user = newUser;
      balance = 0;
    } else {
      balance = user.rows[0].balance;
    }

    // Генерируем наш JWT токен для сайта
    const token = jwt.sign(
      { id: user.rows[0].id, discord_id: id, name: username },
      process.env.JWT_SECRET,
      { expiresIn: '30d' }
    );

    // Перенаправляем на фронтенд с токеном в параметрах
    res.redirect(`${process.env.FRONTEND_URL}?token=${token}&balance=${balance}`);

  } catch (error) {
    console.error('Ошибка Discord OAuth:', error.response?.data || error.message);
    res.redirect(`${process.env.FRONTEND_URL}?error=auth_failed`);
  }
});

// 3. Получить данные текущего пользователя по токену
app.get('/api/user/me', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Нет токена' });

  try {
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await pool.query('SELECT id, name, avatar_url, balance, role FROM users WHERE id = $1', [decoded.id]);
    res.json(user.rows[0]);
  } catch (err) {
    res.status(401).json({ error: 'Неверный токен' });
  }
});

// --- ТОВАРЫ И МОНЕТЫ (старые маршруты) ---
app.get('/api/products', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM products ORDER BY id ASC');
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/admin/products', async (req, res) => {
  try {
    const { name, price, image_url, description } = req.body;
    const result = await pool.query(
      'INSERT INTO products (name, price, image_url, description) VALUES ($1, $2, $3, $4) RETURNING *',
      [name, price, image_url || '', description || '']
    );
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/admin/products/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM products WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/admin/give-coins', async (req, res) => {
  try {
    const { email, amount } = req.body;
    const updated = await pool.query('UPDATE users SET balance = balance + $1 WHERE name = $2 RETURNING balance', [amount, email]);
    if (updated.rows.length === 0) return res.status(404).json({ error: 'Пользователь не найден' });
    res.json({ message: `✅ Выдано ${amount} монет`, new_balance: updated.rows[0].balance });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/', (req, res) => {
  res.json({ message: '🛒 Full Shop API работает с Discord Auth!' });
});

app.listen(PORT, () => {
  console.log(`✅ Сервер запущен на порту ${PORT}`);
});
