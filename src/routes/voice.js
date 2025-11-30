// backend/src/routes/voice.js
/**
 * backend/src/routes/voice.js
 *
 * Gemini-only backend (no attempt to generate audio via Gemini).
 * - Audio -> STT via Gemini (transcription)
 * - Text  -> Reply via Gemini (text only)
 *
 * NOTE: If you want audio replies, enable a TTS provider (Google Cloud TTS, ElevenLabs, etc.)
 * and I can add that code. For now we return replyText and audioBase64=null.
 */

const express = require("express");
const multer = require("multer");
const upload = multer();
const router = express.Router();

const { GoogleGenerativeAI } = require("@google/generative-ai");

if (!process.env.GEMINI_API_KEY) {
  console.error("Missing GEMINI_API_KEY in env — set GEMINI_API_KEY in backend .env");
}

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

/* ---------------------------------------------------------
   Gemini STT (speech -> text)
   We'll ask Gemini to transcribe the inline audio.
   If this fails for your account/region, you can replace STT
   with a dedicated STT provider later.
--------------------------------------------------------- */
async function geminiSTT(buffer) {
  const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

  // Use inline data pattern: prompt + inline audio
  // We ask Gemini to "transcribe this audio to English."
  const prompt = "Transcribe the following audio into English text (accurate punctuation).";

  // The SDK accepts an array of inputs; using the simpler shape that worked earlier:
  const result = await model.generateContent([
    prompt,
    {
      inlineData: {
        mimeType: "audio/webm",
        data: buffer.toString("base64"),
      },
    },
  ]);

  // result.response.text() returns the transcription text
  const respText = result?.response?.text ? result.response.text() : "";
  return respText;
}

/* ---------------------------------------------------------
   Gemini Chat (text -> reply)
--------------------------------------------------------- */
async function geminiChat(text, history = []) {
  const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

  const historyText = Array.isArray(history)
    ? history.map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.text}`).join("\n")
    : "";

  const prompt = `
You are a compassionate, concise mental-wellbeing assistant.
Conversation so far:
${historyText}

User: ${text}

Reply in a supportive, concise way (2-4 sentences).
`;

  const result = await model.generateContent([prompt]);
  const reply = result?.response?.text ? result.response.text() : "";
  return reply;
}

/* ---------------------------------------------------------
   Main route: accepts multipart/form-data (file) OR JSON { text }
--------------------------------------------------------- */
router.post("/", upload.single("file"), async (req, res) => {
  try {
    // AUDIO MODE: file present -> transcribe
    if (req.file) {
      const buffer = req.file.buffer;
      try {
        const transcript = await geminiSTT(buffer);
        return res.json({ success: true, transcript });
      } catch (e) {
        console.error("geminiSTT error:", e?.message || e);
        return res.status(500).json({ success: false, error: "Transcription failed", details: String(e?.message || e) });
      }
    }

    // TEXT MODE: JSON body { text, history? } -> reply text
    if (req.is("application/json")) {
      const { text, history = [] } = req.body || {};
      if (!text) return res.status(400).json({ success: false, error: "Missing text" });

      try {
        const replyText = await geminiChat(text, history);
        // No TTS here — return audioBase64: null to make frontend handling explicit
        return res.json({ success: true, replyText, audioBase64: null });
      } catch (e) {
        console.error("geminiChat error:", e?.message || e);
        return res.status(500).json({ success: false, error: "LLM reply failed", details: String(e?.message || e) });
      }
    }

    // fallback
    return res.status(400).json({ success: false, error: "Bad request format" });
  } catch (err) {
    console.error("voice route unhandled error:", err);
    return res.status(500).json({ success: false, error: String(err?.message || err) });
  }
});

module.exports = router;
