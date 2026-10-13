// Đọc file PDF "Inventory Report" xuất từ chương trình kho bao bì / nguyên liệu (thư mục Data Package).
// Mỗi dòng có: Spec Code, Product Name (2 dòng), Lot No, B/F, Received, Issued, Balance (Qty / Wgh), SKU, Unit Code, Product Code.
// Lấy số tồn Balance Qty của từng lô làm số sổ sách để kiểm đếm.
const PdfStock = (function () {
  const LOT = /^\d{6,8}-[A-Z0-9]{1,3}$/;
  const PCODE = /^\d{4,}[A-Z]{1,4}\d+$/;
  const NUM = /^-?[\d,]+\.\d+$/;
  const num = s => parseFloat(String(s).replace(/,/g, '')) || 0;
  // Chữ trong PDF dùng font TCVN3 (vd "C¸i", "Cuén"); vài dòng đã là Unicode (vd "Khay Nhựa PP") thì giữ nguyên.
  // Bộ đọc PDF trả "µ" (TCVN3 của "à") thành chữ Hy Lạp "μ".
  const txt = s => {
    s = String(s || '').trim().replace(/μ/g, 'µ');
    if (/[Ā-ỿ]/.test(s)) return s;
    return tcvn3ToUnicode(s, true);
  };

  async function parse(arrayBuffer, fileName) {
    if (!window.pdfjsLib) throw new Error('Không tải được bộ đọc PDF');
    const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer.slice(0)) }).promise;
    const items = [];
    let title = '', stockDate = null, wh = { code: '', name: '' };
    const names = new Map(); // productCode -> tên hàng
    let n = 0, skippedZero = 0;
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const tc = await page.getTextContent();
      const all = tc.items.filter(i => i.str && i.str.trim()).map(i => ({ s: i.str.trim(), x: i.transform[4], y: i.transform[5] }));
      if (!title) { const t = all.find(i => /corporation|factory|công ty/i.test(i.s)); if (t) title = t.s; }
      if (!stockDate) {
        const d = all.find(i => /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(i.s));
        if (d) stockDate = Importer.parseDate(d.s);
      }
      // Cột tên hàng nằm giữa cột Spec Code và cột Lot No
      const hLot = all.find(i => i.s === 'Lot No');
      const hName = all.find(i => i.s === 'Product Name');
      const lotX = hLot ? hLot.x : 138;
      const nameX0 = hName ? Math.min(hName.x, lotX) - 12 : 65;
      // Gom theo dòng (cùng toạ độ y)
      const rows = [];
      all.slice().sort((a, b) => b.y - a.y || a.x - b.x).forEach(i => {
        const r = rows.find(r => Math.abs(r.y - i.y) < 2);
        if (r) r.cells.push(i); else rows.push({ y: i.y, cells: [i] });
      });
      rows.forEach(r => r.cells.sort((a, b) => a.x - b.x));
      rows.forEach((r, ri) => {
        const c = r.cells;
        const first = c[0];
        // Dòng tên kho: "8010  Packaging Main WH"
        if (/^\d{3,5}$/.test(first.s) && first.x < nameX0 && c.length >= 2 && !c.some(x => NUM.test(x.s)) && !c.some(x => LOT.test(x.s))) {
          wh = { code: first.s, name: txt(c.slice(1).map(x => x.s).join(' ')) };
          return;
        }
        const lot = c.find(x => LOT.test(x.s) && Math.abs(x.x - lotX) < 40);
        const pcode = c.find(x => PCODE.test(x.s));
        if (!lot || !pcode) return;
        const nums = c.filter(x => NUM.test(x.s) && x.x > lot.x);
        if (nums.length < 8) return;
        const balQty = num(nums[6].s), balWgh = num(nums[7].s);
        const after = c.filter(x => x.x > nums[7].x && x !== pcode);
        const sku = (after.find(x => /^[A-Z]$/.test(x.s)) || {}).s || '';
        const unit = txt((after.find(x => !/^[A-Z]$/.test(x.s)) || {}).s || '');
        const spec = (c.find(x => x.x < nameX0 && /^[A-Z]{1,4}\d+/.test(x.s)) || {}).s || pcode.s.replace(/^\d+/, '');
        // Tên hàng: chữ trong cột tên trên cùng dòng và dòng ngay dưới (tên in 2 dòng)
        if (!names.has(pcode.s)) {
          const parts = [];
          for (let k = ri; k < rows.length && r.y - rows[k].y < 12; k++) {
            rows[k].cells.filter(x => x.x >= nameX0 && x.x < lotX - 2 && !NUM.test(x.s)).forEach(x => parts.push(x.s));
          }
          if (parts.length) names.set(pcode.s, txt(parts.join(' ')).replace(/\s+/g, ' '));
        }
        if (Math.abs(balQty) < 0.0005 && Math.abs(balWgh) < 0.0005) { skippedZero++; return; }
        n++;
        items.push({
          id: 'P' + n, code: spec, productCode: pcode.s, name: '', unit, sku, lot: lot.s,
          warehouseCode: wh.code, warehouse: wh.code ? `${wh.code} - ${wh.name}` : (wh.name || 'Kho'),
          system: '', prodDate: null, sysQty: balQty, sysWgh: 0, ages: '', shelfLife: 0,
          actualQty: null, actualWgh: null, note: '', photos: [], isExtra: false
        });
      });
    }
    items.forEach(it => { it.name = names.get(it.productCode) || ''; });
    if (!items.length) throw new Error('Không đọc được dòng tồn kho nào trong PDF (cần file "Inventory Report" xuất từ chương trình)');
    const org = (String(fileName || '').match(/^([A-Z]\d{3,6})[_\s-]/i) || [])[1] || '';
    return { fileName, mode: 'package', source: 'pdf', title, importedAt: new Date().toISOString(), encoding: 'PDF', sites: [], orgCode: org.toUpperCase(), stockDate, skippedZero, items };
  }

  return { parse };
})();
