/**
 * Orchestrates the full server-side pipeline for one inbound packet from a
 * bridge node:
 *
 *   1. Hash the ciphertext.
 *   2. Try to claim that hash via the idempotency cache.
 *      - If already claimed: this is a duplicate. Drop it.
 *   3. Decrypt the ciphertext with the server's private key.
 *      - If decryption fails: tampered or junk. Reject.
 *   4. Check freshness — reject if signedAt is too old (replay protection).
 *   5. Hand off to SettlementService for the actual debit/credit.
 */
class BridgeIngestionService {
  constructor(cryptoService, idempotencyService, settlementService, maxAgeSeconds = 86400) {
    this.cryptoService = cryptoService;
    this.idempotencyService = idempotencyService;
    this.settlementService = settlementService;
    this.maxAgeSeconds = maxAgeSeconds;
  }

  async ingest(packet, bridgeNodeId, hopCount) {
    try {
      const packetHash = this.cryptoService.hashCiphertext(packet.ciphertext);

      // ---- Idempotency gate ----
      if (!this.idempotencyService.claim(packetHash)) {
        console.info(`DUPLICATE packet ${packetHash.substring(0, 12)}... from bridge ${bridgeNodeId} — dropped`);
        return BridgeIngestionService.IngestResult.duplicate(packetHash);
      }

      // ---- Decrypt ----
      let instruction;
      try {
        instruction = await this.cryptoService.decrypt(packet.ciphertext);
      } catch (e) {
        console.warn(`Decryption failed for packet ${packetHash.substring(0, 12)}...: ${e.message}`);
        return BridgeIngestionService.IngestResult.invalid(packetHash, 'decryption_failed');
      }

      // ---- Freshness check (replay protection) ----
      const ageSeconds = Math.floor((Date.now() - instruction.signedAt) / 1000);
      if (ageSeconds > this.maxAgeSeconds) {
        console.warn(`Packet ${packetHash.substring(0, 12)}... too old (${ageSeconds}s), rejected`);
        return BridgeIngestionService.IngestResult.invalid(packetHash, 'stale_packet');
      }
      if (ageSeconds < -300) { // small clock-skew tolerance
        return BridgeIngestionService.IngestResult.invalid(packetHash, 'future_dated');
      }

      // ---- Settle ----
      const transaction = await this.settlementService.settle(
        instruction, 
        packetHash, 
        bridgeNodeId, 
        hopCount
      );
      return BridgeIngestionService.IngestResult.settled(packetHash, transaction);

    } catch (e) {
      console.error(`Ingestion error: ${e.message}`, e);
      return BridgeIngestionService.IngestResult.invalid('?', 'internal_error: ' + e.message);
    }
  }

  static IngestResult = class {
    constructor(outcome, packetHash, reason, transactionId) {
      this.outcome = outcome;
      this.packetHash = packetHash;
      this.reason = reason;
      this.transactionId = transactionId;
    }

    static settled(hash, transaction) {
      return new BridgeIngestionService.IngestResult('SETTLED', hash, null, transaction.id);
    }

    static duplicate(hash) {
      return new BridgeIngestionService.IngestResult('DUPLICATE_DROPPED', hash, null, null);
    }

    static invalid(hash, reason) {
      return new BridgeIngestionService.IngestResult('INVALID', hash, reason, null);
    }
  };
}

module.exports = BridgeIngestionService;
