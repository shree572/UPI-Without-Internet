const express = require('express');
const router = express.Router();

/**
 * Public REST surface.
 *
 * The endpoints split into three groups:
 *   /api/server-key      → so simulated senders can fetch the server's public key
 *   /api/mesh/*          → simulator endpoints (inject, gossip, flush)
 *   /api/bridge/ingest   → THE real production endpoint a real bridge node would hit
 *   /api/accounts, /api/transactions → for the dashboard
 */

// Services will be injected via middleware
router.use((req, res, next) => {
  // These will be set in app.js
  req.services = req.app.locals.services;
  next();
});

// ------------------------------------------------------------------ key

router.get('/server-key', (req, res) => {
  const { serverKeyHolder } = req.services;
  res.json({
    publicKey: serverKeyHolder.getPublicKeyBase64(),
    algorithm: 'RSA-2048 / OAEP-SHA256',
    hybridScheme: 'RSA-OAEP encrypts an AES-256-GCM session key'
  });
});

// ---------------------------------------------------------------- demo

/**
 * Demo helper: build a packet on the server (simulating a sender phone)
 * and inject it into the mesh at the given device.
 */
router.post('/demo/send', async (req, res) => {
  try {
    const { demoService, meshSimulator } = req.services;
    const { senderVpa, receiverVpa, amount, pin, ttl = 5, startDevice = 'phone-alice' } = req.body;

    const packet = await demoService.createPacket(senderVpa, receiverVpa, amount, pin, ttl);
    meshSimulator.inject(startDevice, packet);

    res.json({
      packetId: packet.packetId,
      ciphertextPreview: packet.ciphertext.substring(0, 64) + '...',
      ttl: packet.ttl,
      injectedAt: startDevice
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// -------------------------------------------------------------- mesh sim

router.get('/mesh/state', (req, res) => {
  const { meshSimulator, idempotencyService } = req.services;
  const devices = meshSimulator.getDevices().map(device => ({
    deviceId: device.deviceId,
    hasInternet: device.hasInternetAccess(),
    packetCount: device.packetCount(),
    packetIds: device.getHeldPackets().map(p => p.packetId.substring(0, 8))
  }));

  res.json({
    devices,
    idempotencyCacheSize: idempotencyService.size()
  });
});

router.post('/mesh/gossip', (req, res) => {
  const { meshSimulator } = req.services;
  const result = meshSimulator.gossipOnce();
  res.json(result);
});

/**
 * "All bridge nodes simultaneously walk outside and get 4G."
 * They all upload everything they hold to /api/bridge/ingest.
 *
 * THIS is the moment the duplicate-storm idempotency case is tested:
 * if multiple bridge nodes hold the same packet, the server gets multiple
 * concurrent POSTs of the same ciphertext, and only one should settle.
 */
router.post('/mesh/flush', async (req, res) => {
  try {
    const { meshSimulator, bridgeIngestionService } = req.services;
    const uploads = meshSimulator.collectBridgeUploads();

    const results = [];
    
    // Upload them in parallel to actually exercise concurrent idempotency
    const uploadPromises = uploads.map(async (upload) => {
      const result = await bridgeIngestionService.ingest(
        upload.packet,
        upload.bridgeNodeId,
        5 - upload.packet.ttl
      );
      
      return {
        bridgeNode: upload.bridgeNodeId,
        packetId: upload.packet.packetId.substring(0, 8),
        outcome: result.outcome,
        reason: result.reason || '',
        transactionId: result.transactionId || -1
      };
    });

    const resolvedResults = await Promise.all(uploadPromises);
    results.push(...resolvedResults);

    res.json({
      uploadsAttempted: uploads.length,
      results
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/mesh/reset', (req, res) => {
  const { meshSimulator, idempotencyService } = req.services;
  meshSimulator.resetMesh();
  idempotencyService.clear();
  res.json({ status: 'mesh and idempotency cache cleared' });
});

// -------------------------------------------------------------- bridge

/**
 * THE PRODUCTION ENDPOINT.
 * In a real deployment, the Android app's bridge logic POSTs here whenever
 * the device has internet and is holding mesh packets.
 */
router.post('/bridge/ingest', async (req, res) => {
  try {
    const { bridgeIngestionService } = req.services;
    const packet = req.body;
    const bridgeNodeId = req.headers['x-bridge-node-id'] || 'unknown';
    const hopCount = parseInt(req.headers['x-hop-count']) || 0;

    const result = await bridgeIngestionService.ingest(packet, bridgeNodeId, hopCount);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ------------------------------------------------------------- accounts

router.get('/accounts', async (req, res) => {
  try {
    const { accountRepository } = req.services;
    const accounts = await accountRepository.findAll();
    res.json(accounts);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/transactions', async (req, res) => {
  try {
    const { transactionRepository } = req.services;
    const transactions = await transactionRepository.findAll({
      order: [['id', 'DESC']],
      limit: 20
    });
    res.json(transactions);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
