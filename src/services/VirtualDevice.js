const MeshPacket = require('../models/MeshPacket');

/**
 * A simulated phone in the mesh. Holds packets it has seen.
 *
 * In the real system, this state would be on a physical Android device,
 * with packets exchanged via BLE GATT characteristics.
 */
class VirtualDevice {
  constructor(deviceId, hasInternet = false) {
    this.deviceId = deviceId;
    this.hasInternet = hasInternet;
    this.heldPackets = new Map();
  }

  getDeviceId() {
    return this.deviceId;
  }

  hasInternetAccess() {
    return this.hasInternet;
  }

  hold(packet) {
    if (!(packet instanceof MeshPacket)) {
      packet = MeshPacket.fromJSON(packet);
    }
    this.heldPackets.set(packet.packetId, packet);
  }

  getHeldPackets() {
    return Array.from(this.heldPackets.values());
  }

  holds(packetId) {
    return this.heldPackets.has(packetId);
  }

  packetCount() {
    return this.heldPackets.size;
  }

  clear() {
    this.heldPackets.clear();
  }

  toJSON() {
    return {
      deviceId: this.deviceId,
      hasInternet: this.hasInternet,
      packetCount: this.packetCount(),
      packets: this.getHeldPackets().map(p => p.toJSON())
    };
  }
}

module.exports = VirtualDevice;
