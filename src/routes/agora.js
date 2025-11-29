// backend/src/routes/agora.js
// CommonJS style to match your backend (require)
const express = require('express');
const router = express.Router();

// Ensure package is installed: npm i agora-access-token
const pkg = require('agora-access-token');
const RtcTokenBuilder = pkg.RtcTokenBuilder || pkg.RtcTokenBuilder;
const RtcRole = pkg.RtcRole || pkg.RtcRole;

const APP_ID = (process.env.AGORA_APP_ID || '').trim();
const APP_CERT = (process.env.AGORA_APP_CERT || '').trim();

if (!APP_ID || !APP_CERT) {
  console.warn('⚠️ AGORA_APP_ID or AGORA_APP_CERT not set in environment for /api/agora/token');
}

/**
 * GET /api/agora/token?channel=<name>&uid=<optional numeric uid>
 * Returns JSON: { token, appId, uid, expiresAt }
 */
router.get('/token', (req, res) => {
  const channel = req.query.channel;
  if (!channel) return res.status(400).json({ error: 'channel is required' });

  // pick uid: either client-supplied numeric or 0 (SDK assigns)
  const uid = req.query.uid ? Number(req.query.uid) : 0;
  if (req.query.uid && Number.isNaN(uid)) return res.status(400).json({ error: 'uid must be numeric' });

  // token lifetime (seconds)
  const expireInSeconds = 60 * 60; // 1 hour
  const currentTs = Math.floor(Date.now() / 1000);
  const privilegeExpireTs = currentTs + expireInSeconds;

  try {
    const token = RtcTokenBuilder.buildTokenWithUid(APP_ID, APP_CERT, channel, uid, RtcRole.PUBLISHER, privilegeExpireTs);
    return res.json({
      token,
      appId: APP_ID,
      uid,
      expiresAt: new Date(privilegeExpireTs * 1000).toISOString(),
    });
  } catch (err) {
    console.error('Error while building Agora token', err);
    return res.status(500).json({ error: 'token creation failed', detail: String(err.message || err) });
  }
});

module.exports = router;
