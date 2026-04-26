const { Sequelize } = require('sequelize');
const path = require('path');

/**
 * Database configuration using SQLite instead of H2
 */
const sequelize = new Sequelize({
  dialect: 'sqlite',
  storage: path.join(__dirname, '../../database.sqlite'),
  logging: false, // Set to console.log to see SQL queries
  define: {
    timestamps: false,
    underscored: false
  },
  pool: {
    max: 5,
    min: 0,
    acquire: 30000,
    idle: 10000
  }
});

module.exports = sequelize;
