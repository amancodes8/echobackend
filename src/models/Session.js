const mongoose = require('mongoose');

const SessionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, required: true, ref: 'User', index: true },
  type: { type: String, required: true }, // e.g., 'Breathing Exercise'
  duration: { type: Number, default: 0 }, // seconds
  startEmotion: { type: String, default: 'neutral' },
  endEmotion: { type: String, default: 'neutral' },
  summary: { type: String, default: '' },
  timestamp: { type: Date, default: Date.now }
}, { timestamps: true });

module.exports = mongoose.model('Session', SessionSchema);
