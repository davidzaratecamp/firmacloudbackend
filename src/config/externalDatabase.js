const mysql = require('mysql2/promise');
require('dotenv').config();

const externalPool = mysql.createPool({
  host: process.env.EXT_DB_HOST,
  port: process.env.EXT_DB_PORT || 3306,
  user: process.env.EXT_DB_USER,
  password: process.env.EXT_DB_PASSWORD,
  database: process.env.EXT_DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  timezone: '+00:00',
});

module.exports = externalPool;
