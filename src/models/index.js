const sequelize = require('../config/database');
const Account = require('./Account');
const Transaction = require('./Transaction');

// Initialize models
const models = {
  Account: Account(sequelize),
  Transaction: Transaction(sequelize),
  sequelize: sequelize,
  Sequelize: sequelize.Sequelize
};

// Define associations
Object.keys(models).forEach(modelName => {
  if (models[modelName].associate) {
    models[modelName].associate(models);
  }
});

module.exports = models;
