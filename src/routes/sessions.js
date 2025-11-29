const express = require('express');
const auth = require('../middleware/auth');
const Session = require('../models/Session');

const router = express.Router();

// GET /api/sessions/me
router.get('/me', auth, async (req, res) => {
  const sessions = await Session.find({ userId: req.user._id }).sort({ timestamp: -1 }).lean();
  res.json(sessions);
});

// POST /api/sessions  (create session entry)
router.post('/', auth, async (req, res) => {
  const { type, duration, startEmotion, endEmotion, summary, timestamp } = req.body;
  const session = await Session.create({
    userId: req.user._id,
    type: type || 'Unknown',
    duration: duration || 0,
    startEmotion: startEmotion || 'neutral',
    endEmotion: endEmotion || 'neutral',
    summary: summary || '',
    timestamp: timestamp ? new Date(timestamp) : new Date()
  });
  res.json(session);
});

// DELETE /api/sessions/:id
router.delete('/:id', auth, async (req, res) => {
  const s = await Session.findById(req.params.id);
  if (!s) return res.status(404).json({ error: 'Not found' });
  if (s.userId.toString() !== req.user._id.toString()) return res.status(403).json({ error: 'Forbidden' });
  await s.remove();
  res.json({ message: 'Deleted' });
});

module.exports = router;
