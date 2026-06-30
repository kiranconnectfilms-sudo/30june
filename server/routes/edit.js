'use strict';

const express = require('express');
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');

const { detectType, LEGACY_UNSUPPORTED } = require('../lib/fileTypes');
const { parseDocx } = require('../lib/parsers/docx');
const { parseXlsx } = require('../lib/parsers/xlsx');
const { parseCsv } = require('../lib/parsers/csv');
const { parsePptx } = require('../lib/parsers/pptx');
const { parsePdf } = require('../lib/parsers/pdf');
const { parseTxt } = require('../lib/builders/txt');

const { buildDocx } = require('../lib/builders/docx');
const { buildXlsx } = require('../lib/builders/xlsx');
const { buildPptx } = require('../lib/builders/pptx');

const { editDocumentBlocks, editSpreadsheet, editPresentation } = require('../lib/aiEdit');
const { AiConfigError, AiApiError } = require('../lib/groq');
const convert = require('../lib/converters');

const router = express.Router();

const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB || 25);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024 },
});

const jobs = new Map();
const JOB_TTL_MS = 30 * 60 * 1000;

function createJob(data) {
  const id = crypto.randomUUID();
  jobs.set(id, { ...data, createdAt: Date.now() });
  setTimeout(() => jobs.delete(id), JOB_TTL_MS).unref?.();
  return id;
}

function cleanFilename(name) {
  const base = path.basename(name, path.extname(name));
  return base.replace(/[^a-z0-9_\- ]/gi, '_').slice(0, 80) || 'document';
}

router.post('/edit', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file was uploaded.' });
  }

  const { originalname, buffer } = req.file;
  const instruction = (req.body.instruction || '').slice(0, 2000);
  const { ext, info } = detectType(originalname);

  if (!info) {
    return res.status(400).json({
      error: `Unsupported file type ".${ext}". Supported: Word (.docx), Excel (.xlsx, .csv), PowerPoint (.pptx), PDF (.pdf), Text (.txt).`,
    });
  }

  if (LEGACY_UNSUPPORTED.has(ext)) {
    return res.status(400).json({
      error: `Legacy ".${ext}" files use an old binary format. Please re-save as ${ext === 'doc' ? '.docx' : ext === 'xls' ? '.xlsx' : '.pptx'} and upload that instead.`,
    });
  }

  try {
    const baseName = cleanFilename(originalname);

    if (info.kind === 'document' || info.kind === 'pdf' || info.kind === 'text') {
      let blocks;
      if (info.kind === 'document') {
        ({ blocks } = await parseDocx(buffer));
      } else if (info.kind === 'pdf') {
        ({ blocks } = await parsePdf(buffer));
      } else {
        ({ blocks } = parseTxt(buffer.toString('utf-8')));
      }
      const editedBlocks = await editDocumentBlocks(blocks, instruction);
      const jobId = createJob({ modelType: 'blocks', data: editedBlocks, baseName });
      return res.json({ jobId, baseName, modelType: 'blocks', itemCount: editedBlocks.length });
    }

    if (info.kind === 'spreadsheet' || info.kind === 'csv') {
      let sheets;
      if (info.kind === 'csv') {
        const rows = parseCsv(buffer.toString('utf-8'));
        sheets = [{ name: 'Sheet1', rows }];
      } else {
        ({ sheets } = await parseXlsx(buffer, false));
      }
      const editedSheets = await editSpreadsheet(sheets, instruction);
      const jobId = createJob({ modelType: 'sheets', data: editedSheets, baseName });
      return res.json({ jobId, baseName, modelType: 'sheets', itemCount: editedSheets.length });
    }

    if (info.kind === 'presentation') {
      const { slides } = await parsePptx(buffer);
      const editedSlides = await editPresentation(slides, instruction);
      const jobId = createJob({ modelType: 'slides', data: editedSlides, baseName });
      return res.json({ jobId, baseName, modelType: 'slides', itemCount: editedSlides.length });
    }

    return res.status(400).json({ error: 'Unhandled file kind.' });
  } catch (err) {
    return res.status(mapErrorStatus(err)).json({ error: describeError(err) });
  }
});

router.get('/download/:jobId/:format', async (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) {
    return res.status(404).json({ error: 'This file is no longer available. Please re-upload and try again.' });
  }

  const format = req.params.format;
  if (!['docx', 'pptx', 'xlsx'].includes(format)) {
    return res.status(400).json({ error: 'Unsupported format. Choose docx, pptx, or xlsx.' });
  }

  try {
    let outBuffer, mime, filename;

    if (format === 'docx') {
      let blocks;
      if (job.modelType === 'blocks') blocks = job.data;
      else if (job.modelType === 'slides') blocks = convert.slidesToBlocks(job.data);
      else blocks = convert.sheetsToBlocks(job.data);
      outBuffer = await buildDocx(blocks, job.baseName);
      mime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      filename = `${job.baseName}.docx`;
    }

    if (format === 'pptx') {
      let slides;
      if (job.modelType === 'slides') slides = job.data;
      else if (job.modelType === 'blocks') slides = convert.blocksToSlides(job.data);
      else slides = convert.sheetsToSlides(job.data);
      outBuffer = await buildPptx(slides);
      mime = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
      filename = `${job.baseName}.pptx`;
    }

    if (format === 'xlsx') {
      let sheets;
      if (job.modelType === 'sheets') sheets = job.data;
      else if (job.modelType === 'blocks') sheets = convert.blocksToSheets(job.data);
      else sheets = convert.slidesToSheets(job.data);
      outBuffer = await buildXlsx(sheets);
      mime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      filename = `${job.baseName}.xlsx`;
    }

    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(outBuffer);
  } catch (err) {
    console.error('[download] build failed:', err);
    return res.status(500).json({ error: `Failed to build the ${format} file: ${err.message}` });
  }
});

function mapErrorStatus(err) {
  if (err instanceof AiConfigError) return 503;
  if (err instanceof AiApiError) return err.status === 429 ? 429 : 502;
  if (err.code === 'CONTENT_TOO_LARGE') return 413;
  return 500;
}

function describeError(err) {
  if (err instanceof AiConfigError) return err.message;
  if (err instanceof AiApiError) return `The AI provider couldn't process this request: ${err.body || err.message}`;
  if (err.code === 'CONTENT_TOO_LARGE') return err.message;
  return `Something went wrong while processing this file: ${err.message}`;
}

module.exports = router;
