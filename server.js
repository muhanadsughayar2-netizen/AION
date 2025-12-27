const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors({
  origin: ['chrome-extension://*', '*'],
  methods: ['POST', 'GET'],
  allowedHeaders: ['Content-Type', 'X-Extension-ID']
}));
app.use(express.json({ limit: '50mb' }));

const DEVELOPER_KEY = process.env['GEMINI_API_KEY'];
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW = 60000;
const RATE_LIMIT_MAX = 5;

function checkRateLimit(userId) {
  const now = Date.now();
  const userKey = userId || 'anonymous';
  const userData = rateLimitMap.get(userKey) || { count: 0, windowStart: now };
  
  if (now - userData.windowStart > RATE_LIMIT_WINDOW) {
    userData.count = 0;
    userData.windowStart = now;
  }
  
  if (userData.count >= RATE_LIMIT_MAX) {
    return false;
  }
  
  userData.count++;
  rateLimitMap.set(userKey, userData);
  return true;
}

app.post('/premium-chat', async (req, res) => {
  const { contents, systemPrompt, userId } = req.body;
  
  if (!DEVELOPER_KEY) {
    return res.status(500).json({ error: 'Server not configured' });
  }
  
  if (!checkRateLimit(userId)) {
    return res.status(429).json({ error: 'Rate limit exceeded. Please wait.' });
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${DEVELOPER_KEY}`;

  try {
    const requestBody = {
      contents: contents,
      generationConfig: {
        maxOutputTokens: 2048,
        temperature: 0.7,
        topP: 0.95,
        topK: 40
      }
    };
    
    if (systemPrompt) {
      requestBody.systemInstruction = { parts: [{ text: systemPrompt }] };
    }
    
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    });

    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error('[SnapToAI Proxy] Error:', error);
    res.status(500).json({ error: 'AI Server busy. Try again.' });
  }
});

app.post('/premium-chat-stream', async (req, res) => {
  const { contents, systemPrompt, userId } = req.body;
  
  if (!DEVELOPER_KEY) {
    return res.status(500).json({ error: 'Server not configured' });
  }
  
  if (!checkRateLimit(userId)) {
    return res.status(429).json({ error: 'Rate limit exceeded. Please wait.' });
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:streamGenerateContent?key=${DEVELOPER_KEY}&alt=sse`;

  try {
    const requestBody = {
      contents: contents,
      generationConfig: {
        maxOutputTokens: 2048,
        temperature: 0.7,
        topP: 0.95,
        topK: 40
      }
    };
    
    if (systemPrompt) {
      requestBody.systemInstruction = { parts: [{ text: systemPrompt }] };
    }
    
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    });

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(decoder.decode(value));
    }
    res.end();
  } catch (error) {
    console.error('[SnapToAI Proxy] Stream Error:', error);
    res.status(500).json({ error: 'AI Server busy. Try again.' });
  }
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', hasKey: !!DEVELOPER_KEY });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`[SnapToAI] Premium Proxy running on port ${PORT}`);
  console.log(`[SnapToAI] API Key configured: ${!!DEVELOPER_KEY}`);
});
