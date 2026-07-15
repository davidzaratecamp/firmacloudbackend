const bcrypt = require('bcryptjs');
const db = require('../config/database');

const VALID_ROLES = ['admin', 'agent', 'firma_datos', 'correo_datos'];

async function listAgents(req, res, next) {
  try {
    const [rows] = await db.query(
      'SELECT id, name, email, role, active, created_at FROM agents ORDER BY created_at DESC'
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
}

async function createAgent(req, res, next) {
  try {
    const { name, email, password, role } = req.body;

    if (!name || typeof name !== 'string' || !name.trim())
      return res.status(400).json({ error: 'Nombre requerido' });
    if (!email || typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return res.status(400).json({ error: 'Email inválido' });
    if (!password || typeof password !== 'string' || password.length < 8 || password.length > 128)
      return res.status(400).json({ error: 'La contraseña debe tener entre 8 y 128 caracteres' });
    if (!VALID_ROLES.includes(role))
      return res.status(400).json({ error: `Rol inválido. Use: ${VALID_ROLES.join(', ')}` });

    const passwordHash = await bcrypt.hash(password, 10);

    try {
      const [result] = await db.query(
        'INSERT INTO agents (name, email, password_hash, role) VALUES (?, ?, ?, ?)',
        [name.trim(), email.trim(), passwordHash, role]
      );
      res.status(201).json({ id: result.insertId, name: name.trim(), email: email.trim(), role, active: true });
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') return res.status(400).json({ error: 'Ya existe un agente con ese email' });
      throw err;
    }
  } catch (err) {
    next(err);
  }
}

async function updateAgent(req, res, next) {
  try {
    const { id } = req.params;
    const { name, email, password, role, active } = req.body;

    const [rows] = await db.query('SELECT id, role, active FROM agents WHERE id = ?', [id]);
    if (!rows.length) return res.status(404).json({ error: 'Agente no encontrado' });

    const isSelf = req.user.id === parseInt(id);
    if (isSelf && role !== undefined && role !== 'admin')
      return res.status(400).json({ error: 'No puedes quitarte a ti mismo el rol de administrador' });
    if (isSelf && active === false)
      return res.status(400).json({ error: 'No puedes desactivarte a ti mismo' });

    const fields = [];
    const params = [];

    if (name !== undefined) {
      if (typeof name !== 'string' || !name.trim()) return res.status(400).json({ error: 'Nombre inválido' });
      fields.push('name = ?'); params.push(name.trim());
    }
    if (email !== undefined) {
      if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
        return res.status(400).json({ error: 'Email inválido' });
      fields.push('email = ?'); params.push(email.trim());
    }
    if (role !== undefined) {
      if (!VALID_ROLES.includes(role)) return res.status(400).json({ error: `Rol inválido. Use: ${VALID_ROLES.join(', ')}` });
      fields.push('role = ?'); params.push(role);
    }
    if (active !== undefined) {
      fields.push('active = ?'); params.push(Boolean(active));
    }
    if (password !== undefined) {
      if (typeof password !== 'string' || password.length < 8 || password.length > 128)
        return res.status(400).json({ error: 'La contraseña debe tener entre 8 y 128 caracteres' });
      fields.push('password_hash = ?'); params.push(await bcrypt.hash(password, 10));
    }

    if (!fields.length) return res.status(400).json({ error: 'Nada para actualizar' });

    try {
      await db.query(`UPDATE agents SET ${fields.join(', ')} WHERE id = ?`, [...params, id]);
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') return res.status(400).json({ error: 'Ya existe un agente con ese email' });
      throw err;
    }

    const [[updated]] = await db.query('SELECT id, name, email, role, active, created_at FROM agents WHERE id = ?', [id]);
    res.json(updated);
  } catch (err) {
    next(err);
  }
}

module.exports = { listAgents, createAgent, updateAgent, VALID_ROLES };
