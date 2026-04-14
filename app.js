// ─── State ───
let pdfDoc = null;
let currentPage = 1;
let totalPages = 0;
let pdfName = '';
let comments = [];
let referenceText = '';
let renderTask = null;
let zoomLevel = 1.0; // 1.0 = fit to width
// Hidden canvas for rendering, img for display (fetched dynamically for shared mode)
function getRenderCanvas() { return document.getElementById('pdf-render-canvas'); }
function getPdfImage() { return document.getElementById('pdf-image'); }

// ─── Storage key based on PDF name ───
function storageKey() {
  return 'pdfredline_' + pdfName;
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
}

// ─── Save / Load ───
function saveState() {
  const data = {
    pdfName,
    referenceText,
    comments,
    updatedAt: new Date().toISOString()
  };
  try {
    localStorage.setItem(storageKey(), JSON.stringify(data));
  } catch (e) {
    console.warn('localStorage save failed:', e);
  }
  updateCommentCount();
}

function loadState() {
  try {
    const raw = localStorage.getItem(storageKey());
    if (raw) {
      const data = JSON.parse(raw);
      comments = data.comments || [];
      referenceText = data.referenceText || '';
      document.getElementById('ref-text').value = referenceText;
    }
  } catch (e) {
    console.warn('localStorage load failed:', e);
  }
}

function updateCommentCount() {
  const el = document.getElementById('comment-count');
  el.textContent = comments.length + ' 件のコメント';
}

// ─── PDF Loading ───
async function loadPDF(file) {
  pdfName = file.name;
  const arrayBuffer = await file.arrayBuffer();
  pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  totalPages = pdfDoc.numPages;

  document.getElementById('upload-screen').classList.remove('active');
  document.getElementById('app-screen').classList.add('active');
  document.getElementById('pdf-name-display').textContent = pdfName;
  document.getElementById('page-jump').max = totalPages;

  loadState();
  currentPage = 1;
  renderPage(currentPage);
  renderComments();
  updateCommentCount();
}

// ─── PDF Rendering (render to hidden canvas → display as <img>) ───
async function renderPage(num) {
  if (renderTask) {
    renderTask.cancel();
    renderTask = null;
  }

  const loading = document.getElementById('pdf-loading');
  loading.classList.remove('hidden');
  const pdfImage = getPdfImage();
  const renderCanvas = getRenderCanvas();
  const renderCtx = renderCanvas.getContext('2d');
  pdfImage.style.opacity = '0.3';

  try {
    const page = await pdfDoc.getPage(num);
    const container = document.getElementById('pdf-container');
    const containerWidth = container.clientWidth - 24;
    const viewport = page.getViewport({ scale: 1 });

    // Render at 4x base resolution for crisp text on Retina displays
    const dpr = window.devicePixelRatio || 1;
    const renderScale = Math.max(dpr, 2) * 2 * zoomLevel;
    const renderViewport = page.getViewport({ scale: renderScale });

    renderCanvas.width = renderViewport.width;
    renderCanvas.height = renderViewport.height;

    renderTask = page.render({ canvasContext: renderCtx, viewport: renderViewport });
    await renderTask.promise;
    renderTask = null;

    // Convert to image and display
    const dataUrl = renderCanvas.toDataURL('image/png');
    pdfImage.src = dataUrl;

    // Set display size based on zoom
    const fitScale = containerWidth / viewport.width;
    const displayWidth = Math.floor(viewport.width * fitScale * zoomLevel);
    pdfImage.style.width = displayWidth + 'px';
    pdfImage.style.height = 'auto';
    pdfImage.style.opacity = '1';

    updateZoomDisplay();
  } catch (e) {
    if (e.name !== 'RenderingCancelledException') {
      console.error('Render error:', e);
    }
  }

  loading.classList.add('hidden');
  document.getElementById('page-info').textContent = num + ' / ' + totalPages;
  document.getElementById('prev-btn').disabled = num <= 1;
  document.getElementById('next-btn').disabled = num >= totalPages;
  document.getElementById('page-jump').value = '';
}

// ─── Zoom ───
function zoomIn() {
  zoomLevel = Math.min(zoomLevel + 0.25, 4.0);
  renderPage(currentPage);
}

function zoomOut() {
  zoomLevel = Math.max(zoomLevel - 0.25, 0.5);
  renderPage(currentPage);
}

function zoomFit() {
  zoomLevel = 1.0;
  renderPage(currentPage);
}

function updateZoomDisplay() {
  const el = document.getElementById('zoom-display');
  if (el) el.textContent = Math.round(zoomLevel * 100) + '%';
}

// ─── Get current page as base64 PNG ───
function getPageImage() {
  return getRenderCanvas().toDataURL('image/png').split(',')[1];
}

// ─── Comments ───
function addComment(label, text, mode) {
  const comment = {
    id: generateId(),
    page: currentPage,
    label: label || 'Page ' + currentPage,
    revised: text,
    mode: mode,
    status: 'open',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  comments.push(comment);
  saveState();
  renderComments();
}

function deleteComment(id) {
  comments = comments.filter(c => c.id !== id);
  saveState();
  renderComments();
}

function updateComment(id, updates) {
  const c = comments.find(c => c.id === id);
  if (c) {
    Object.assign(c, updates, { updatedAt: new Date().toISOString() });
    saveState();
    renderComments();
  }
}

function cycleStatus(id) {
  const c = comments.find(c => c.id === id);
  if (!c) return;
  const order = ['open', 'in_progress', 'done'];
  const labels = { open: '未対応', in_progress: '対応中', done: '完了' };
  const idx = order.indexOf(c.status);
  c.status = order[(idx + 1) % order.length];
  c.updatedAt = new Date().toISOString();
  saveState();
  renderComments();
}

function renderComments() {
  const list = document.getElementById('comment-list');
  const filter = document.getElementById('comment-filter').value;
  const filtered = filter === 'page'
    ? comments.filter(c => c.page === currentPage)
    : [...comments].sort((a, b) => a.page - b.page);

  if (filtered.length === 0) {
    list.innerHTML = '<div class="empty-state">コメントはまだありません</div>';
    return;
  }

  const statusLabels = { open: '未対応', in_progress: '対応中', done: '完了' };

  list.innerHTML = filtered.map(c => `
    <div class="comment-card ${c.status === 'done' ? 'status-done' : ''}" data-id="${c.id}">
      <div class="comment-card-header">
        <span class="comment-label">${escHtml(c.label)}</span>
        <span class="comment-page" onclick="goToPage(${c.page})">p.${c.page}</span>
      </div>
      <div class="comment-body">${escHtml(c.revised)}</div>
      <div class="comment-meta">
        <div style="display:flex;align-items:center;gap:6px">
          <span class="comment-mode ${c.mode}">${c.mode === 'ai' ? 'AI' : '手動'}</span>
          <button class="comment-status" onclick="cycleStatus('${c.id}')">${statusLabels[c.status]}</button>
        </div>
        <div class="comment-actions">
          <button class="btn btn-danger" onclick="startEdit('${c.id}')">編集</button>
          <button class="btn btn-danger" onclick="deleteComment('${c.id}')">削除</button>
        </div>
      </div>
    </div>
  `).join('');
}

function startEdit(id) {
  const c = comments.find(c => c.id === id);
  if (!c) return;
  const card = document.querySelector(`.comment-card[data-id="${id}"]`);
  if (!card) return;
  card.classList.add('editing');
  const body = card.querySelector('.comment-body');
  body.innerHTML = `
    <input type="text" class="edit-textarea" style="min-height:auto;margin-bottom:4px" value="${escAttr(c.label)}" id="edit-label-${id}">
    <textarea class="edit-textarea" id="edit-text-${id}">${escHtml(c.revised)}</textarea>
    <div class="edit-actions">
      <button class="btn btn-primary" onclick="finishEdit('${id}')">保存</button>
      <button class="btn btn-secondary" onclick="renderComments()">キャンセル</button>
    </div>
  `;
}

function finishEdit(id) {
  const label = document.getElementById('edit-label-' + id).value;
  const text = document.getElementById('edit-text-' + id).value;
  updateComment(id, { label, revised: text });
}

function escHtml(s) {
  const d = document.createElement('div');
  d.textContent = s || '';
  return d.innerHTML;
}

function escAttr(s) {
  return (s || '').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function goToPage(p) {
  if (p >= 1 && p <= totalPages) {
    currentPage = p;
    renderPage(currentPage);
    // Switch to page filter
    document.getElementById('comment-filter').value = 'page';
    renderComments();
  }
}

// ─── AI Completion ───
async function runAI() {
  const instruction = document.getElementById('ai-instruction').value.trim();
  if (!instruction) {
    alert('AIへの指示を入力してください');
    return;
  }

  const loading = document.getElementById('ai-loading');
  const result = document.getElementById('ai-result');
  const generateBtn = document.getElementById('ai-generate-btn');

  loading.classList.remove('hidden');
  result.classList.add('hidden');
  generateBtn.disabled = true;

  try {
    const pageImage = getPageImage();
    const refText = document.getElementById('ref-text').value || '';

    const res = await fetch('/api/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        instruction,
        pageImage,
        pageNumber: currentPage,
        totalPages,
        pdfName,
        referenceText: refText
      })
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'API request failed');
    }

    const data = await res.json();
    document.getElementById('ai-result-text').value = data.text;
    result.classList.remove('hidden');
  } catch (e) {
    alert('AI処理エラー: ' + e.message);
  } finally {
    loading.classList.add('hidden');
    generateBtn.disabled = false;
  }
}

// ─── Share (Link) ───
async function shareData() {
  const data = {
    pdfName,
    referenceText: document.getElementById('ref-text').value,
    comments,
    sharedAt: new Date().toISOString()
  };

  // Show modal immediately
  showShareModal('保存中...');

  try {
    const res = await fetch('/api/share', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });

    if (!res.ok) throw new Error('Share failed');
    const result = await res.json();
    const shareUrl = window.location.origin + '/share/' + result.id;
    showShareModal(shareUrl);
  } catch (e) {
    // Fallback to JSON export
    exportJSON();
    closeModal();
  }
}

function showShareModal(url) {
  closeModal();
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.onclick = (e) => { if (e.target === overlay) closeModal(); };
  overlay.innerHTML = `
    <div class="modal">
      <button class="modal-close" onclick="closeModal()">&times;</button>
      <h2>共有リンク</h2>
      <div class="share-url-box">
        <input type="text" value="${escAttr(url)}" readonly id="share-url-input">
        <button class="btn btn-primary" onclick="copyShareUrl()">コピー</button>
      </div>
      <p class="share-status">このリンクをチームメンバーに共有してください。</p>
      <div style="margin-top:12px;display:flex;gap:8px">
        <button class="btn btn-secondary" onclick="exportJSON()">JSONでもダウンロード</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
}

function copyShareUrl() {
  const input = document.getElementById('share-url-input');
  input.select();
  navigator.clipboard.writeText(input.value);
  const status = document.querySelector('.share-status');
  if (status) status.textContent = 'コピーしました';
}

function closeModal() {
  document.querySelectorAll('.modal-overlay').forEach(el => el.remove());
}

// ─── Export / Import JSON ───
function exportJSON() {
  const data = {
    pdfName,
    referenceText: document.getElementById('ref-text').value,
    comments,
    exportedAt: new Date().toISOString()
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = pdfName.replace('.pdf', '') + '_redline.json';
  a.click();
  URL.revokeObjectURL(a.href);
}

function importJSON(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target.result);
      if (data.comments && Array.isArray(data.comments)) {
        comments = data.comments;
        referenceText = data.referenceText || '';
        pdfName = data.pdfName || pdfName;
        document.getElementById('ref-text').value = referenceText;
        saveState();
        renderComments();
        alert('インポートしました (' + comments.length + ' 件のコメント)');
      }
    } catch (err) {
      alert('JSONファイルの読み込みに失敗しました');
    }
  };
  reader.readAsText(file);
}

// ─── Report ───
function generateReport() {
  const sorted = [...comments].sort((a, b) => a.page - b.page || a.createdAt.localeCompare(b.createdAt));
  const statusLabels = { open: '未対応', in_progress: '対応中', done: '完了' };

  let md = `# PDF Redline Report\n`;
  md += `## ${pdfName}\n`;
  md += `生成日時: ${new Date().toLocaleString('ja-JP')}\n`;
  md += `コメント数: ${comments.length}\n\n`;

  let lastPage = -1;
  for (const c of sorted) {
    if (c.page !== lastPage) {
      md += `---\n### Page ${c.page}\n\n`;
      lastPage = c.page;
    }
    md += `**${c.label}** [${statusLabels[c.status]}] (${c.mode === 'ai' ? 'AI' : '手動'})\n`;
    md += `${c.revised}\n\n`;
  }

  closeModal();
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.onclick = (e) => { if (e.target === overlay) closeModal(); };
  overlay.innerHTML = `
    <div class="modal">
      <button class="modal-close" onclick="closeModal()">&times;</button>
      <h2>レポート</h2>
      <div class="report-preview">${escHtml(md)}</div>
      <button class="btn btn-primary" onclick="downloadReport()">Markdownダウンロード</button>
    </div>
  `;
  overlay.querySelector('.report-preview')._reportMd = md;
  document.body.appendChild(overlay);
}

function downloadReport() {
  const pre = document.querySelector('.report-preview');
  const md = pre._reportMd;
  const blob = new Blob([md], { type: 'text/markdown' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = pdfName.replace('.pdf', '') + '_report.md';
  a.click();
  URL.revokeObjectURL(a.href);
  closeModal();
}

// ─── Load shared data from URL ───
async function checkSharedData() {
  const path = window.location.pathname;
  const match = path.match(/^\/share\/([a-zA-Z0-9_-]+)$/);
  if (!match) return false;

  const shareId = match[1];
  try {
    const res = await fetch('/api/share?id=' + shareId);
    if (!res.ok) return false;
    const data = await res.json();
    if (data.comments) {
      comments = data.comments;
      referenceText = data.referenceText || '';
      pdfName = data.pdfName || 'shared.pdf';

      // Show app screen in view mode (no PDF loaded, just comments)
      document.getElementById('upload-screen').classList.remove('active');
      document.getElementById('app-screen').classList.add('active');
      document.getElementById('pdf-name-display').textContent = pdfName + ' (共有データ)';
      document.getElementById('ref-text').value = referenceText;
      document.getElementById('comment-filter').value = 'all';
      renderComments();
      updateCommentCount();

      // Show message about loading PDF
      const container = document.getElementById('pdf-container');
      container.innerHTML = `
        <div class="empty-state" style="padding:60px 20px">
          <p style="margin-bottom:16px">共有データを読み込みました (${comments.length} 件のコメント)</p>
          <p style="margin-bottom:16px">対象PDF: <strong>${escHtml(pdfName)}</strong></p>
          <p>PDFファイルをドラッグ&ドロップで読み込んでください</p>
          <input type="file" id="shared-file-input" accept=".pdf" hidden>
          <button class="btn btn-primary" style="margin-top:16px" onclick="document.getElementById('shared-file-input').click()">PDFを選択</button>
        </div>`;
      document.getElementById('shared-file-input').addEventListener('change', (e) => {
        if (e.target.files[0]) loadPDFIntoViewer(e.target.files[0]);
      });
      return true;
    }
  } catch (e) {
    console.warn('Failed to load shared data:', e);
  }
  return false;
}

async function loadPDFIntoViewer(file) {
  const arrayBuffer = await file.arrayBuffer();
  pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  totalPages = pdfDoc.numPages;
  document.getElementById('page-jump').max = totalPages;

  // Restore image viewer
  const container = document.getElementById('pdf-container');
  container.innerHTML = '<canvas id="pdf-render-canvas" style="display:none"></canvas><img id="pdf-image" alt="PDF page"><div id="pdf-loading" class="hidden">読み込み中...</div>';

  currentPage = 1;
  renderPage(currentPage);
  document.getElementById('comment-filter').value = 'page';
  renderComments();
}

// ─── Event Listeners ───
document.addEventListener('DOMContentLoaded', async () => {
  // Check for shared data first
  const isShared = await checkSharedData();
  if (isShared) return;

  // File input
  document.getElementById('file-input').addEventListener('change', (e) => {
    if (e.target.files[0]) loadPDF(e.target.files[0]);
  });

  // Drag & drop
  const dropZone = document.getElementById('drop-zone');
  dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('drag-over'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file && file.type === 'application/pdf') loadPDF(file);
  });

  // Also allow drop on entire app
  document.addEventListener('dragover', (e) => e.preventDefault());
  document.addEventListener('drop', (e) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file && file.type === 'application/pdf' && pdfDoc) {
      loadPDFIntoViewer(file);
    }
  });

  // Navigation
  document.getElementById('prev-btn').addEventListener('click', () => {
    if (currentPage > 1) { currentPage--; renderPage(currentPage); renderComments(); }
  });
  document.getElementById('next-btn').addEventListener('click', () => {
    if (currentPage < totalPages) { currentPage++; renderPage(currentPage); renderComments(); }
  });
  document.getElementById('page-jump').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const p = parseInt(e.target.value);
      if (p >= 1 && p <= totalPages) { currentPage = p; renderPage(currentPage); renderComments(); }
    }
  });

  // Keyboard navigation
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.key === 'ArrowLeft' && currentPage > 1) { currentPage--; renderPage(currentPage); renderComments(); }
    if (e.key === 'ArrowRight' && currentPage < totalPages) { currentPage++; renderPage(currentPage); renderComments(); }
  });

  // Mode tabs
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.mode-content').forEach(m => m.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(tab.dataset.mode + '-mode').classList.add('active');
    });
  });

  // Add comment (manual)
  document.getElementById('add-comment-btn').addEventListener('click', () => {
    const label = document.getElementById('comment-label').value.trim();
    const text = document.getElementById('comment-text').value.trim();
    if (!text) { alert('修正内容を入力してください'); return; }
    addComment(label, text, 'manual');
    document.getElementById('comment-label').value = '';
    document.getElementById('comment-text').value = '';
  });

  // AI generate
  document.getElementById('ai-generate-btn').addEventListener('click', runAI);
  document.getElementById('ai-retry-btn').addEventListener('click', runAI);
  document.getElementById('ai-accept-btn').addEventListener('click', () => {
    const text = document.getElementById('ai-result-text').value.trim();
    if (text) {
      const instruction = document.getElementById('ai-instruction').value.trim();
      addComment(instruction.substring(0, 50), text, 'ai');
      document.getElementById('ai-result').classList.add('hidden');
      document.getElementById('ai-instruction').value = '';
    }
  });

  // Comment filter
  document.getElementById('comment-filter').addEventListener('change', renderComments);

  // Reference panel
  document.getElementById('ref-toggle').addEventListener('click', () => {
    document.getElementById('ref-panel').classList.toggle('hidden');
  });
  document.getElementById('ref-text').addEventListener('input', (e) => {
    referenceText = e.target.value;
    saveState();
  });
  document.getElementById('ref-file-btn').addEventListener('click', () => {
    document.getElementById('ref-file-input').click();
  });
  document.getElementById('ref-file-input').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        document.getElementById('ref-text').value = ev.target.result;
        referenceText = ev.target.result;
        saveState();
      };
      reader.readAsText(file);
    }
  });
  document.getElementById('ref-clear-btn').addEventListener('click', () => {
    document.getElementById('ref-text').value = '';
    referenceText = '';
    saveState();
  });

  // Export / Share
  document.getElementById('export-btn').addEventListener('click', shareData);

  // Report
  document.getElementById('report-btn').addEventListener('click', generateReport);

  // Import
  document.getElementById('import-btn').addEventListener('click', () => {
    document.getElementById('import-input').click();
  });
  document.getElementById('import-input').addEventListener('change', (e) => {
    if (e.target.files[0]) importJSON(e.target.files[0]);
  });

  // New PDF
  document.getElementById('new-pdf-btn').addEventListener('click', () => {
    if (confirm('新しいPDFを読み込みますか？現在のコメントは保存されています。')) {
      location.reload();
    }
  });
});
