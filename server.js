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
const os      = require('os');
const { execFileSync } = require('child_process');
const express    = require('express');
const multer     = require('multer');
const mammoth    = require('mammoth');
const { PDFDocument } = require('pdf-lib');
const Anthropic  = require('@anthropic-ai/sdk');

// ---------- Configuration ----------
const PORT          = parseInt(process.env.PORT || '3000', 10);
const MODEL         = 'claude-sonnet-4-20250514';
const MAX_TOKENS    = 8192;
const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB
const CRITERIA_DIR  = path.resolve(__dirname, 'criteria');
const ROOT_DIR      = __dirname;

const SYSTEM_PROMPT =
  "You are an experienced, senior assessor for 20/20 Project Management. " +
  "You genuinely care about helping learners improve. You will be provided " +
  "with a learner's assignment submission and the official marking criteria " +
  "for their module.\n\n" +

  "Mark the submission strictly against the criteria provided. Do not award " +
  "marks for anything not evidenced in the submission.\n\n" +

  "For each criterion:\n" +
  "- Award a score.\n" +
  "- Write a clear justification explaining why that score was given.\n" +
  "- Provide constructive, specific feedback that tells the learner exactly " +
  "what to do to improve — reference particular sections of their work " +
  "rather than making generic statements.\n\n" +

  "At the bottom of the criteria document you will find a marking rubric " +
  "or mark sheet. Complete every row of that rubric with the marks you have " +
  "awarded and a brief comment for each.\n\n" +

  "End with an overall grade and a brief summary of strengths and areas " +
  "for improvement.\n\n" +

  "Tone and voice — this is critical:\n" +
  "- Write the way a thoughtful, experienced tutor would speak to a " +
  "learner face-to-face: warm, encouraging, but honest.\n" +
  "- Vary your sentence structure naturally. Do not start every paragraph " +
  "the same way. Avoid formulaic patterns like 'The learner demonstrates…' " +
  "or 'This section evidences…'.\n" +
  "- Be specific: say 'Your risk register on page 3 covers likelihood " +
  "well but misses impact scoring' rather than 'Risk identification " +
  "could be improved'.\n" +
  "- It should be impossible to tell this feedback was written by AI. " +
  "If it reads like a template, rewrite it until it doesn't.";

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
            'feedback; completed rubric from the criteria document; overall ' +
            'grade; strengths and areas for improvement.\n\n' +
            'Return ONLY a single JSON object matching this exact shape — ' +
            'no markdown code fences, no commentary outside the JSON:\n\n' +
            '{\n' +
            '  "criteria": [\n' +
            '    {\n' +
            '      "name": "string — name or number of the criterion",\n' +
            '      "score": "string — e.g. \\"18/20\\" or \\"85%\\"",\n' +
            '      "justification": "string — why this score was awarded",\n' +
            '      "feedback": "string — constructive, specific feedback written in a natural, human voice"\n' +
            '    }\n' +
            '  ],\n' +
            '  "completed_rubric": [\n' +
            '    {\n' +
            '      "criterion": "string — name of the rubric row, exactly as it appears in the criteria document",\n' +
            '      "marks_available": "string — maximum marks for this row",\n' +
            '      "marks_awarded": "string — marks you are awarding",\n' +
            '      "comments": "string — brief assessor comment for this row"\n' +
            '    }\n' +
            '  ],\n' +
            '  "overall_grade": "string — e.g. \\"Distinction\\", \\"Merit\\", \\"Pass\\", \\"Refer\\", or a percentage",\n' +
            '  "summary": {\n' +
            '    "strengths": "string — what the learner did well, written warmly and specifically",\n' +
            '    "areas_for_improvement": "string — what to focus on next, with actionable suggestions"\n' +
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

// ---------- POST /api/generate-marked-pdf ----------
// Merges the original submission (as PDF) with a styled feedback/rubric
// document generated from the mark_sheet JSON. Returns a downloadable
// PDF named "<original>-Marked.pdf".
app.post('/api/generate-marked-pdf', (req, res) => {
  upload.single('file')(req, res, async function (uploadErr) {
    if (uploadErr) {
      return res.status(400).json({ ok: false, error: 'Upload failed: ' + uploadErr.message });
    }

    try {
      const file = req.file;
      if (!file) {
        return res.status(400).json({ ok: false, error: 'No file was uploaded.' });
      }

      let markSheet;
      try {
        markSheet = JSON.parse(req.body.mark_sheet || '{}');
      } catch (_) {
        return res.status(400).json({ ok: false, error: 'Invalid mark_sheet JSON.' });
      }

      const ext = (file.originalname.split('.').pop() || '').toLowerCase();

      // 1. Get the original submission as a PDF buffer.
      var originalPdf;
      if (ext === 'pdf') {
        originalPdf = file.buffer;
      } else if (ext === 'doc' || ext === 'docx') {
        originalPdf = convertDocxToPdf(file.buffer, file.originalname);
        if (!originalPdf) {
          return res.status(500).json({
            ok: false,
            error: 'Could not convert the Word document to PDF. LibreOffice may not be available.'
          });
        }
      } else if (ext === 'png' || ext === 'jpg' || ext === 'jpeg') {
        originalPdf = convertImageToPdf(file.buffer, file.originalname, ext);
        if (!originalPdf) {
          return res.status(500).json({
            ok: false,
            error: 'Could not convert the image to PDF.'
          });
        }
      } else {
        return res.status(400).json({ ok: false, error: 'Unsupported file type.' });
      }

      // 2. Generate the feedback document as HTML, then convert to PDF.
      const feedbackHtml = buildFeedbackHtml(markSheet, file.originalname, req.body.module || '');
      const feedbackPdf  = convertHtmlToPdf(feedbackHtml, 'feedback.html');
      if (!feedbackPdf) {
        return res.status(500).json({
          ok: false,
          error: 'Could not generate the feedback PDF. LibreOffice may not be available.'
        });
      }

      // 3. Merge: original submission + feedback pages.
      const mergedPdf = await mergePdfs([originalPdf, feedbackPdf]);

      // 4. Return as a downloadable file.
      const baseName = file.originalname.replace(/\.[^.]+$/, '');
      const downloadName = baseName + '-Marked.pdf';

      res.set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename="' + downloadName.replace(/"/g, '\\"') + '"',
        'Content-Length': mergedPdf.length
      });
      return res.send(mergedPdf);

    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[/api/generate-marked-pdf] error:', err);
      return res.status(500).json({
        ok: false,
        error: 'Failed to generate the marked PDF: ' + (err.message || 'unknown error')
      });
    }
  });
});

// ---------- Helpers ----------

/**
 * Convert an uploaded submission file into an array of Anthropic content
 * blocks based on its extension.
 *
 *   PDF        → document (base64)
 *   PNG / JPG  → image    (base64)
 *   DOC / DOCX → converted to PDF via LibreOffice, then sent as a
 *                 document block so Claude reads text AND embedded images.
 *                 Falls back to mammoth text-only extraction if
 *                 LibreOffice is not installed (local dev convenience).
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
    // Try LibreOffice conversion first (preserves images + formatting).
    // Fall back to mammoth text-only extraction if LO isn't available,
    // so local dev without LibreOffice still works.
    const pdfBuffer = convertDocxToPdf(file.buffer, file.originalname);

    if (pdfBuffer) {
      return [{
        type: 'document',
        source: {
          type: 'base64',
          media_type: 'application/pdf',
          data: pdfBuffer.toString('base64')
        },
        title: file.originalname + ' (converted to PDF)'
      }];
    }

    // eslint-disable-next-line no-console
    console.warn(
      '[buildSubmissionBlocks] LibreOffice not available — ' +
      'falling back to mammoth text extraction for ' + file.originalname
    );

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
      text: 'Learner submission (extracted text — images in the original document ' +
            'could not be included because LibreOffice is not installed on this ' +
            'server):\n\n' + text
    }];
  }

  // Should be unreachable thanks to upstream validation.
  throw new Error('Unsupported file extension: ' + ext);
}

/**
 * Convert a DOCX/DOC buffer to PDF using LibreOffice in headless mode.
 * Returns a Buffer containing the PDF, or null if LibreOffice is not
 * installed or the conversion fails.
 *
 * The function is synchronous (execFileSync) because the conversion is
 * fast for typical assignment-sized documents (<10s) and keeps the
 * calling code simple. A temp directory is used and cleaned up
 * regardless of outcome.
 */
function convertDocxToPdf(buffer, originalName) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docx-convert-'));
  const safeName = originalName.replace(/[^a-zA-Z0-9._-]/g, '_');
  const inputPath = path.join(tmpDir, safeName);

  try {
    fs.writeFileSync(inputPath, buffer);

    execFileSync('libreoffice', [
      '--headless',
      '--convert-to', 'pdf',
      '--outdir', tmpDir,
      inputPath
    ], {
      timeout: 30000,   // 30s safety cap
      stdio: 'pipe'     // don't leak LO output to stdout
    });

    // LibreOffice writes <name>.pdf alongside the input file.
    const pdfName = safeName.replace(/\.[^.]+$/, '.pdf');
    const pdfPath = path.join(tmpDir, pdfName);

    if (!fs.existsSync(pdfPath)) {
      return null;
    }

    return fs.readFileSync(pdfPath);
  } catch (err) {
    // LibreOffice not installed, or conversion failed.
    // eslint-disable-next-line no-console
    console.warn('[convertDocxToPdf]', err.message || err);
    return null;
  } finally {
    // Clean up the temp directory.
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) { /* ignore */ }
  }
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

/**
 * Wrap a raw image buffer in a minimal HTML page so LibreOffice can
 * convert it to a single-page PDF.
 */
function convertImageToPdf(buffer, originalName, ext) {
  var mime = ext === 'png' ? 'image/png' : 'image/jpeg';
  var b64  = buffer.toString('base64');
  var html =
    '<!DOCTYPE html><html><head><style>' +
    'body{margin:0;display:flex;justify-content:center;align-items:center;min-height:100vh;}' +
    'img{max-width:100%;max-height:100vh;}' +
    '</style></head><body>' +
    '<img src="data:' + mime + ';base64,' + b64 + '"/>' +
    '</body></html>';
  return convertHtmlToPdf(html, originalName + '.html');
}

/**
 * Convert an HTML string to PDF via LibreOffice headless.
 * Returns a Buffer, or null if LibreOffice is unavailable.
 */
function convertHtmlToPdf(html, tempName) {
  var tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'html2pdf-'));
  var safeName = (tempName || 'doc.html').replace(/[^a-zA-Z0-9._-]/g, '_');
  if (!safeName.endsWith('.html')) safeName += '.html';
  var inputPath = path.join(tmpDir, safeName);

  try {
    fs.writeFileSync(inputPath, html, 'utf8');

    execFileSync('libreoffice', [
      '--headless',
      '--convert-to', 'pdf',
      '--outdir', tmpDir,
      inputPath
    ], { timeout: 30000, stdio: 'pipe' });

    var pdfName = safeName.replace(/\.html$/, '.pdf');
    var pdfPath = path.join(tmpDir, pdfName);

    if (!fs.existsSync(pdfPath)) return null;
    return fs.readFileSync(pdfPath);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[convertHtmlToPdf]', err.message || err);
    return null;
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) { /* ignore */ }
  }
}

/**
 * Merge an array of PDF buffers into a single PDF using pdf-lib.
 */
async function mergePdfs(pdfBuffers) {
  var merged = await PDFDocument.create();
  for (var i = 0; i < pdfBuffers.length; i++) {
    var doc   = await PDFDocument.load(pdfBuffers[i]);
    var pages = await merged.copyPages(doc, doc.getPageIndices());
    pages.forEach(function (page) { merged.addPage(page); });
  }
  return Buffer.from(await merged.save());
}

/**
 * Build a complete HTML document containing the styled feedback,
 * completed rubric table, overall grade, and summary. Designed to
 * be converted to PDF by LibreOffice and appended after the original
 * submission.
 */
function buildFeedbackHtml(sheet, fileName, moduleKey) {
  var criteria = Array.isArray(sheet.criteria) ? sheet.criteria : [];
  var rubric   = Array.isArray(sheet.completed_rubric) ? sheet.completed_rubric : [];
  var summary  = sheet.summary || {};
  var moduleLabel = MODULE_FILES[moduleKey]
    ? moduleKey.replace('-', ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); })
    : (moduleKey || '');

  var esc = function (s) {
    return String(s || '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  };

  var html = '<!DOCTYPE html><html><head><meta charset="UTF-8"/>' +
    '<style>' +
    '@page { margin: 25mm 20mm; }' +
    'body { font-family: Arial, Helvetica, sans-serif; color: #2a2a2a; font-size: 11pt; line-height: 1.55; }' +
    'h1 { color: #1D253C; font-size: 16pt; border-bottom: 3px solid #E8303A; padding-bottom: 8px; margin-bottom: 4px; }' +
    '.meta { color: #AAAAAA; font-size: 9pt; margin-bottom: 24px; }' +
    'h2 { color: #1D253C; font-size: 13pt; margin-top: 28px; margin-bottom: 10px; }' +
    'h3 { color: #1D253C; font-size: 11pt; margin: 0 0 4px 0; }' +
    '.criterion { margin-bottom: 18px; border-left: 3px solid #E8303A; padding-left: 14px; }' +
    '.score { display: inline-block; background: #E8303A; color: #fff; padding: 2px 10px; font-weight: bold; font-size: 10pt; margin-bottom: 6px; }' +
    '.label { font-size: 8pt; font-weight: bold; text-transform: uppercase; letter-spacing: 0.08em; color: #AAAAAA; margin-top: 8px; margin-bottom: 2px; }' +
    'table { width: 100%; border-collapse: collapse; margin: 12px 0 24px 0; font-size: 10pt; }' +
    'th { background: #1D253C; color: #fff; padding: 7px 10px; text-align: left; font-size: 9pt; text-transform: uppercase; letter-spacing: 0.06em; }' +
    'td { padding: 7px 10px; border: 1px solid #d3d6de; vertical-align: top; }' +
    'tr:nth-child(even) { background: #f2f2f2; }' +
    '.awarded { color: #E8303A; font-weight: bold; text-align: center; }' +
    '.available { text-align: center; }' +
    '.overall { background: #f2f2f2; border-left: 4px solid #E8303A; padding: 16px 18px; margin-top: 28px; }' +
    '.grade { color: #E8303A; font-size: 18pt; font-weight: bold; margin: 4px 0 12px 0; }' +
    '.section-head { font-weight: bold; color: #1D253C; margin: 12px 0 4px 0; }' +
    '</style></head><body>';

  // Header
  html += '<h1>Assessment Feedback &mdash; 20/20 Project Management</h1>';
  html += '<p class="meta">' + esc(fileName) + ' &middot; ' + esc(moduleLabel) + '</p>';

  // Detailed criteria
  if (criteria.length > 0) {
    html += '<h2>Detailed Feedback</h2>';
    criteria.forEach(function (c, i) {
      var name          = (c && c.name)          ? String(c.name)          : ('Criterion ' + (i + 1));
      var score         = (c && c.score)         ? String(c.score)         : '';
      var justification = (c && c.justification) ? String(c.justification) : '';
      var feedback      = (c && c.feedback)      ? String(c.feedback)      : '';

      html += '<div class="criterion">';
      html += '<h3>' + esc(name) + '</h3>';
      if (score) html += '<span class="score">' + esc(score) + '</span>';
      if (justification) {
        html += '<p class="label">Justification</p>';
        html += '<p>' + esc(justification) + '</p>';
      }
      if (feedback) {
        html += '<p class="label">Feedback</p>';
        html += '<p>' + esc(feedback) + '</p>';
      }
      html += '</div>';
    });
  }

  // Completed rubric
  if (rubric.length > 0) {
    html += '<h2>Completed Marking Rubric</h2>';
    html += '<table><thead><tr>' +
      '<th>Criterion</th><th>Available</th><th>Awarded</th><th>Comments</th>' +
      '</tr></thead><tbody>';
    rubric.forEach(function (r) {
      var criterion = (r && r.criterion)       ? String(r.criterion)       : '';
      var available = (r && r.marks_available) ? String(r.marks_available) : '';
      var awarded   = (r && r.marks_awarded)   ? String(r.marks_awarded)   : '';
      var comments  = (r && r.comments)        ? String(r.comments)        : '';
      html += '<tr>' +
        '<td><strong>' + esc(criterion) + '</strong></td>' +
        '<td class="available">' + esc(available) + '</td>' +
        '<td class="awarded">' + esc(awarded) + '</td>' +
        '<td>' + esc(comments) + '</td>' +
        '</tr>';
    });
    html += '</tbody></table>';
  }

  // Overall grade + summary
  html += '<div class="overall">';
  html += '<p class="label">Overall Grade</p>';
  html += '<p class="grade">' + esc(sheet.overall_grade || '—') + '</p>';
  if (summary.strengths) {
    html += '<p class="section-head">Strengths</p>';
    html += '<p>' + esc(String(summary.strengths)) + '</p>';
  }
  if (summary.areas_for_improvement) {
    html += '<p class="section-head">Areas for Improvement</p>';
    html += '<p>' + esc(String(summary.areas_for_improvement)) + '</p>';
  }
  html += '</div>';

  html += '</body></html>';
  return html;
}

// ---------- Boot ----------
app.listen(PORT, function () {
  // eslint-disable-next-line no-console
  console.log(
    '20/20 PM AI Marking Companion server listening on http://localhost:' + PORT
  );
});
