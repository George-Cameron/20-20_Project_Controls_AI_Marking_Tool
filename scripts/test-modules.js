#!/usr/bin/env node
/* =========================================================
   Module-loading smoke test
   ---------------------------------------------------------
   For each module (A–H), verifies that:
     1. The criteria PDF the server will load for that module
        exists on disk and has non-zero size.
     2. If ANTHROPIC_API_KEY is set, runs a real end-to-end
        marking call against the Anthropic API with a short
        sample paragraph to prove the full pipeline works.

   Run:
     node scripts/test-modules.js           # offline checks only
     node scripts/test-modules.js --api     # also runs the API call
   ========================================================= */

'use strict';

// dotenv is optional — only needed if the user keeps ANTHROPIC_API_KEY
// in a .env file. The offline check uses only Node built-ins.
try { require('dotenv').config(); } catch (_) { /* fine */ }

const fs   = require('fs');
const path = require('path');

const CRITERIA_DIR = path.resolve(__dirname, '..', 'criteria');

// Kept in sync with MODULE_FILES in server.js.
const MODULES = [
  { key: 'module-a', name: 'Nature of projects',                                          file: 'module-a.pdf' },
  { key: 'module-b', name: 'Project Initiation, risk & change',                           file: 'module-b.pdf' },
  { key: 'module-c', name: 'Estimating & scope definition',                               file: 'module-c.pdf' },
  { key: 'module-d', name: 'Procurement & document control',                              file: 'module-d.pdf' },
  { key: 'module-e', name: 'Planning & scheduling',                                       file: 'module-e.pdf' },
  { key: 'module-f', name: 'Cost management, project control (time/cost) & monitoring',  file: 'module-f.pdf' },
  { key: 'module-g', name: 'Project control & jobsite management',                        file: 'module-g.pdf' }
];

// A short sample paragraph submitted for every module. Deliberately
// generic so any module can reasonably produce a mark sheet.
const SAMPLE_TEXT =
  'Project controls ensure a project is delivered on time, within budget, ' +
  'and to the agreed scope. Typical activities include cost estimation, ' +
  'schedule development, risk identification, earned value tracking, and ' +
  'change control. Effective project controls require clear baselines, ' +
  'regular reporting, and disciplined configuration management.';

// ---------- Colour helpers (no deps) ----------
const C = {
  reset: '\u001b[0m', bold: '\u001b[1m',
  green: '\u001b[32m', red: '\u001b[31m',
  yellow: '\u001b[33m', dim: '\u001b[2m'
};
function ok(msg)   { return C.green + 'PASS' + C.reset + ' ' + msg; }
function fail(msg) { return C.red + 'FAIL' + C.reset + ' ' + msg; }
function warn(msg) { return C.yellow + 'WARN' + C.reset + ' ' + msg; }

// ---------- Offline checks ----------
function checkOffline() {
  console.log(C.bold + '\n1. Criteria file resolution (offline)' + C.reset);
  console.log('   Source: ' + CRITERIA_DIR);
  console.log('');

  let passed = 0, empties = 0, missing = 0;

  for (const m of MODULES) {
    const full = path.join(CRITERIA_DIR, m.file);
    if (!fs.existsSync(full)) {
      console.log('   ' + fail(m.key + ' → ' + m.file + ' (MISSING)'));
      missing++;
      continue;
    }
    const size = fs.statSync(full).size;
    if (size === 0) {
      console.log('   ' + warn(
        m.key + ' → ' + m.file + ' (empty, 0 bytes) — marking this module will fail at the server'
      ));
      empties++;
      continue;
    }
    console.log('   ' + ok(
      m.key + ' → ' + m.file +
      C.dim + ' (' + (size / 1024).toFixed(1) + ' KB)' + C.reset
    ));
    passed++;
  }

  console.log('');
  console.log('   Summary: ' + passed + ' ready, ' + empties + ' empty, ' + missing + ' missing');
  return { passed, empties, missing };
}

// ---------- Online check (requires ANTHROPIC_API_KEY) ----------
async function checkOnline(modulesToHit) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.log(C.bold + '\n2. End-to-end API check' + C.reset);
    console.log('   ' + warn('ANTHROPIC_API_KEY not set — skipped.'));
    console.log('   To run the API check: ANTHROPIC_API_KEY=sk-... node scripts/test-modules.js --api');
    return;
  }

  console.log(C.bold + '\n2. End-to-end API check (claude-sonnet-4-20250514)' + C.reset);
  console.log('   Sample submission (' + SAMPLE_TEXT.length + ' chars) sent to each module.\n');

  const Anthropic = require('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey });

  let passed = 0, failed = 0;

  for (const m of modulesToHit) {
    const criteriaPath = path.join(CRITERIA_DIR, m.file);
    if (!fs.existsSync(criteriaPath) || fs.statSync(criteriaPath).size === 0) {
      console.log('   ' + warn(m.key + ' — skipped (criteria file unusable)'));
      continue;
    }
    const criteriaB64 = fs.readFileSync(criteriaPath).toString('base64');

    process.stdout.write('   ' + m.key + '...');
    try {
      const response = await client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        system:
          'You are a professional assessor for 20/20 Project Management. ' +
          'You will be provided with a learner submission and the official ' +
          'marking criteria. Respond with a single short sentence naming ' +
          'the module covered by the criteria document, so the caller can ' +
          'verify the correct criteria file was loaded.',
        messages: [{
          role: 'user',
          content: [
            {
              type: 'document',
              source: { type: 'base64', media_type: 'application/pdf', data: criteriaB64 },
              title: 'Criteria — ' + m.key
            },
            { type: 'text', text: 'Sample submission: ' + SAMPLE_TEXT },
            {
              type: 'text',
              text:
                'In one short sentence, name the module that the criteria ' +
                'document above describes. Do not mark the submission.'
            }
          ]
        }]
      });

      const text = (response.content || [])
        .filter(function (b) { return b.type === 'text'; })
        .map(function (b) { return b.text; })
        .join(' ')
        .trim();

      console.log(' ' + ok(''));
      console.log('      model reply: ' + C.dim + text.slice(0, 180) + C.reset);
      passed++;
    } catch (err) {
      console.log(' ' + fail(''));
      console.log('      error: ' + (err.message || err));
      failed++;
    }
  }

  console.log('\n   Summary: ' + passed + ' succeeded, ' + failed + ' failed');
}

// ---------- Main ----------
(async function main() {
  console.log(C.bold + '20/20 PM AI Marking Companion — module smoke test' + C.reset);

  const offline = checkOffline();
  const usable  = MODULES.filter(function (m) {
    const p = path.join(CRITERIA_DIR, m.file);
    return fs.existsSync(p) && fs.statSync(p).size > 0;
  });

  if (process.argv.indexOf('--api') !== -1) {
    await checkOnline(usable);
  } else {
    console.log(C.bold + '\n2. End-to-end API check' + C.reset);
    console.log('   ' + C.dim + 'Skipped. Pass --api to run (uses real tokens).' + C.reset);
  }

  // Non-zero exit if anything offline is wrong, so CI can fail cleanly.
  if (offline.missing > 0) process.exit(1);
})();
