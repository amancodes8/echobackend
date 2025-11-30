// backend/src/index.js
require('dotenv').config();
const http = require('http');
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');

// DB + Middleware + Services
const { connectDB } = require('./config/db');
const authMiddleware = require('./middleware/auth');
const SensorSimulator = require('./services/sensorSimulator');

// 🟢 FIX: Use CommonJS require for emotion route
const emotionRoute = require('./emotion');

const app = express();

/* ------------------------------------------------------------
   CORS CONFIG — ECHO ORIGIN (safe for cookies/sessions)
------------------------------------------------------------- */
const corsOptions = {
  origin: function (origin, callback) {
    // allow requests with no origin (mobile apps / curl)
    if (!origin) return callback(null, true);
    return callback(null, origin); // echo the requesting origin
  },
  credentials: true,
  methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization','X-Requested-With','Accept'],
  exposedHeaders: ['Content-Length','X-Request-Id'],
  optionsSuccessStatus: 204
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

/* ------------------------------------------------------------
   Body Parsers — Allow large base64 frames for EdenAI
------------------------------------------------------------- */
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ limit: "10mb", extended: true }));

/* ------------------------------------------------------------
   Normalize Router Helper
------------------------------------------------------------- */
function normalizeRouter(mod, label) {
  if (!mod) throw new Error(`Route module ${label} is undefined`);
  if (typeof mod === 'function' || (mod && typeof mod.use === 'function')) return mod;
  if (mod.default) return mod.default;
  throw new Error(`Route ${label} is not exporting a router`);
}

/* ------------------------------------------------------------
   Load Routes
------------------------------------------------------------- */
let authRoutes, profileRoutes, sessionRoutes, inferRoutes;

try {
  authRoutes = normalizeRouter(require('./routes/auth'), 'auth');
  profileRoutes = normalizeRouter(require('./routes/profiles'), 'profiles');
  sessionRoutes = normalizeRouter(require('./routes/sessions'), 'sessions');

  try {
    inferRoutes = normalizeRouter(require('./routes/infer'), 'infer');
  } catch {
    console.warn("Infer route not found. Skipping.");
  }

} catch (err) {
  console.error("Route load error:", err);
  process.exit(1);
}

/* ------------------------------------------------------------
   Mount API Routes
------------------------------------------------------------- */
const voiceRoute = require('./routes/voice');
app.use('/api/voice', voiceRoute);

app.use("/emotion", emotionRoute);    // 🟢 Emotion detection
app.use('/api/auth', authRoutes);     // Existing Auth APIs
app.use('/api/profiles', profileRoutes);
app.use('/api/sessions', sessionRoutes);

if (inferRoutes) app.use('/api/infer', inferRoutes);

/* ------------------------------------------------------------
   Agora Token Route
------------------------------------------------------------- */
app.get('/api/agora/token', (req, res) => {
  try {
    const pkg = require('agora-access-token');
    const { RtcTokenBuilder, RtcRole } = pkg;

    const channel = req.query.channel;
    if (!channel) return res.status(400).json({ error: "channel is required" });

    const appId = process.env.AGORA_APP_ID;
    const appCert = process.env.AGORA_APP_CERT;

    const uid = Number(req.query.uid || 0);
    const expiration = Math.floor(Date.now() / 1000) + 3600;

    const token = RtcTokenBuilder.buildTokenWithUid(
      appId, appCert, channel, uid, RtcRole.PUBLISHER, expiration
    );

    res.json({
      token,
      appId,
      uid,
      expiresAt: new Date(expiration * 1000).toISOString()
    });

  } catch (e) {
    res.status(500).json({ error: "Token creation failed", details: e.message });
  }
});

/* ------------------------------------------------------------
   Agora Conversational AI Agent Route
------------------------------------------------------------- */
app.post('/api/ai/session', async (req, res) => {
  const channel = req.body.channel;
  if (!channel) return res.status(400).json({ error: "channel is required" });

  const basicAuth = Buffer.from(
    `${process.env.AGORA_CUSTOMER_KEY}:${process.env.AGORA_CUSTOMER_SECRET}`
  ).toString('base64');

  try {
    const response = await fetch(
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
              system_messages: [
                {
                  role: "system",
                  content: "You are a compassionate therapy agent."
                }
              ]
            },
            tts: {
              vendor: process.env.TTS_VENDOR,
              key: process.env.TTS_KEY,
              region: process.env.TTS_REGION,
              voice_name: process.env.TTS_VOICE,
            }
          }
        })
      }
    );

    const data = await response.json();
    if (!response.ok) return res.status(500).json({ error: "Failed to start AI agent", details: data });

    res.json({ success: true, data });

  } catch (e) {
    res.status(500).json({ error: "Server error", details: e.message });
  }
});

/* ------------------------------------------------------------
   Health Check
------------------------------------------------------------- */
app.get('/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

/* ------------------------------------------------------------
   Protected /api/me
------------------------------------------------------------- */
app.get('/api/me', authMiddleware, async (req, res) => {
  try {
    const User = require('./models/User');
    const Profile = require('./models/Profile');

    const user = await User.findById(req.user._id).lean();
    const profile = await Profile.findOne({ userId: req.user._id }).lean();

    res.json({
      id: user._id,
      email: user.email,
      name: user.name,
      consent: user.consent,
      profile
    });

  } catch (e) {
    res.status(500).json({ error: "Server error" });
  }
});

/* ------------------------------------------------------------
   Start Server + Socket.IO
------------------------------------------------------------- */
const PORT = process.env.PORT || 4000;

async function start() {
  try {
    await connectDB(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/mindecho');
    console.log("MongoDB connected");

    const server = http.createServer(app);

    const { Server } = require('socket.io');
    const io = new Server(server, {
      cors: {
        origin: (origin, callback) => callback(null, origin || "*"),
        credentials: true,
        methods: "*",
      }
    });

    let simulator = null;
    try {
      simulator = new SensorSimulator(io);
      simulator.start();
    } catch (e) {
      console.warn("SensorSimulator not started:", e.message);
    }

    io.on("connection", (socket) => {
      console.log("Socket connected:", socket.id);
      if (simulator) simulator.registerClient(socket);

      socket.on("consent", (c) => simulator?.updateConsent(socket, c));
      socket.on("disconnect", () => simulator?.unregisterClient(socket));
    });

    server.listen(PORT, () =>
      console.log(`🚀 Server running at http://localhost:${PORT}`)
    );

  } catch (err) {
    console.error("Startup error:", err);
    process.exit(1);
  }
}

start();
