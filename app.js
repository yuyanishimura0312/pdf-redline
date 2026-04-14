// ─── State ───
let pdfDoc = null;
let currentPage = 1;
let totalPages = 0;
let pdfName = '';
let comments = [];
let referenceText = '';
let renderTask = null;
let zoomLevel = 1.0;
let attachedImage = null; // base64 data URL for attached image

function getRenderCanvas() { return document.getElementById('pdf-render-canvas'); }
function getPdfImage() { return document.getElementById('pdf-image'); }
function generateId() { return Date.now().toString(36) + Math.random().toString(36).substr(2, 9); }

// ─── Storage ───
function storageKey() { return 'pdfredline_' + pdfName; }

function saveState() {
  const data = { pdfName, referenceText, comments, updatedAt: new Date().toISOString() };
  try { localStorage.setItem(storageKey(), JSON.stringify(data)); } catch (e) {}
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
  } catch (e) {}
}

function updateCommentCount() {
  document.getElementById('comment-count').textContent = comments.length + ' 件';
}

// ─── PDF Loading ───
async function loadPDF(file) {
  pdfName = file.name;
  const arrayBuffer = await file.arrayBuffer();
  pdfDoc = await pdfjsLib.getDocument({
    data: arrayBuffer,
    cMapUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/cmaps/',
    cMapPacked: true
  }).promise;
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

// ─── PDF Rendering ───
async function renderPage(num) {
  if (renderTask) { renderTask.cancel(); renderTask = null; }

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
    const fitScale = containerWidth / viewport.width;
    const renderScale = fitScale * 2.0 * zoomLevel;
    const renderViewport = page.getViewport({ scale: renderScale });

    renderCanvas.width = renderViewport.width;
    renderCanvas.height = renderViewport.height;

    renderTask = page.render({ canvasContext: renderCtx, viewport: renderViewport });
    await renderTask.promise;
    renderTask = null;

    pdfImage.src = renderCanvas.toDataURL('image/png');
    const displayWidth = Math.floor(renderViewport.width);
    pdfImage.style.width = displayWidth + 'px';
    pdfImage.style.height = 'auto';
    pdfImage.style.opacity = '1';
    updateZoomDisplay();
  } catch (e) {
    if (e.name !== 'RenderingCancelledException') console.error('Render error:', e);
  }

  loading.classList.add('hidden');
  document.getElementById('page-info').textContent = num + ' / ' + totalPages;
  document.getElementById('prev-btn').disabled = num <= 1;
  document.getElementById('next-btn').disabled = num >= totalPages;
  document.getElementById('page-jump').value = '';
}

function getPageImage() { return getRenderCanvas().toDataURL('image/png').split(',')[1]; }

// ─── Zoom ───
function zoomIn() { zoomLevel = Math.min(zoomLevel + 0.25, 4.0); renderPage(currentPage); }
function zoomOut() { zoomLevel = Math.max(zoomLevel - 0.25, 0.5); renderPage(currentPage); }
function zoomFit() { zoomLevel = 1.0; renderPage(currentPage); }
function updateZoomDisplay() {
  const el = document.getElementById('zoom-display');
  if (el) el.textContent = Math.round(zoomLevel * 100) + '%';
}

// ─── Image Attachment ───
function handleImageAttach(file) {
  if (!file || !file.type.startsWith('image/')) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    attachedImage = e.target.result;
    document.getElementById('image-preview-img').src = attachedImage;
    document.getElementById('image-preview').classList.remove('hidden');
  };
  reader.readAsDataURL(file);
}

function removeAttachedImage() {
  attachedImage = null;
  document.getElementById('image-preview').classList.add('hidden');
  document.getElementById('comment-image-input').value = '';
}

// ─── Comments ───
function addComment(label, text, mode, image) {
  comments.push({
    id: generateId(),
    page: currentPage,
    label: label || 'p.' + currentPage,
    revised: text,
    mode: mode,
    image: image || null,
    status: 'open',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });
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
  if (c) { Object.assign(c, updates, { updatedAt: new Date().toISOString() }); saveState(); renderComments(); }
}

function cycleStatus(id) {
  const c = comments.find(c => c.id === id);
  if (!c) return;
  const order = ['open', 'in_progress', 'done'];
  const idx = order.indexOf(c.status);
  c.status = order[(idx + 1) % order.length];
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
    list.innerHTML = '<div class="empty-state">コメントなし</div>';
    return;
  }

  const statusLabels = { open: '未対応', in_progress: '対応中', done: '完了' };
  list.innerHTML = filtered.map(c => `
    <div class="comment-card ${c.status === 'done' ? 'status-done' : ''}" data-id="${c.id}">
      <div class="comment-card-header">
        <span class="comment-label">${esc(c.label)}</span>
        <span class="comment-page" onclick="goToPage(${c.page})">p.${c.page}</span>
      </div>
      <div class="comment-body">${esc(c.revised)}</div>
      ${c.image ? '<div class="comment-image"><img src="' + c.image + '" alt="添付"></div>' : ''}
      <div class="comment-meta">
        <div style="display:flex;align-items:center;gap:4px">
          <span class="comment-mode ${c.mode}">${c.mode === 'ai' ? 'AI' : '手動'}</span>
          <button class="comment-status" onclick="cycleStatus('${c.id}')">${statusLabels[c.status]}</button>
        </div>
        <div class="comment-actions">
          <button class="btn-danger" onclick="startEdit('${c.id}')">編集</button>
          <button class="btn-danger" onclick="deleteComment('${c.id}')">削除</button>
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
    <input type="text" class="edit-textarea" style="min-height:auto;margin-bottom:3px" value="${escAttr(c.label)}" id="edit-label-${id}">
    <textarea class="edit-textarea" id="edit-text-${id}">${esc(c.revised)}</textarea>
    <div class="edit-actions">
      <button class="btn btn-primary" style="padding:4px 12px;font-size:12px" onclick="finishEdit('${id}')">保存</button>
      <button class="btn btn-secondary" style="padding:4px 12px;font-size:12px" onclick="renderComments()">戻す</button>
    </div>
  `;
}

function finishEdit(id) {
  updateComment(id, {
    label: document.getElementById('edit-label-' + id).value,
    revised: document.getElementById('edit-text-' + id).value
  });
}

function esc(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }
function escAttr(s) { return (s || '').replace(/"/g, '&quot;').replace(/</g, '&lt;'); }

function goToPage(p) {
  if (p >= 1 && p <= totalPages) {
    currentPage = p;
    renderPage(currentPage);
    document.getElementById('comment-filter').value = 'page';
    renderComments();
  }
}

// ─── AI ───
async function runAI() {
  const instruction = document.getElementById('ai-instruction').value.trim();
  if (!instruction) { alert('AIへの指示を入力してください'); return; }

  const loading = document.getElementById('ai-loading');
  const result = document.getElementById('ai-result');
  loading.classList.remove('hidden');
  result.classList.add('hidden');
  document.getElementById('ai-generate-btn').disabled = true;

  try {
    const res = await fetch('/api/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        instruction,
        pageImage: getPageImage(),
        pageNumber: currentPage,
        totalPages,
        pdfName,
        referenceText: document.getElementById('ref-text').value || ''
      })
    });
    if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || 'API error'); }
    const data = await res.json();
    document.getElementById('ai-result-text').value = data.text;
    result.classList.remove('hidden');
  } catch (e) {
    alert('AI処理エラー: ' + e.message);
  } finally {
    loading.classList.add('hidden');
    document.getElementById('ai-generate-btn').disabled = false;
  }
}

// ─── PDF Report (HTML → Print) ───
async function generatePdfReport() {
  if (!pdfDoc || comments.length === 0) { alert('コメントがありません'); return; }

  closeModal();
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = '<div class="modal"><h2>レポート生成中...</h2><p id="pdf-progress">準備中...</p></div>';
  document.body.appendChild(overlay);
  const progressEl = document.getElementById('pdf-progress');

  const statusLabels = { open: '未対応', in_progress: '対応中', done: '完了' };
  const grouped = {};
  for (const c of comments) { if (!grouped[c.page]) grouped[c.page] = []; grouped[c.page].push(c); }
  const pageNumbers = Object.keys(grouped).map(Number).sort((a, b) => a - b);

  // Render thumbnails
  const thumbCanvas = document.createElement('canvas');
  const thumbCtx = thumbCanvas.getContext('2d');
  const thumbnails = {};

  for (let i = 0; i < pageNumbers.length; i++) {
    const pgNum = pageNumbers[i];
    progressEl.textContent = 'ページ ' + pgNum + ' (' + (i + 1) + '/' + pageNumbers.length + ')';
    try {
      const page = await pdfDoc.getPage(pgNum);
      const vp = page.getViewport({ scale: 1.5 });
      thumbCanvas.width = vp.width;
      thumbCanvas.height = vp.height;
      thumbCtx.fillStyle = '#fff';
      thumbCtx.fillRect(0, 0, vp.width, vp.height);
      await page.render({ canvasContext: thumbCtx, viewport: vp }).promise;
      thumbnails[pgNum] = thumbCanvas.toDataURL('image/jpeg', 0.85);
    } catch (e) {}
  }

  // Build cards
  let cardsHtml = '';
  for (const pgNum of pageNumbers) {
    const cmts = grouped[pgNum];
    const img = thumbnails[pgNum] || '';
    const commentsHtml = cmts.map(c => `
      <div class="rc">
        <div class="rc-head">
          <span class="rc-label">${esc(c.label)}</span>
          <span class="rc-status rc-status-${c.status}">${statusLabels[c.status]}</span>
        </div>
        <div class="rc-body">${esc(c.revised)}</div>
        ${c.image ? '<img class="rc-img" src="' + c.image + '">' : ''}
      </div>
    `).join('');

    cardsHtml += `
      <div class="card">
        <div class="card-thumb"><img src="${img}"></div>
        <div class="card-right">
          <div class="card-page">Page ${pgNum}</div>
          ${commentsHtml}
        </div>
      </div>
    `;
  }

  const html = `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<title>${esc(pdfName)} - Redline Report</title>
<style>
  @page { size: A4 landscape; margin: 10mm 12mm; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: "Noto Sans JP", "Hiragino Kaku Gothic ProN", sans-serif; color: #222; font-size: 9pt; line-height: 1.45; background: #fff; }

  .header { padding: 6mm 0 5mm; border-bottom: 2px solid #783c28; margin-bottom: 5mm; display: flex; justify-content: space-between; align-items: baseline; }
  .header h1 { font-size: 16pt; color: #783c28; font-weight: 600; }
  .header-meta { font-size: 8pt; color: #888; }

  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4mm; }

  .card { border: 1px solid #ddd; border-radius: 3mm; overflow: hidden; break-inside: avoid; display: flex; gap: 0; background: #fff; }
  .card-thumb { width: 42%; min-width: 42%; background: #f5f5f5; display: flex; align-items: center; justify-content: center; padding: 2mm; }
  .card-thumb img { max-width: 100%; max-height: 48mm; height: auto; }
  .card-right { flex: 1; padding: 2.5mm 3mm; overflow: hidden; }
  .card-page { font-size: 8pt; font-weight: 700; color: #783c28; margin-bottom: 1.5mm; padding-bottom: 1mm; border-bottom: 1px solid #eee; }

  .rc { margin-bottom: 1.5mm; }
  .rc-head { display: flex; align-items: center; gap: 2mm; margin-bottom: 0.5mm; }
  .rc-label { font-size: 8pt; font-weight: 600; color: #333; }
  .rc-status { font-size: 6.5pt; padding: 0.3mm 1.5mm; border-radius: 1mm; background: #f0f0f0; color: #888; }
  .rc-status-done { background: #e8f5e9; color: #2e7d32; }
  .rc-status-in_progress { background: #fff3e0; color: #e65100; }
  .rc-body { font-size: 8pt; color: #444; white-space: pre-wrap; word-break: break-word; }
  .rc-img { max-width: 100%; max-height: 20mm; border-radius: 1mm; margin-top: 1mm; border: 0.5px solid #ddd; }

  .actions { text-align: center; padding: 20px; }
  .actions button { padding: 12px 40px; font-size: 15px; background: #783c28; color: #fff; border: none; border-radius: 8px; cursor: pointer; font-family: inherit; }
  .actions button:hover { background: #4a2418; }
  @media print { .actions { display: none; } body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style>
</head>
<body>
  <div class="actions"><button onclick="window.print()">PDFとして保存</button></div>
  <div class="header">
    <h1>${esc(pdfName)}</h1>
    <span class="header-meta">${new Date().toLocaleDateString('ja-JP')} | ${comments.length} 件のコメント</span>
  </div>
  <div class="grid">${cardsHtml}</div>
</body>
</html>`;

  closeModal();
  const win = window.open('', '_blank');
  if (!win) { alert('ポップアップを許可してください'); return; }
  win.document.write(html);
  win.document.close();
}

// ─── Modal helpers ───
function closeModal() { document.querySelectorAll('.modal-overlay').forEach(el => el.remove()); }

// ─── Event Listeners ───
document.addEventListener('DOMContentLoaded', () => {
  // File input
  document.getElementById('file-input').addEventListener('change', (e) => {
    if (e.target.files[0]) loadPDF(e.target.files[0]);
  });

  // Drag & drop
  const dropZone = document.getElementById('drop-zone');
  dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('drag-over'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault(); dropZone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file && file.type === 'application/pdf') loadPDF(file);
  });

  // Navigation
  document.getElementById('prev-btn').addEventListener('click', () => {
    if (currentPage > 1) { currentPage--; renderPage(currentPage); renderComments(); }
  });
  document.getElementById('next-btn').addEventListener('click', () => {
    if (currentPage < totalPages) { currentPage++; renderPage(currentPage); renderComments(); }
  });
  document.getElementById('page-jump').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { const p = parseInt(e.target.value); if (p >= 1 && p <= totalPages) goToPage(p); }
  });

  // Keyboard nav
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

  // Add comment
  document.getElementById('add-comment-btn').addEventListener('click', () => {
    const label = document.getElementById('comment-label').value.trim();
    const text = document.getElementById('comment-text').value.trim();
    if (!text && !attachedImage) { alert('コメントまたは画像を入力してください'); return; }
    addComment(label, text, 'manual', attachedImage);
    document.getElementById('comment-label').value = '';
    document.getElementById('comment-text').value = '';
    removeAttachedImage();
  });

  // Image attachment
  document.getElementById('comment-image-input').addEventListener('change', (e) => {
    if (e.target.files[0]) handleImageAttach(e.target.files[0]);
  });

  // AI
  document.getElementById('ai-generate-btn').addEventListener('click', runAI);
  document.getElementById('ai-retry-btn').addEventListener('click', runAI);
  document.getElementById('ai-accept-btn').addEventListener('click', () => {
    const text = document.getElementById('ai-result-text').value.trim();
    if (text) {
      addComment(document.getElementById('ai-instruction').value.trim().substring(0, 50), text, 'ai');
      document.getElementById('ai-result').classList.add('hidden');
      document.getElementById('ai-instruction').value = '';
    }
  });

  // Filter
  document.getElementById('comment-filter').addEventListener('change', renderComments);

  // Reference panel
  document.getElementById('ref-toggle').addEventListener('click', () => {
    document.getElementById('ref-panel').classList.toggle('hidden');
  });
  document.getElementById('ref-text').addEventListener('input', (e) => { referenceText = e.target.value; saveState(); });
  document.getElementById('ref-file-btn').addEventListener('click', () => document.getElementById('ref-file-input').click());
  document.getElementById('ref-file-input').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (ev) => { document.getElementById('ref-text').value = ev.target.result; referenceText = ev.target.result; saveState(); };
      reader.readAsText(file);
    }
  });
  document.getElementById('ref-clear-btn').addEventListener('click', () => {
    document.getElementById('ref-text').value = ''; referenceText = ''; saveState();
  });

  // Report & New
  document.getElementById('pdf-report-btn').addEventListener('click', generatePdfReport);
  document.getElementById('new-pdf-btn').addEventListener('click', () => {
    if (confirm('別のPDFを読み込みますか？')) location.reload();
  });
});
