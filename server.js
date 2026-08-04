const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function initDB() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100),
        email VARCHAR(255),
        discord_id VARCHAR(255) UNIQUE,
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
    await pool.query(`
      CREATE TABLE IF NOT EXISTS purchases (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        product_id INTEGER REFERENCES products(id),
        product_name VARCHAR(255),
        price INTEGER,
        purchased_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log("✅ БД готова (с таблицей покупок)");
  } catch (err) {
    console.error("Ошибка БД:", err.message);
  }
}
initDB();

// --- ПОЛУЧИТЬ ПОКУПКИ ПОЛЬЗОВАТЕЛЯ ---
app.get('/api/user/purchases/:discord_id', async (req, res) => {
  try {
    const { discord_id } = req.params;
    const user = await pool.query('SELECT id FROM users WHERE discord_id = $1', [discord_id]);
    if (user.rows.length === 0) return res.json([]);
    
    const purchases = await pool.query(`
      SELECT purchases.id, purchases.product_name, purchases.price, purchases.purchased_at, products.image_url 
      FROM purchases 
      LEFT JOIN products ON purchases.product_id = products.id
      WHERE purchases.user_id = $1 
      ORDER BY purchases.purchased_at DESC
    `, [user.rows[0].id]);
    
    res.json(purchases.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- ПОКУПКА ТОВАРА (для бота) ---
app.post('/api/admin/buy-product', async (req, res) => {
  try {
    const { username, productName } = req.body;
    if (!username || !productName) return res.status(400).json({ error: 'Укажите username и название товара' });

    const user = await pool.query('SELECT * FROM users WHERE name = $1 OR discord_id = $1', [username]);
    if (user.rows.length === 0) return res.status(404).json({ error: 'Пользователь не найден' });

    const product = await pool.query('SELECT * FROM products WHERE name ILIKE $1', [`%${productName}%`]);
    if (product.rows.length === 0) return res.status(404).json({ error: 'Товар не найден' });

    const targetProduct = product.rows[0];
    const currentBalance = user.rows[0].balance;

    if (currentBalance < targetProduct.price) {
      return res.status(400).json({ error: `Недостаточно монет! Нужно: ${targetProduct.price}, у вас: ${currentBalance}` });
    }

    // Списываем монеты
    const newBalance = currentBalance - targetProduct.price;
    await pool.query('UPDATE users SET balance = $1 WHERE id = $2', [newBalance, user.rows[0].id]);

    // Записываем покупку в историю
    await pool.query(
      'INSERT INTO purchases (user_id, product_id, product_name, price) VALUES ($1, $2, $3, $4)',
      [user.rows[0].id, targetProduct.id, targetProduct.name, targetProduct.price]
    );

    res.json({ 
      message: `✅ Вы успешно купили "${targetProduct.name}" за ${targetProduct.price} монет!`, 
      new_balance: newBalance 
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- ТОВАРЫ И МОНЕТЫ ---
app.get('/api/products', async (req, res) => {
  const result = await pool.query('SELECT * FROM products ORDER BY id ASC');
  res.json(result.rows);
});

app.post('/api/admin/products', async (req, res) => {
  const { name, price, image_url, description } = req.body;
  const result = await pool.query(
    'INSERT INTO products (name, price, image_url, description) VALUES ($1, $2, $3, $4) RETURNING *',
    [name, price, image_url || '', description || '']
  );
  res.json(result.rows[0]);
});

app.delete('/api/admin/products/:id', async (req, res) => {
  await pool.query('DELETE FROM products WHERE id = $1', [req.params.id]);
  res.json({ success: true });
});

app.post('/api/admin/give-coins', async (req, res) => {
  const { email, amount } = req.body;
  const updated = await pool.query('UPDATE users SET balance = balance + $1 WHERE name = $2 OR discord_id = $2 RETURNING balance', [amount, email]);
  if (updated.rows.length === 0) return res.status(404).json({ error: 'Пользователь не найден' });
  res.json({ message: `✅ Выдано ${amount} монет`, new_balance: updated.rows[0].balance });
});

app.get('/', (req, res) => {
  res.json({ message: '🛒 Магазин работает с историей покупок!' });
});

app.listen(PORT, () => {
  console.log(`✅ Сервер запущен на порту ${PORT}`);
});
