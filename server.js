const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// Подключение к БД
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Функция для создания таблицы товаров при запуске
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

// Проверка работы сервера и БД
app.get('/', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ message: '🛒 Сервер работает и подключен к Базе Данных!' });
  } catch (err) {
    res.status(500).json({ error: 'Ошибка подключения к БД: ' + err.message });
  }
});

// Маршрут для получения всех товаров
app.get('/api/products', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM products');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Маршрут для добавления товара (позже сделаем админку)
app.post('/api/products', async (req, res) => {
  try {
    const { name, price, image_url, description } = req.body;
    const result = await pool.query(
      'INSERT INTO products (name, price, image_url, description) VALUES ($1, $2, $3, $4) RETURNING *',
      [name, price, image_url, description]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`✅ Сервер запущен на порту ${PORT}`);
});
