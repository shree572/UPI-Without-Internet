const forge = require('node-forge');
const crypto = require('crypto');
const PaymentInstruction = require('../models/PaymentInstruction');

/**
 * Hybrid encryption — the same pattern used by TLS, PGP, Signal, etc.
 *
 * Why hybrid? RSA can only encrypt small data (~245 bytes for a 2048-bit key).
 * Our payment instruction (JSON) might be ~300 bytes, and in real use we might
 * include device certificates and signatures pushing it well over.
 *
 * Solution: generate a fresh AES key per packet, encrypt the JSON with AES-GCM
 * (fast + authenticated), then encrypt JUST the AES key with RSA-OAEP.
 *
 * Wire format (after base64 encoding):
 *   [ 256 bytes RSA-encrypted AES key ][ 12 bytes GCM IV ][ ciphertext + 16-byte tag ]
 *
 * AES-GCM is authenticated encryption: any single-bit tampering with the ciphertext
 * causes decryption to fail with an exception. This is what makes it safe for
 * untrusted intermediaries to hold.
 */
class HybridCryptoService {
  constructor(serverKeyHolder) {
    this.serverKeyHolder = serverKeyHolder;
    this.AES_KEY_BITS = 256;
    this.GCM_IV_BYTES = 12;
    this.GCM_TAG_BITS = 128;
    this.RSA_ENCRYPTED_KEY_BYTES = 256; // for 2048-bit RSA
  }

  /**
   * Encrypt a payment instruction with the server's public key.
   * Called by the simulated sender device.
   */
  async encrypt(instruction, serverPublicKeyPem) {
    const plaintext = JSON.stringify(instruction.toJSON());

    // 1. Generate a one-time AES key for this packet.
    const aesKey = crypto.randomBytes(this.AES_KEY_BITS / 8);

    // 2. AES-GCM encrypt the payload.
    const iv = crypto.randomBytes(this.GCM_IV_BYTES);
    const cipher = crypto.createCipheriv('aes-256-gcm', aesKey, iv);
    cipher.setAAD(Buffer.from('upi-mesh', 'utf8'));
    
    let aesCiphertext = cipher.update(plaintext, 'utf8');
    aesCiphertext = Buffer.concat([aesCiphertext, cipher.final()]);
    const tag = cipher.getAuthTag();

    // Combine ciphertext and tag
    const aesResult = Buffer.concat([aesCiphertext, tag]);

    // 3. RSA-OAEP encrypt the AES key with the server's public key.
    const publicKey = forge.pki.publicKeyFromPem(serverPublicKeyPem);
    const encryptedAesKey = publicKey.encrypt(aesKey.toString('binary'), 'RSA-OAEP', {
      md: forge.md.sha256.create(),
      mgf1: {
        md: forge.md.sha256.create()
      }
    });

    // 4. Pack: [encrypted AES key][IV][AES ciphertext + tag]
    const encryptedKeyBuffer = Buffer.from(encryptedAesKey, 'binary');
    const buffer = Buffer.concat([
      encryptedKeyBuffer,
      iv,
      aesResult
    ]);

    return buffer.toString('base64');
  }

  /**
   * Decrypt with the server's private key.
   * If anything has been tampered with — wrong key, modified ciphertext,
   * truncated input — this throws.
   */
  async decrypt(base64Ciphertext) {
    const all = Buffer.from(base64Ciphertext, 'base64');

    if (all.length < this.RSA_ENCRYPTED_KEY_BYTES + this.GCM_IV_BYTES + this.GCM_TAG_BITS / 8) {
      throw new Error('Ciphertext too short');
    }

    // Unpack
    const encryptedAesKey = all.slice(0, this.RSA_ENCRYPTED_KEY_BYTES);
    const iv = all.slice(this.RSA_ENCRYPTED_KEY_BYTES, this.RSA_ENCRYPTED_KEY_BYTES + this.GCM_IV_BYTES);
    const aesCiphertextWithTag = all.slice(this.RSA_ENCRYPTED_KEY_BYTES + this.GCM_IV_BYTES);

    // Split ciphertext and tag
    const aesCiphertext = aesCiphertextWithTag.slice(0, aesCiphertextWithTag.length - 16);
    const tag = aesCiphertextWithTag.slice(aesCiphertextWithTag.length - 16);

    // 1. RSA-decrypt the AES key.
    const privateKey = this.serverKeyHolder.getPrivateKey();
    const aesKeyBytes = privateKey.decrypt(encryptedAesKey.toString('binary'), 'RSA-OAEP', {
      md: forge.md.sha256.create(),
      mgf1: {
        md: forge.md.sha256.create()
      }
    });
    const aesKey = Buffer.from(aesKeyBytes, 'binary');

    // 2. AES-GCM decrypt + verify the tag.
    const decipher = crypto.createDecipheriv('aes-256-gcm', aesKey, iv);
    decipher.setAAD(Buffer.from('upi-mesh', 'utf8'));
    decipher.setAuthTag(tag);
    
    let plaintext = decipher.update(aesCiphertext, null, 'utf8');
    plaintext += decipher.final('utf8');

    return PaymentInstruction.fromJSON(JSON.parse(plaintext));
  }

  /**
   * SHA-256 of the ciphertext. THIS is the idempotency key.
   *
   * Why ciphertext and not packetId? Because intermediates can rewrite packetId
   * but cannot forge a valid ciphertext for a different payload. Two delivered
   * copies of the same packet have identical ciphertexts, hence identical hashes.
   */
  hashCiphertext(base64Ciphertext) {
    return crypto.createHash('sha256').update(base64Ciphertext).digest('hex');
  }
}

module.exports = HybridCryptoService;

