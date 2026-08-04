// --- ПОКУПКА ТОВАРА ЧЕРЕЗ БОТА ---
app.post('/api/admin/buy-product', async (req, res) => {
  try {
    const { username, productName } = req.body;
    if (!username || !productName) return res.status(400).json({ error: 'Укажите username и название товара' });

    // 1. Ищем пользователя по имени (Discord tag)
    const user = await pool.query('SELECT * FROM users WHERE name = $1', [username]);
    if (user.rows.length === 0) return res.status(404).json({ error: 'Пользователь не найден в базе' });

    // 2. Ищем товар по названию (без учёта регистра)
    const product = await pool.query('SELECT * FROM products WHERE name ILIKE $1', [`%${productName}%`]);
    if (product.rows.length === 0) return res.status(404).json({ error: 'Товар с таким названием не найден' });

    const targetProduct = product.rows[0];
    const currentBalance = user.rows[0].balance;

    // 3. Проверяем, хватает ли монет
    if (currentBalance < targetProduct.price) {
      return res.status(400).json({ 
        error: `Недостаточно монет! Нужно: ${targetProduct.price}, у вас: ${currentBalance}` 
      });
    }

    // 4. Списываем монеты
    const newBalance = currentBalance - targetProduct.price;
    await pool.query('UPDATE users SET balance = $1 WHERE id = $2', [newBalance, user.rows[0].id]);

    // 5. Отправляем успешный ответ
    res.json({ 
      message: `✅ Вы успешно купили "${targetProduct.name}" за ${targetProduct.price} монет!`, 
      new_balance: newBalance 
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
