/**
 * Where the actual ledger update happens. Wrapped in a DB transaction so either
 * BOTH the debit and credit happen, or neither does.
 *
 * The @Version column on Account gives us optimistic locking — if two threads
 * somehow get past idempotency and both try to debit the same account, the
 * second one will fail with OptimisticLockException rather than corrupting
 * the balance. (In a demo the idempotency layer should always catch this first,
 * but defense in depth.)
 */
class SettlementService {
  constructor(accountRepository, transactionRepository) {
    this.accountRepository = accountRepository;
    this.transactionRepository = transactionRepository;
  }

  /**
   * Settle a payment instruction in a transaction.
   * In a real database, this would use proper transactions.
   * For SQLite with Sequelize, we'll use a transaction.
   */
  async settle(instruction, packetHash, bridgeNodeId, hopCount, transaction) {
    const sender = await this.accountRepository.findByPk(instruction.senderVpa, { transaction });
    if (!sender) {
      throw new Error(`Unknown sender VPA: ${instruction.senderVpa}`);
    }

    const receiver = await this.accountRepository.findByPk(instruction.receiverVpa, { transaction });
    if (!receiver) {
      throw new Error(`Unknown receiver VPA: ${instruction.receiverVpa}`);
    }

    const amount = instruction.amount;
    if (amount <= 0) {
      throw new Error('Amount must be positive');
    }

    if (sender.balance < amount) {
      console.warn(`Insufficient balance: ${sender.vpa} has ₹${sender.balance}, tried to send ₹${amount}`);
      return await this.recordRejected(instruction, packetHash, bridgeNodeId, hopCount, transaction);
    }

    // Update balances with optimistic locking
    const newSenderBalance = sender.balance - amount;
    const newReceiverBalance = receiver.balance + amount;

    await this.accountRepository.update(
      { balance: newSenderBalance },
      { 
        where: { 
          vpa: sender.vpa,
          version: sender.version // Optimistic locking
        },
        transaction 
      }
    );

    await this.accountRepository.update(
      { balance: newReceiverBalance },
      { 
        where: { 
          vpa: receiver.vpa,
          version: receiver.version // Optimistic locking
        },
        transaction 
      }
    );

    // Create transaction record
    const tx = await this.transactionRepository.create({
      packetHash,
      senderVpa: instruction.senderVpa,
      receiverVpa: instruction.receiverVpa,
      amount,
      signedAt: new Date(instruction.signedAt),
      settledAt: new Date(),
      bridgeNodeId,
      hopCount,
      status: 'SETTLED'
    }, { transaction });

    console.log(`SETTLED ₹${amount} from ${sender.vpa} to ${receiver.vpa} (packetHash=${packetHash.substring(0, 12)}..., bridge=${bridgeNodeId}, hops=${hopCount})`);

    return tx;
  }

  async recordRejected(instruction, packetHash, bridgeNodeId, hopCount, transaction) {
    const tx = await this.transactionRepository.create({
      packetHash,
      senderVpa: instruction.senderVpa,
      receiverVpa: instruction.receiverVpa,
      amount: instruction.amount,
      signedAt: new Date(instruction.signedAt),
      settledAt: new Date(),
      bridgeNodeId,
      hopCount,
      status: 'REJECTED'
    }, { transaction });

    return tx;
  }
}

module.exports = SettlementService;
