// backend/src/models/Profile.js
const mongoose = require('mongoose');

const BaselineMetricsSchema = new mongoose.Schema({
  calm: { type: Number, default: 0.5, min: 0, max: 1 },
  anxiety: { type: Number, default: 0.5, min: 0, max: 1 },
  focus: { type: Number, default: 0.5, min: 0, max: 1 },
}, { _id: false });

const ProfileSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  displayName: { type: String, required: true, trim: true },
  bio: { type: String, required: true, trim: true },
  location: { type: String, required: true, trim: true },
  avatarUrl: { type: String, default: '' },
  tags: { type: [String], default: [] },
  baselineMetrics: { type: BaselineMetricsSchema, default: () => ({}) },
}, { timestamps: true });

module.exports = mongoose.model('Profile', ProfileSchema);
