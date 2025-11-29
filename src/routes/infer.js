// backend/src/routes/infer.js
const express = require('express');
const multer = require('multer');
const router = express.Router();
const eden = require('../edenClient');

const upload = multer({ limits: { fileSize: 30 * 1024 * 1024 } }); // 30MB limit

// Basic helper to map Eden responses into { label, score }
function parseEdenEmotion(resp) {

  try {
    if (!resp) return null;

    if (Array.isArray(resp.emotions) && resp.emotions.length) {
      const best = resp.emotions.reduce((a, b) => (b.score > a.score ? b : a));
      return { label: best.label || best.name, score: best.score ?? 0.8 };
    }
   
    if (Array.isArray(resp.result) && resp.result.length) {
      const best = resp.result.reduce((a, b) => (b.score > a.score ? b : a));
      return { label: best.label || best.name, score: best.score ?? 0.8 };
    }
   
    if (resp.label) return { label: resp.label, score: resp.score ?? 0.8 };
   
    if (typeof resp === 'string') return { label: resp, score: 0.6 };
  } catch (e) {
   
  }
  return null;
}


function fuseSimple({ face, text, eeg }) {
  const weights = { face: 0.5, text: 0.35, eeg: 0.15 };
  const votes = {};

  const add = (label, w) => {
    if (!label) return;
    const l = String(label).toLowerCase();
    votes[l] = (votes[l] || 0) + w;
  };

  if (face) add(face.label, weights.face * (face.score ?? 1));
  if (text) add(text.label, weights.text * (text.score ?? 1));
  if (eeg && typeof eeg.anxiety === 'number') {
    const label = eeg.anxiety > 0.6 ? 'anxious' : (eeg.anxiety < 0.35 ? 'calm' : 'neutral');
    add(label, weights.eeg * (1 - Math.abs(0.5 - eeg.anxiety)));
  }

  // choose top
  const entries = Object.entries(votes);
  if (!entries.length) return { primary: 'neutral', confidence: 0.5, recommendation: { exercise_id: 'grounding', title: 'Grounding', desc: 'Take a short grounding break.' } };
  entries.sort((a, b) => b[1] - a[1]);
  const primary = entries[0][0];
  const total = entries.reduce((s,e)=>s+e[1],0);
  const confidence = Math.min(1, entries[0][1] / (total || 1));

  const recMap = {
    anxious: { exercise_id: 'breathing_2min', title: '2-min breathing', desc: 'Box breathing: 4-4-4-4 for 2 minutes.' },
    calm: { exercise_id: 'journaling', title: 'Quick journal', desc: 'Write 1 line about how you feel.' },
    happy: { exercise_id: 'celebrate', title: 'Micro celebration', desc: 'Take 30s to smile and stretch.' },
    sad: { exercise_id: 'gentle_move', title: 'Gentle movement', desc: 'Try a short walk or stretch.' },
    focused: { exercise_id: 'micro_task', title: 'Short sprint', desc: 'Use this focus for a 10-min task.' },
    energized: { exercise_id: 'micro_sprint', title: 'Short sprint', desc: 'Channel energy into a short productivity sprint.' },
    neutral: { exercise_id: 'grounding', title: 'Grounding', desc: 'Grounding exercise: 5-4-3-2-1.' }
  };

  const rec = recMap[primary] || recMap.neutral;
  return { primary, confidence: Number(confidence.toFixed(2)), recommendation: rec };
}

// POST / (multipart: image, audio, eeg)
router.post('/', upload.fields([{ name: 'image' }, { name: 'audio' }, { name: 'eeg' }]), async (req, res) => {
  try {
    const userId = req.body.user_id || 'guest';
    const files = req.files || {};

    // call Eden for image -> face emotion
    let faceParsed = null;
    if (files.image && files.image[0]) {
      const imageFile = files.image[0];
      // endpoint: use Eden image emotion/face detection. Adjust path per Eden docs/provider you want.
      // Example path: '/v2/image/face_detection' - many providers return emotions inside.
      try {
        const faceResp = await eden.postForm('/v2/image/face_detection', {}, {
          image: { buffer: imageFile.buffer, filename: imageFile.originalname, mime: imageFile.mimetype }
        });
        faceParsed = parseEdenEmotion(faceResp);
      } catch (err) {
        console.warn('Eden face call failed:', err.message || err);
      }
    }

    // call Eden for audio -> ASR (speech-to-text)
    let transcript = null;
    let textParsed = null;
    if (files.audio && files.audio[0]) {
      const audioFile = files.audio[0];
      try {
        const audioResp = await eden.postForm('/v2/audio/speech_to_text', { language: req.body.language || 'en' }, {
          audio: { buffer: audioFile.buffer, filename: audioFile.originalname, mime: audioFile.mimetype }
        });
        // many providers return transcription in audioResp.transcription or audioResp.text
        transcript = audioResp.transcription || audioResp.text || audioResp.result || '';
        // Do a quick emotion analysis on transcription using Eden text emotion endpoint
        if (transcript) {
          try {
            // Use Eden text emotion: POST /v2/text/emotion (some endpoints accept JSON or form-data; we use form to be safe)
            const textResp = await eden.postForm('/v2/text/emotion', { text: transcript }, {});
            textParsed = parseEdenEmotion(textResp) || { label: textResp.label || 'neutral', score: textResp.score || 0.7 };
          } catch (e) {
            // fallback to simple heuristics if Eden text emotion fails
            const t = (transcript || '').toLowerCase();
            if (t.includes('sad') || t.includes('depressed') || t.includes('down')) textParsed = { label: 'sad', score: 0.8 };
            else if (t.includes('happy') || t.includes('great') || t.includes('good')) textParsed = { label: 'happy', score: 0.8 };
            else textParsed = { label: 'neutral', score: 0.6 };
          }
        }
      } catch (err) {
        console.warn('Eden audio/ASR failed:', err.message || err);
      }
    }

    // parse EEG if provided (assume JSON with alpha/beta or array)
    let eegSummary = null;
    if (files.eeg && files.eeg[0]) {
      try {
        const txt = files.eeg[0].buffer.toString('utf8');
        const parsed = JSON.parse(txt);
        // try alpha/beta heuristic
        const alpha = parsed.alpha ?? parsed.alpha_mean ?? null;
        const beta = parsed.beta ?? parsed.beta_mean ?? null;
        if (alpha != null && beta != null) {
          const anxiety = beta / (alpha + beta + 1e-6);
          eegSummary = { anxiety: Math.max(0, Math.min(1, anxiety)) };
        } else if (Array.isArray(parsed)) {
          const flat = parsed.flat ? parsed.flat() : parsed;
          const avg = flat.reduce((s,x)=>s+x,0)/flat.length;
          const variance = flat.reduce((s,x)=>s+(x-avg)*(x-avg),0)/flat.length;
          eegSummary = { variance, anxiety: Math.min(1, variance / 10) };
        }
      } catch (e) {
        console.warn('EEG parse failed:', e.message || e);
      }
    }

    // Final fusion & recommendation
    const fused = fuseSimple({ face: faceParsed, text: textParsed, eeg: eegSummary });

    // Return both raw pieces and fused summary
    return res.json({
      success: true,
      user_id: userId,
      raw: {
        face: faceParsed,
        transcript,
        textEmotion: textParsed,
        eeg: eegSummary
      },
      fused
    });
  } catch (err) {
    console.error('Infer route error:', err);
    return res.status(500).json({ success: false, error: String(err) });
  }
});

module.exports = router;
