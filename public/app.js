'use strict';

(() => {
  const SUPPORTED_EXT = ['docx', 'xlsx', 'xls', 'csv', 'pptx', 'ppt', 'doc', 'pdf', 'txt'];
  const MAX_MB = 25;

  const screens = {
    upload: document.getElementById('screen-upload'),
    processing: document.getElementById('screen-processing'),
    done: document.getElementById('screen-done'),
    error: document.getElementById('screen-error'),
  };

  const dropzone = document.getElementById('dropzone');
  const fileInput = document.getElementById('fileInput');
  const fileChip = document.getElementById('fileChip');
  const fileChipIcon = document.getElementById('fileChipIcon');
  const fileChipName = document.getElementById('fileChipName');
  const fileChipSize = document.getElementById('fileChipSize');
  const fileChipRemove = document.getElementById('fileChipRemove');
  const instructionBox = document.getElementById('instructionBox');
  const instructionInput = document.getElementById('instructionInput');
  const processBtn = document.getElementById('processBtn');
  const aiWarning = document.getElementById('aiWarning');

  const processingTitle = document.getElementById('processingTitle');
  const processingSteps = document.getElementById('processingSteps');

  const doneSummary = document.getElementById('doneSummary');
  const dlDocx = document.getElementById('dlDocx');
  const dlPptx = document.getElementById('dlPptx');
  const dlXlsx = document.getElementById('dlXlsx');
  const startOverBtn = document.getElementById('startOverBtn');

  const errorMessage = document.getElementById('errorMessage');
  const errorRetryBtn = document.getElementById('errorRetryBtn');

  let selectedFile = null;

  function showScreen(name) {
    Object.entries(screens).forEach(([key, el]) => {
      el.classList.toggle('screen-active', key === name);
    });
  }

  function extOf(filename) {
    return (filename || '').split('.').pop().toLowerCase();
  }

  function formatSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function extLabel(ext) {
    return { docx: 'DOCX', xlsx: 'XLSX', xls: 'XLS', csv: 'CSV', pptx: 'PPTX', ppt: 'PPT', doc: 'DOC', pdf: 'PDF', txt: 'TXT' }[ext] || ext.toUpperCase();
  }

  function selectFile(file) {
    const ext = extOf(file.name);
    if (!SUPPORTED_EXT.includes(ext)) {
      alert(`".${ext}" is not supported. Please use: ${SUPPORTED_EXT.map(e => '.' + e).join(', ')}`);
      return;
    }
    if (file.size > MAX_MB * 1024 * 1024) {
      alert(`File is too large (${formatSize(file.size)}). Max is ${MAX_MB}MB.`);
      return;
    }
    selectedFile = file;
    fileChipIcon.textContent = extLabel(ext);
    fileChipName.textContent = file.name;
    fileChipSize.textContent = formatSize(file.size);
    fileChip.classList.remove('hidden');
    dropzone.classList.add('hidden');
    instructionBox.classList.remove('hidden');
    processBtn.classList.remove('hidden');
    processBtn.disabled = false;
  }

  function clearSelectedFile() {
    selectedFile = null;
    fileInput.value = '';
    fileChip.classList.add('hidden');
    dropzone.classList.remove('hidden');
    instructionBox.classList.add('hidden');
    processBtn.classList.add('hidden');
    processBtn.disabled = true;
  }

  dropzone.addEventListener('click', () => fileInput.click());
  dropzone.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') fileInput.click(); });
  fileInput.addEventListener('change', () => { if (fileInput.files[0]) selectFile(fileInput.files[0]); });
  fileChipRemove.addEventListener('click', clearSelectedFile);

  dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('drag-over'); });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag-over'));
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('drag-over');
    if (e.dataTransfer.files[0]) selectFile(e.dataTransfer.files[0]);
  });

  function setStep(stepName) {
    const steps = processingSteps.querySelectorAll('li');
    let passed = true;
    steps.forEach((li) => {
      const s = li.dataset.step;
      li.classList.remove('done', 'active');
      if (s === stepName) { li.classList.add('active'); passed = false; }
      else if (passed) li.classList.add('done');
    });
  }

  async function processFile() {
    if (!selectedFile) return;
    showScreen('processing');
    processingTitle.textContent = 'Reading your file\u2026';
    setStep('parse');

    const formData = new FormData();
    formData.append('file', selectedFile);
    formData.append('instruction', instructionInput.value || '');

    const t1 = setTimeout(() => {
      setStep('ai');
      processingTitle.textContent = 'AI is editing the content\u2026';
    }, 900);
    const t2 = setTimeout(() => {
      setStep('build');
      processingTitle.textContent = 'Rebuilding your file\u2026';
    }, 3200);

    try {
      const res = await fetch('/api/edit', { method: 'POST', body: formData });
      const data = await res.json();
      clearTimeout(t1);
      clearTimeout(t2);

      if (!res.ok) {
        showError(data.error || 'Something went wrong while processing this file.');
        return;
      }

      setStep('build');
      const base = `/api/download/${data.jobId}`;
      dlDocx.href = `${base}/docx`;
      dlPptx.href = `${base}/pptx`;
      dlXlsx.href = `${base}/xlsx`;
      doneSummary.textContent = summaryFor(data);
      showScreen('done');
    } catch (err) {
      clearTimeout(t1);
      clearTimeout(t2);
      showError('Could not reach the server. Check your connection and try again.');
    }
  }

  function summaryFor(data) {
    if (data.modelType === 'blocks') return `${data.itemCount} sections reviewed and polished.`;
    if (data.modelType === 'sheets') return `${data.itemCount} sheet(s) cleaned and reformatted.`;
    if (data.modelType === 'slides') return `${data.itemCount} slides refined.`;
    return 'Your file has been updated.';
  }

  function showError(message) {
    errorMessage.textContent = message;
    showScreen('error');
  }

  processBtn.addEventListener('click', processFile);
  errorRetryBtn.addEventListener('click', () => showScreen('upload'));
  startOverBtn.addEventListener('click', () => {
    clearSelectedFile();
    showScreen('upload');
  });

  fetch('/api/health')
    .then((r) => r.json())
    .then((data) => {
      if (!data.aiConfigured) {
        aiWarning.classList.remove('hidden');
        processBtn.disabled = true;
      }
    })
    .catch(() => {});
})();
