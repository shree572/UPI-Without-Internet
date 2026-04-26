const ServerKeyHolder = require('../src/crypto/ServerKeyHolder');
const HybridCryptoService = require('../src/crypto/HybridCryptoService');
const PaymentInstruction = require('../src/models/PaymentInstruction');
const MeshPacket = require('../src/models/MeshPacket');
const DemoService = require('../src/services/DemoService');
const BridgeIngestionService = require('../src/services/BridgeIngestionService');
const IdempotencyService = require('../src/services/IdempotencyService');
const SettlementService = require('../src/services/SettlementService');
const models = require('../src/models');

/**
 * The killer test: simulates the "three bridges deliver at the same instant"
 * scenario the user explicitly cared about.
 */
describe('IdempotencyConcurrencyTest', () => {
  let serverKeyHolder, cryptoService, demoService, bridgeService, idempotencyService;
  let settlementService, accountRepository, transactionRepository;

  beforeAll(async () => {
    // Initialize database in memory for tests
    const sequelize = require('../src/config/database');
    await sequelize.sync({ force: true });

    // Initialize services
    serverKeyHolder = new ServerKeyHolder();
    await serverKeyHolder.init();
    
    cryptoService = new HybridCryptoService(serverKeyHolder);
    accountRepository = models.Account;
    transactionRepository = models.Transaction;
    
    // Seed test accounts
    await accountRepository.bulkCreate([
      { vpa: 'alice@demo', holderName: 'Alice', balance: 5000.00 },
      { vpa: 'bob@demo', holderName: 'Bob', balance: 1000.00 },
      { vpa: 'carol@demo', holderName: 'Carol', balance: 2500.00 },
      { vpa: 'dave@demo', holderName: 'Dave', balance: 500.00 }
    ]);

    idempotencyService = new IdempotencyService(86400);
    settlementService = new SettlementService(accountRepository, transactionRepository);
    demoService = new DemoService(accountRepository, cryptoService, serverKeyHolder);
    bridgeService = new BridgeIngestionService(cryptoService, idempotencyService, settlementService, 86400);
  });

  beforeEach(async () => {
    // Clear idempotency cache before each test
    idempotencyService.clear();
    
    // Clear transaction table
    await transactionRepository.destroy({ where: {} });
  });

  afterAll(async () => {
    // Cleanup
    idempotencyService.destroy();
    const sequelize = require('../src/config/database');
    await sequelize.close();
  });

  test('single packet delivered by three bridges settles exactly once', async () => {
    // Capture starting balances
    const aliceBefore = await accountRepository.findByPk('alice@demo');
    const bobBefore = await accountRepository.findByPk('bob@demo');

    // One packet, but we'll deliver it from 3 "bridges" simultaneously
    const packet = await demoService.createPacket('alice@demo', 'bob@demo', 100.00, '1234', 5);

    // Create promises for concurrent execution
    const promises = [];
    const results = [];

    for (let i = 0; i < 3; i++) {
      const nodeId = `bridge-${i}`;
      const promise = bridgeService.ingest(packet, nodeId, 3).then(result => {
        results.push({ nodeId, result });
        return result;
      });
      promises.push(promise);
    }

    // Execute all promises concurrently
    await Promise.all(promises);

    // Count outcomes
    const settled = results.filter(r => r.result.outcome === 'SETTLED').length;
    const duplicates = results.filter(r => r.result.outcome === 'DUPLICATE_DROPPED').length;

    expect(settled).toBe(1, 'exactly one bridge should settle');
    expect(duplicates).toBe(2, 'the other two should be duplicates');

    // Balance moved exactly once
    const aliceAfter = await accountRepository.findByPk('alice@demo');
    const bobAfter = await accountRepository.findByPk('bob@demo');

    expect(aliceAfter.balance).toBe(aliceBefore.balance - 100.00);
    expect(bobAfter.balance).toBe(bobBefore.balance + 100.00);
  });

  test('tampered ciphertext is rejected', async () => {
    const packet = await demoService.createPacket('alice@demo', 'bob@demo', 50.00, '1234', 5);

    // Flip a character in the middle of the ciphertext
    const chars = packet.ciphertext.split('');
    const middleIndex = Math.floor(chars.length / 2);
    chars[middleIndex] = chars[middleIndex] === 'A' ? 'B' : 'A';
    packet.ciphertext = chars.join('');

    const result = await bridgeService.ingest(packet, 'bridge-x', 1);
    expect(result.outcome).toBe('INVALID');
    expect(result.reason).toBe('decryption_failed');
  });

  test('encrypt decrypt round trip', async () => {
    const original = new PaymentInstruction(
      'alice@demo', 
      'bob@demo', 
      123.45,
      'abcdef', 
      'nonce-1', 
      Date.now()
    );

    const ciphertext = await cryptoService.encrypt(original, serverKeyHolder.getPublicKeyPem());
    const decrypted = await cryptoService.decrypt(ciphertext);

    expect(decrypted.senderVpa).toBe(original.senderVpa);
    expect(decrypted.receiverVpa).toBe(original.receiverVpa);
    expect(decrypted.amount).toBe(original.amount);
    expect(decrypted.nonce).toBe(original.nonce);
    expect(decrypted.signedAt).toBe(original.signedAt);
  });

  test('stale packet is rejected', async () => {
    const packet = await demoService.createPacket('alice@demo', 'bob@demo', 50.00, '1234', 5);
    
    // Manually set the signedAt to be very old (more than 24 hours)
    // We need to decrypt, modify, and re-encrypt for this test
    const instruction = await cryptoService.decrypt(packet.ciphertext);
    instruction.signedAt = Date.now() - (25 * 60 * 60 * 1000); // 25 hours ago
    
    // Re-encrypt with the old timestamp
    packet.ciphertext = await cryptoService.encrypt(instruction, serverKeyHolder.getPublicKeyPem());

    const result = await bridgeService.ingest(packet, 'bridge-test', 1);
    expect(result.outcome).toBe('INVALID');
    expect(result.reason).toBe('stale_packet');
  });

  test('future dated packet is rejected', async () => {
    const packet = await demoService.createPacket('alice@demo', 'bob@demo', 50.00, '1234', 5);
    
    // Manually set the signedAt to be in the future
    const instruction = await cryptoService.decrypt(packet.ciphertext);
    instruction.signedAt = Date.now() + (10 * 60 * 1000); // 10 minutes in future
    
    // Re-encrypt with the future timestamp
    packet.ciphertext = await cryptoService.encrypt(instruction, serverKeyHolder.getPublicKeyPem());

    const result = await bridgeService.ingest(packet, 'bridge-test', 1);
    expect(result.outcome).toBe('INVALID');
    expect(result.reason).toBe('future_dated');
  });
});
