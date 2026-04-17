/* =========================================================
   20/20 Project Management
   Project Controls AI Powered Marking Companion
   ---------------------------------------------------------
   Front-end only. Handles file upload (drag/drop + click),
   file validation, module selection, and reveals the
   "Submit for Marking" button when both a file and a module
   have been chosen. No API call is made — the submit handler
   currently just renders a placeholder "pending" message.
   ========================================================= */

(function () {
  'use strict';

  // -------- Configuration --------
  const ACCEPTED_EXTENSIONS = ['pdf'];
  const ACCEPTED_MIME_TYPES = [
    'application/pdf'
  ];
  const MAX_FILE_BYTES  = 20 * 1024 * 1024;  // hard cap — reject above this
  const WARN_FILE_BYTES =  5 * 1024 * 1024;  // soft threshold — warn above this

  const MODULE_LABELS = {
    'module-a': 'Module A — Introduction to Project Controls',
    'module-b': 'Module B — Planning & Scheduling',
    'module-c': 'Module C — Cost Management',
    'module-d': 'Module D — Risk Management',
    'module-e': 'Module E — Earned Value Management',
    'module-f': 'Module F — Change & Configuration Control',
    'module-g': 'Module G — Reporting & Analysis',
    'module-h': 'Module H — Integrated Project Controls'
  };

  // -------- Shared state --------
  const state = {
    file: null,
    moduleKey: null
  };

  // -------- Init --------
  document.addEventListener('DOMContentLoaded', init);

  function init() {
    setFooterYear();
    wireHeroButtons();
    wireDropzone();
    wireModuleGrid();
    wireSubmitButton();
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
    if (startBtn) startBtn.addEventListener('click', () => scrollToSection('marking-tool'));
    if (learnBtn) learnBtn.addEventListener('click', () => scrollToSection('how-it-works'));
  }

  function scrollToSection(id) {
    const target = document.getElementById(id);
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // =========================================================
  // DROPZONE
  // =========================================================
  function wireDropzone() {
    const dropzone   = document.getElementById('dropzone');
    const fileInput  = document.getElementById('file-input');
    const removeBtn  = document.getElementById('file-remove-btn');
    if (!dropzone || !fileInput) return;

    // Click the zone (outside the input) also opens file picker
    dropzone.addEventListener('click', function (e) {
      if (e.target === fileInput) return;
      fileInput.click();
    });

    // Keyboard: Enter / Space triggers the picker
    dropzone.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        fileInput.click();
      }
    });

    // Native file input change
    fileInput.addEventListener('change', function (e) {
      const file = e.target.files && e.target.files[0];
      if (file) handleFile(file);
    });

    // Drag & drop events
    ['dragenter', 'dragover'].forEach(function (evt) {
      dropzone.addEventListener(evt, function (e) {
        e.preventDefault();
        e.stopPropagation();
        dropzone.classList.add('is-dragover');
      });
    });

    ['dragleave', 'dragend', 'drop'].forEach(function (evt) {
      dropzone.addEventListener(evt, function (e) {
        e.preventDefault();
        e.stopPropagation();
        dropzone.classList.remove('is-dragover');
      });
    });

    dropzone.addEventListener('drop', function (e) {
      const files = e.dataTransfer && e.dataTransfer.files;
      if (files && files.length) handleFile(files[0]);
    });

    // Block the browser from opening the file if dropped outside the zone
    ['dragover', 'drop'].forEach(function (evt) {
      window.addEventListener(evt, function (e) {
        if (!dropzone.contains(e.target)) {
          e.preventDefault();
        }
      });
    });

    // Remove selected file
    if (removeBtn) {
      removeBtn.addEventListener('click', function () {
        clearFile();
      });
    }
  }

  function handleFile(file) {
    const error = validateFile(file);
    if (error) {
      showDropzoneError(error);
      clearFile(/*keepError*/ true);
      return;
    }

    hideDropzoneError();
    state.file = file;
    renderFilePreview(file);
    showSizeWarning(file);
    showStep('step-module');
    updateSubmitVisibility();
  }

  function validateFile(file) {
    if (!file) return 'No file selected.';

    const name = file.name || '';
    const ext  = name.split('.').pop().toLowerCase();
    const mime = (file.type || '').toLowerCase();

    const extOk  = ACCEPTED_EXTENSIONS.indexOf(ext) !== -1;
    const mimeOk = ACCEPTED_MIME_TYPES.indexOf(mime) !== -1;

    // Some browsers leave MIME blank — accept if the extension is valid.
    if (!extOk && !mimeOk) {
      return 'Unsupported file type. Please upload a PDF file.';
    }
    if (file.size > MAX_FILE_BYTES) {
      return 'File is too large. The maximum size is 20MB.';
    }
    return null;
  }

  function renderFilePreview(file) {
    const preview = document.getElementById('file-preview');
    const nameEl  = document.getElementById('file-preview-name');
    const sizeEl  = document.getElementById('file-preview-size');
    const iconEl  = document.querySelector('#file-preview .file-preview-icon i');
    const dropzone = document.getElementById('dropzone');
    if (!preview || !nameEl || !sizeEl) return;

    nameEl.textContent = file.name;
    sizeEl.textContent = formatBytes(file.size) + ' · ' + (file.type || fileTypeFromName(file.name));

    if (iconEl) {
      iconEl.className = 'fa-solid ' + iconForFile(file);
    }

    preview.hidden = false;
    if (dropzone) dropzone.style.display = 'none';
  }

  function clearFile(keepError) {
    state.file = null;
    const fileInput = document.getElementById('file-input');
    const preview   = document.getElementById('file-preview');
    const dropzone  = document.getElementById('dropzone');

    if (fileInput) fileInput.value = '';
    if (preview)   preview.hidden = true;
    if (dropzone)  dropzone.style.display = '';

    if (!keepError) hideDropzoneError();

    hideSizeWarning();

    hideStep('step-module');
    clearModuleSelection();
    updateSubmitVisibility();
    resetOutputPlaceholder();
  }

  // ---- Size warning (>5MB soft cap) ----
  function showSizeWarning(file) {
    const el = document.getElementById('file-warning');
    if (!el) return;
    if (file.size > WARN_FILE_BYTES) {
      el.hidden = false;
    } else {
      el.hidden = true;
    }
  }
  function hideSizeWarning() {
    const el = document.getElementById('file-warning');
    if (el) el.hidden = true;
  }

  function showDropzoneError(message) {
    const el = document.getElementById('dropzone-error');
    if (!el) return;
    el.textContent = message;
    el.hidden = false;
  }

  function hideDropzoneError() {
    const el = document.getElementById('dropzone-error');
    if (!el) return;
    el.textContent = '';
    el.hidden = true;
  }

  // =========================================================
  // MODULE SELECTION
  // =========================================================
  function wireModuleGrid() {
    const grid = document.getElementById('module-grid');
    if (!grid) return;

    grid.addEventListener('click', function (e) {
      const card = e.target.closest('.module-card');
      if (!card) return;
      selectModule(card);
    });

    grid.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const card = e.target.closest('.module-card');
      if (!card) return;
      e.preventDefault();
      selectModule(card);
    });
  }

  function selectModule(card) {
    const grid = document.getElementById('module-grid');
    if (!grid) return;

    grid.querySelectorAll('.module-card').forEach(function (c) {
      c.classList.remove('is-selected');
      c.setAttribute('aria-checked', 'false');
    });

    card.classList.add('is-selected');
    card.setAttribute('aria-checked', 'true');
    state.moduleKey = card.getAttribute('data-module');

    updateSubmitVisibility();
  }

  function clearModuleSelection() {
    state.moduleKey = null;
    const grid = document.getElementById('module-grid');
    if (!grid) return;
    grid.querySelectorAll('.module-card').forEach(function (c) {
      c.classList.remove('is-selected');
      c.setAttribute('aria-checked', 'false');
    });
  }

  // =========================================================
  // SUBMIT BUTTON REVEAL
  // =========================================================
  function updateSubmitVisibility() {
    const step = document.getElementById('step-submit');
    if (!step) return;
    step.hidden = !(state.file && state.moduleKey);
  }

  function wireSubmitButton() {
    const btn = document.getElementById('submit-marking-btn');
    if (!btn) return;

    btn.addEventListener('click', function () {
      if (!state.file || !state.moduleKey) return;
      submitForMarking();
    });
  }

  /**
   * Send the file + module to /api/mark, render loading / result / error.
   * No retry — the server is in charge of upstream retries. The "Try Again"
   * button in the error panel re-invokes this function.
   */
  async function submitForMarking() {
    // -- Defensive validation --
    // The submit button is hidden until file+module are set, but if it's
    // ever called without both (keyboard trigger, race condition, etc.)
    // surface a clear, red, accessible error rather than silently failing.
    if (!state.file) {
      renderErrorOutput(
        'No file has been uploaded. Please upload your submission before clicking Submit for Marking.',
        /*retryable*/ false
      );
      scrollToSection('marking-output');
      return;
    }
    if (!state.moduleKey) {
      renderErrorOutput(
        'No module has been selected. Please choose a module before clicking Submit for Marking.',
        /*retryable*/ false
      );
      scrollToSection('marking-output');
      return;
    }

    // -- Soft-cap confirmation for files >5MB --
    if (state.file.size > WARN_FILE_BYTES) {
      const ok = window.confirm(
        'This file is ' + formatBytes(state.file.size) + ', which is larger than ' +
        'the recommended 5MB. Marking may take noticeably longer and will use ' +
        'more API tokens.\n\nDo you want to continue?'
      );
      if (!ok) return;
    }

    const btn = document.getElementById('submit-marking-btn');

    renderLoadingOutput();
    scrollToSection('marking-output');

    if (btn) {
      btn.disabled = true;
      btn.innerHTML =
        'Marking in progress <i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i>';
    }

    try {
      const formData = new FormData();
      formData.append('file', state.file);
      formData.append('module', state.moduleKey);

      const response = await fetch('/api/mark', {
        method: 'POST',
        body: formData
      });

      let payload;
      try {
        payload = await response.json();
      } catch (parseErr) {
        throw new Error('The server returned an unreadable response.');
      }

      if (!response.ok || !payload.ok) {
        throw new Error(payload && payload.error
          ? payload.error
          : 'The marking service returned an error (HTTP ' + response.status + ').');
      }

      renderResultOutput(payload);
    } catch (err) {
      renderErrorOutput(
        err && err.message ? err.message : String(err),
        /*retryable*/ true
      );
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML =
          'Submit for Marking <i class="fa-solid fa-arrow-up-right" aria-hidden="true"></i>';
      }
    }
  }

  // =========================================================
  // OUTPUT — LOADING / RESULT / ERROR
  // =========================================================
  function renderLoadingOutput() {
    const wrap = document.getElementById('marking-output');
    if (!wrap) return;

    const fileLine   = state.file
      ? escapeHtml(state.file.name) + ' (' + formatBytes(state.file.size) + ')'
      : '—';
    const moduleLine = escapeHtml(MODULE_LABELS[state.moduleKey] || state.moduleKey || '—');

    wrap.innerHTML =
      '<div class="output-loading" role="status" aria-live="polite">' +
        '<div class="spinner" aria-hidden="true"></div>' +
        '<h3 class="output-loading-heading">Marking your submission&hellip;</h3>' +
        '<p class="output-loading-text">' +
          'Reviewing <strong>' + fileLine + '</strong> against ' + moduleLine + '. ' +
          'This usually takes 20–60 seconds.' +
        '</p>' +
      '</div>';
  }

  function renderResultOutput(payload) {
    const wrap = document.getElementById('marking-output');
    if (!wrap) return;

    const sheet      = payload && payload.mark_sheet;
    const rawText    = payload && payload.raw_text;
    const fileName   = state.file ? state.file.name : '—';
    const moduleName = MODULE_LABELS[state.moduleKey] || state.moduleKey || '—';

    const headerHtml =
      '<header class="result-header">' +
        '<h3 class="output-result-heading">' +
          '<i class="fa-solid fa-clipboard-check" aria-hidden="true"></i> ' +
          'AI Mark Sheet' +
        '</h3>' +
        '<dl class="result-meta-grid">' +
          '<dt>Submission</dt><dd>' + escapeHtml(fileName) + '</dd>' +
          '<dt>Module</dt><dd>' + escapeHtml(moduleName) + '</dd>' +
          '<dt>Generated</dt><dd>' + escapeHtml(formatDateTime(new Date())) + '</dd>' +
        '</dl>' +
      '</header>';

    const bodyHtml = sheet
      ? renderStructuredMarkSheet(sheet)
      : renderRawMarkSheet(rawText);

    const actionsHtml =
      '<div class="results-actions" role="group" aria-label="Mark sheet actions">' +
        '<button type="button" class="btn btn-marking" data-action="download-marked-pdf">' +
          '<i class="fa-solid fa-file-arrow-down" aria-hidden="true"></i> Download Marked PDF' +
        '</button>' +
        '<button type="button" class="btn btn-outline-dark" data-action="copy-output">' +
          '<i class="fa-solid fa-copy" aria-hidden="true"></i> Copy Output' +
        '</button>' +
        '<button type="button" class="btn btn-outline-dark" data-action="new-submission">' +
          '<i class="fa-solid fa-rotate-left" aria-hidden="true"></i> Mark Another Submission' +
        '</button>' +
        '<button type="button" class="btn btn-outline-dark" data-action="print-output">' +
          '<i class="fa-solid fa-print" aria-hidden="true"></i> Print' +
        '</button>' +
      '</div>';

    wrap.innerHTML =
      '<div class="output-result">' +
        headerHtml +
        bodyHtml +
        actionsHtml +
      '</div>';

    // Cache the data the action handlers need.
    wrap._lastResult = {
      sheet: sheet || null,
      rawText: rawText || '',
      fileName: fileName,
      moduleName: moduleName,
      generatedAt: formatDateTime(new Date())
    };

    wireResultActions(wrap);
  }

  function renderStructuredMarkSheet(sheet) {
    const criteria = Array.isArray(sheet.criteria) ? sheet.criteria : [];
    const summary  = sheet.summary || {};

    const cardsHtml =
      '<section class="criteria-grid" aria-label="Criteria assessment">' +
        criteria.map(function (c, i) {
          const name          = c && c.name          ? String(c.name)          : ('Criterion ' + (i + 1));
          const score         = c && c.score         ? String(c.score)         : '—';
          const justification = c && c.justification ? String(c.justification) : '';
          const feedback      = c && c.feedback      ? String(c.feedback)      : '';

          return (
            '<article class="criterion-card">' +
              '<header class="criterion-card-head">' +
                '<h4 class="criterion-card-name">' + escapeHtml(name) + '</h4>' +
                '<span class="criterion-card-score">' + escapeHtml(score) + '</span>' +
              '</header>' +
              (justification
                ? '<div class="criterion-card-section">' +
                    '<span class="criterion-card-label">Justification</span>' +
                    '<p>' + escapeHtml(justification) + '</p>' +
                  '</div>'
                : '') +
              (feedback
                ? '<div class="criterion-card-section">' +
                    '<span class="criterion-card-label">Feedback</span>' +
                    '<p>' + escapeHtml(feedback) + '</p>' +
                  '</div>'
                : '') +
            '</article>'
          );
        }).join('') +
      '</section>';

    const overallHtml =
      '<section class="overall-box" aria-label="Overall grade">' +
        '<div class="overall-box-grade">' +
          '<span class="overall-box-label">Overall Grade</span>' +
          '<span class="overall-box-value">' +
            escapeHtml(sheet.overall_grade ? String(sheet.overall_grade) : '—') +
          '</span>' +
        '</div>' +
        (summary.strengths
          ? '<div class="overall-box-section">' +
              '<h4>Strengths</h4>' +
              '<p>' + escapeHtml(String(summary.strengths)) + '</p>' +
            '</div>'
          : '') +
        (summary.areas_for_improvement
          ? '<div class="overall-box-section">' +
              '<h4>Areas for improvement</h4>' +
              '<p>' + escapeHtml(String(summary.areas_for_improvement)) + '</p>' +
            '</div>'
          : '') +
      '</section>';

    const rubric = Array.isArray(sheet.completed_rubric) ? sheet.completed_rubric : [];
    var rubricHtml = '';
    if (rubric.length > 0) {
      rubricHtml =
        '<section class="rubric-section" aria-label="Completed marking rubric">' +
          '<h4 class="rubric-heading">' +
            '<i class="fa-solid fa-table-list" aria-hidden="true"></i> ' +
            'Completed Marking Rubric' +
          '</h4>' +
          '<div class="rubric-table-wrap">' +
            '<table class="rubric-table">' +
              '<thead>' +
                '<tr>' +
                  '<th>Criterion</th>' +
                  '<th>Available</th>' +
                  '<th>Awarded</th>' +
                  '<th>Comments</th>' +
                '</tr>' +
              '</thead>' +
              '<tbody>' +
                rubric.map(function (r) {
                  var criterion = r && r.criterion ? String(r.criterion) : '—';
                  var available = r && r.marks_available ? String(r.marks_available) : '—';
                  var awarded   = r && r.marks_awarded   ? String(r.marks_awarded)   : '—';
                  var comments  = r && r.comments        ? String(r.comments)        : '';
                  return (
                    '<tr>' +
                      '<td class="rubric-criterion">' + escapeHtml(criterion) + '</td>' +
                      '<td class="rubric-marks">' + escapeHtml(available) + '</td>' +
                      '<td class="rubric-marks rubric-awarded">' + escapeHtml(awarded) + '</td>' +
                      '<td>' + escapeHtml(comments) + '</td>' +
                    '</tr>'
                  );
                }).join('') +
              '</tbody>' +
            '</table>' +
          '</div>' +
        '</section>';
    }

    return cardsHtml + rubricHtml + overallHtml;
  }

  function renderRawMarkSheet(text) {
    // Fallback path when the model didn't return parseable JSON.
    return (
      '<div class="result-fallback-notice">' +
        '<i class="fa-solid fa-circle-info" aria-hidden="true"></i> ' +
        'The marker returned an unstructured response, shown below as plain text.' +
      '</div>' +
      '<pre class="output-result-body">' +
        escapeHtml(text || '(No content returned.)') +
      '</pre>'
    );
  }

  // -------- Result action handlers --------
  function wireResultActions(wrap) {
    const buttons = wrap.querySelectorAll('[data-action]');
    buttons.forEach(function (btn) {
      btn.addEventListener('click', function () {
        const action = btn.getAttribute('data-action');
        if (action === 'download-marked-pdf') handleDownloadMarkedPdf(btn);
        else if (action === 'copy-output')      handleCopyOutput(btn);
        else if (action === 'new-submission')    handleNewSubmission();
        else if (action === 'print-output')      window.print();
      });
    });
  }

  async function handleDownloadMarkedPdf(button) {
    const wrap = document.getElementById('marking-output');
    const data = wrap && wrap._lastResult;
    if (!data || !state.file) return;

    var original = button.innerHTML;
    button.innerHTML =
      '<i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i> Generating PDF&hellip;';
    button.disabled = true;

    try {
      var fd = new FormData();
      fd.append('file', state.file);
      fd.append('module', state.moduleKey || '');
      fd.append('mark_sheet', JSON.stringify(data.sheet || {}));

      var response = await fetch('/api/generate-marked-pdf', {
        method: 'POST',
        body: fd
      });

      if (!response.ok) {
        var errBody;
        try { errBody = await response.json(); } catch (_) { /* ignore */ }
        throw new Error(
          errBody && errBody.error
            ? errBody.error
            : 'Server returned HTTP ' + response.status
        );
      }

      var blob = await response.blob();
      var baseName = state.file.name.replace(/\.[^.]+$/, '');
      var downloadName = baseName + '-Marked.pdf';

      var url = URL.createObjectURL(blob);
      var a   = document.createElement('a');
      a.href = url;
      a.download = downloadName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      button.innerHTML = '<i class="fa-solid fa-check" aria-hidden="true"></i> Downloaded';
      setTimeout(function () {
        button.innerHTML = original;
        button.disabled = false;
      }, 2000);
    } catch (err) {
      button.innerHTML = original;
      button.disabled = false;
      alert('Could not generate the marked PDF:\n\n' + (err.message || String(err)));
    }
  }

  function handleCopyOutput(button) {
    const wrap = document.getElementById('marking-output');
    const data = wrap && wrap._lastResult;
    if (!data) return;

    const text = data.sheet
      ? markSheetToPlainText(data.sheet, data.fileName, data.moduleName, data.generatedAt)
      : data.rawText;

    function flash(label) {
      const original = button.innerHTML;
      button.innerHTML = '<i class="fa-solid fa-check" aria-hidden="true"></i> ' + label;
      button.disabled = true;
      setTimeout(function () {
        button.innerHTML = original;
        button.disabled = false;
      }, 1600);
    }

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        function () { flash('Copied'); },
        function () { fallbackCopy(text); flash('Copied'); }
      );
    } else {
      fallbackCopy(text);
      flash('Copied');
    }
  }

  function fallbackCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (_) { /* ignore */ }
    document.body.removeChild(ta);
  }

  function handleNewSubmission() {
    clearFile();                       // resets file, module, output
    scrollToSection('marking-tool');
  }

  function markSheetToPlainText(sheet, fileName, moduleName, generatedAt) {
    const lines = [];
    lines.push('20/20 PROJECT MANAGEMENT — AI MARK SHEET');
    lines.push('Submission: ' + fileName);
    lines.push('Module:     ' + moduleName);
    lines.push('Generated:  ' + generatedAt);
    lines.push('');
    lines.push('CRITERIA');
    lines.push('--------');

    const criteria = Array.isArray(sheet.criteria) ? sheet.criteria : [];
    criteria.forEach(function (c, i) {
      const name  = (c && c.name)  ? String(c.name)  : ('Criterion ' + (i + 1));
      const score = (c && c.score) ? String(c.score) : '—';
      lines.push('');
      lines.push((i + 1) + '. ' + name + '  —  ' + score);
      if (c && c.justification) lines.push('   Justification: ' + String(c.justification));
      if (c && c.feedback)      lines.push('   Feedback:      ' + String(c.feedback));
    });

    const rubric = Array.isArray(sheet.completed_rubric) ? sheet.completed_rubric : [];
    if (rubric.length > 0) {
      lines.push('');
      lines.push('MARKING RUBRIC');
      lines.push('--------------');
      rubric.forEach(function (r) {
        var criterion = (r && r.criterion) ? String(r.criterion) : '—';
        var available = (r && r.marks_available) ? String(r.marks_available) : '—';
        var awarded   = (r && r.marks_awarded)   ? String(r.marks_awarded)   : '—';
        var comments  = (r && r.comments)        ? String(r.comments)        : '';
        lines.push('');
        lines.push(criterion);
        lines.push('  Marks: ' + awarded + ' / ' + available);
        if (comments) lines.push('  Comment: ' + comments);
      });
    }

    lines.push('');
    lines.push('OVERALL GRADE: ' + (sheet.overall_grade ? String(sheet.overall_grade) : '—'));
    lines.push('');

    const summary = sheet.summary || {};
    if (summary.strengths) {
      lines.push('Strengths:');
      lines.push(String(summary.strengths));
      lines.push('');
    }
    if (summary.areas_for_improvement) {
      lines.push('Areas for improvement:');
      lines.push(String(summary.areas_for_improvement));
      lines.push('');
    }
    return lines.join('\n');
  }

  function formatDateTime(d) {
    const pad = function (n) { return n < 10 ? '0' + n : String(n); };
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
           ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function renderErrorOutput(message, retryable) {
    const wrap = document.getElementById('marking-output');
    if (!wrap) return;

    // Only show "Try Again" when the failure could plausibly succeed on
    // retry (e.g. API / network error). For input-validation errors
    // (missing file, missing module) it makes no sense — the user needs
    // to go back and fix the input.
    const actions = retryable
      ? '<div class="results-actions" role="group" aria-label="Error actions">' +
          '<button type="button" class="btn btn-marking" data-action="retry-submit">' +
            '<i class="fa-solid fa-rotate-right" aria-hidden="true"></i> Try Again' +
          '</button>' +
          '<button type="button" class="btn btn-outline-dark" data-action="new-submission">' +
            '<i class="fa-solid fa-arrow-left" aria-hidden="true"></i> Back to upload' +
          '</button>' +
        '</div>'
      : '<div class="results-actions" role="group" aria-label="Error actions">' +
          '<button type="button" class="btn btn-marking" data-action="new-submission">' +
            '<i class="fa-solid fa-arrow-left" aria-hidden="true"></i> Back to upload' +
          '</button>' +
        '</div>';

    wrap.innerHTML =
      '<div class="output-error" role="alert">' +
        '<h3 class="output-error-heading">' +
          '<i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i> ' +
          (retryable ? 'Marking failed' : 'Cannot submit') +
        '</h3>' +
        '<p style="margin:0 0 12px 0;">' + escapeHtml(message) + '</p>' +
        actions +
      '</div>';

    wireErrorActions(wrap);
  }

  function wireErrorActions(wrap) {
    wrap.querySelectorAll('[data-action]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const action = btn.getAttribute('data-action');
        if (action === 'retry-submit')      submitForMarking();
        else if (action === 'new-submission') handleNewSubmission();
      });
    });
  }

  function resetOutputPlaceholder() {
    const wrap = document.getElementById('marking-output');
    if (!wrap) return;
    wrap.innerHTML =
      '<div class="output-placeholder" id="output-placeholder">' +
        '<div class="output-placeholder-icon">' +
          '<i class="fa-regular fa-file-lines" aria-hidden="true"></i>' +
        '</div>' +
        '<h3 class="output-placeholder-heading">Your AI-generated mark sheet will appear here</h3>' +
        '<p class="output-placeholder-text">' +
          'Once you submit your work, the Project Controls AI Marking Companion will review it ' +
          'against the official module criteria and return your structured feedback in this panel.' +
        '</p>' +
      '</div>';
  }

  // =========================================================
  // Helpers
  // =========================================================
  function showStep(id) {
    const el = document.getElementById(id);
    if (el) el.hidden = false;
  }
  function hideStep(id) {
    const el = document.getElementById(id);
    if (el) el.hidden = true;
  }

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes)) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  }

  function iconForFile() {
    return 'fa-file-pdf';
  }

  function fileTypeFromName(name) {
    const ext = (name || '').split('.').pop().toUpperCase();
    return ext || 'FILE';
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

})();
