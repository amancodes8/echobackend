// backend/src/routes/auth.js
const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Profile = require('../models/Profile');

const router = express.Router();

const jwtSecret = process.env.JWT_SECRET || 'dev_secret';
const jwtExpiry = process.env.JWT_EXPIRES_IN || '7d';

function isString(v) { return typeof v === 'string' && v.trim().length > 0; }
function isBoolean(v) { return typeof v === 'boolean'; }
function isNumberBetween0and1(n) { return typeof n === 'number' && n >= 0 && n <= 1; }

/**
 * POST /api/auth/register
 * Strict registration (all required fields)
 */
router.post('/register', async (req, res) => {
  try {
    const {
      name, email, password,
      displayName, bio, location,
      tags, baselineMetrics, consent,
      avatarUrl
    } = req.body || {};

    // Basic presence checks
    if (!isString(name)) return res.status(400).json({ error: 'name is required' });
    if (!isString(email)) return res.status(400).json({ error: 'email is required' });
    if (!isString(password)) return res.status(400).json({ error: 'password is required' });

    if (!isString(displayName)) return res.status(400).json({ error: 'displayName is required' });
    if (bio === undefined || typeof bio !== 'string') return res.status(400).json({ error: 'bio is required' });
    if (!isString(location)) return res.status(400).json({ error: 'location is required' });

    if (!Array.isArray(tags)) return res.status(400).json({ error: 'tags must be an array (can be empty)' });

    if (!baselineMetrics || typeof baselineMetrics !== 'object') {
      return res.status(400).json({ error: 'baselineMetrics is required and must be an object' });
    }
    const { calm, anxiety, focus } = baselineMetrics;
    if (!isNumberBetween0and1(calm)) return res.status(400).json({ error: 'baselineMetrics.calm must be 0..1' });
    if (!isNumberBetween0and1(anxiety)) return res.status(400).json({ error: 'baselineMetrics.anxiety must be 0..1' });
    if (!isNumberBetween0and1(focus)) return res.status(400).json({ error: 'baselineMetrics.focus must be 0..1' });

    if (!consent || typeof consent !== 'object') return res.status(400).json({ error: 'consent object is required' });
    if (!isBoolean(consent.neurofeedback)) return res.status(400).json({ error: 'consent.neurofeedback must be boolean' });
    if (!isBoolean(consent.camera)) return res.status(400).json({ error: 'consent.camera must be boolean' });
    if (!isBoolean(consent.audio)) return res.status(400).json({ error: 'consent.audio must be boolean' });

    // uniqueness check
    const exists = await User.findOne({ email }).lean();
    if (exists) return res.status(400).json({ error: 'Email already in use' });

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await User.create({
      name: name.trim(),
      email: email.trim().toLowerCase(),
      passwordHash,
      consent
    });

    const profile = await Profile.create({
      userId: user._id,
      displayName: displayName.trim(),
      bio,
      location: location.trim(),
      avatarUrl: avatarUrl || `https://placehold.co/100x100/A78BFA/FFFFFF?text=${displayName.charAt(0)}`,
      tags,
      baselineMetrics: { calm, anxiety, focus }
    });

    const token = jwt.sign({ sub: user._id.toString() }, jwtSecret, { expiresIn: jwtExpiry });

    res.json({
      token,
      user: { id: user._id, email: user.email, name: user.name, profile }
    });
  } catch (err) {
    console.error('REGISTER ERROR', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * POST /api/auth/login
 * Body: { email, password }
 */
router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!isString(email) || !isString(password)) {
    return res.status(400).json({ error: 'Missing email or password' });
  }
  try {
    const user = await User.findOne({ email: email.trim().toLowerCase() });
    if (!user) return res.status(400).json({ error: 'Invalid credentials' });

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return res.status(400).json({ error: 'Invalid credentials' });

    const profile = await Profile.findOne({ userId: user._id }).lean();
    const token = jwt.sign({ sub: user._id.toString() }, jwtSecret, { expiresIn: jwtExpiry });

    res.json({ token, user: { id: user._id, email: user.email, name: user.name, profile } });
  } catch (err) {
    console.error('LOGIN ERROR', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Expose router
module.exports = router;
