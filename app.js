/* =========================================================
   20/20 Project Management
   Project Controls AI Powered Marking Companion
   ---------------------------------------------------------
   Front-end scaffolding. AI integration is stubbed and will
   be wired up to the marking service in a later iteration.
   ========================================================= */

(function () {
  'use strict';

  // -------- Module / criteria definitions --------
  // The criteria files live in /criteria and will be loaded
  // server-side when the AI marking service is wired up.
  const MODULES = {
    'module-a': { label: 'Module A — Introduction to Project Controls', file: 'criteria/module-a.pdf' },
    'module-b': { label: 'Module B — Planning & Scheduling',            file: 'criteria/module-b.pdf' },
    'module-c': { label: 'Module C — Cost Management',                  file: 'criteria/module-c.pdf' },
    'module-d': { label: 'Module D — Risk Management',                  file: 'criteria/module-d.pdf' },
    'module-e': { label: 'Module E — Earned Value Management',          file: 'criteria/module-e.pdf' },
    'module-f': { label: 'Module F — Change & Configuration Control',   file: 'criteria/module-f.pdf' },
    'module-g': { label: 'Module G — Reporting & Analysis',             file: 'criteria/module-g.pdf' },
    'module-h': { label: 'Module H — Integrated Project Controls',      file: 'criteria/module-h.pdf' }
  };

  // -------- DOM ready --------
  document.addEventListener('DOMContentLoaded', init);

  function init() {
    setFooterYear();
    wireHeroButtons();
    wireMarkingForm();
    wireResultsButtons();
  }

  // -------- Footer year --------
  function setFooterYear() {
    const el = document.getElementById('footer-year');
    if (el) el.textContent = new Date().getFullYear();
  }

  // -------- Hero buttons --------
  function wireHeroButtons() {
    const startBtn = document.getElementById('start-marking-btn');
    const learnBtn = document.getElementById('learn-more-btn');

    if (startBtn) {
      startBtn.addEventListener('click', () => scrollToSection('marking-tool'));
    }
    if (learnBtn) {
      learnBtn.addEventListener('click', () => scrollToSection('how-it-works'));
    }
  }

  function scrollToSection(id) {
    const target = document.getElementById(id);
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // -------- Marking form --------
  function wireMarkingForm() {
    const form = document.getElementById('marking-form');
    if (!form) return;

    form.addEventListener('submit', function (event) {
      event.preventDefault();

      const learnerName = form.elements['learner-name'].value.trim();
      const moduleKey   = form.elements['module'].value;
      const fileInput   = form.elements['submission'];
      const notes       = form.elements['notes'].value.trim();

      if (!learnerName || !moduleKey || !fileInput.files.length) {
        // Minimal validation — the browser will also flag required fields.
        return;
      }

      const submission = {
        learnerName: learnerName,
        module: MODULES[moduleKey],
        fileName: fileInput.files[0].name,
        notes: notes
      };

      // Stubbed AI call — to be replaced with real endpoint.
      runMarkingStub(submission).then(renderResults);
    });
  }

  /**
   * Placeholder AI marking call. This will be replaced by a
   * request to the marking service which returns a structured
   * mark sheet generated from the selected module's criteria.
   */
  function runMarkingStub(submission) {
    const submitBtn = document.getElementById('submit-btn');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML =
        'Marking in progress <i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i>';
    }

    return new Promise((resolve) => {
      setTimeout(() => {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.innerHTML =
            'Mark my submission <i class="fa-solid fa-arrow-up-right" aria-hidden="true"></i>';
        }
        resolve({
          submission: submission,
          overallScore: 78,
          overallGrade: 'Merit',
          criteria: [
            { name: 'Criterion 1 — Knowledge & understanding', mark: '18 / 20',
              feedback: 'Strong grasp of the core concepts; add more reference to industry standards.' },
            { name: 'Criterion 2 — Application',               mark: '15 / 20',
              feedback: 'Good use of examples. Tie each example back to the specific learning outcome.' },
            { name: 'Criterion 3 — Analysis',                  mark: '16 / 20',
              feedback: 'Analysis is clear; strengthen it with supporting data where available.' },
            { name: 'Criterion 4 — Structure & presentation',  mark: '14 / 20',
              feedback: 'Cover page and numbering present. Check consistency of headings.' },
            { name: 'Criterion 5 — Reflection',                mark: '15 / 20',
              feedback: 'Reflection is honest and useful. Add one concrete next action.' }
          ]
        });
      }, 900);
    });
  }

  // -------- Render results --------
  function renderResults(result) {
    const section = document.getElementById('results-section');
    const card    = document.getElementById('results-card');
    if (!section || !card) return;

    const criteriaHtml = result.criteria.map(function (c) {
      return (
        '<li class="criteria-item">' +
          '<span class="criteria-name">' + escapeHtml(c.name) + '</span>' +
          '<span class="criteria-mark">' + escapeHtml(c.mark) + '</span>' +
          '<p class="criteria-feedback">' + escapeHtml(c.feedback) + '</p>' +
        '</li>'
      );
    }).join('');

    card.innerHTML =
      '<div class="results-summary">' +
        '<div>' +
          '<h3 style="margin:0 0 4px 0;">' + escapeHtml(result.submission.learnerName) + '</h3>' +
          '<p style="margin:0;color:var(--color-muted);">' + escapeHtml(result.submission.module.label) + '</p>' +
        '</div>' +
        '<div class="results-score">' +
          escapeHtml(String(result.overallScore)) + '%' +
          '<small>' + escapeHtml(result.overallGrade) + '</small>' +
        '</div>' +
      '</div>' +
      '<ul class="criteria-list">' + criteriaHtml + '</ul>';

    section.hidden = false;
    scrollToSection('results-section');
  }

  // -------- Results buttons --------
  function wireResultsButtons() {
    const newBtn      = document.getElementById('new-submission-btn');
    const downloadBtn = document.getElementById('download-results-btn');

    if (newBtn) {
      newBtn.addEventListener('click', function () {
        const form = document.getElementById('marking-form');
        if (form) form.reset();
        const section = document.getElementById('results-section');
        if (section) section.hidden = true;
        scrollToSection('marking-tool');
      });
    }

    if (downloadBtn) {
      downloadBtn.addEventListener('click', function () {
        // Placeholder — a real implementation will export a PDF mark sheet.
        window.print();
      });
    }
  }

  // -------- Utilities --------
  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

})();
