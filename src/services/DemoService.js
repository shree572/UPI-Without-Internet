const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const PaymentInstruction = require('../models/PaymentInstruction');
const MeshPacket = require('../models/MeshPacket');

/**
 * Helper service that:
 *   - seeds demo accounts on startup
 *   - simulates "sender phone creates an encrypted packet" flow
 */
class DemoService {
  constructor(accountRepository, cryptoService, serverKeyHolder) {
    this.accountRepository = accountRepository;
    this.cryptoService = cryptoService;
    this.serverKeyHolder = serverKeyHolder;
  }

  async seedAccounts() {
    const count = await this.accountRepository.count();
    if (count === 0) {
      await this.accountRepository.bulkCreate([
        { vpa: 'alice@demo', holderName: 'Alice', balance: 5000.00 },
        { vpa: 'bob@demo', holderName: 'Bob', balance: 1000.00 },
        { vpa: 'carol@demo', holderName: 'Carol', balance: 2500.00 },
        { vpa: 'dave@demo', holderName: 'Dave', balance: 500.00 }
      ]);
      console.log('Seeded 4 demo accounts');
    }
  }

  /**
   * Simulates the sender's phone:
   *   1. Build a PaymentInstruction with a fresh nonce + signedAt timestamp.
   *   2. Encrypt with the server's public key (hybrid RSA+AES).
   *   3. Wrap in a MeshPacket with TTL.
   *
   * In a real Android app, this exact code (minus the server-side reference)
   * would run on the phone. The phone would have already cached the server's
   * public key during a previous online session.
   */
  async createPacket(senderVpa, receiverVpa, amount, pin, ttl) {
    const instruction = new PaymentInstruction(
      senderVpa,
      receiverVpa,
      amount,
      this.sha256Hex(pin),
      uuidv4(), // nonce — guarantees uniqueness
      Date.now() // signedAt — for freshness check
    );

    const ciphertext = await this.cryptoService.encrypt(
      instruction, 
      this.serverKeyHolder.getPublicKeyPem()
    );

    const packet = new MeshPacket(
      uuidv4(), // packetId
      ttl,
      Date.now(), // createdAt
      ciphertext
    );

    return packet;
  }

  sha256Hex(input) {
    return crypto.createHash('sha256').update(input).digest('hex');
  }
}

module.exports = DemoService;
