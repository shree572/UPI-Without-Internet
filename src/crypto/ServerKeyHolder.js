const forge = require('node-forge');

/**
 * Holds the server's RSA keypair.
 *
 * In production, the private key would live in an HSM (Hardware Security Module)
 * or at least a KMS like AWS KMS / HashiCorp Vault. NEVER in the JAR or source.
 *
 * For this demo we generate a fresh keypair on every startup. The public key is
 * exposed via /api/server-key so the (simulated) sender devices can use it to
 * encrypt payloads.
 */
class ServerKeyHolder {
  constructor() {
    this.keyPair = null;
  }

  async init() {
    // Generate 2048-bit RSA key pair
    this.keyPair = forge.pki.rsa.generateKeyPair(2048);
    
    const publicKeyBase64 = this.getPublicKeyBase64();
    console.log(`Server RSA keypair generated (2048-bit). Public key fingerprint: ${publicKeyBase64.substring(0, 32)}...`);
  }

  getPublicKey() {
    if (!this.keyPair) {
      throw new Error('KeyPair not initialized. Call init() first.');
    }
    return this.keyPair.publicKey;
  }

  getPrivateKey() {
    if (!this.keyPair) {
      throw new Error('KeyPair not initialized. Call init() first.');
    }
    return this.keyPair.privateKey;
  }

  getPublicKeyBase64() {
    const publicKeyPem = forge.pki.publicKeyToPem(this.getPublicKey());
    return Buffer.from(publicKeyPem).toString('base64');
  }

  getPublicKeyPem() {
    return forge.pki.publicKeyToPem(this.getPublicKey());
  }
}

module.exports = ServerKeyHolder;
