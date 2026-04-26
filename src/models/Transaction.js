const { DataTypes } = require('sequelize');

/**
 * Permanent record of every settled transaction. Once written, never modified.
 * The packetHash is the idempotency key — uniqueness is enforced at the DB level
 * as a defense-in-depth fallback if the Redis-style cache layer ever fails.
 */
module.exports = (sequelize) => {
  const Transaction = sequelize.define('Transaction', {
    id: {
      type: DataTypes.BIGINT,
      primaryKey: true,
      autoIncrement: true
    },
    packetHash: {
      type: DataTypes.STRING(64),
      allowNull: false,
      unique: true,
      comment: 'SHA-256 hex of the encrypted packet'
    },
    senderVpa: {
      type: DataTypes.STRING,
      allowNull: false
    },
    receiverVpa: {
      type: DataTypes.STRING,
      allowNull: false
    },
    amount: {
      type: DataTypes.DECIMAL(19, 2),
      allowNull: false
    },
    signedAt: {
      type: DataTypes.DATE,
      allowNull: false,
      comment: 'When the sender originally signed it (offline)'
    },
    settledAt: {
      type: DataTypes.DATE,
      allowNull: false,
      comment: 'When the backend actually processed it'
    },
    bridgeNodeId: {
      type: DataTypes.STRING,
      allowNull: false,
      comment: 'Which mesh node finally delivered it'
    },
    hopCount: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    status: {
      type: DataTypes.ENUM('SETTLED', 'REJECTED'),
      allowNull: false,
      defaultValue: 'SETTLED'
    }
  }, {
    tableName: 'transactions',
    timestamps: false,
    indexes: [
      {
        name: 'idx_packet_hash',
        unique: true,
        fields: ['packetHash']
      }
    ]
  });

  return Transaction;
};
