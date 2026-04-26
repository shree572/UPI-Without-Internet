/**
 * The actual payment instruction. After the server decrypts MeshPacket.ciphertext,
 * it gets one of these.
 *
 * Critical fields for security:
 *   - nonce: a UUID unique to this payment. Even if everything else were identical
 *            for two legitimate payments (alice sends bob ₹100 twice), the nonces
 *            differ, so the resulting ciphertexts and their hashes also differ.
 *   - signedAt: lets the server reject stale packets ("freshness window"). Without
 *               this, an attacker who got the ciphertext could replay it weeks later.
 *   - pinHash: in a real system the user enters a UPI PIN; we'd verify it against
 *              a hash held by the bank. Here we just record it for realism.
 */
class PaymentInstruction {
  constructor(senderVpa, receiverVpa, amount, pinHash, nonce, signedAt) {
    this.senderVpa = senderVpa;
    this.receiverVpa = receiverVpa;
    this.amount = amount;
    this.pinHash = pinHash;
    this.nonce = nonce;
    this.signedAt = signedAt;
  }

  static fromJSON(json) {
    return new PaymentInstruction(
      json.senderVpa,
      json.receiverVpa,
      json.amount,
      json.pinHash,
      json.nonce,
      json.signedAt
    );
  }

  toJSON() {
    return {
      senderVpa: this.senderVpa,
      receiverVpa: this.receiverVpa,
      amount: this.amount,
      pinHash: this.pinHash,
      nonce: this.nonce,
      signedAt: this.signedAt
    };
  }

  validate() {
    const errors = [];
    
    if (!this.senderVpa || !this.receiverVpa) {
      errors.push('Sender and receiver VPA are required');
    }
    
    if (!this.amount || this.amount <= 0) {
      errors.push('Amount must be greater than 0');
    }
    
    if (!this.nonce) {
      errors.push('Nonce is required');
    }
    
    if (!this.signedAt) {
      errors.push('Signed timestamp is required');
    }
    
    return errors;
  }
}

module.exports = PaymentInstruction;
