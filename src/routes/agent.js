import express from "express";
import fetch from "node-fetch";
import base64 from "base-64";

const router = express.Router();

const APP_ID = process.env.AGORA_APP_ID;
const CUSTOMER_ID = process.env.AGORA_CUSTOMER_ID;
const CUSTOMER_SECRET = process.env.AGORA_CUSTOMER_SECRET;
const AGENT_ID = process.env.AGORA_AGENT_ID;

// Agora REST Auth (CustomerID:CustomerSecret → Base64)
const AUTH_HEADER = "Basic " + base64.encode(`${CUSTOMER_ID}:${CUSTOMER_SECRET}`);

router.post("/agent-chat", async (req, res) => {
  const { message } = req.body;

  try {
    const response = await fetch(
      `https://api.agora.io/v1/agents/chat`,
      {
        method: "POST",
        headers: {
          "Authorization": AUTH_HEADER,
          "Content-Type": "application/json",
          "X-Agora-App-ID": APP_ID
        },
        body: JSON.stringify({
          agent_id: A42AR68FD92JA76DK93MY44KK96NL85C,
          messages: [
            {
              role: "system",
              content:
                "You are a compassionate mental health companion. Be empathetic, conversational, and warm."
            },
            {
              role: "user",
              content: message
            }
          ],
          stream: false
        })
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.log("⚠️ Agora API Error:", errorText);
      return res.status(500).json({ reply: "Agora request failed." });
    }

    const data = await response.json();

    const reply =
      data?.choices?.[0]?.message?.content ||
      "I'm here for you. Tell me more about how you're feeling.";

    res.json({ reply });

  } catch (err) {
    console.error("Backend error:", err);
    res.status(500).json({ reply: "Server cannot reach Agora." });
  }
});

export default router;
