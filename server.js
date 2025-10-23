require('dotenv').config();
const express = require('express');
const session = require('express-session');
const flash = require('connect-flash');
const bcrypt = require('bcrypt');
const mysql = require('mysql2/promise');
const path = require('path');
const bodyParser = require('body-parser');
const multer = require('multer');
const fs = require('fs');


const app = express();
// --- Configuración de subida de imágenes ---
const uploadDir = path.join(__dirname, 'public/uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const uniqueName = Date.now() + '-' + file.originalname.replace(/\s+/g, '_');
    cb(null, uniqueName);
  }
});

const upload = multer({ storage });


const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.static('public'));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({ secret: process.env.SESSION_SECRET || 'cambia_esto', resave: false, saveUninitialized: false, cookie: { maxAge: 1000 * 60 * 60 * 24 } // 1 día
}));
app.use(flash());

// Conexión pool a MySQL
const pool = mysql.createPool({
host: process.env.DB_HOST || '127.0.0.1',
user: process.env.DB_USER || 'root',
password: process.env.DB_PASSWORD || '',
database: process.env.DB_NAME || 'tienda_cafe',
waitForConnections: true,
connectionLimit: 10,
queueLimit: 0
});


// Crear producto (sólo admin)
app.post('/api/products', ensureRole('admin'), upload.single('imagen'), async (req, res) => {
  try {
    const { nombre, descripcion, precio, stock } = req.body;
    const imagen = req.file ? '/uploads/' + req.file.filename : null;

    if (!nombre || !precio) return res.status(400).json({ ok: false, message: 'Faltan campos obligatorios' });

    const [result] = await pool.query(
      'INSERT INTO products (nombre, descripcion, precio, stock, imagen) VALUES (?,?,?,?,?)',
      [nombre, descripcion, precio, stock || 0, imagen]
    );

    res.json({ ok: true, id: result.insertId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, message: 'Error al crear producto' });
  }
});

// --- Helpers ---
function ensureAuthenticated(req, res, next) {
if (req.session.user) return next();
return res.status(401).json({ ok: false, message: 'No autenticado' });
}
function ensureRole(role) {
return (req, res, next) => {
if (!req.session.user) return res.status(401).json({ ok: false, message:
'No autenticado' });
if (req.session.user.role !== role) return res.status(403).json({ ok:
false, message: 'Acceso denegado' });
next();
};
}
// --- Rutas de autenticación ---
// Registro
app.post('/api/register', async (req, res) => {
try {
const { nombre, email, password, role, admin_code } = req.body;

if (!nombre || !email || !password) return res.status(400).json({ ok:
    false, message: 'Faltan campos' });
    const [rows] = await pool.query('SELECT id FROM users WHERE email = ?',
[email]);
if (rows.length) return res.status(400).json({ ok: false, message:
'Email ya registrado' });
const hash = await bcrypt.hash(password, 10);
let finalRole = 'cliente';

// Solo permitir admin si el código es válido
if (role === 'admin') {
  const [codes] = await pool.query('SELECT code FROM admin_codes WHERE code = ?', [admin_code]);
  if (!codes.length) {
    return res.status(403).json({ ok: false, message: 'Código de administrador inválido' });
  }
  finalRole = 'admin';
}


const [result] = await pool.query(
  'INSERT INTO users (nombre, email, password_hash, role) VALUES (?,?,?,?)',
  [nombre, email, hash, finalRole]
);

req.session.user = { id: result.insertId, nombre, email, role: 'cliente' };
res.json({ ok: true, message: 'Registro exitoso', user: req.session.user });
} catch (err) {
console.error(err);
res.status(500).json({ ok: false, message: 'Error del servidor' });
}
});
// Login
app.post('/api/login', async (req, res) => {
try {
    const { email, password } = req.body;
if (!email || !password) return res.status(400).json({ ok: false,
message: 'Faltan datos' });
const [rows] = await pool.query('SELECT * FROM users WHERE email = ?', [email]);
if (!rows.length) return res.status(400).json({ ok: false, message: 'Usuario no encontrado' });
const user = rows[0];
const match = await bcrypt.compare(password, user.password_hash);
if (!match) return res.status(400).json({ ok: false, message: 'Credenciales inválidas' });
req.session.user = { id: user.id, nombre: user.nombre, email:
user.email, role: user.role };
res.json({ ok: true, message: 'Login exitoso', user: req.session.user });
} catch (err) {
console.error(err);
res.status(500).json({ ok: false, message: 'Error del servidor' });
}
});
// Logout
app.post('/api/logout', (req, res) => {
req.session.destroy(err => {
    if (err) return res.status(500).json({ ok: false, message: 'No se pudo cerrar sesión' });
res.json({ ok: true, message: 'Sesión cerrada' });
});
});

// Obtener usuario en sesión
app.get('/api/me', (req, res) => {
if (!req.session.user) return res.json({ ok: false, user: null });
res.json({ ok: true, user: req.session.user });
});


// --- RUTAS DE PRODUCTOS ---
// --- Obtener productos ---
app.get('/api/products', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM products');
    res.json({ ok: true, products: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, message: 'Error al obtener productos' });
  }
});



// --- Crear producto (solo admin) ---
app.post('/api/products', ensureRole('admin'), async (req, res) => {
  try {
    const { nombre, descripcion, precio, stock, imagen } = req.body;
    const [r] = await pool.query(
      'INSERT INTO products (nombre, descripcion, precio, stock, imagen) VALUES (?, ?, ?, ?, ?)',
      [nombre, descripcion, precio, stock, imagen]
    );
    res.json({ ok: true, id: r.insertId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, message: 'Error al crear producto' });
  }
});

// --- Eliminar producto (solo admin) ---
app.delete('/api/products/:id', ensureRole('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const [r] = await pool.query('DELETE FROM products WHERE id = ?', [id]);
    if (r.affectedRows === 0)
      return res.status(404).json({ ok: false, message: 'Producto no encontrado' });
    res.json({ ok: true, message: 'Producto eliminado' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, message: 'Error al eliminar producto' });
  }
});
// --- Editar producto (solo admin) ---
app.put('/api/products/:id', ensureRole('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const { nombre, descripcion, precio, stock, imagen } = req.body;
    const [r] = await pool.query(
      'UPDATE products SET nombre=?, descripcion=?, precio=?, stock=?, imagen=? WHERE id=?',
      [nombre, descripcion, precio, stock, imagen, id]
    );
    if (r.affectedRows === 0)
      return res.status(404).json({ ok: false, message: 'Producto no encontrado' });
    res.json({ ok: true, message: 'Producto actualizado correctamente' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, message: 'Error al actualizar producto' });
  }
});

// --- RUTA DE PROMOCIONES ---
// --- Obtener promociones ---
app.get('/api/promotions', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM promotions WHERE activo = 1');
    res.json({ ok: true, promotions: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, message: 'Error al obtener promociones' });
  }
});

// --- Crear promoción (solo admin) ---
app.post('/api/promotions', ensureRole('admin'), async (req, res) => {
  try {
    const { nombre, descripcion, precio, imagen, stock } = req.body;
    const [r] = await pool.query(
      'INSERT INTO promotions (nombre, descripcion, precio, imagen, stock) VALUES (?, ?, ?, ?, ?)',
      [nombre, descripcion, precio, imagen, stock]
    );
    res.json({ ok: true, id: r.insertId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, message: 'Error al crear promoción' });
  }
});

// --- Eliminar promoción (solo admin) ---
app.delete('/api/promotions/:id', ensureRole('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const [result] = await pool.query('DELETE FROM promotions WHERE id = ?', [id]);
    if (result.affectedRows === 0) return res.status(404).json({ ok: false, message: 'Promoción no encontrada' });
    res.json({ ok: true, message: 'Promoción eliminada' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, message: 'Error al eliminar promoción' });
  }
});

// --- Editar promoción (solo admin) ---
app.put('/api/promotions/:id', ensureRole('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const { nombre, descripcion, precio, imagen, stock } = req.body;
    const [r] = await pool.query(
      'UPDATE promotions SET nombre=?, descripcion=?, precio=?, imagen=?, stock=? WHERE id=?',
      [nombre, descripcion, precio, imagen, stock, id]
    );
    if (r.affectedRows === 0) return res.status(404).json({ ok: false, message: 'Promoción no encontrada' });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, message: 'Error al actualizar promoción' });
  }
});

// --- ADICIONALES ---

// Obtener todos los adicionales
app.get('/api/adicionales', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM adicionales ORDER BY id DESC');
    res.json({ ok: true, adicionales: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, message: 'Error al obtener adicionales' });
  }
});

// Crear nuevo adicional (solo admin)
app.post('/api/adicionales', async (req, res) => {
  try {
    const { nombre, descripcion, precio, stock, imagen } = req.body;
    if (!nombre || !precio)
      return res.json({ ok: false, message: 'Nombre y precio son requeridos' });

    await pool.query(
      'INSERT INTO adicionales (nombre, descripcion, precio, stock, imagen) VALUES (?, ?, ?, ?, ?)',
      [nombre, descripcion || '', precio, stock || 0, imagen || '']
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, message: 'Error al crear adicional' });
  }
});

// Actualizar adicional
app.put('/api/adicionales/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { nombre, descripcion, precio, stock, imagen } = req.body;
    await pool.query(
      'UPDATE adicionales SET nombre=?, descripcion=?, precio=?, stock=?, imagen=? WHERE id=?',
      [nombre, descripcion, precio, stock, imagen, id]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, message: 'Error al actualizar adicional' });
  }
});

// Eliminar adicional
app.delete('/api/adicionales/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM adicionales WHERE id=?', [id]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, message: 'Error al eliminar adicional' });
  }
});






// --- Carrito en sesión ---

// Agregar producto o promoción al carrito
app.post('/api/cart/add', (req, res) => {
  const { productId, promoId, cantidad } = req.body;
  if (!req.session.cart) req.session.cart = [];

  // Si es producto normal
  if (productId) {
    const idx = req.session.cart.findIndex(i => i.productId === productId);
    if (idx >= 0) req.session.cart[idx].cantidad += Number(cantidad || 1);
    else req.session.cart.push({ productId, cantidad: Number(cantidad || 1) });
  }

  // Si es promoción
  if (promoId) {
    const idx = req.session.cart.findIndex(i => i.promoId === promoId);
    if (idx >= 0) req.session.cart[idx].cantidad += Number(cantidad || 1);
    else req.session.cart.push({ promoId, cantidad: Number(cantidad || 1) });
  }

  // Si es adicional
if (req.body.adicionalId) {
  const adicionalId = req.body.adicionalId;
  const idx = req.session.cart.findIndex(i => i.adicionalId === adicionalId);
  if (idx >= 0) req.session.cart[idx].cantidad += Number(req.body.cantidad || 1);
  else req.session.cart.push({ adicionalId, cantidad: Number(req.body.cantidad || 1) });
}

  res.json({ ok: true, cart: req.session.cart });
});

// Obtener carrito (seguro para productos, promociones y adicionales)
app.get('/api/cart', async (req, res) => {
  try {
    const cart = req.session.cart || [];
    if (!cart.length) return res.json({ ok: true, items: [] });

    const prodIds = cart.filter(i => i.productId).map(i => i.productId);
    const promoIds = cart.filter(i => i.promoId).map(i => i.promoId);
    const adicionalIds = cart.filter(i => i.adicionalId).map(i => i.adicionalId);

    let rowsProducts = [], rowsPromos = [], rowsAdicionales = [];

    if (prodIds.length > 0) {
      const [rows] = await pool.query(
        `SELECT id, nombre, precio FROM products WHERE id IN (${prodIds.map(() => '?').join(',')})`,
        prodIds
      );
      rowsProducts = rows;
    }

    if (promoIds.length > 0) {
      const [rows] = await pool.query(
        `SELECT id, nombre, precio FROM promotions WHERE id IN (${promoIds.map(() => '?').join(',')})`,
        promoIds
      );
      rowsPromos = rows;
    }

    if (adicionalIds.length > 0) {
      const [rows] = await pool.query(
        `SELECT id, nombre, precio FROM adicionales WHERE id IN (${adicionalIds.map(() => '?').join(',')})`,
        adicionalIds
      );
      rowsAdicionales = rows;
    }

    const items = cart.map(ci => {
      let p = null;

      if (ci.productId) p = rowsProducts.find(r => r.id === ci.productId);
      else if (ci.promoId) p = rowsPromos.find(r => r.id === ci.promoId);
      else if (ci.adicionalId) p = rowsAdicionales.find(r => r.id === ci.adicionalId);

      return {
        id: ci.productId || ci.promoId || ci.adicionalId,
        tipo: ci.productId ? 'producto' : ci.promoId ? 'promoción' : 'adicional',
        nombre: p ? p.nombre : 'Desconocido',
        precio: p ? Number(p.precio) : 0,
        cantidad: ci.cantidad
      };
    });

    res.json({ ok: true, items });
  } catch (err) {
    console.error('Error en /api/cart:', err);
    res.status(500).json({ ok: false, message: 'Error al obtener carrito' });
  }
});


// Actualizar cantidad (en sesión)
app.put('/api/cart/update', (req, res) => {
  const { id, delta } = req.body;
  if (!req.session.cart) return res.json({ ok: false, message: 'Carrito vacío' });

  const item = req.session.cart.find(i =>
    i.productId === Number(id) ||
    i.promoId === Number(id) ||
    i.adicionalId === Number(id)
  );
  if (!item) return res.json({ ok: false, message: 'Ítem no encontrado' });

  item.cantidad += delta;
  if (item.cantidad <= 0)
    req.session.cart = req.session.cart.filter(i => i !== item);

  res.json({ ok: true });
});

// Eliminar ítem
app.delete('/api/cart/remove/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!req.session.cart) return res.json({ ok: false, message: 'Carrito vacío' });

  req.session.cart = req.session.cart.filter(i =>
    i.productId !== id &&
    i.promoId !== id &&
    i.adicionalId !== id
  );
  res.json({ ok: true });
});

// Vaciar carrito
app.post('/api/cart/clear', (req, res) => {
  req.session.cart = [];
  res.json({ ok: true });
});

// Checkout -> crea orden en DB (requiere autenticación)
app.post('/api/checkout', ensureAuthenticated, async (req, res) => {
  const cart = req.session.cart || [];
  if (!cart.length)
    return res.status(400).json({ ok: false, message: 'Carrito vacío' });

  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    // Separar productos y promociones
    const prodIds = cart.filter(i => i.productId).map(i => i.productId);
    const promoIds = cart.filter(i => i.promoId).map(i => i.promoId);

    let rowsProducts = [], rowsPromos = [];

    if (prodIds.length)
      [rowsProducts] = await conn.query(
        `SELECT id, precio, stock FROM products WHERE id IN (${prodIds.map(()=>'?').join(',')}) FOR UPDATE`, prodIds
      );

    if (promoIds.length)
      [rowsPromos] = await conn.query(
        `SELECT id, precio, stock FROM promotions WHERE id IN (${promoIds.map(()=>'?').join(',')}) FOR UPDATE`, promoIds
      );
    // --- Dentro de /api/checkout ---
const adicionalIds = cart.filter(i => i.adicionalId).map(i => i.adicionalId);
let rowsAdicionales = [];

if (adicionalIds.length)
  [rowsAdicionales] = await conn.query(
    `SELECT id, precio, stock FROM adicionales WHERE id IN (${adicionalIds.map(()=>'?').join(',')}) FOR UPDATE`,
    adicionalIds
  );

// Calcular total y validar stock
let total = 0;
for (const item of cart) {
  let p = null;
  if (item.productId) p = rowsProducts.find(r => r.id === item.productId);
  else if (item.promoId) p = rowsPromos.find(r => r.id === item.promoId);
  else if (item.adicionalId) p = rowsAdicionales.find(r => r.id === item.adicionalId);

  if (!p) throw new Error('Ítem no encontrado en base de datos');
  if (p.stock < item.cantidad)
    throw new Error('Stock insuficiente para: ' + (p.nombre || 'Desconocido'));
  total += Number(p.precio) * Number(item.cantidad);
}

// Crear orden
const [rOrder] = await conn.query(
  'INSERT INTO orders (user_id, total) VALUES (?,?)',
  [req.session.user.id, total]
);
const orderId = rOrder.insertId;

// Insertar items y descontar stock
for (const item of cart) {
  let p = null, table = '';
  if (item.productId) {
    p = rowsProducts.find(r => r.id === item.productId);
    table = 'products';
    await conn.query(
      'INSERT INTO order_items (order_id, product_id, cantidad, precio_unit) VALUES (?,?,?,?)',
      [orderId, item.productId, item.cantidad, p.precio]
    );
  } else if (item.promoId) {
    p = rowsPromos.find(r => r.id === item.promoId);
    table = 'promotions';
    await conn.query(
      'INSERT INTO order_items (order_id, promo_id, cantidad, precio_unit) VALUES (?,?,?,?)',
      [orderId, item.promoId, item.cantidad, p.precio]
    );
  } else if (item.adicionalId) {
    p = rowsAdicionales.find(r => r.id === item.adicionalId);
    table = 'adicionales';
    await conn.query(
      'INSERT INTO order_items (order_id, adicional_id, cantidad, precio_unit) VALUES (?,?,?,?)',
      [orderId, item.adicionalId, item.cantidad, p.precio]
    );
  }

  // Descontar stock
  await conn.query(
    `UPDATE ${table} SET stock = stock - ? WHERE id = ?`,
    [item.cantidad, p.id]
  );
}


    await conn.commit();
    req.session.cart = [];
    res.json({ ok: true, orderId });
  } catch (err) {
    await conn.rollback();
    console.error(err);
    res.status(500).json({ ok: false, message: err.message || 'Error en checkout' });
  } finally {
    conn.release();
  }
});





// --- Rutas de administración ---
app.get('/api/admin/orders', ensureRole('admin'), async (req, res) => {
try {
const [orders] = await pool.query(`
  SELECT o.id, u.nombre AS cliente, o.total, o.status, o.created_at
  FROM orders o
  JOIN users u ON o.user_id = u.id
  ORDER BY o.created_at DESC
`);

res.json({ ok: true, orders });
} catch (err) {
console.error(err);
res.status(500).json({ ok: false, message: 'Error al obtener órdenes' });
}
});

// --- Actualizar estado del pedido ---
app.put('/api/orders/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const validStatuses = ['pendiente', 'pagado', 'enviado', 'cancelado'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ ok: false, message: 'Estado inválido' });
    }

    const [result] = await pool.query('UPDATE orders SET status = ? WHERE id = ?', [status, id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ ok: false, message: 'Pedido no encontrado' });
    }

    res.json({ ok: true, message: `Estado del pedido #${id} actualizado a ${status}` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, message: 'Error al actualizar estado', error: err.message });
  }
});

// --- Imprimir factura ---
async function imprimirFactura(id) {
  try {
    const res = await fetch(`/api/orders/${id}`);
    const data = await res.json();
    if (!data.ok) return alert('❌ No se pudo obtener la información del pedido.');

    const pedido = data.order;
    const productos = pedido.items || [];

    // Generar contenido de factura
    const facturaHTML = `
      <html>
        <head>
          <title>Factura #${pedido.id}</title>
          <style>
            body { font-family: 'Poppins', sans-serif; padding: 20px; color: #3a2a17; }
            h1 { text-align: center; color: #6f4e37; }
            table { width: 100%; border-collapse: collapse; margin-top: 20px; }
            th, td { border: 1px solid #ccc; padding: 8px; text-align: center; }
            th { background-color: #f2e1c6; }
            .total { font-weight: bold; }
            .footer { margin-top: 30px; text-align: center; font-size: 0.9rem; color: #555; }
          </style>
        </head>
        <body>
          <h1>Café del Sol</h1>
          <h2>Factura #${pedido.id}</h2>
          <p><strong>Cliente:</strong> ${pedido.cliente}</p>
          <p><strong>Fecha:</strong> ${new Date(pedido.created_at).toLocaleString()}</p>

          <table>
            <thead>
              <tr><th>Producto</th><th>Cantidad</th><th>Precio</th><th>Subtotal</th></tr>
            </thead>
            <tbody>
              ${productos.map(p => `
                <tr>
                  <td>${p.nombre}</td>
                  <td>${p.cantidad}</td>
                  <td>$${Number(p.precio).toFixed(2)}</td>
                  <td>$${(p.cantidad * p.precio).toFixed(2)}</td>
                </tr>
              `).join('')}
            </tbody>
            <tfoot>
              <tr class="total"><td colspan="3">Total</td><td>$${Number(pedido.total).toFixed(2)}</td></tr>
            </tfoot>
          </table>

          <div class="footer">
            <p>☕ Gracias por tu compra en <strong>Café del Sol</strong></p>
            <p>Visítanos en www.cafedelsol.com o nuestras redes sociales.</p>
          </div>
        </body>
      </html>
    `;

    // Abrir ventana de impresión
    const printWindow = window.open('', '_blank');
    printWindow.document.write(facturaHTML);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
  } catch (err) {
    console.error('Error al imprimir factura:', err);
    alert('❌ Error al generar la factura.');
  }
}


// --- Obtener todos los productos (normales, promociones y adicionales) ---
app.get('/api/productos', async (req, res) => {
  try {
    const db = pool;
    // Traemos los productos normales
    const [productos] = await db.execute('SELECT nombre, imagen FROM products');
    const [promos] = await db.execute('SELECT nombre, imagen FROM promotions');
    const [adicionales] = await db.execute('SELECT nombre, imagen FROM adicionales');

    // Agregamos el campo "categoria" manualmente
    const productosConCategoria = [
      ...productos.map(p => ({ ...p, categoria: 'menu' })),
      ...promos.map(p => ({ ...p, categoria: 'promocion' })),
      ...adicionales.map(p => ({ ...p, categoria: 'adicional' }))
    ];

    res.json({ ok: true, productos: productosConCategoria });
  } catch (err) {
    console.error(err);
    res.json({ ok: false, message: 'Error al obtener productos' });
  }
});


// Iniciar servidor
app.listen(PORT, () => console.log(`Servidor en http://localhost:${PORT}`));
