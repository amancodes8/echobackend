// backend/src/emotion.js
const express = require("express");
const router = express.Router();
const { GoogleGenerativeAI } = require("@google/generative-ai");

if (!process.env.GEMINI_API_KEY) {
  console.error("❌ Missing GEMINI_API_KEY in .env");
}

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

/** Extract numeric values like:
 * happiness: 0.82
 * sadness: 0.12
 */
function extractEmotions(text) {
  const emotions = {
    happiness: 0,
    neutral: 0,
    sadness: 0,
    anger: 0,
    fear: 0,
  };

  const regex = /(\w+):\s*([0-9.]+)/gi;
  let match;
  while ((match = regex.exec(text))) {
    const key = match[1].toLowerCase();
    const val = Math.min(1, parseFloat(match[2]) || 0);
    if (emotions[key] !== undefined) emotions[key] = val;
  }
  return emotions;
}

router.post("/", async (req, res) => {
  try {
    let { imageBase64 } = req.body;
    if (!imageBase64) {
      return res.status(400).json({ success: false, error: "Missing base64 image" });
    }

    // Ensure data URL prefix
    if (!imageBase64.startsWith("data:")) {
      imageBase64 = "data:image/jpeg;base64," + imageBase64;
    }

    const model = genAI.getGenerativeModel({
      // ⭐ SWITCHED FROM 1.5 PRO → 2.5 FLASH
      model: "gemini-2.5-flash",
    });

    const prompt = `
Analyze the human face in this image.
Return ONLY these fields with numeric values between 0 and 1:

happiness:
neutral:
sadness:
anger:
fear:
`;

    const result = await model.generateContent([
      {
        inlineData: {
          mimeType: "image/jpeg",
          data: imageBase64.split(",")[1],
        },
      },
      prompt,
    ]);

    const text = result.response.text();
    const emotions = extractEmotions(text);

    return res.json({
      success: true,
      emotions,
      raw: text,
    });
  } catch (err) {
    console.error("Gemini Emotion Error:", err);
    return res.status(500).json({
      success: false,
      error: err.message || "Gemini request failed",
    });
  }
});

module.exports = router;
