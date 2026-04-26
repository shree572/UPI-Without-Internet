# UPI Offline Mesh — Demo (Node.js Version)

A Node.js backend that demonstrates **offline UPI payments routed through a Bluetooth-style mesh network**. You're in a basement with zero connectivity. You send your friend ₹500. Your phone encrypts the payment, broadcasts it to nearby phones, and the packet hops device-to-device until *some* phone walks outside, gets 4G, and silently uploads it to this backend. The backend decrypts, deduplicates, and settles.

This is the **Node.js conversion** of the original Java Spring Boot application, maintaining the same architecture and security guarantees while using JavaScript/Node.js ecosystem.

---

## Table of Contents

1. [What this demo proves](#what-this-demo-proves)
2. [How to run it (Node.js)](#how-to-run-it-nodejs)
3. [The demo flow (step by step)](#the-demo-flow-step-by-step)
4. [Architecture differences from Java version](#architecture-differences-from-java-version)
5. [API reference](#api-reference)
6. [Tests](#tests)
7. [What's NOT real (and what would change for production)](#whats-not-real-and-what-would-change-for-production)
8. [Honest limitations of the concept](#honest-limitations-of-the-concept)

---

## What this demo proves

The system shows three things working end to end:

1. **A payment can travel from sender to backend through untrusted intermediaries** without any of them being able to read or tamper with it. (Hybrid RSA + AES-GCM encryption.)
2. **Even if the same payment reaches the backend simultaneously through multiple bridge nodes, it settles exactly once.** (Idempotency via atomic compare-and-set on the ciphertext hash.)
3. **A tampered or replayed packet is rejected** before it touches the ledger.

You'll see all three in the dashboard.

---

## How to run it (Node.js)

### Prerequisites

- **Node.js 18 or newer** installed and on PATH. Check with `node --version`.
- **npm** (comes with Node.js). Check with `npm --version`.
- That's it. No database, no Redis, no Maven. Just Node.js.

### Install dependencies

```bash
npm install
```

### Run the application

```bash
npm start
```

For development with auto-restart:
```bash
npm run dev
```

The first run downloads npm dependencies (~50 MB). Subsequent runs start in a few seconds.

### Open the dashboard

Once you see `UPI Offline Mesh Demo started successfully!`, open:

**http://localhost:8080**

You'll get a dark dashboard with everything you need to drive the demo.

### Stop the server

`Ctrl+C` in the terminal.

### Run the tests

```bash
npm test
```

The interesting one is `IdempotencyConcurrencyTest` — it fires three concurrent requests delivering the same packet and asserts that exactly one settles.

---

## The demo flow (step by step)

The dashboard has four buttons that walk through the full pipeline. The intended sequence:

### Step 1 — Compose a payment

Choose sender, receiver, amount, PIN. Click **"📤 Inject into Mesh"**.

**What actually happens on the backend:**
- The server pretends to be the sender's phone.
- It builds a `PaymentInstruction` with a unique nonce and current timestamp.
- It encrypts that with the server's RSA public key (using hybrid encryption — see below).
- It wraps the ciphertext in a `MeshPacket` with a TTL of 5.
- It hands the packet to `phone-alice`, an offline virtual device.

You'll see `phone-alice` now holds 1 packet.

### Step 2 — Run gossip rounds

Click **"🔄 Run Gossip Round"**. Then click it again.

Each round, every device that holds a packet broadcasts it to every other device within "Bluetooth range" (which, in our simulator, means everyone). TTL decrements per hop.

After 1 round: every device holds the packet. After 2 rounds: still every device — TTL is just lower.

In the real system this would happen organically as people walk past each other in the basement.

### Step 3 — Bridge node walks outside

Click **"📡 Bridges Upload to Backend"**.

`phone-bridge` is the only device with `hasInternet=true`. The dashboard simulates that phone walking outside and getting 4G. It POSTs every packet it holds to `/api/bridge/ingest`.

The backend pipeline runs:
1. Hash the ciphertext (`SHA-256`).
2. Try to claim the hash in the idempotency cache.
3. If claimed: decrypt with the server's RSA private key.
4. Verify freshness (signedAt within 24 hours).
5. Run the debit/credit in a single DB transaction.

Watch the **Account Balances** table — money has moved. Watch the **Transaction Ledger** — a new row appears.

### Step 4 — Demonstrate idempotency (the killer feature)

Reset the mesh. Inject a single packet. Run gossip 2 times. Now **all 5 devices hold the same packet, including multiple bridges in a more complex setup**.

To really see idempotency in action, modify `MeshSimulatorService.js` to seed multiple bridge devices, or just:

1. Click "Inject" once.
2. Click "Gossip" twice.
3. Click "Flush Bridges" — only `phone-bridge` is a bridge in the default seed, so just one upload happens.

To exercise the *concurrent duplicate* case properly, run the test:
```bash
npm test -- IdempotencyConcurrencyTest
```

This test creates one packet, fires 3 concurrent requests at `BridgeIngestionService.ingest()`, and verifies that exactly one settles, two are dropped as duplicates, and the sender is debited exactly once.

---

## Architecture differences from Java version

| Java Spring Boot | Node.js Version |
|---|---|
| Spring Boot framework | Express.js web framework |
| H2 in-memory database | SQLite database with Sequelize ORM |
| Maven build system | npm package manager |
| JUnit 5 tests | Jest testing framework |
| Java crypto libraries | node-forge + built-in Node.js crypto |
| Thymeleaf templates | Static HTML with vanilla JavaScript |
| ConcurrentHashMap for idempotency | In-memory Map (production would use Redis) |
| @Transactional annotations | Sequelize transactions |
| JPA entities | Sequelize models |

The core cryptographic and idempotency logic remains identical, just implemented in JavaScript instead of Java.

---

## API reference

| Method | Path | What it does |
|---|---|---|
| GET | `/` | Dashboard HTML |
| GET | `/api/server-key` | Server's RSA public key (base64) |
| GET | `/api/accounts` | All accounts and balances |
| GET | `/api/transactions` | Last 20 transactions |
| GET | `/api/mesh/state` | Current state of every virtual device |
| POST | `/api/demo/send` | Simulate sender phone — encrypt + inject packet |
| POST | `/api/mesh/gossip` | Run one round of gossip across the mesh |
| POST | `/api/mesh/flush` | Bridges with internet upload to backend (parallel) |
| POST | `/api/mesh/reset` | Clear mesh + idempotency cache |
| POST | `/api/bridge/ingest` | **The production endpoint.** Real bridges POST here |

### Request format for `/api/bridge/ingest`

```http
POST /api/bridge/ingest
Content-Type: application/json
X-Bridge-Node-Id: phone-bridge-42
X-Hop-Count: 3

{
  "packetId": "550e8400-e29b-41d4-a716-446655440000",
  "ttl": 2,
  "createdAt": 1730000000000,
  "ciphertext": "base64-encoded-RSA-and-AES-blob"
}
```

Response:
```json
{
  "outcome": "SETTLED",                     // or "DUPLICATE_DROPPED" or "INVALID"
  "packetHash": "a3f8c9...",
  "reason": null,                            // populated on INVALID
  "transactionId": 42                        // populated on SETTLED
}
```

---

## Tests

Run all tests:
```bash
npm test
```

The tests include:

- **`encryptDecryptRoundTrip`** — sanity-check that hybrid encryption is symmetric.
- **`tamperedCiphertextIsRejected`** — flip a byte in the ciphertext, verify that `BridgeIngestionService` returns `INVALID` instead of crashing or settling.
- **`singlePacketDeliveredByThreeBridgesSettlesExactlyOnce`** — the headline test. Three concurrent requests, one packet, simultaneous delivery. Asserts exactly one `SETTLED`, two `DUPLICATE_DROPPED`, and that the sender's balance changed by exactly the amount once.
- **`stale packet is rejected`** — verifies packets older than 24 hours are rejected.
- **`future dated packet is rejected`** — verifies packets with future timestamps are rejected.

---

## What's NOT real (and what would change for production)

This is a teaching demo. To make it production-grade you'd swap these things:

| What's in the demo | What it would be in production |
|---|---|
| SQLite database | PostgreSQL / MySQL with replicas |
| In-memory Map for idempotency | Redis with `SET NX EX` |
| RSA keypair regenerated on startup | Private key in HSM (AWS KMS, HashiCorp Vault). Public key cached on devices. |
| Server-side `DemoService.createPacket()` | Same code running on Android, in a Kotlin/Java port |
| Software-simulated mesh (`MeshSimulatorService`) | Real BLE GATT or Wi-Fi Direct between phones |
| One settlement service that owns the ledger | Integration with NPCI / a real bank core |
| No auth on `/api/bridge/ingest` | Mutual TLS or signed bridge-node certificates |
| In-memory accounts seeded on startup | Real KYC'd users, real VPAs, real PIN verification against the bank |
| No rate limiting | Per-bridge-node rate limit, per-sender velocity check |
| Logs to console | Structured logs to a SIEM, alerts on `INVALID` spikes |

The cryptography and idempotency code is essentially production-shaped. The infrastructure around it is what changes.

---

## Honest limitations of the concept

I want this README to be useful to you when someone reviews the project, so let's be straight about what this design **does not** solve. These are not implementation bugs — they're inherent to "no internet, anywhere in the chain":

1. **The receiver has no way to verify the sender has the funds.** When sender hands receiver a phone showing "₹500 sent," it's an IOU, not a settled payment. If the sender's account is empty when the packet finally reaches the backend, the settlement will be `REJECTED` and the receiver is out ₹500 with no recourse. *This is why real offline UPI (UPI Lite) uses a pre-funded hardware-backed wallet* — to give cryptographic proof of available funds offline.
2. **A malicious sender can double-spend offline.** With ₹500 in their account, they could send a packet to Bob in basement A, walk to basement B, and send another ₹500 to Carol. Whichever packet hits the backend first wins; the other gets `REJECTED`. Same root cause as #1.
3. **Bluetooth in real life is hard.** Background BLE on Android is heavily throttled since Android 8. iOS peripheral mode is locked down. Two strangers' phones reliably forming a GATT connection while the apps aren't actively open is genuinely difficult and a lot of energy. This demo skips that problem entirely by simulating the mesh.
4. **Privacy / liability.** A stranger carries your encrypted transaction packet on their phone. They can't read it, but its existence is metadata. In a real deployment you'd want to think about regulatory disclosures and what happens if a device is seized.

For a college / portfolio project: name the concept honestly as **"mesh-routed deferred settlement"** rather than "real-time offline UPI," and you'll have a much stronger pitch. The cryptography and idempotency work here is real engineering and worth showing off.

---

## Troubleshooting

**`node: command not found`** — Install Node.js 18+. On Windows, download from nodejs.org or use winget.

**Port 8080 already in use** — Set `PORT=3000` environment variable before running: `PORT=3000 npm start`

**First `npm install` hangs for a long time** — It's downloading dependencies (~50 MB). Give it a minute or two on a normal connection. After that, startup is ~5 seconds.

**Tests fail intermittently** — The concurrency test is timing-sensitive. If it ever flakes, run it 3x; if it consistently fails on your hardware, check the actual failure output.

---

## License

Demo code, no license. Use it however you want for learning.

- Shridhi Gupta (Original Java version)
- Node.js conversion maintaining the same architecture and security guarantees
