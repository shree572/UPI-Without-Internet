/**
 * The over-the-wire format. This is what hops from phone to phone via Bluetooth.
 *
 * The intermediate phones can read the OUTER fields (packetId, ttl, createdAt)
 * because they need them for routing and dedup. They CANNOT read `ciphertext` —
 * that's encrypted with the server's public key.
 *
 * NOTE on outer-field tampering:
 *   A malicious intermediate could change `packetId` or `createdAt`. That's why
 *   we use the ciphertext's hash (not packetId) as the idempotency key on the
 *   server. The ciphertext is authenticated by hybrid encryption, so any
 *   tampering inside the encrypted blob is detected on decryption.
 */
class MeshPacket {
  constructor(packetId, ttl, createdAt, ciphertext) {
    this.packetId = packetId;
    this.ttl = ttl;
    this.createdAt = createdAt;
    this.ciphertext = ciphertext;
  }

  static fromJSON(json) {
    return new MeshPacket(
      json.packetId,
      json.ttl,
      json.createdAt,
      json.ciphertext
    );
  }

  toJSON() {
    return {
      packetId: this.packetId,
      ttl: this.ttl,
      createdAt: this.createdAt,
      ciphertext: this.ciphertext
    };
  }

  validate() {
    const errors = [];
    
    if (!this.packetId) {
      errors.push('Packet ID is required');
    }
    
    if (typeof this.ttl !== 'number' || this.ttl < 0) {
      errors.push('TTL must be a non-negative number');
    }
    
    if (!this.createdAt) {
      errors.push('Created timestamp is required');
    }
    
    if (!this.ciphertext) {
      errors.push('Ciphertext is required');
    }
    
    return errors;
  }

  // Decrement TTL for mesh routing
  decrementTtl() {
    if (this.ttl > 0) {
      this.ttl--;
    }
    return this.ttl;
  }

  // Check if packet is still valid for routing
  isValidForRouting() {
    return this.ttl > 0;
  }
}

module.exports = MeshPacket;
