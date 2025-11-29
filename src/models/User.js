// backend/src/models/User.js
const mongoose = require('mongoose');

const ConsentSchema = new mongoose.Schema({
  neurofeedback: { type: Boolean, default: true },
  camera: { type: Boolean, default: true },
  audio: { type: Boolean, default: true },
}, { _id: false });

const UserSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, index: true, lowercase: true },
  passwordHash: { type: String, required: true },
  consent: { type: ConsentSchema, default: () => ({}) },
}, { timestamps: true });

// For security: never return passwordHash by default
UserSchema.methods.toJSON = function () {
  const obj = this.toObject();
  delete obj.passwordHash;
  return obj;
};

module.exports = mongoose.model('User', UserSchema);
