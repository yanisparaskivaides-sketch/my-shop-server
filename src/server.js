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

async function createTable() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS products (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        price INTEGER NOT NULL,
        image_url TEXT,
        description TEXT
      );
    `);
    console.log("✅ Таблица 'products' готова!");
  } catch (err) {
    console.error("Ошибка при создании таблицы:", err.message);
  }
}
createTable();

app.get('/', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ message: '🛒 Сервер работает!' });
  } catch (err) {
    res.status(500).json({ error: 'Ошибка БД: ' + err.message });
  }
});

app.get('/api/products', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM products');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`✅ Сервер запущен на порту ${PORT}`);
});
