// backend/src/routes/voice.js
/**
 * /api/voice — Gemini + (optional) Lingo.dev
 * - Audio (multipart) -> Gemini STT -> { transcript }
 * - Text (JSON) -> Gemini Chat -> { replyText, replyTextUserLanguage? }
 *   Accepts `selectedMode` in JSON to switch system prompt tone.
 */

const express = require("express");
const multer = require("multer");
const upload = multer();
const router = express.Router();

const { GoogleGenerativeAI } = require("@google/generative-ai");

if (!process.env.GEMINI_API_KEY) {
  console.warn("Missing GEMINI_API_KEY in .env");
}
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// (Optional) Lingo.dev initialization — unchanged from prior setup
let lingo = null;
if (process.env.LINGODOTDEV_API_KEY) {
  try {
    const { LingoDotDevEngine } = require("lingo.dev/sdk");
    lingo = new LingoDotDevEngine({ apiKey: process.env.LINGODOTDEV_API_KEY });
    console.log("Lingo.dev initialized");
  } catch (e) {
    console.warn("Failed to init lingo.dev:", e?.message || e);
    lingo = null;
  }
}

/* -------------------------
   Modes (system prompts)
--------------------------*/
const modes = {
  calm: "You are a gentle, slow, calming wellbeing companion. Use soft reassuring language, short sentences, and suggest breathing or grounding when appropriate.",
  motivate: "You are energetic, uplifting, and encouraging. Use motivating language, positive affirmations, and short actionable steps.",
  grounding: "You give short, simple grounding prompts and quick exercises to stabilize attention. Keep responses short (1-2 sentences).",
};

// Helpers for lingo (no-op if lingo absent)
async function lingoTranslateToEnglish(text) {
  if (!lingo) return text;
  try { return (await lingo.localizeText(text, { targetLocale: "en" })) || text; } catch (e) { return text; }
}
async function lingoTranslateToTarget(text, targetLocale) {
  if (!lingo) return null;
  try { return (await lingo.localizeText(text, { targetLocale })) || null; } catch (e) { return null; }
}

function pickUserLocale(req) {
  const header = (req.headers["accept-language"] || "").toString();
  if (!header) return "en";
  const first = header.split(",")[0].split(";")[0].trim();
  return first || "en";
}

/* -------------------------
   Gemini STT (inline audio)
--------------------------*/
async function geminiSTT(buffer) {
  const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

  const resp = await model.generateContent([
    "Transcribe the following audio to text. If the audio is not English, transcribe it in the original language.",
    {
      inline_data: {
        mime_type: "audio/webm",
        data: buffer.toString("base64"),
      },
    },
  ]);

  return resp?.response?.text ? resp.response.text() : "";
}

/* -------------------------
   Gemini Chat (uses selectedMode system prompt)
   Accepts mode key (calm|motivate|grounding)
--------------------------*/
async function geminiChat(text, history = [], mode = "calm") {
  const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

  const systemPrompt = modes[mode] || modes.calm;

  const historyText = Array.isArray(history)
    ? history.map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.text}`).join("\n")
    : "";

  const prompt = `
SYSTEM:
${systemPrompt}

Conversation:
${historyText}

User: ${text}

Reply in a supportive manner appropriate to the system instructions. Keep replies concise.
`;

  const result = await model.generateContent([prompt]);
  return result?.response?.text ? result.response.text() : "";
}

/* -------------------------
   Routes
--------------------------*/
router.post("/", upload.single("file"), async (req, res) => {
  try {
    // AUDIO MODE -> transcribe
    if (req.file) {
      const buffer = req.file.buffer;
      try {
        const transcript = await geminiSTT(buffer);
        return res.json({ success: true, transcript });
      } catch (e) {
        console.error("geminiSTT error:", e);
        return res.status(500).json({ success: false, error: "Transcription failed", details: String(e?.message || e) });
      }
    }

    // JSON TEXT MODE -> chat
    if (req.is("application/json")) {
      const { text, history = [], selectedMode } = req.body || {};
      if (!text) return res.status(400).json({ success: false, error: "Missing text" });

      // translate to English for LLM if lingo available
      const englishText = await lingoTranslateToEnglish(text);

      let replyEnglish;
      try {
        replyEnglish = await geminiChat(englishText, history, selectedMode || "calm");
      } catch (e) {
        console.error("geminiChat error:", e);
        return res.status(500).json({ success: false, error: "LLM reply failed", details: String(e?.message || e) });
      }

      // translate back to user's locale if lingo available
      const userLocale = pickUserLocale(req);
      const replyUserLang = lingo ? await lingoTranslateToTarget(replyEnglish, userLocale) : null;

      return res.json({
        success: true,
        replyText: replyEnglish,
        replyTextUserLanguage: replyUserLang,
      });
    }

    return res.status(400).json({ success: false, error: "Invalid request format" });
  } catch (err) {
    console.error("voice route error:", err);
    return res.status(500).json({ success: false, error: String(err?.message || err) });
  }
});

module.exports = router;
