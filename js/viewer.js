// Xem PDF ngay trong app (điện thoại thường không mở được PDF trong khung app), vẽ từng trang bằng pdf.js
const Viewer = (function () {
  if (window.pdfjsLib) pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';
  const ZOOMS = [1, 1.5, 2, 3];

  async function open(blob, title, actions) {
    const m = document.createElement('div');
    m.className = 'viewer';
    m.innerHTML = `<div class="viewer-bar">
        <button class="icon" data-close aria-label="Đóng">✕</button>
        <span class="viewer-title"></span>
        <button class="btn small-btn" data-zoom="-1" aria-label="Thu nhỏ">−</button>
        <button class="btn small-btn" data-zoom="1" aria-label="Phóng to">+</button>
      </div>
      <div class="viewer-actions"></div>
      <div class="viewer-pages"><div class="spinner"></div></div>`;
    m.querySelector('.viewer-title').textContent = title;
    const bar = m.querySelector('.viewer-actions');
    (actions || []).forEach(a => {
      const b = document.createElement('button');
      b.className = 'btn small-btn'; b.textContent = a.label; b.onclick = a.run;
      bar.appendChild(b);
    });
    if (!bar.children.length) bar.remove();
    m.querySelector('[data-close]').onclick = () => m.remove();
    document.body.appendChild(m);

    const pages = m.querySelector('.viewer-pages');
    let pdf, zi = 0, token = 0;

    async function render() {
      const my = ++token;
      const fitW = Math.min(pages.clientWidth - 16, 900);
      const cssW = Math.round(fitW * ZOOMS[zi]);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      pages.classList.toggle('zoomed', zi > 0);
      pages.innerHTML = '';
      for (let i = 1; i <= pdf.numPages; i++) {
        if (my !== token) return; // đã đổi mức phóng to giữa chừng
        const page = await pdf.getPage(i);
        const base = page.getViewport({ scale: 1 });
        const vp = page.getViewport({ scale: cssW / base.width * dpr });
        const c = document.createElement('canvas');
        c.width = vp.width; c.height = vp.height;
        c.style.width = cssW + 'px';
        pages.appendChild(c);
        await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
      }
    }

    m.querySelectorAll('[data-zoom]').forEach(b => b.onclick = () => {
      const next = Math.max(0, Math.min(ZOOMS.length - 1, zi + Number(b.dataset.zoom)));
      if (next !== zi && pdf) { zi = next; render(); }
    });

    try {
      pdf = await pdfjsLib.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise;
      await render();
    } catch (e) {
      pages.innerHTML = '<p class="center" style="color:#fff">Không hiển thị được PDF: ' + Util.esc(e.message) + '</p>';
    }
  }

  return { open };
})();
