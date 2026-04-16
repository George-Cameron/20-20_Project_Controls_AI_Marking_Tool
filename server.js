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

// ---------- POST /api/extract-docx-preview ----------
// Returns the first ~800 characters of extracted text from a .doc/.docx
// so the user can verify the extraction looks right before spending an
// expensive Anthropic call. No AI call happens here.
app.post('/api/extract-docx-preview', (req, res) => {
  upload.single('file')(req, res, async function (uploadErr) {
    if (uploadErr) {
      const msg = uploadErr.code === 'LIMIT_FILE_SIZE'
        ? 'File is too large. Maximum size is 20MB.'
        : ('Upload failed: ' + uploadErr.message);
      return res.status(400).json({ ok: false, error: msg });
    }

    try {
      const file = req.file;
      if (!file) {
        return res.status(400).json({ ok: false, error: 'No file was uploaded.' });
      }
      const ext = (file.originalname.split('.').pop() || '').toLowerCase();
      if (ext !== 'doc' && ext !== 'docx') {
        return res.status(400).json({
          ok: false,
          error: 'This endpoint only accepts .doc or .docx files.'
        });
      }

      const result = await mammoth.extractRawText({ buffer: file.buffer });
      const fullText = (result && result.value ? result.value : '').trim();

      if (!fullText) {
        return res.json({
          ok: true,
          empty: true,
          preview: '',
          char_count: 0,
          word_count: 0
        });
      }

      const PREVIEW_CHARS = 800;
      const preview = fullText.length > PREVIEW_CHARS
        ? fullText.slice(0, PREVIEW_CHARS).trim() + '\u2026'
        : fullText;

      return res.json({
        ok: true,
        empty: false,
        preview: preview,
        char_count: fullText.length,
        word_count: fullText.split(/\s+/).filter(Boolean).length,
        truncated: fullText.length > PREVIEW_CHARS
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[/api/extract-docx-preview] error:', err);
      return res.status(500).json({
        ok: false,
        error: 'Could not extract text from the Word document: ' + (err.message || 'unknown error')
      });
    }
  });
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
            'feedback; overall grade; strengths and areas for improvement.\n\n' +
            'Return ONLY a single JSON object matching this exact shape — ' +
            'no markdown code fences, no commentary outside the JSON:\n\n' +
            '{\n' +
            '  "criteria": [\n' +
            '    {\n' +
            '      "name": "string — name or number of the criterion",\n' +
            '      "score": "string — e.g. \\"18/20\\" or \\"85%\\"",\n' +
            '      "justification": "string — why this score was awarded",\n' +
            '      "feedback": "string — constructive feedback for improvement"\n' +
            '    }\n' +
            '  ],\n' +
            '  "overall_grade": "string — e.g. \\"Distinction\\", \\"Merit\\", \\"Pass\\", \\"Refer\\", or a percentage",\n' +
            '  "summary": {\n' +
            '    "strengths": "string — what the learner did well",\n' +
            '    "areas_for_improvement": "string — what to focus on next"\n' +
            '  }\n' +
            '}'
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

      // Try to parse the model's reply as the JSON mark sheet.
      // The client falls back to rendering raw_text if this is null.
      const structured = parseMarkSheet(textOut);

      return res.json({
        ok: true,
        model: response.model,
        stop_reason: response.stop_reason,
        usage: response.usage,
        mark_sheet: structured,
        raw_text: textOut
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

/**
 * Parse the model's reply as the structured mark sheet.
 * Returns the parsed object, or null if no usable JSON was found.
 *
 * Tries a direct JSON.parse first, then a substring slice between the
 * first `{` and last `}` (handles cases where the model adds preamble
 * or wraps the JSON in a markdown code fence despite being asked not to).
 */
function parseMarkSheet(text) {
  if (!text || typeof text !== 'string') return null;

  try { return JSON.parse(text); } catch (_) { /* fall through */ }

  const start = text.indexOf('{');
  const end   = text.lastIndexOf('}');
  if (start !== -1 && end > start) {
    try { return JSON.parse(text.slice(start, end + 1)); } catch (_) { /* fall through */ }
  }
  return null;
}

// ---------- Boot ----------
app.listen(PORT, function () {
  // eslint-disable-next-line no-console
  console.log(
    '20/20 PM AI Marking Companion server listening on http://localhost:' + PORT
  );
});
