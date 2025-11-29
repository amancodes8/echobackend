// backend/src/routes/profiles.js
const express = require('express');
const mongoose = require('mongoose');

const Profile = require('../models/Profile');
const User = require('../models/User');
// Session model is optional; if you don't have it yet, the route will gracefully return [].
let Session;
try {
  Session = require('../models/Session');
} catch (e) {
  Session = null;
  // no-op; route will handle absence
}

const router = express.Router();

/**
 * GET /api/profiles
 * Optional query:
 *   - q  : search string to match displayName (case-insensitive)
 *   - page, limit : pagination
 */
router.get('/', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    const page = Math.max(1, parseInt(req.query.page || '1', 10));
    const limit = Math.min(50, Math.max(5, parseInt(req.query.limit || '20', 10)));
    const skip = (page - 1) * limit;

    const filter = {};
    if (q) {
      filter.displayName = { $regex: q, $options: 'i' };
    }

    const [items, total] = await Promise.all([
      Profile.find(filter).sort({ updatedAt: -1 }).skip(skip).limit(limit).lean(),
      Profile.countDocuments(filter),
    ]);

    res.json({
      profiles: items,
      meta: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    console.error('GET /api/profiles error', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * GET /api/profiles/:id
 * Returns: { profile }
 */
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Validate ObjectId
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid profile id' });
    }

    const profile = await Profile.findById(id).lean();
    if (!profile) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    // Optionally populate minimal user info
    const user = await User.findById(profile.userId).select('name email consent').lean().catch(() => null);

    return res.json({ profile: { ...profile, user: user || undefined } });
  } catch (err) {
    console.error('GET /api/profiles/:id error', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

/**
 * GET /api/profiles/:id/sessions
 * Returns recent sessions for the profile's userId (if Session model exists)
 */
router.get('/:id/sessions', async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid profile id' });
    }

    const profile = await Profile.findById(id).lean();
    if (!profile) return res.status(404).json({ error: 'Profile not found' });

    if (!Session) {
      console.warn('Session model not found; returning empty sessions array.');
      return res.json({ sessions: [] });
    }

    const sessions = await Session.find({ userId: profile.userId })
      .sort({ timestamp: -1 })
      .limit(50)
      .lean();

    return res.json({ sessions });
  } catch (err) {
    console.error('GET /api/profiles/:id/sessions error', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
