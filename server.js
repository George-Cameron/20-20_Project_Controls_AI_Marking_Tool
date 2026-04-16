/* =========================================================
   20/20 Project Management
   Project Controls AI Powered Marking Companion — server
   ---------------------------------------------------------
   Serves the static frontend and exposes POST /api/mark,
   which calls the Anthropic Claude API to mark a submission
   against the official criteria PDF for the chosen module.
   ========================================================= */

'use strict';

require('dotenv').config();

const path    = require('path');
const fs      = require('fs');
const express = require('express');
const multer  = require('multer');
const mammoth = require('mammoth');
const Anthropic = require('@anthropic-ai/sdk');

// ---------- Configuration ----------
const PORT          = parseInt(process.env.PORT || '3000', 10);
const MODEL         = 'claude-sonnet-4-20250514';
const MAX_TOKENS    = 4096;
const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB
const CRITERIA_DIR  = path.resolve(__dirname, 'criteria');
const ROOT_DIR      = __dirname;

const SYSTEM_PROMPT =
  "You are a professional assessor for 20/20 Project Management. " +
  "You will be provided with a learner's assignment submission and the " +
  "official marking criteria for their module. Mark the submission strictly " +
  "against the criteria provided. For each criterion, provide a score, a " +
  "clear written justification, and constructive feedback. Do not award " +
  "marks for anything not evidenced in the submission. End with an overall " +
  "grade and a brief summary of strengths and areas for improvement. Use " +
  "professional, formal language throughout.";

const MODULE_FILES = {
  'module-a': 'module-a.pdf',
  'module-b': 'module-b.pdf',
  'module-c': 'module-c.pdf',
  'module-d': 'module-d.pdf',
  'module-e': 'module-e.pdf',
  'module-f': 'module-f.pdf',
  'module-g': 'module-g.pdf',
  'module-h': 'module-h.pdf'
};

// Accepted submission types (extension + MIME)
const ACCEPTED = {
  pdf:  { mime: 'application/pdf' },
  doc:  { mime: 'application/msword' },
  docx: { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  jpg:  { mime: 'image/jpeg' },
  jpeg: { mime: 'image/jpeg' },
  png:  { mime: 'image/png' }
};

// ---------- API key ----------
const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  // Fail loudly at boot rather than at the first request.
  // eslint-disable-next-line no-console
  console.error(
    '\n[startup error] ANTHROPIC_API_KEY is not set.\n' +
    'Set it in your environment or in a .env file before starting the server.\n'
  );
  process.exit(1);
}

const anthropic = new Anthropic({ apiKey });

// ---------- App ----------
const app = express();

// Serve the static frontend from the project root.
app.use(express.static(ROOT_DIR, { index: 'index.html' }));

// Multer: in-memory upload, single file, 20MB cap.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE, files: 1 }
});

// ---------- POST /api/mark ----------
app.post('/api/mark', (req, res) => {
  upload.single('file')(req, res, async function (uploadErr) {
    if (uploadErr) {
      const msg = uploadErr.code === 'LIMIT_FILE_SIZE'
        ? 'File is too large. Maximum size is 20MB.'
        : ('Upload failed: ' + uploadErr.message);
      return res.status(400).json({ ok: false, error: msg });
    }

    try {
      const moduleKey = String(req.body.module || '').trim();
      const file      = req.file;

      // ----- Validate inputs -----
      if (!file) {
        return res.status(400).json({ ok: false, error: 'No file was uploaded.' });
      }
      if (!MODULE_FILES[moduleKey]) {
        return res.status(400).json({ ok: false, error: 'Unknown or missing module.' });
      }

      const ext = (file.originalname.split('.').pop() || '').toLowerCase();
      if (!ACCEPTED[ext]) {
        return res.status(400).json({
          ok: false,
          error: 'Unsupported file type. Accepted: PDF, DOC, DOCX, JPG, PNG.'
        });
      }

      // ----- Load criteria PDF -----
      const criteriaPath = path.join(CRITERIA_DIR, MODULE_FILES[moduleKey]);
      if (!fs.existsSync(criteriaPath)) {
        return res.status(500).json({
          ok: false,
          error: 'Criteria file is missing on the server for this module.'
        });
      }
      const criteriaBuffer = fs.readFileSync(criteriaPath);
      if (criteriaBuffer.length === 0) {
        return res.status(500).json({
          ok: false,
          error: 'Criteria file for this module is empty on the server.'
        });
      }
      const criteriaB64 = criteriaBuffer.toString('base64');

      // ----- Build submission content block(s) -----
      const submissionBlocks = await buildSubmissionBlocks(file, ext);

      // ----- Compose the user message -----
      // Order: criteria document (cached) → submission → instruction.
      // The criteria PDF gets cache_control because the same 8 PDFs are
      // reused across every learner's submission for that module.
      const userContent = [
        {
          type: 'document',
          source: {
            type: 'base64',
            media_type: 'application/pdf',
            data: criteriaB64
          },
          title: 'Official marking criteria — ' + moduleKey,
          cache_control: { type: 'ephemeral' }
        },
        {
          type: 'text',
          text:
            'Below is the learner submission for ' + moduleKey.toUpperCase() +
            ' (' + escapeForPrompt(file.originalname) + ').'
        },
        ...submissionBlocks,
        {
          type: 'text',
          text:
            'Mark the submission above strictly against the official criteria ' +
            'document provided at the top of this message. Follow the system ' +
            'instructions exactly: per-criterion score, justification and ' +
            'feedback; overall grade; strengths and areas for improvement.'
        }
      ];

      // ----- Call the Claude API -----
      const response = await anthropic.messages.create({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userContent }]
      });

      // Extract text blocks from the response.
      const textOut = (response.content || [])
        .filter(function (b) { return b.type === 'text'; })
        .map(function (b) { return b.text; })
        .join('\n\n')
        .trim();

      return res.json({
        ok: true,
        model: response.model,
        stop_reason: response.stop_reason,
        usage: response.usage,
        mark_sheet: textOut
      });

    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[/api/mark] error:', err);

      // Surface API errors with a clean message; never leak the API key.
      const status = err.status || 500;
      const message = err.error && err.error.error && err.error.error.message
        ? err.error.error.message
        : (err.message || 'Unexpected server error.');

      return res.status(status >= 400 && status < 600 ? status : 500).json({
        ok: false,
        error: message
      });
    }
  });
});

// ---------- Helpers ----------

/**
 * Convert an uploaded submission file into an array of Anthropic content
 * blocks based on its extension.
 *
 *   PDF  → document (base64)
 *   PNG  → image    (base64)
 *   JPG  → image    (base64)
 *   DOC  → text     (extracted via mammoth)
 *   DOCX → text     (extracted via mammoth)
 */
async function buildSubmissionBlocks(file, ext) {
  if (ext === 'pdf') {
    return [{
      type: 'document',
      source: {
        type: 'base64',
        media_type: 'application/pdf',
        data: file.buffer.toString('base64')
      },
      title: file.originalname
    }];
  }

  if (ext === 'png' || ext === 'jpg' || ext === 'jpeg') {
    return [{
      type: 'image',
      source: {
        type: 'base64',
        media_type: ext === 'png' ? 'image/png' : 'image/jpeg',
        data: file.buffer.toString('base64')
      }
    }];
  }

  if (ext === 'doc' || ext === 'docx') {
    // mammoth handles .docx natively. .doc support is best-effort —
    // most learners submit .docx, and we fail clearly if extraction fails.
    let text;
    try {
      const result = await mammoth.extractRawText({ buffer: file.buffer });
      text = (result && result.value) ? result.value.trim() : '';
    } catch (extractErr) {
      throw new Error(
        'Could not extract text from Word document: ' + extractErr.message
      );
    }
    if (!text) {
      throw new Error('The Word document appears to be empty.');
    }
    return [{
      type: 'text',
      text: 'Learner submission (extracted text):\n\n' + text
    }];
  }

  // Should be unreachable thanks to upstream validation.
  throw new Error('Unsupported file extension: ' + ext);
}

function escapeForPrompt(s) {
  return String(s).replace(/[\r\n\t]/g, ' ').slice(0, 200);
}

// ---------- Boot ----------
app.listen(PORT, function () {
  // eslint-disable-next-line no-console
  console.log(
    '20/20 PM AI Marking Companion server listening on http://localhost:' + PORT
  );
});
