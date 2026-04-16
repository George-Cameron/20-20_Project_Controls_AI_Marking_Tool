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
  const ACCEPTED_EXTENSIONS = ['pdf', 'doc', 'docx', 'jpg', 'jpeg', 'png'];
  const ACCEPTED_MIME_TYPES = [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'image/jpeg',
    'image/jpg',
    'image/png'
  ];
  const MAX_FILE_BYTES = 20 * 1024 * 1024; // 20MB

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

    // Some browsers leave MIME blank for .docx — accept if the extension is valid.
    if (!extOk && !mimeOk) {
      return 'Unsupported file type. Please upload a PDF, DOCX, JPG, or PNG file.';
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

    hideStep('step-module');
    clearModuleSelection();
    updateSubmitVisibility();
    resetOutputPlaceholder();
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
      renderPendingOutput();
      scrollToSection('marking-output');
    });
  }

  // =========================================================
  // OUTPUT PLACEHOLDER
  // =========================================================
  function renderPendingOutput() {
    const wrap = document.getElementById('marking-output');
    if (!wrap) return;

    const fileLine   = state.file
      ? escapeHtml(state.file.name) + ' (' + formatBytes(state.file.size) + ')'
      : '—';
    const moduleLine = escapeHtml(MODULE_LABELS[state.moduleKey] || state.moduleKey || '—');

    wrap.innerHTML =
      '<div class="output-placeholder">' +
        '<div class="output-placeholder-icon">' +
          '<i class="fa-solid fa-hourglass-half" aria-hidden="true"></i>' +
        '</div>' +
        '<h3 class="output-placeholder-heading">Submission received</h3>' +
        '<p class="output-placeholder-text">' +
          'The AI marking service is not yet connected. When it is, your mark ' +
          'sheet for the submission below will appear here.' +
        '</p>' +
        '<div class="panel panel-accent" ' +
             'style="text-align:left;max-width:560px;margin:20px auto 0 auto;">' +
          '<h4 class="panel-heading">' +
            '<i class="fa-solid fa-file-lines" aria-hidden="true"></i> Submission summary' +
          '</h4>' +
          '<ul class="panel-list">' +
            '<li><strong>File:</strong> ' + fileLine + '</li>' +
            '<li><strong>Module:</strong> ' + moduleLine + '</li>' +
          '</ul>' +
        '</div>' +
      '</div>';
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

  function iconForFile(file) {
    const ext = (file.name || '').split('.').pop().toLowerCase();
    if (ext === 'pdf') return 'fa-file-pdf';
    if (ext === 'doc' || ext === 'docx') return 'fa-file-word';
    if (ext === 'jpg' || ext === 'jpeg' || ext === 'png') return 'fa-file-image';
    return 'fa-file-lines';
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
