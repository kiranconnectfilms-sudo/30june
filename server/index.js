'use strict';

require('dotenv').config();

const express = require('express');
const path = require('path');

const editRoute = require('./routes/edit');
const groq = require('./lib/groq');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/api/health', async (req, res) => {
  const health = await groq.checkHealth();
  res.json({
    ok: true,
    aiConfigured: health.configured && health.reachable,
    providerReachable: health.reachable,
    providerError: health.error || null,
    model: groq.MODEL,
  });
});

app.use('/api', editRoute);

app.use((err, req, res, next) => {
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: `File is too large. Max size is ${process.env.MAX_UPLOAD_MB || 25}MB.` });
  }
  console.error(err);
  res.status(500).json({ error: 'Unexpected server error.' });
});

app.listen(PORT, async () => {
  console.log(`\n  AI Document Editor running at http://localhost:${PORT}`);
  const health = await groq.checkHealth();
  if (!health.configured) {
    console.log('\n  WARNING: GROQ_API_KEY is not set.');
    console.log('  Get a free key at https://console.groq.com/keys\n');
  } else if (!health.reachable) {
    console.log(`\n  WARNING: AI provider not reachable (${health.error}).\n`);
  } else {
    console.log(`  AI features ready — using model "${groq.MODEL}" via ${groq.BASE_URL}\n`);
  }
});
