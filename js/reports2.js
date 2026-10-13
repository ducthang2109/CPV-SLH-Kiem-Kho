// PDF cho 2 loại kiểm mới:
//  - Kiểm kê kho Spare part / Supplies / Bao bì / Ingredient: biên bản theo mẫu "Biên bản kiểm bao bì, sparepart, supplies"
//    (mỗi kho một biên bản, chỉ số lượng) và báo cáo slide theo mẫu "BA5146_Báo cáo kiểm kê".
//  - Kiểm tra chi nhánh: biên bản checklist theo mẫu "SLH_Form kiểm tra Nhà máy" (Đạt / Không đạt / Ghi chú).
const Docs2 = (function () {
  const GREEN = '#0a7a3c', GREEN_LIGHT = '#e6f4ea', GREEN_MID = '#c3e6cc', TEAL = '#4dc4b0', TEAL_DARK = '#2a9d8a';
  const RED = '#c62828', BLUE = '#1565c0', MUTED = '#6b7280', DARK = '#1d2433', LINE = '#dfe5ec';
  const Q = n => (n == null || n === '') ? '' : Number(n).toLocaleString('en-US', { maximumFractionDigits: 3 });
  const D = n => n == null ? '' : (Math.abs(n) < 0.0005 ? '-' : (n > 0 ? '+' : '') + Q(n));
  const two = n => String(n).padStart(2, '0');
  const hmph = ts => { if (!ts) return '.......'; const d = new Date(ts); return `${two(d.getHours())}h:${two(d.getMinutes())}ph`; };
  const dmy = iso => { const [y, m, d] = iso.split('-'); return `${d}-${m}-${y}`; };
  const dateWords = iso => { const [y, m, d] = iso.split('-'); return `Ngày ${d} tháng ${m} năm ${y}`; };
  const docNo = s => `${s.type === 'branch' ? 'KTCN' : s.type === 'package' ? 'BBPK' : 'BBVT'}-${s.factory.code}-${s.countDate.replace(/-/g, '')}`;
  const whName = it => it.warehouseCode ? it.warehouse.replace(new RegExp('^' + it.warehouseCode + '\\s*-\\s*'), '') : it.warehouse;

  function byWarehouse(items) {
    const map = new Map();
    items.forEach(it => { if (!map.has(it.warehouse)) map.set(it.warehouse, []); map.get(it.warehouse).push(it); });
    return map;
  }

  function variance(it) { return it.actualQty == null ? null : Util.round(it.actualQty - it.sysQty, 3); }

  // Giờ bắt đầu / kết thúc riêng từng kho: theo lần đếm đầu tiên / cuối cùng của các dòng trong kho
  function whTimes(s, list) {
    const a = list.map(i => i.countedAt).filter(Boolean).sort();
    const b = list.map(i => i.lastAt || i.countedAt).filter(Boolean).sort();
    return { start: a[0] || (s.checkIn && s.checkIn.time) || s.startedAt, end: b[b.length - 1] || (s.checkOut && s.checkOut.time) || s.finishedAt };
  }

  function companyHeader(s, images) {
    const logo = Branding.logo();
    if (logo) images.logo = logo;
    return {
      columns: [
        logo ? { width: 90, image: 'logo', fit: [90, 30] } : { width: 0, text: '' },
        { width: '*', fontSize: 8.5, stack: [
          { text: s.companyName, bold: true },
          { text: 'Chi Nhánh : ' + (s.factory.shortName || s.factory.name), bold: true },
          s.factory.address ? { text: 'Địa chỉ : ' + s.factory.address, italics: true, bold: true } : ''
        ] }
      ], columnGap: 6, margin: [0, 0, 0, 8]
    };
  }

  function signRow(people, withSig) {
    const cell = p => ({
      width: '*', alignment: 'center', stack: [
        withSig && p.signature ? { image: p.signature, fit: [100, 42], margin: [0, 0, 0, 2] } : { text: ' ', margin: [0, 20, 0, 20] },
        { text: p.name || ' ', fontSize: 8.5 },
        { text: p.role || '', bold: true, fontSize: 8.5 }
      ]
    });
    const rows = [];
    for (let i = 0; i < people.length; i += 4) {
      const c = people.slice(i, i + 4).map(cell);
      while (c.length < 4) c.push({ width: '*', text: '' });
      rows.push({ columns: c, columnGap: 6, margin: [0, 10, 0, 0] });
    }
    return { stack: rows, unbreakable: true, margin: [0, 6, 0, 0] };
  }

  // ===================== Kiểm kê vật tư: biên bản =====================
  // opts.onlyWh: chỉ in một kho (dùng để chèn ảnh biên bản từng kho vào báo cáo)
  function suppliesRecordDoc(s, withSig, opts = {}) {
    const images = {};
    const content = [];
    const groups = [...byWarehouse(s.items)].filter(([wh]) => !opts.onlyWh || wh === opts.onlyWh);
    const people = s.committee.filter(p => p.name || p.role);
    groups.forEach(([wh, list], gi) => {
      const w = list[0];
      const t = whTimes(s, list);
      const pkg = s.type === 'package';
      const sys = w.system || (pkg ? s.factory.packageSystem || 'Winfood' : s.factory.suppliesSystem || 'SAP');
      const hasLot = list.some(i => i.lot);
      const H = (txt, o = {}) => Object.assign({ text: txt, bold: true, alignment: 'center', fontSize: 8, color: '#fff', fillColor: GREEN }, o);
      // Thêm cột Số lô khi dữ liệu có lô (kho bao bì / nguyên liệu)
      const L = (a, b) => hasLot ? [a, b] : [a];
      const ncol = hasLot ? 9 : 8;
      const body = [
        [H('STT', { rowSpan: 3 }), ...L(H(pkg ? 'Mã Hàng' : 'Mã SAP', { rowSpan: 3 }), H('Số Lô', { rowSpan: 3 })), H('Tên Sản Phẩm', { rowSpan: 3 }), H('ĐVT', { rowSpan: 3 }), H(sys), H('Kiểm Thực Tế'), H('Chênh Lệch'), H('Ghi Chú', { rowSpan: 3 })],
        [{}, ...L({}, {}), {}, {}, H('(1)'), H('(2)'), H('3 = (2) - (1)'), {}],
        [{}, ...L({}, {}), {}, {}, H('Số Lượng'), H('Số Lượng'), H('Số Lượng'), {}],
        [{ text: `Warehouse : ${w.warehouseCode} _ ${whName(w)}`, colSpan: ncol, bold: true, decoration: 'underline', fontSize: 8.5, fillColor: GREEN_LIGHT }, ...Array.from({ length: ncol - 1 }, () => ({}))]
      ];
      let sq = 0, aq = 0, dq = 0;
      list.forEach((it, i) => {
        const v = variance(it);
        sq += it.sysQty; if (it.actualQty != null) { aq += it.actualQty; dq += v; }
        const hl = v != null && Math.abs(v) > 0.0005;
        const note = [it.isExtra ? 'Ngoài sổ sách. ' : '', it.actualQty == null ? 'Chưa kiểm. ' : '', it.note || ''].join('');
        body.push([
          { text: i + 1, alignment: 'center' }, ...L({ text: it.code, alignment: 'center' }, { text: it.lot || '', alignment: 'center', fontSize: 7.5 }), it.name, { text: it.unit || '', alignment: 'center' },
          { text: Q(it.sysQty), alignment: 'center' }, { text: Q(it.actualQty), alignment: 'center' },
          { text: v == null ? '' : D(v), alignment: 'center', bold: hl, color: hl ? (v < 0 ? RED : BLUE) : null },
          { text: note, fontSize: 7.5, color: it.actualQty == null ? RED : null }
        ]);
      });
      body.push([{ text: 'TỔNG', colSpan: ncol - 4, bold: true, alignment: 'center', fillColor: GREEN_MID }, ...Array.from({ length: ncol - 5 }, () => ({})),
        { text: Q(sq), bold: true, alignment: 'center', fillColor: GREEN_MID }, { text: Q(aq), bold: true, alignment: 'center', fillColor: GREEN_MID },
        { text: D(Util.round(dq, 3)), bold: true, alignment: 'center', fillColor: GREEN_MID }, { text: '', fillColor: GREEN_MID }]);

      content.push(
        Object.assign(companyHeader(s, images), gi ? { pageBreak: 'before' } : {}),
        { text: 'BIÊN BẢN KIỂM KÊ HÀNG TỒN KHO', fontSize: 17, bold: true, alignment: 'center', margin: [0, 2, 0, 2] },
        { text: `Kho : ${w.warehouse}`, color: RED, italics: true, bold: true, alignment: 'center', fontSize: 10.5, margin: [0, 0, 0, 8] },
        { text: `Ngày Kiểm Kho : ${dmy(s.countDate)}`, bold: true, fontSize: 8.5 },
        { text: `Thời gian bắt đầu : ${hmph(t.start)}   Thời gian kết thúc : ${hmph(t.end)}`, bold: true, fontSize: 8.5, margin: [0, 0, 0, 4] },
        {
          table: { headerRows: 3, widths: hasLot ? [20, 50, 52, '*', 30, 46, 46, 46, 62] : [22, 78, '*', 30, 44, 50, 50, 80], body },
          layout: {
            hLineWidth: (i, n) => (i <= 3 || i === n.table.body.length || i === n.table.body.length - 1) ? 0.7 : 0.4,
            vLineWidth: () => 0.5, hLineColor: () => '#555', vLineColor: () => '#555',
            hLineStyle: (i, n) => (i > 4 && i < n.table.body.length - 1) ? { dash: { length: 1.5, space: 1.5 } } : null,
            paddingTop: () => 2, paddingBottom: () => 2, paddingLeft: () => 3, paddingRight: () => 3
          },
          fontSize: 8
        },
        signRow(people, withSig)
      );
    });
    return {
      pageSize: 'A4', pageMargins: [26, 26, 26, 30], images,
      defaultStyle: { font: 'Roboto', fontSize: 8.5 },
      footer: (p, n) => ({ text: `${docNo(s)}${withSig ? '' : ' — bản ký tay'} · ${p}/${n}`, alignment: 'right', fontSize: 7, color: MUTED, margin: [0, 10, 26, 0] }),
      info: { title: 'Biên bản kiểm kê vật tư ' + docNo(s) },
      content
    };
  }

  // ===================== Kiểm kê vật tư: báo cáo slide (mẫu BA5146) =====================
  // opts.whImages: { [kho]: [ảnh trang biên bản...] }
  function suppliesReportDoc(s, opts = {}) {
    const W = 841.89, H = 595.28, M = 34;
    const images = {};
    const logo = Branding.logo();
    if (logo) images.logo = logo;
    const groups = [...byWarehouse(s.items)];
    const counted = s.items.filter(i => i.actualQty != null);
    const diff = counted.filter(i => Math.abs(variance(i)) > 0.0005);
    // File SAP có cột giá trị: tính giá trị chênh lệch theo đơn giá bình quân sổ sách
    const priced = diff.filter(i => i.sysValue != null && i.sysQty);
    const diffValue = priced.length ? Math.round(priced.reduce((a, i) => a + variance(i) * i.sysValue / i.sysQty, 0)) : null;
    const acc = counted.length ? Math.round((counted.length - diff.length) / counted.length * 1000) / 10 : 0;
    const content = [];
    const leaves = () => ({ canvas: [
      { type: 'ellipse', x: W - 60, y: 120, r1: 150, r2: 230, color: GREEN },
      { type: 'ellipse', x: W - 60, y: 120, r1: 95, r2: 170, color: TEAL },
      { type: 'ellipse', x: W - 210, y: 420, r1: 60, r2: 26, color: GREEN },
      { type: 'ellipse', x: W - 300, y: 300, r1: 22, r2: 55, color: GREEN }
    ], absolutePosition: { x: 0, y: 0 } });
    const bg = color => ({ canvas: [{ type: 'rect', x: 0, y: 0, w: W, h: H, color }], absolutePosition: { x: 0, y: 0 } });
    const titleBar = (txt, first) => ({
      stack: [
        { canvas: [{ type: 'rect', x: 120, y: 0, w: W - 120, h: 50, r: 25, color: TEAL }, { type: 'ellipse', x: 140, y: 25, r1: 30, r2: 30, color: GREEN }], absolutePosition: { x: 0, y: 8 } },
        { text: txt.toUpperCase(), color: '#fff', bold: true, fontSize: 22, absolutePosition: { x: 190, y: 20 } }
      ], pageBreak: first ? undefined : 'before'
    });
    const divider = (no, txt) => [
      { text: '', pageBreak: 'before' }, bg('#ffffff'), leaves(),
      { canvas: [{ type: 'rect', x: 0, y: 0, w: 480, h: 170, r: 85, color: TEAL }], absolutePosition: { x: -85, y: 180 } },
      { text: no, color: '#fff', bold: true, fontSize: 40, absolutePosition: { x: 36, y: 236 } },
      { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 0, y2: 60, lineWidth: 3, lineColor: '#fff' }], absolutePosition: { x: 110, y: 235 } },
      { text: txt, color: '#fff', bold: true, fontSize: 24, absolutePosition: { x: 128, y: 238 }, width: 250 }
    ];
    const whTitle = list => whName(list[0]);

    // 1. Bìa
    content.push(
      bg(TEAL), leaves(),
      logo ? { canvas: [{ type: 'rect', x: 0, y: 0, w: 230, h: 76, r: 8, color: '#ffffff' }], absolutePosition: { x: 50, y: 50 } } : '',
      logo ? { image: 'logo', fit: [210, 60], absolutePosition: { x: 60, y: 58 } } : '',
      { text: 'Check Warehouse', color: '#fff', bold: true, fontSize: 30, absolutePosition: { x: 50, y: 175 } },
      { text: groups.map(([, l]) => whTitle(l)).join(' & '), color: '#fff', bold: true, fontSize: 22, absolutePosition: { x: 50, y: 220 }, width: 520 },
      { text: (s.factory.shortName || s.factory.name).toUpperCase(), color: '#fff', bold: true, fontSize: 16, absolutePosition: { x: 70, y: 430 } },
      { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 420, y2: 0, lineWidth: 3, lineColor: '#fff' }], absolutePosition: { x: 64, y: 458 } },
      { text: new Date(s.countDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }), color: '#fff', bold: true, fontSize: 14, absolutePosition: { x: 70, y: 470 } },
      { text: `Người kiểm tra: ${s.user.name}`, color: '#fff', fontSize: 11, absolutePosition: { x: 70, y: 492 } }
    );

    // 2. Tóm tắt
    content.push(titleBar('Tóm tắt kết quả kiểm kê'));
    const card = (label, value, sub, color) => ({ table: { widths: ['*'], body: [[{ stack: [
      { text: label, fontSize: 9, color: MUTED }, { text: value, fontSize: 24, bold: true, color: color || GREEN, margin: [0, 4, 0, 2] }, { text: sub, fontSize: 8.5, color: MUTED }
    ], margin: [10, 8, 10, 8] }]] }, layout: { hLineWidth: () => 0, vLineWidth: i => i === 0 ? 4 : 0, vLineColor: () => color || GREEN, fillColor: () => '#f7f9fb' } });
    content.push({ margin: [0, 50, 0, 0], columns: [
      card('Số kho đã kiểm', String(groups.length), groups.map(([, l]) => l[0].warehouseCode).join(' · ')),
      card('Mã hàng đã kiểm', `${counted.length}/${s.items.length}`, 'dòng đã đếm / tổng dòng', counted.length === s.items.length ? GREEN : '#e65100'),
      card('Độ chính xác', Util.fmt(acc) + '%', `${counted.length - diff.length} dòng khớp sổ sách`, acc >= 98 ? GREEN : acc >= 95 ? '#e65100' : RED),
      card('Dòng chênh lệch', String(diff.length), diff.length ? (diffValue != null ? 'Giá trị lệch: ' + Q(diffValue) + ' đ' : 'xem bảng chi tiết') : 'Không có chênh lệch', diff.length ? RED : GREEN)
    ], columnGap: 12 });
    content.push({ margin: [0, 16, 0, 0], table: { headerRows: 1, widths: ['*', 70, 70, 80, 80, 80], body: [
      ['Kho', 'Số dòng', 'Đã kiểm', 'SL sổ sách', 'SL thực tế', 'Chênh lệch'].map(t => ({ text: t, bold: true, color: '#fff', fillColor: GREEN })),
      ...groups.map(([wh, l]) => {
        const c = l.filter(i => i.actualQty != null);
        const d = c.reduce((a, i) => a + variance(i), 0);
        const t = whTimes(s, l);
        return [`${wh}  (${hmph(t.start)} – ${hmph(t.end)})`, { text: l.length, alignment: 'right' }, { text: c.length, alignment: 'right' },
          { text: Q(l.reduce((a, i) => a + i.sysQty, 0)), alignment: 'right' }, { text: Q(c.reduce((a, i) => a + i.actualQty, 0)), alignment: 'right' },
          { text: D(Util.round(d, 3)), alignment: 'right', bold: true, color: Math.abs(d) > 0.0005 ? RED : DARK }];
      })
    ] }, layout: { hLineWidth: () => 0.5, vLineWidth: () => 0, hLineColor: () => LINE, paddingTop: () => 4, paddingBottom: () => 4 }, fontSize: 9.5 });
    if (diff.length) {
      content.push({ text: 'Dòng chênh lệch', bold: true, color: RED, margin: [0, 12, 0, 4] });
      content.push({ table: { headerRows: 1, widths: [70, '*', 40, 60, 60, 60, 140], body: [
        ['Mã', 'Tên', 'ĐVT', 'Sổ sách', 'Thực tế', 'CL', 'Ghi chú'].map(t => ({ text: t, bold: true, color: '#fff', fillColor: RED })),
        ...diff.slice(0, 12).map(i => [i.code, i.name, i.unit, { text: Q(i.sysQty), alignment: 'right' }, { text: Q(i.actualQty), alignment: 'right' }, { text: D(variance(i)), alignment: 'right', bold: true }, i.note || ''])
      ] }, layout: { hLineWidth: () => 0.5, vLineWidth: () => 0, hLineColor: () => LINE }, fontSize: 8.5 });
    }

    // 3. Biên bản theo kho
    content.push(...divider('01', 'CHECK\nWAREHOUSE'));
    groups.forEach(([wh, l]) => {
      const imgs = (opts.whImages || {})[wh] || [];
      const pick = imgs.length > 2 ? [imgs[0], imgs[imgs.length - 1]] : imgs;
      content.push(titleBar('Warehouse – ' + whTitle(l)));
      content.push({ margin: [0, 62, 0, 0], columns: pick.length ? pick.map(img => ({ width: '*', image: img, fit: [(W - 2 * M - 14) / 2, H - 175], alignment: 'center' }))
        : [{ text: 'Xem file biên bản kiểm kê kèm theo.', italics: true, color: MUTED }], columnGap: 14 });
    });

    // 4. Hình ảnh kiểm kho theo kho
    content.push(...divider('02', 'CHECKING\nWAREHOUSE\nIMAGES'));
    const photoSlide = (caption, photos) => {
      content.push(titleBar('Checking warehouse images'));
      content.push({ margin: [0, 62, 0, 6], columns: [{ width: 34, canvas: [{ type: 'rect', x: 0, y: 6, w: 22, h: 8, color: '#4472c4' }, { type: 'polyline', closePath: true, points: [{ x: 20, y: 0 }, { x: 34, y: 10 }, { x: 20, y: 20 }], color: '#4472c4' }] },
        { width: '*', text: caption, fontSize: 14, margin: [8, 0, 0, 0] }] });
      const w = (W - 2 * M - 16) / 3;
      content.push({ columns: photos.slice(0, 3).map(p => ({ width: w, image: p, fit: [w, H - 170], alignment: 'center' })), columnGap: 8 });
    };
    groups.forEach(([wh, l]) => {
      const photos = [].concat(...l.map(i => i.photos || []), ...(s.generalPhotos || []).filter(g => g.wh === wh).map(g => g.data));
      for (let i = 0; i < Math.max(photos.length, 1) && i < 9; i += 3) {
        photoSlide(`Hàng hóa của kho ${whTitle(l)} & Hình ảnh kiểm đếm hàng hóa`, photos.slice(i, i + 3));
        if (!photos.length) content.push({ text: 'Chưa có ảnh cho kho này.', italics: true, color: MUTED, margin: [0, 20, 0, 0] });
      }
    });
    const common = [s.checkIn && s.checkIn.data, s.checkOut && s.checkOut.data, ...(s.generalPhotos || []).filter(g => !g.wh).map(g => g.data)].filter(Boolean);
    if (common.length) for (let i = 0; i < common.length; i += 3) photoSlide('Hình ảnh xác nhận có mặt & hiện trường kiểm kê', common.slice(i, i + 3));

    // 5. Báo cáo tồn gốc từ chương trình (Package / Ingredient): chèn từng trang PDF đính kèm
    const src = opts.sourceImages || [];
    if (src.length) {
      content.push(...divider('03', 'PROGRAM\nSTOCK\nREPORT'));
      src.slice(0, 20).forEach((img, i) => {
        content.push(titleBar(`Báo cáo tồn từ chương trình · ${i + 1}/${src.length}`));
        content.push({ margin: [0, 60, 0, 0], image: img, fit: [W - 2 * M, H - 120], alignment: 'center' });
      });
      if ((opts.sourceNames || []).length) content.push({ text: 'File gốc: ' + opts.sourceNames.join(', '), fontSize: 8, color: MUTED, margin: [0, 4, 0, 0] });
    }

    // 6. Thank You
    content.push({ text: '', pageBreak: 'before' }, bg(TEAL), leaves(),
      logo ? { canvas: [{ type: 'rect', x: 0, y: 0, w: 230, h: 76, r: 8, color: '#ffffff' }], absolutePosition: { x: 50, y: 50 } } : '',
      logo ? { image: 'logo', fit: [210, 60], absolutePosition: { x: 60, y: 58 } } : '',
      { text: 'Thank You', color: '#fff', bold: true, fontSize: 54, absolutePosition: { x: 60, y: 250 } });

    return {
      pageSize: 'A4', pageOrientation: 'landscape', pageMargins: [M, 30, M, 26], images,
      defaultStyle: { font: 'Roboto', fontSize: 10, color: DARK },
      footer: (p, n) => (p === 1 || p === n) ? null : { text: `${docNo(s)} · ${p}/${n}`, alignment: 'right', fontSize: 7, color: MUTED, margin: [0, 6, M, 0] },
      info: { title: 'Báo cáo kiểm kê vật tư ' + docNo(s) },
      content
    };
  }

  // ===================== Kiểm tra chi nhánh: biên bản checklist =====================
  function branchSummary(s) {
    const all = [].concat(...s.checklist.sections.map(sec => sec.items.map(it => Object.assign({ sec }, it))));
    const pass = all.filter(i => i.result === 'pass'), fail = all.filter(i => i.result === 'fail'), todo = all.filter(i => !i.result);
    return { all, pass, fail, todo, score: all.length ? Math.round(pass.length / Math.max(1, pass.length + fail.length) * 1000) / 10 : 0 };
  }

  function branchRecordDoc(s, withSig) {
    const images = {};
    const sum = branchSummary(s);
    const cl = s.checklist;
    // Mỗi ô phải là một đối tượng riêng: pdfmake ghi thêm dữ liệu vào node, dùng chung một đối tượng sẽ làm treo khi dàn trang
    const X = () => ({ text: 'X', bold: true, alignment: 'center' });
    const body = [
      [{ text: 'STT', rowSpan: 2 }, { text: 'Chỉ tiêu kiểm tra', rowSpan: 2 }, { text: 'Đánh giá', colSpan: 3 }, null, null].map(c => c ? Object.assign({ bold: true, alignment: 'center', color: '#fff', fillColor: GREEN }, c) : {}),
      [{}, {}, 'Đạt', 'Không đạt', 'Ghi chú'].map(c => typeof c === 'string' ? { text: c, bold: true, alignment: 'center', color: '#fff', fillColor: GREEN } : c)
    ];
    cl.sections.forEach(sec => {
      body.push([{ text: sec.no + '.', bold: true, fillColor: GREEN_LIGHT }, { text: sec.title, bold: true, colSpan: 4, fillColor: GREEN_LIGHT }, {}, {}, {}]);
      sec.items.forEach(it => body.push([
        { text: it.no, alignment: 'center' }, it.text,
        it.result === 'pass' ? X() : '', it.result === 'fail' ? Object.assign(X(), { color: RED }) : '',
        { text: [it.note || '', (it.photos || []).length ? ` (${it.photos.length} ảnh)` : ''].join(''), fontSize: 8 }
      ]));
    });
    const people = s.committee.filter(p => p.name || p.role);
    const content = [
      { text: s.companyName.toUpperCase(), bold: true, fontSize: 10 },
      { text: 'CHI NHÁNH : ' + (s.factory.shortName || s.factory.name), bold: true, fontSize: 10, margin: [0, 0, 0, 8] },
      { text: cl.title || 'BIÊN BẢN KIỂM TRA NHÀ MÁY', bold: true, fontSize: 15, alignment: 'center' },
      { text: dateWords(s.countDate), italics: true, alignment: 'center', margin: [0, 2, 0, 8] },
      { columns: [{ text: [{ text: 'Tên nhà máy : ', bold: true }, s.factory.name] }, { text: [{ text: 'Địa chỉ : ', bold: true }, s.factory.address || ''] }], columnGap: 12, fontSize: 9 },
      { text: [{ text: 'Loại sản phẩm: ', bold: true }, s.productType || '..................................'], fontSize: 9, margin: [0, 2, 0, 2] },
      { text: [{ text: 'Thời gian kiểm tra: ', bold: true }, `${hmph(s.checkIn && s.checkIn.time)} – ${hmph(s.checkOut && s.checkOut.time)}`, '   ', { text: 'Người kiểm: ', bold: true }, s.user.name], fontSize: 9, margin: [0, 0, 0, 6] },
      {
        table: { headerRows: 2, widths: [26, '*', 34, 44, 140], body },
        layout: { hLineWidth: () => 0.5, vLineWidth: () => 0.5, hLineColor: () => '#777', vLineColor: () => '#777', paddingTop: () => 2.5, paddingBottom: () => 2.5 },
        fontSize: 8.5
      },
      {
        margin: [0, 8, 0, 0], table: { widths: ['*', '*', '*', '*'], body: [[
          { text: [{ text: 'Tổng chỉ tiêu: ', bold: true }, String(sum.all.length)] },
          { text: [{ text: 'Đạt: ', bold: true, color: GREEN }, String(sum.pass.length)] },
          { text: [{ text: 'Không đạt: ', bold: true, color: RED }, String(sum.fail.length)] },
          { text: [{ text: 'Tỉ lệ đạt: ', bold: true }, Util.fmt(sum.score) + '%'] }
        ]] }, layout: { hLineWidth: () => 0.5, vLineWidth: () => 0.5, hLineColor: () => GREEN, vLineColor: () => GREEN, fillColor: () => GREEN_LIGHT, paddingTop: () => 4, paddingBottom: () => 4 }
      },
      { text: 'Ý kiến của giám đốc', bold: true, margin: [0, 10, 0, 2] },
      { text: s.opinion || '..............................................................................................................................................................' },
      signRow(people, withSig)
    ];
    // Phụ lục: chỉ tiêu không đạt kèm ảnh, rồi ảnh các chỉ tiêu khác và ảnh có mặt
    const withPhotos = sum.all.filter(i => (i.photos || []).length).sort((a, b) => (a.result === 'fail' ? 0 : 1) - (b.result === 'fail' ? 0 : 1));
    const presence = [s.checkIn, s.checkOut].filter(Boolean);
    if (sum.fail.length || withPhotos.length || presence.length) {
      content.push({ text: 'PHỤ LỤC: CHỈ TIÊU KHÔNG ĐẠT VÀ HÌNH ẢNH', bold: true, fontSize: 12, color: GREEN, pageBreak: 'before', margin: [0, 0, 0, 6] });
      if (sum.fail.length) {
        content.push({ table: { headerRows: 1, widths: [60, '*', 150], body: [
          ['Mục', 'Chỉ tiêu không đạt', 'Ghi chú'].map(t => ({ text: t, bold: true, color: '#fff', fillColor: RED })),
          ...sum.fail.map(i => [`${i.sec.no}.${i.no}`, i.text, i.note || ''])
        ] }, layout: { hLineWidth: () => 0.5, vLineWidth: () => 0, hLineColor: () => LINE }, fontSize: 9, margin: [0, 0, 0, 10] });
      }
      withPhotos.forEach(i => {
        content.push({ text: `${i.sec.no}.${i.no} ${i.text} – ${i.result === 'fail' ? 'KHÔNG ĐẠT' : i.result === 'pass' ? 'Đạt' : 'Chưa đánh giá'}${i.note ? ' – ' + i.note : ''}`, bold: true, fontSize: 9, color: i.result === 'fail' ? RED : DARK, margin: [0, 6, 0, 3] });
        for (let k = 0; k < i.photos.length; k += 2) content.push({ columns: i.photos.slice(k, k + 2).map(p => ({ image: p, fit: [255, 200] })), columnGap: 10, margin: [0, 0, 0, 6] });
      });
      if (presence.length) {
        content.push({ text: 'Ảnh xác nhận có mặt (bắt đầu / kết thúc)', bold: true, fontSize: 9, margin: [0, 8, 0, 3] });
        content.push({ columns: presence.map(p => ({ stack: [{ image: p.data, fit: [220, 240] }, { text: `${Stamp.dt(new Date(p.time))} · ${Geo.fmt(p.geo)}`, fontSize: 7.5, color: MUTED }] })), columnGap: 12 });
      }
    }
    return {
      pageSize: 'A4', pageMargins: [30, 28, 30, 30], images,
      defaultStyle: { font: 'Roboto', fontSize: 9 },
      footer: (p, n) => ({ text: `${docNo(s)}${withSig ? '' : ' — bản ký tay'} · ${p}/${n}`, alignment: 'right', fontSize: 7, color: MUTED, margin: [0, 10, 30, 0] }),
      info: { title: 'Biên bản kiểm tra chi nhánh ' + docNo(s) },
      content
    };
  }

  function branchExcel(s) {
    const sum = branchSummary(s);
    const rows = sum.all.map(i => ({ 'Mục': i.sec.no, 'Khu vực': i.sec.title, 'STT': i.no, 'Chỉ tiêu': i.text, 'Kết quả': i.result === 'pass' ? 'Đạt' : i.result === 'fail' ? 'Không đạt' : '', 'Ghi chú': i.note || '', 'Số ảnh': (i.photos || []).length }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'KiemTraChiNhanh');
    return new Blob([XLSX.write(wb, { bookType: 'xlsx', type: 'array' })], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }

  function suppliesExcel(s) {
    const price = it => it.sysValue != null && it.sysQty ? it.sysValue / it.sysQty : null;
    const rows = s.items.map((it, i) => Object.assign({ STT: i + 1, 'Kho': it.warehouse, 'Mã': it.code }, it.lot ? { 'Số lô': it.lot } : {}, it.productCode ? { 'Product Code': it.productCode } : {},
      { 'Tên sản phẩm': it.name, 'ĐVT': it.unit, 'SL sổ sách': it.sysQty, 'SL thực tế': it.actualQty, 'Chênh lệch': variance(it) },
      price(it) != null ? { 'Giá trị sổ sách': it.sysValue, 'Giá trị chênh lệch': variance(it) == null ? null : Math.round(variance(it) * price(it)) } : {},
      { 'Ghi chú': it.note, 'Số ảnh': (it.photos || []).length }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'KiemKeVatTu');
    return new Blob([XLSX.write(wb, { bookType: 'xlsx', type: 'array' })], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }

  return { suppliesRecordDoc, suppliesReportDoc, branchRecordDoc, branchSummary, branchExcel, suppliesExcel, docNo, byWarehouse };
})();
