'use strict';

require('dotenv').config();

const express = require('express');
const path = require('path');

const editRoute = require('./routes/edit');
const adminRoute = require('./routes/admin');
const accessRoute = require('./routes/access');
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
    baseUrl: groq.BASE_URL,
  });
});

app.use('/api', editRoute);
app.use('/api', accessRoute);
app.use('/admin', adminRoute);

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
    console.log('  Get a free key at https://console.groq.com/keys');
    console.log('  Locally: add GROQ_API_KEY=... to .env, then restart.');
    console.log('  On Render: add it under "Environment" in your service settings.\n');
  } else if (!health.reachable) {
    console.log(`\n  WARNING: AI provider is configured but not reachable (${health.error}).`);
    console.log(`  Base URL: ${groq.BASE_URL}`);
    console.log('  Check the key is valid and the URL is correct.\n');
  } else {
    console.log(`  AI features ready — using model "${groq.MODEL}" via ${groq.BASE_URL}\n`);
  }
});
