// backend/src/edenClient.js
const axios = require('axios');
const FormData = require('form-data');

const EDEN_BASE = process.env.EDENAI_BASE || 'https://api.edenai.run';
const EDEN_KEY = process.env.EDENAI_API_KEY;

if (!EDEN_KEY) {
  console.warn('⚠️ EDENAI_API_KEY is not set. Eden AI calls will fail.');
}

const axiosInstance = axios.create({
  baseURL: EDEN_BASE,
  timeout: 60_000,
  headers: {
    // Authorization is added per-request so form-data headers don't get overridden.
  },
});

/**
 * postForm - post multipart/form-data to Eden
 * path - string, e.g. '/v2/image/face_detection' or '/v2/audio/speech_to_text'
 * fields - object of key->value
 * files - object of key -> { buffer, filename, mime }
 */
async function postForm(path, fields = {}, files = {}) {
  const form = new FormData();

  Object.entries(fields).forEach(([k, v]) => {
    if (v !== undefined && v !== null) form.append(k, v);
  });

  Object.entries(files).forEach(([k, fileObj]) => {
    if (!fileObj) return;
    form.append(k, fileObj.buffer, {
      filename: fileObj.filename || k,
      contentType: fileObj.mime || 'application/octet-stream',
    });
  });

  const headers = {
    ...form.getHeaders(),
    Authorization: `Bearer ${EDEN_KEY}`,
  };

  try {
    const res = await axiosInstance.post(path, form, { headers });
    return res.data;
  } catch (err) {
    // surface useful message
    const respData = err.response?.data || err.message;
    throw new Error(`Eden API error: ${JSON.stringify(respData)}`);
  }
}

module.exports = {
  postForm,
};
