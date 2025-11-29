// backend/src/index.js
require('dotenv').config();
const http = require('http');
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch'); // For Agora AI API connection

const { connectDB } = require('./config/db');
const authMiddleware = require('./middleware/auth');
const SensorSimulator = require('./services/sensorSimulator');

const app = express();

/**
 * Basic middleware
 */
app.use(cors({
  origin: process.env.CLIENT_URL || 'http://localhost:5173',
  credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/**
 * Helper: normalize imported route module
 */
function normalizeRouter(mod, label) {
  if (!mod) {
    throw new Error(`Route module ${label} is empty/undefined`);
  }
  if (typeof mod === 'function' || (mod && typeof mod.use === 'function')) return mod;
  if (mod.default && (typeof mod.default === 'function' || typeof mod.default.use === 'function')) {
    return mod.default;
  }
  const keys = Object.keys(mod);
  throw new TypeError(`Route "${label}" does not export an Express router. Found keys: ${keys.join(', ')}`);
}

/**
 * Load routes (wrap in try/catch so startup errors are clear)
 */
let authRoutes, profileRoutes, sessionRoutes, inferRoutes;
try {
  authRoutes = normalizeRouter(require('./routes/auth'), 'auth');
  profileRoutes = normalizeRouter(require('./routes/profiles'), 'profiles');
  sessionRoutes = normalizeRouter(require('./routes/sessions'), 'sessions');
  try {
    inferRoutes = normalizeRouter(require('./routes/infer'), 'infer');
  } catch (e) {
    console.warn('Notice: infer route not found or invalid. Skipping /api/infer mount.', e.message || e);
    inferRoutes = null;
  }
} catch (err) {
  console.error('Failed to load routes:', err);
  process.exit(1);
}

/**
 * Mount API routes under /api
 */
app.use('/api/auth', authRoutes);
app.use('/api/profiles', profileRoutes);
app.use('/api/sessions', sessionRoutes);
if (inferRoutes) {
  app.use('/api/infer', inferRoutes);
}

/**
 * Agora token route
 */
app.get('/api/agora/token', (req, res) => {
  try {
    const pkg = require('agora-access-token');
    const { RtcTokenBuilder, RtcRole } = pkg;
    const channel = req.query.channel;
    if (!channel) return res.status(400).json({ error: 'channel is required' });

    const appId = (process.env.AGORA_APP_ID || '').trim();
    const appCert = (process.env.AGORA_APP_CERT || '').trim();
    if (!appId || !appCert) {
      console.error('❌ Missing AGORA_APP_ID or AGORA_APP_CERT in environment');
      return res.status(500).json({ error: 'Missing AGORA_APP_ID or AGORA_APP_CERT in server environment' });
    }

    const uid = req.query.uid ? Number(req.query.uid) : 0;
    const expireSeconds = Number(req.query.expireSeconds) || 60 * 60; // 1 hour

    const currentTs = Math.floor(Date.now() / 1000);
    const privilegeExpireTs = currentTs + expireSeconds;

    const token = RtcTokenBuilder.buildTokenWithUid(appId, appCert, channel, uid, RtcRole.PUBLISHER, privilegeExpireTs);

    return res.json({
      token,
      appId,
      uid,
      expiresAt: new Date(privilegeExpireTs * 1000).toISOString(),
    });
  } catch (err) {
    console.error('Agora token generation failed', err);
    return res.status(500).json({ error: 'token creation failed', details: String(err && err.message ? err.message : err) });
  }
});

/**
 * Agora Conversational AI Agent route
 */
app.post('/api/ai/session', async (req, res) => {
  const channel = req.body.channel;
  if (!channel) return res.status(400).json({ error: 'channel is required for AI agent' });

  const basicAuth = Buffer.from(`${process.env.AGORA_CUSTOMER_KEY}:${process.env.AGORA_CUSTOMER_SECRET}`).toString('base64');

  try {
    const agoraRes = await fetch(
      `https://api.agora.io/api/conversational-ai-agent/v2/projects/${process.env.AGORA_APP_ID}/join`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${basicAuth}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          name: "therapist_agent",
          properties: {
            channel,
            llm: {
              url: process.env.LLM_PROVIDER_URL,
              api_key: process.env.LLM_API_KEY,
              model: process.env.LLM_MODEL,
              input_modalities: process.env.LLM_INPUT_MODALITIES.split(','),
              output_modalities: process.env.LLM_OUTPUT_MODALITIES.split(','),
              system_messages: [{
                role: "system",
                content: "You are a compassionate, empathetic therapy agent who helps users talk through their feelings."
              }]
            },
            tts: {
              vendor: process.env.TTS_VENDOR,
              key: process.env.TTS_KEY,
              region: process.env.TTS_REGION,
              voice_name: process.env.TTS_VOICE
            }
          }
        })
      }
    );
    const agoraData = await agoraRes.json();
    if (!agoraRes.ok) {
      return res.status(500).json({ error: 'Failed to start AI agent', details: agoraData });
    }
    return res.json({ success: true, data: agoraData });
  } catch (err) {
    console.error('Error connecting to Agora Conversational AI:', err);
    return res.status(500).json({ error: 'Server error', details: String(err && err.message ? err.message : err) });
  }
});

/**
 * Health check route
 */
app.get('/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

/**
 * Protected "me" endpoint
 */
app.get('/api/me', authMiddleware, async (req, res) => {
  try {
    const User = require('./models/User');
    const Profile = require('./models/Profile');

    const user = await User.findById(req.user._id).lean();
    const profile = await Profile.findOne({ userId: req.user._id }).lean();

    return res.json({
      id: user._id,
      email: user.email,
      name: user.name,
      consent: user.consent,
      profile,
    });
  } catch (err) {
    console.error('GET /api/me error', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

/**
 * Start server + socket.io after DB connects
 */
const PORT = parseInt(process.env.PORT || '4000', 10);

async function startServer() {
  try {
    const mongoUri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/mindecho';
    await connectDB(mongoUri);
    console.log('✅ MongoDB connected');

    const server = http.createServer(app);

    // Socket.IO setup
    const { Server } = require('socket.io');
    const io = new Server(server, {
      cors: { origin: process.env.CLIENT_URL || '*' },
      pingTimeout: 60000,
    });

    let simulator = null;
    try {
      simulator = new SensorSimulator(io);
      simulator.start();
    } catch (simErr) {
      console.warn('SensorSimulator not started:', simErr.message || simErr);
    }

    io.on('connection', (socket) => {
      console.log('Socket connected:', socket.id);

      try {
        if (simulator) simulator.registerClient(socket, { neurofeedback: true, camera: true, audio: true });
      } catch (e) {
        console.warn('Failed to register client to simulator:', e.message || e);
      }

      socket.on('consent', (consent) => {
        try {
          if (simulator) simulator.updateConsent(socket, consent);
        } catch (err) {
          console.warn('Failed to update consent for socket', socket.id, err);
        }
      });

      socket.on('disconnect', (reason) => {
        try {
          if (simulator) simulator.unregisterClient(socket);
        } catch (e) {}
        console.log('Socket disconnected:', socket.id, reason);
      });
    });

    server.listen(PORT, () => {
      console.log(`🚀 Server listening on http://localhost:${PORT}`);
    });

    // Graceful shutdown
    const shutdown = async () => {
      console.log('Shutting down...');
      try {
        if (simulator) {
          simulator.stop();
        }
        io.close();
        server.close(() => {
          console.log('HTTP server closed');
          process.exit(0);
        });
        setTimeout(() => process.exit(0), 10000);
      } catch (err) {
        console.error('Error during shutdown', err);
        process.exit(1);
      }
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  } catch (err) {
    console.error('Failed to start server', err);
    process.exit(1);
  }
}

startServer();