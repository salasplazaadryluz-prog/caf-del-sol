// server.js
require('dotenv').config();
const express = require('express');
const path = require('path');
const session = require('express-session');
const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');

const app = express();
const PORT = process.env.PORT || 3000;

// Pool de MySQL
const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASS || '',
  database: process.env.DB_NAME || 'cafe_app',
  waitForConnections: true,
  connectionLimit: 10
});

// Middlewares
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: process.env.SESSION_SECRET || 'secret',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 } // 1 hora
}));

// Rutas
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/register', (req,res) => res.sendFile(path.join(__dirname, 'public', 'register.html')));

// Login
app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).send('Faltan campos');

  try {
    const [rows] = await pool.execute('SELECT id, name, password FROM users WHERE email = ?', [email]);
    if (rows.length === 0) return res.status(401).send('Usuario o contraseña inválidos');

    const user = rows[0];
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).send('Usuario o contraseña inválidos');

    req.session.userId = user.id;
    req.session.userName = user.name;
    return res.redirect('/dashboard');
  } catch (err) {
    console.error(err);
    return res.status(500).send('Error interno');
  }
});

// Registro
app.post('/register', async (req, res) => {
  const { name, email, password, birthday } = req.body;
  if (!name || !email || !password) return res.status(400).send('Faltan campos');

  try {
    const hashed = await bcrypt.hash(password, 10);
    await pool.execute('INSERT INTO users (name, email, password, birthday) VALUES (?, ?, ?, ?)', [name, email, hashed, birthday || null]);
    return res.redirect('/');
  } catch (err) {
    console.error(err);
    if (err.code === 'ER_DUP_ENTRY') return res.status(400).send('Email ya registrado');
    return res.status(500).send('Error al crear usuario');
  }
});

// Dashboard protegido
app.get('/dashboard', (req, res) => {
  if (!req.session.userId) return res.redirect('/');
  return res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

// Levantar servidor
app.listen(PORT, () => console.log(`Servidor en http://localhost:${PORT}`));
