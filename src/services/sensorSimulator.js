// src/services/sensorSimulator.js
const { randomUUID } = require('crypto');

class SensorSimulator {
  constructor(io) {
    this.io = io; // socket.io server instance
    this.interval = null;
    this.baseAnxiety = 0.5;
    this.clients = new Map(); // socketId -> consent
  }

  start() {
    // global loop emits signals to all connected clients
    if (this.interval) return;
    this.interval = setInterval(() => {
      // drift
      this.baseAnxiety += (Math.random() - 0.5) * 0.06;
      this.baseAnxiety = Math.max(0, Math.min(1, this.baseAnxiety));

      // For each connected socket, emit tailored signals based on consent
      for (const [socketId, consent] of this.clients.entries()) {
        const socket = this.io.sockets.sockets.get(socketId);
        if (!socket) {
          this.clients.delete(socketId);
          continue;
        }

        const signals = {};

        if (consent.neurofeedback) {
          const alpha = (1 - this.baseAnxiety) * 70 + Math.random() * 30;
          const beta = this.baseAnxiety * 70 + Math.random() * 30;
          signals.neuro = { alpha: alpha.toFixed(2), beta: beta.toFixed(2) };
        }

        if (consent.camera) {
          const smileProb = (1 - this.baseAnxiety) * 0.6 + Math.random() * 0.4;
          const frownProb = this.baseAnxiety * 0.6 + Math.random() * 0.4;
          signals.emotion = { smile: smileProb.toFixed(3), frown: frownProb.toFixed(3), neutral: (Math.random() * 0.5).toFixed(3) };
        }

        if (consent.audio) {
          const pitch = 100 + this.baseAnxiety * 100 + (Math.random() - 0.5) * 20;
          const variance = this.baseAnxiety * 5 + Math.random();
          signals.acoustic = { pitch: pitch.toFixed(2), variance: variance.toFixed(2) };
        }

        if (Object.keys(signals).length > 0) {
          socket.emit('signals', signals);
        }
      }
    }, 1500);
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  // When client connects, store its consent (default all true)
  registerClient(socket, consent = { neurofeedback: true, camera: true, audio: true }) {
    this.clients.set(socket.id, consent);
  }

  unregisterClient(socket) {
    this.clients.delete(socket.id);
  }

  updateConsent(socket, consent) {
    if (this.clients.has(socket.id)) this.clients.set(socket.id, consent);
  }
}

module.exports = SensorSimulator;
