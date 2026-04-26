const { DataTypes } = require('sequelize');

/**
 * Simulated bank account. In a real system this would live in the bank's core,
 * not in our service. For the demo, we own the ledger.
 */
module.exports = (sequelize) => {
  const Account = sequelize.define('Account', {
    vpa: {
      type: DataTypes.STRING,
      primaryKey: true,
      comment: 'Virtual Payment Address, e.g. "alice@demo"'
    },
    holderName: {
      type: DataTypes.STRING,
      allowNull: false
    },
    balance: {
      type: DataTypes.DECIMAL(19, 2),
      allowNull: false,
      defaultValue: 0.00
    },
    version: {
      type: DataTypes.BIGINT,
      allowNull: true,
      defaultValue: 0,
      comment: 'Optimistic locking — prevents lost updates on concurrent transfers'
    }
  }, {
    tableName: 'accounts',
    timestamps: false
  });

  return Account;
};
