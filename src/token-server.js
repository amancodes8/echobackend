// backend/token-server.js
// Usage: from backend folder run `node token-server.js`

require('dotenv').config();
const express = require('express');
const cors = require('cors');

// agora-access-token is a CommonJS package — import via default require to avoid named export issues
const agoraPkg = require('agora-access-token');
const { RtcTokenBuilder, RtcRole } = agoraPkg;

const app = express();
app.use(cors());
app.use(express.json());

// Debug / sanity-check: print env keys (trimmed) so you can see what Node reads
console.log('NODE ENV:   ', process.env.NODE_ENV || 'development');
console.log('AGORA_APP_ID (raw):', JSON.stringify(process.env.AGORA_APP_ID));
console.log('AGORA_APP_CERT (raw):', JSON.stringify(process.env.AGORA_APP_CERT));

const APP_ID = (process.env.AGORA_APP_ID || '').trim();
const APP_CERT = (process.env.AGORA_APP_CERT || '').trim();

if (!APP_ID || !APP_CERT) {
  console.error('❌ Missing AGORA_APP_ID or AGORA_APP_CERT in environment. Please check backend/.env and remove extra spaces.');
  console.error('Make sure your .env contains lines like:');
  console.error('  AGORA_APP_ID=13b9f03b83c0467b81840d09e5a3d7d3');
  console.error('  AGORA_APP_CERT=your_app_certificate_here');
  process.exit(1);
}

app.get('/token', (req, res) => {
  const channel = req.query.channel;
  if (!channel) return res.status(400).json({ error: 'channel is required' });

  // uid: allow client to pass numeric uid or default to 0 (SDK picks random)
  const uid = req.query.uid ? Number(req.query.uid) : 0;

  // token expiry (seconds) — adjust as needed
  const expireTime = 60 * 60; // 1 hour
  const currentTs = Math.floor(Date.now() / 1000);
  const privilegeExpireTs = currentTs + expireTime;

  try {
    const token = RtcTokenBuilder.buildTokenWithUid(APP_ID, APP_CERT, channel, uid, RtcRole.PUBLISHER, privilegeExpireTs);
    return res.json({ token, appId: APP_ID, uid });
  } catch (err) {
    console.error('token creation error', err);
    return res.status(500).json({ error: 'token creation failed', details: err.message });
  }
});

const PORT = Number(process.env.PORT1 || 5000);
app.listen(PORT, () => console.log(`Agora token server running on :${PORT}`));
