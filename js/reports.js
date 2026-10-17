// Tạo PDF: biên bản kiểm kê (có chữ ký / bản trống để ký ngoài) và báo cáo đi kiểm kê kho.
const Reports = (function () {
  const F = Util.fmt;
  const STATUS_COLOR = { expired: '#c62828', near: '#e65100', ok: '#2e7d32', unknown: '#757575' };

  function docNo(s) {
    return `BBKK-${s.factory.code}-${s.countDate.replace(/-/g, '')}`;
  }

  function dateWords(iso) {
    const [y, m, d] = iso.split('-');
    return `ngày ${d} tháng ${m} năm ${y}`;
  }

  function enrich(s) {
    const cfg = Config.get();
    return s.items.map(it => Object.assign({}, it, {
      exp: Util.expiry(it, s.countDate, cfg),
      var: Util.variance(it),
      aWgh: Util.actualWgh(it)
    }));
  }

  function summary(s) {
    const items = enrich(s);
    const sum = { lines: items.length, counted: 0, sysQty: 0, sysWgh: 0, actQty: 0, actWgh: 0, overLines: 0, shortLines: 0, expired: 0, near: 0, photos: 0 };
    items.forEach(it => {
      sum.sysQty += it.sysQty; sum.sysWgh += it.sysWgh;
      if (it.actualQty != null) {
        sum.counted++; sum.actQty += it.actualQty; sum.actWgh += it.aWgh;
        if (it.var.qty > 0 || (it.var.qty === 0 && it.var.wgh > 0.0005)) sum.overLines++;
        if (it.var.qty < 0 || (it.var.qty === 0 && it.var.wgh < -0.0005)) sum.shortLines++;
      }
      if (it.exp.status === 'expired') sum.expired++;
      if (it.exp.status === 'near') sum.near++;
      sum.photos += (it.photos || []).length;
    });
    return { items, sum };
  }

  function byWarehouse(items) {
    const map = new Map();
    items.forEach(it => { if (!map.has(it.warehouse)) map.set(it.warehouse, []); map.get(it.warehouse).push(it); });
    return map;
  }

  const signed = v => v == null ? '' : (v > 0 ? '+' : '') + F(v);
  // Định dạng số giống biên bản mẫu: 17,348.79 ; số lượng không lẻ ; chênh lệch 0 ghi "-"
  const N = (n, dec) => (n == null || n === '') ? '' : Number(n).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
  const Q = n => (n == null || n === '') ? '' : Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });
  const D = (n, dec) => (n == null) ? '' : (Math.abs(n) < 0.0005 ? '-' : (n > 0 ? '+' : '') + (dec ? N(n, dec) : Q(n)));
  const hm = ts => { const d = new Date(ts); return `${Util.pad(d.getHours())}h${Util.pad(d.getMinutes())}`; };
  const whName = it => it.warehouseCode ? it.warehouse.replace(new RegExp('^' + it.warehouseCode + '\\s*-\\s*'), '') : it.warehouse;

  // Tên kho in dưới tiêu đề: người dùng sửa được ở bước xem lại, mặc định ghép tên các kho
  function storeTitle(s) {
    return s.storeTitle || [...new Set(s.items.map(whName))].join(' & ');
  }

  // Màu xanh theo logo C.P Slaughter House
  const GREEN = '#0a7a3c', GREEN_LIGHT = '#e6f4ea', GREEN_MID = '#c3e6cc';

  // Đầu trang giống biên bản mẫu: (logo) tên công ty / chi nhánh / địa chỉ
  function headerBlock(s, rightText) {
    const logo = Branding.logo();
    return {
      columns: [
        logo ? { width: 120, image: logo, fit: [120, 40], margin: [0, 0, 8, 0] } : { width: 0, text: '' },
        { width: '*', fontSize: 9, stack: [
          { text: s.companyName, bold: true },
          { text: s.factory.name },
          s.factory.address ? { text: 'Địa chỉ : ' + s.factory.address, italics: true } : ''
        ] },
        { width: 'auto', alignment: 'right', fontSize: 8, color: '#555', stack: rightText || [] }
      ],
      margin: [0, 0, 0, 10]
    };
  }

  // Khối ký: mỗi hàng 4 người — chữ ký, họ tên, dòng chấm, chức danh (in nghiêng đậm)
  function signatureBlock(s, withSignatures) {
    const people = s.committee.filter(p => p.name || p.role);
    const cell = p => ({
      width: '*', alignment: 'center', stack: [
        withSignatures && p.signature ? { image: p.signature, fit: [105, 46], margin: [0, 0, 0, 2] }
          : withSignatures && p.absent ? { text: 'Vắng mặt', italics: true, color: '#777', fontSize: 8, margin: [0, 22, 0, 22] }
          : { text: ' ', margin: [0, 22, 0, 22] },
        { text: p.name || ' ', fontSize: 8 },
        { text: '..................................................', fontSize: 7, color: '#555' },
        { text: p.role || '', bold: true, italics: true, fontSize: 8 },
        p.title ? { text: p.title, italics: true, fontSize: 7, color: '#555' } : ''
      ]
    });
    const rows = [];
    for (let i = 0; i < people.length; i += 4) {
      const chunk = people.slice(i, i + 4).map(cell);
      while (chunk.length < 4) chunk.push({ width: '*', text: '' });
      rows.push({ columns: chunk, columnGap: 6, margin: [0, 12, 0, 0] });
    }
    return { stack: rows, margin: [0, 12, 0, 0], unbreakable: true };
  }

  // ---------- Biên bản kiểm kê (theo mẫu 22.09 đã ký) ----------
  // opts.appendix = false: bỏ phụ lục ảnh (khi chèn biên bản vào báo cáo kiểm kê, ảnh đã có ở phần riêng)
  function inventoryDoc(s, withSignatures, opts = {}) {
    const { items } = summary(s);
    const cfg = Config.get();
    const H = (t, o = {}) => Object.assign({ text: t, style: 'th' }, o);
    const body = [
      [H('STT', { rowSpan: 3 }), H('Mã SAP', { rowSpan: 3 }), H('Tên Sản Phẩm', { rowSpan: 3 }), H('ĐVT', { rowSpan: 3 }), H('Lot', { rowSpan: 3 }),
        H((s.factory && s.factory.systemName) || cfg.systemName || 'SmartSoft_Food', { colSpan: 2 }), {}, H('Kiểm Thực Tế', { colSpan: 2 }), {}, H('Chênh Lệch', { colSpan: 2 }), {},
        H('Ghi Chú', { rowSpan: 3 })],
      [{}, {}, {}, {}, {}, H('(1)', { colSpan: 2 }), {}, H('(2)', { colSpan: 2 }), {}, H('(3) = (2) - (1)', { colSpan: 2 }), {}, {}],
      [{}, {}, {}, {}, {}, H('Số Lượng'), H('Trọng Lượng'), H('Số Lượng'), H('Trọng Lượng'), H('Số Lượng'), H('Trọng Lượng'), {}]
    ];
    const tot = list => list.reduce((a, it) => {
      a[0] += it.sysQty; a[1] += it.sysWgh;
      if (it.actualQty != null) { a[2] += it.actualQty; a[3] += it.aWgh; a[4] += it.var.qty; a[5] += it.var.wgh; }
      return a;
    }, [0, 0, 0, 0, 0, 0]);
    let stt = 0;
    for (const list of byWarehouse(items).values()) {
      const w = list[0];
      body.push([{ text: `Warehouse : ${w.warehouseCode}   ${whName(w)}`, colSpan: 12, bold: true, decoration: 'underline', fontSize: 8, fillColor: GREEN_LIGHT }, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}]);
      list.forEach(it => {
        stt++;
        const v = it.var;
        const hl = v && (v.qty !== 0 || Math.abs(v.wgh) > 0.0005);
        const notes = [];
        if (it.isExtra) notes.push({ text: 'Ngoài sổ sách. ' });
        if (it.actualQty == null) notes.push({ text: 'Chưa kiểm. ', color: '#c62828' });
        if (it.exp.status === 'expired' || it.exp.status === 'near') notes.push({ text: `${it.exp.label} (HSD ${Util.vnDate(it.exp.expDate)}). `, color: STATUS_COLOR[it.exp.status], bold: true });
        if (it.note) notes.push({ text: it.note });
        body.push([
          { text: stt, alignment: 'center' }, it.code, it.name, { text: it.unit || '', alignment: 'center' }, { text: it.lot, alignment: 'center' },
          { text: Q(it.sysQty), alignment: 'right' }, { text: N(it.sysWgh, 2), alignment: 'right' },
          { text: Q(it.actualQty), alignment: 'right' }, { text: N(it.aWgh, 2), alignment: 'right' },
          { text: v ? D(v.qty) : '', alignment: 'center', bold: hl, color: hl ? '#c62828' : null },
          { text: v ? D(v.wgh, 2) : '', alignment: 'center', bold: hl, color: hl ? '#c62828' : null },
          { text: notes.length ? notes : '' }
        ]);
      });
      const t = tot(list);
      const tc = { fillColor: GREEN_MID };
      body.push([Object.assign({ text: '' }, tc), Object.assign({ text: '' }, tc), { text: 'Tổng Cộng', bold: true, alignment: 'center', fillColor: GREEN_MID }, Object.assign({ text: '' }, tc), Object.assign({ text: '' }, tc),
        ...[Q(t[0]), N(t[1], 2), Q(t[2]), N(t[3], 2), D(Util.round(t[4])), D(Util.round(t[5]), 2)].map((x, i) => ({ text: x, bold: true, alignment: i > 3 ? 'center' : 'right', fillColor: GREEN_MID })), Object.assign({ text: '' }, tc)]);
    }
    const g = tot(items);
    body.push([{ text: 'TỔNG', colSpan: 5, bold: true, alignment: 'center', fontSize: 8, fillColor: GREEN, color: '#fff' }, {}, {}, {}, {},
      ...[Q(g[0]), N(g[1], 2), Q(g[2]), N(g[3], 2), D(Util.round(g[4])), D(Util.round(g[5]), 2)].map((x, i) => ({ text: x, bold: true, alignment: i > 3 ? 'center' : 'right', fillColor: GREEN, color: '#fff' })), { text: '', fillColor: GREEN }]);

    const content = [
      headerBlock(s, withSignatures ? [] : [{ text: 'Bản ký tay' }]),
      { text: 'BIÊN BẢN KIỂM KÊ HÀNG TỒN KHO', style: 'title' },
      { text: 'Kho : ' + storeTitle(s), alignment: 'center', italics: true, fontSize: 10, margin: [0, 0, 0, 8] },
      { text: `Ngày Kiểm Kho :            ${Util.vnDate(s.countDate)}`, fontSize: 8 },
      { text: `Thời gian bắt đầu : ${hm(startTime(s))}    Thời gian kết thúc : ${endTime(s) ? hm(endTime(s)) : '.......'}`, fontSize: 8, margin: [0, 0, 0, 3] },
      {
        table: { headerRows: 3, widths: [16, 52, '*', 24, 58, 26, 40, 26, 40, 26, 38, 62], body },
        layout: { hLineWidth: () => 0.5, vLineWidth: () => 0.5, hLineColor: () => '#555', vLineColor: () => '#555', paddingLeft: () => 2, paddingRight: () => 2, paddingTop: () => 1, paddingBottom: () => 1 },
        fontSize: 7
      },
      (s.opinion || s.generalNote) ? {
        margin: [0, 6, 0, 0], fontSize: 8, stack: [
          s.opinion ? { text: [{ text: 'Ý kiến xử lý chênh lệch: ', bold: true }, s.opinion] } : '',
          s.generalNote ? { text: [{ text: 'Ghi chú: ', bold: true }, s.generalNote] } : ''
        ]
      } : '',
      signatureBlock(s, withSignatures)
    ];

    if (withSignatures && opts.appendix !== false) {
      const pics = [...presenceBlock(s), ...photoAppendix(items)];
      if (pics.length) content.push({ text: 'PHỤ LỤC: HÌNH ẢNH ĐÍNH KÈM', style: 'h2', pageBreak: 'before' }, ...pics);
    }

    return {
      pageSize: 'A4', pageMargins: [28, 28, 28, 30],
      defaultStyle: { font: 'Roboto', fontSize: 8 },
      styles: {
        title: { fontSize: 15, bold: true, alignment: 'center', margin: [0, 2, 0, 2] },
        h2: { fontSize: 11, bold: true, margin: [0, 8, 0, 4] },
        th: { alignment: 'center', fontSize: 7, bold: true, color: '#fff', fillColor: GREEN }
      },
      footer: p => ({ text: String(p), alignment: 'center', fontSize: 7, margin: [0, 10, 0, 0] }),
      info: { title: 'Biên bản kiểm kê ' + docNo(s) },
      content
    };
  }

  // Giờ bắt đầu / kết thúc lấy theo ảnh xác nhận có mặt
  const startTime = s => (s.checkIn && s.checkIn.time) || s.startedAt;
  const endTime = s => (s.checkOut && s.checkOut.time) || s.finishedAt;

  // Ảnh bắt đầu / kết thúc kèm giờ và toạ độ
  function presenceBlock(s) {
    const cell = (label, p) => p ? {
      width: '*', stack: [
        { text: label, bold: true, fontSize: 9 },
        { image: p.data, fit: [240, 240], margin: [0, 3, 0, 3] },
        { text: `${Stamp.dt(new Date(p.time))} · ${Geo.fmt(p.geo)}`, fontSize: 8 },
        distanceText(s, p) ? { text: distanceText(s, p), fontSize: 8, italics: true } : ''
      ]
    } : { width: '*', text: '' };
    if (!s.checkIn && !s.checkOut) return [];
    return [{ columns: [cell('Ảnh bắt đầu kiểm kê', s.checkIn), cell('Ảnh kết thúc kiểm kê', s.checkOut)], columnGap: 12, margin: [0, 4, 0, 8], unbreakable: true }];
  }

  function distanceText(s, p) {
    const f = s.factory;
    if (!p || !p.geo || p.geo.error || f.lat == null || f.lat === '' || f.lng == null) return '';
    const d = Geo.distance(p.geo, { lat: Number(f.lat), lng: Number(f.lng) });
    return `Cách nhà máy ${d >= 1000 ? (d / 1000).toFixed(1) + ' km' : d + ' m'}`;
  }

  function photoAppendix(items) {
    const out = [];
    items.filter(it => (it.photos || []).length).forEach(it => {
      out.push({ text: `${it.code} – ${it.name} – Lô ${it.lot} – ${it.warehouse}` + (it.var ? `  (chênh lệch SL ${signed(it.var.qty)}, KL ${signed(it.var.wgh)})` : '') + (it.note ? ` – ${it.note}` : ''), bold: true, fontSize: 8, margin: [0, 6, 0, 2] });
      // 2 ảnh mỗi hàng, đủ lớn để đọc được dòng ngày giờ / toạ độ in trên ảnh
      for (let i = 0; i < it.photos.length; i += 2) {
        out.push({ columns: it.photos.slice(i, i + 2).map(p => ({ image: p, fit: [250, 220] })), columnGap: 8, margin: [0, 0, 0, 6] });
      }
    });
    return out;
  }

  // ---------- Báo cáo kiểm kê dạng slide (A4 ngang) ----------
  // Bố cục theo cách trình bày báo cáo kiểm kê chuyên nghiệp: bìa → tóm tắt điều hành (KPI) → kết quả theo kho
  // → chênh lệch & hạn dùng → biên bản đã ký → hình ảnh → vấn đề phát sinh → kế hoạch hành động → Thank You.
  // opts.minutesImages: ảnh các trang biên bản đã ký; opts.cover: ảnh bìa nhà máy
  function tripDoc(s, opts = {}) {
    const { items, sum } = summary(s);
    const tr = s.trip || {};
    const user = s.user || {};
    const ACCENT = '#f39200', DARK = '#1d2433', MUTED = '#6b7280', LINE = '#dfe5ec';
    const RED = '#c62828', ORANGE = '#e65100', BLUE = '#1565c0';
    const W = 841.89, H = 595.28, M = 36, CW = W - 2 * M, TOP = 70;
    const logo = Branding.logo();
    const cover = opts.cover || s.coverPhoto || (s.checkIn && s.checkIn.data) || null;
    const st = startTime(s), en = endTime(s);
    const images = {};
    if (logo) images.logo = logo;
    const P = (t, o = {}) => Object.assign({ text: t, margin: [0, 2, 0, 2] }, o);
    const pct = (a, b) => b ? Math.round(a / b * 1000) / 10 : 0;
    const kg = n => F(Util.round(n, 2)) + ' kg';
    // Đơn vị tính: của dòng hàng, hoặc đơn vị dùng nhiều nhất của một nhóm dòng
    const unitOf = list => {
      const n = {};
      list.forEach(i => { const u = String(i.unit || '').trim(); if (u) n[u] = (n[u] || 0) + 1; });
      return Object.keys(n).sort((a, b) => n[b] - n[a])[0] || 'ĐV';
    };
    const mainUnit = unitOf(items);

    // ---- số liệu tổng hợp ----
    const counted = items.filter(i => i.actualQty != null);
    const isDiff = i => i.var && (i.var.qty !== 0 || Math.abs(i.var.wgh) > 0.0005);
    const diff = counted.filter(isDiff).sort((a, b) => Math.abs(b.var.wgh) - Math.abs(a.var.wgh));
    const matchLines = counted.length - diff.length;
    const accuracy = pct(matchLines, counted.length);
    const coverage = pct(counted.length, items.length);
    const sysW = counted.reduce((a, i) => a + i.sysWgh, 0);
    const varW = counted.reduce((a, i) => a + i.var.wgh, 0);
    const varQ = counted.reduce((a, i) => a + i.var.qty, 0);
    const expired = items.filter(i => i.exp.status === 'expired');
    const near = items.filter(i => i.exp.status === 'near');
    const uncounted = items.filter(i => i.actualQty == null);
    const scans = Object.keys(s.scannedTags || {}).length;
    const unknown = (s.unknownScans || []).length;

    // ---- khung trang: header logo + footer ----
    const header = (pg, n) => (pg === 1 || pg === n) ? null : {
      margin: [M, 16, M, 0],
      stack: [{
        columns: [
          logo ? { width: 160, image: 'logo', fit: [160, 34] } : { width: '*', text: s.companyName, bold: true, color: GREEN, fontSize: 10 },
          { width: '*', alignment: 'right', fontSize: 8, color: MUTED, margin: [0, 6, 0, 0], stack: [
            { text: 'BÁO CÁO KIỂM KÊ', bold: true, color: GREEN, fontSize: 9 },
            { text: `${s.factory.name} · ${Util.vnDate(s.countDate)}` }
          ] }
        ]
      }, { canvas: [{ type: 'line', x1: 0, y1: 5, x2: CW, y2: 5, lineWidth: 1.5, lineColor: GREEN }] }]
    };
    const footer = (pg, n) => (pg === 1 || pg === n) ? null : {
      margin: [M, 8, M, 0], fontSize: 7, color: MUTED,
      columns: [{ text: `${s.companyName} · ${docNo(s)}` }, { text: `${pg} / ${n}`, alignment: 'right' }]
    };

    // Tiêu đề slide: số mục + tiêu đề + 1 câu kết luận (thông điệp chính của slide)
    const slide = (no, title, lead, first) => ({
      stack: [
        { text: [{ text: no + '  ', color: ACCENT, bold: true }, { text: title, bold: true, color: DARK }], fontSize: 18 },
        lead ? { text: lead, fontSize: 10.5, color: MUTED, margin: [0, 3, 0, 0] } : ''
      ],
      margin: [0, 0, 0, 12], pageBreak: first ? undefined : 'before'
    });
    const card = (label, value, sub, color) => ({
      table: { widths: ['*'], body: [[{
        stack: [
          { text: label, fontSize: 9, color: MUTED },
          { text: value, fontSize: 24, bold: true, color: color || GREEN, margin: [0, 4, 0, 2] },
          { text: sub || '', fontSize: 8.5, color: MUTED }
        ], margin: [10, 8, 10, 8]
      }]] },
      layout: { hLineWidth: () => 0, vLineWidth: (i) => i === 0 ? 4 : 0, vLineColor: () => color || GREEN, fillColor: () => '#f7f9fb' }
    });
    const tableLayout = {
      hLineWidth: (i, node) => (i === 0 || i === 1 || i === node.table.body.length) ? 1 : 0.5,
      vLineWidth: () => 0, hLineColor: (i) => i <= 1 ? GREEN : LINE,
      fillColor: (r) => r === 0 ? GREEN : (r % 2 === 0 ? '#f7faf8' : null),
      paddingTop: () => 4, paddingBottom: () => 4, paddingLeft: () => 5, paddingRight: () => 5
    };
    const th = t => ({ text: t, bold: true, color: '#fff', fontSize: 8.5 });
    const photoGrid = (list, cols = 3, h = 150) => {
      const out = [];
      const w = (CW - (cols - 1) * 12) / cols;
      for (let i = 0; i < list.length; i += cols) {
        const row = list.slice(i, i + cols).map(x => ({ width: w, stack: [
          { image: x.data, fit: [w, h], alignment: 'center' },
          { text: x.caption || '', fontSize: 7.5, color: MUTED, margin: [0, 3, 0, 0] }
        ] }));
        while (row.length < cols) row.push({ width: w, text: '' });
        out.push({ columns: row, columnGap: 12, margin: [0, 0, 0, 10], unbreakable: true });
      }
      return out;
    };

    const content = [];

    // ===== 1. Bìa: ảnh nhà máy nửa trái, thông tin nửa phải =====
    const leftW = W * 0.52;
    content.push(
      cover ? { image: cover, width: leftW, height: H, absolutePosition: { x: 0, y: 0 } }
        : { canvas: [{ type: 'rect', x: 0, y: 0, w: leftW, h: H, color: GREEN_LIGHT }], absolutePosition: { x: 0, y: 0 } },
      { canvas: [{ type: 'rect', x: 0, y: 0, w: 6, h: H, color: ACCENT }], absolutePosition: { x: leftW, y: 0 } },
      logo ? { image: 'logo', fit: [230, 60], absolutePosition: { x: leftW + 34, y: 40 } } : '',
      { text: 'BÁO CÁO', fontSize: 16, bold: true, color: ACCENT, absolutePosition: { x: leftW + 34, y: 140 } },
      { text: 'KIỂM KÊ', fontSize: 40, bold: true, color: GREEN, absolutePosition: { x: leftW + 32, y: 160 } },
      { text: 'HÀNG TỒN KHO', fontSize: 16, bold: true, color: DARK, absolutePosition: { x: leftW + 34, y: 210 } },
      { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 60, y2: 0, lineWidth: 3, lineColor: GREEN }], absolutePosition: { x: leftW + 34, y: 242 } },
      {
        absolutePosition: { x: leftW + 34, y: 262 }, width: W - leftW - 70,
        table: { widths: [86, '*'], body: [
          ['Ngày kiểm kê', Util.vnDate(s.countDate)],
          ['Nhà máy', s.factory.name],
          ['Địa chỉ', s.factory.address || ''],
          ['Kho kiểm', storeTitle(s)],
          ['Thời gian', `${hm(st)}${en ? ' – ' + hm(en) : ''}`],
          ['Số biên bản', docNo(s)]
        ].map(([k, v]) => [{ text: k, fontSize: 9, color: MUTED }, { text: v, fontSize: 10, bold: true, color: DARK }]) },
        layout: { hLineWidth: (i, node) => (i === 0 || i === node.table.body.length) ? 0 : 0.5, vLineWidth: () => 0, hLineColor: () => LINE, paddingTop: () => 4, paddingBottom: () => 4, paddingLeft: () => 0 }
      },
      {
        absolutePosition: { x: leftW + 34, y: H - 92 }, width: W - leftW - 70,
        table: { widths: ['*'], body: [[{
          stack: [{ text: 'NGƯỜI KIỂM TRA', fontSize: 8, color: '#fff', bold: true }, { text: `${user.name || ''}`, fontSize: 14, color: '#fff', bold: true }, { text: user.email || '', fontSize: 8.5, color: '#fff' }],
          fillColor: ACCENT, margin: [12, 8, 12, 8]
        }]] },
        layout: 'noBorders'
      }
    );

    // ===== 2. Tóm tắt điều hành =====
    const findings = [];
    findings.push(`Đã kiểm ${counted.length}/${items.length} dòng hàng (${F(coverage)}%) tại ${byWarehouse(items).size} kho.`);
    findings.push(diff.length ? `${diff.length} dòng lệch sổ: số lượng ${signed(Util.round(varQ))}, trọng lượng ${signed(Util.round(varW))} kg (${signed(pct(varW, sysW))}% so với sổ).` : 'Số lượng và trọng lượng thực tế khớp sổ.');
    if (diff.length) findings.push(`Lệch nhiều nhất: ${diff[0].code} – ${diff[0].name}, lô ${diff[0].lot}: ${signed(diff[0].var.qty)} ${unitOf([diff[0]])}, ${signed(diff[0].var.wgh)} kg.`);
    if (expired.length || near.length) findings.push(`${expired.length} dòng hết hạn, ${near.length} dòng sắp hết hạn, cần xử lý trước.`);
    if (uncounted.length) findings.push(`${uncounted.length} dòng chưa kiểm.`);
    if (scans) findings.push(`Đã quét ${scans} tem${unknown ? `, ${unknown} tem không có trong sổ` : ''}.`);
    const actions = actionPlan();
    content.push(slide('01', 'Tóm tắt kết quả kiểm kê', diff.length || expired.length ? 'Có hàng lệch sổ hoặc sắp hết hạn cần xử lý.' : 'Hàng thực tế khớp sổ, không có hàng hết hạn.'));
    content.push({
      columns: [
        card('Tỉ lệ khớp sổ', F(accuracy) + '%', `${matchLines}/${counted.length} dòng khớp sổ`, accuracy >= 98 ? GREEN : accuracy >= 95 ? ORANGE : RED),
        card('Đã kiểm', F(coverage) + '%', `${counted.length}/${items.length} dòng`, coverage === 100 ? GREEN : ORANGE),
        card('Lệch so với sổ', signed(Util.round(varW, 1)) + ' kg', `Số lượng ${signed(Util.round(varQ))} ${mainUnit} · ${signed(pct(varW, sysW))}% trọng lượng sổ`, Math.abs(varW) < 0.005 && Math.abs(varQ) < 0.0005 ? GREEN : RED),
        card('Hết hạn / sắp hết hạn', String(expired.length + near.length), `${expired.length} hết hạn · ${near.length} sắp hết hạn`, expired.length ? RED : near.length ? ORANGE : GREEN)
      ], columnGap: 12, margin: [0, 0, 0, 16]
    });
    content.push({
      columns: [
        { width: '*', stack: [
          { text: 'KẾT QUẢ CHÍNH', bold: true, color: GREEN, fontSize: 11, margin: [0, 0, 0, 6] },
          { ul: findings, fontSize: 10, color: DARK, lineHeight: 1.25 }
        ] },
        { width: '*', stack: [
          { text: 'VIỆC CẦN LÀM', bold: true, color: ACCENT, fontSize: 11, margin: [0, 0, 0, 6] },
          { ol: actions.slice(0, 5).map(a => `${a.action} (${a.owner}, trước ${Util.vnDate(a.due)})`), fontSize: 10, color: DARK, lineHeight: 1.25 }
        ] }
      ], columnGap: 24
    });

    // ===== 3. Kết quả theo kho: bảng + biểu đồ chênh lệch =====
    const whs = [...byWarehouse(items)].map(([wh, list]) => {
      const c = list.filter(i => i.actualQty != null);
      return {
        wh, lines: list.length, counted: c.length,
        sysQ: list.reduce((a, i) => a + i.sysQty, 0), actQ: c.reduce((a, i) => a + i.actualQty, 0),
        sysW: list.reduce((a, i) => a + i.sysWgh, 0), actW: c.reduce((a, i) => a + i.aWgh, 0),
        varW: c.reduce((a, i) => a + i.var.wgh, 0), varQ: c.reduce((a, i) => a + i.var.qty, 0), diff: c.filter(isDiff).length, unit: unitOf(list)
      };
    });
    content.push(slide('02', 'Kết quả theo kho', `Đã kiểm ${whs.length} kho. Bảng có số lượng (${mainUnit}) và trọng lượng (kg); biểu đồ: phần lệch của từng kho so với sổ.`));
    // Biểu đồ thanh: mỗi kho một hàng, thanh lệch trái (thiếu, đỏ) hoặc phải (thừa, xanh) quanh trục 0
    const maxAbs = Math.max(0.01, ...whs.map(w => Math.abs(w.varW)));
    const barW = 130, mid = barW / 2;
    const chart = { width: 290, stack: [
      { text: 'Lệch theo kho (kg · số lượng)', bold: true, fontSize: 9, color: DARK, margin: [0, 0, 0, 8] },
      ...whs.map(w => {
        const len = Math.max(1.5, Math.abs(w.varW) / maxAbs * (mid - 4));
        const col = Math.abs(w.varW) < 0.005 ? '#b0bec5' : (w.varW > 0 ? BLUE : RED);
        return { columns: [
          { width: 100, text: w.wh.replace(/^(\S+)\s-\s/, '$1 '), fontSize: 7.5, color: DARK, margin: [0, 4, 0, 0] },
          { width: barW, canvas: [
            { type: 'rect', x: 0, y: 0, w: barW, h: 20, color: '#f3f6f4' },
            { type: 'line', x1: mid, y1: -2, x2: mid, y2: 22, lineWidth: 1, lineColor: MUTED },
            { type: 'rect', x: w.varW >= 0 ? mid : mid - len, y: 4, w: len, h: 12, color: col }
          ] },
          { width: '*', stack: [{ text: signed(Util.round(w.varW, 2)) + ' kg', fontSize: 8, bold: true, color: col }, { text: `${signed(Util.round(w.varQ))} ${w.unit}`, fontSize: 7, color: MUTED }], margin: [4, 1, 0, 0] }
        ], columnGap: 4, margin: [0, 0, 0, 8] };
      }),
      { columns: [{ width: 100, text: '' }, { width: barW, columns: [{ text: '‹ thiếu', fontSize: 7, color: RED }, { text: 'thừa ›', fontSize: 7, color: BLUE, alignment: 'right' }] }], margin: [0, 2, 0, 0] }
    ] };    content.push({
      columns: [
        { width: '*', table: { headerRows: 1, widths: ['*', 30, 30, 42, 42, 40, 48, 48, 44], body: [
          ['Kho', 'Dòng', 'ĐVT', 'SL sổ', 'SL thực tế', 'Lệch SL', 'KL sổ (kg)', 'KL thực tế', 'Lệch KL'].map(th),
          ...whs.map(w => [
            { text: w.wh, fontSize: 8 }, { text: `${w.counted}/${w.lines}`, alignment: 'right', fontSize: 8 }, { text: w.unit, alignment: 'center', fontSize: 8 },
            { text: F(w.sysQ), alignment: 'right', fontSize: 8 }, { text: F(w.actQ), alignment: 'right', fontSize: 8 },
            { text: signed(Util.round(w.varQ)), alignment: 'right', fontSize: 8, bold: true, color: Math.abs(w.varQ) < 0.0005 ? DARK : (w.varQ > 0 ? BLUE : RED) },
            { text: F(Util.round(w.sysW, 2)), alignment: 'right', fontSize: 8 }, { text: F(Util.round(w.actW, 2)), alignment: 'right', fontSize: 8 },
            { text: signed(Util.round(w.varW, 2)), alignment: 'right', fontSize: 8, bold: true, color: Math.abs(w.varW) < 0.005 ? DARK : (w.varW > 0 ? BLUE : RED) }
          ]),
          [{ text: 'Tổng cộng', bold: true, fontSize: 8 }, { text: `${counted.length}/${items.length}`, alignment: 'right', bold: true, fontSize: 8 }, { text: mainUnit, alignment: 'center', bold: true, fontSize: 8 },
            { text: F(sum.sysQty), alignment: 'right', bold: true, fontSize: 8 }, { text: F(sum.actQty), alignment: 'right', bold: true, fontSize: 8 },
            { text: signed(Util.round(varQ)), alignment: 'right', bold: true, fontSize: 8 },
            { text: F(Util.round(sum.sysWgh, 2)), alignment: 'right', bold: true, fontSize: 8 }, { text: F(Util.round(sum.actWgh, 2)), alignment: 'right', bold: true, fontSize: 8 },
            { text: signed(Util.round(varW, 2)), alignment: 'right', bold: true, fontSize: 8 }]
        ] }, layout: tableLayout },
        chart
      ], columnGap: 24
    });

    // ===== 4. Chênh lệch & hạn dùng =====
    content.push(slide('03', 'Hàng lệch sổ và hạn sử dụng', diff.length ? 'Xếp theo số kg lệch, nhiều nhất ở trên.' : 'Không có dòng lệch sổ.'));
    const topDiff = diff.slice(0, 10);
    const expAll = expired.concat(near).slice(0, 10);
    content.push({
      columns: [
        { width: '*', stack: [
          { text: `HÀNG LỆCH SỔ (${diff.length})`, bold: true, color: GREEN, fontSize: 10, margin: [0, 0, 0, 6] },
          topDiff.length ? { table: { headerRows: 1, widths: [44, '*', 60, 30, 36, 50], body: [
            ['Mã', 'Tên hàng', 'Lô', 'ĐVT', 'Lệch SL', 'Lệch KL (kg)'].map(th),
            ...topDiff.map(i => [{ text: i.code, fontSize: 8 }, { text: i.name, fontSize: 8 }, { text: i.lot, fontSize: 7.5 }, { text: unitOf([i]), fontSize: 7.5, alignment: 'center' },
              { text: signed(i.var.qty), alignment: 'right', fontSize: 8, color: i.var.qty < 0 ? RED : BLUE, bold: true },
              { text: signed(i.var.wgh), alignment: 'right', fontSize: 8, color: i.var.wgh < 0 ? RED : BLUE, bold: true }])
          ] }, layout: tableLayout } : P('Không có hàng lệch sổ.', { italics: true, color: MUTED }),
          diff.length > topDiff.length ? P(`… và ${diff.length - topDiff.length} dòng khác (xem biên bản).`, { fontSize: 8, color: MUTED }) : ''
        ] },
        { width: '*', stack: [
          { text: `HẠN SỬ DỤNG (${expired.length} hết hạn · ${near.length} sắp hết hạn)`, bold: true, color: ACCENT, fontSize: 10, margin: [0, 0, 0, 6] },
          expAll.length ? { table: { headerRows: 1, widths: [44, '*', 50, 34, 30, 44, 62], body: [
            ['Mã', 'Tên hàng', 'HSD', 'SL', 'ĐVT', 'KL (kg)', 'Tình trạng'].map(th),
            ...expAll.map(i => [{ text: i.code, fontSize: 8 }, { text: i.name, fontSize: 8 }, { text: Util.vnDate(i.exp.expDate), fontSize: 8 },
              { text: F(i.actualQty != null ? i.actualQty : i.sysQty), alignment: 'right', fontSize: 8 }, { text: unitOf([i]), alignment: 'center', fontSize: 7.5 },
              { text: F(Util.round(i.actualQty != null ? i.aWgh : i.sysWgh, 2)), alignment: 'right', fontSize: 8 },
              { text: i.exp.label, fontSize: 7.5, bold: true, color: i.exp.status === 'expired' ? RED : ORANGE }])
          ] }, layout: tableLayout } : P('Không có hàng hết hạn hoặc sắp hết hạn.', { italics: true, color: MUTED })
        ] }
      ], columnGap: 20
    });

    // ===== 5. Biên bản kiểm kê có chữ ký: 2 trang biên bản trên một slide =====
    const mins = opts.minutesImages || [];
    for (let i = 0; i < Math.max(1, mins.length); i += 2) {
      content.push(slide('04', 'Biên bản kiểm kê đã ký', i === 0 ? `Biên bản số ${docNo(s)}, ${mins.length} trang, ký trên app.` : '', false));
      if (!mins.length) { content.push(P('Xem file biên bản đã ký gửi kèm: ' + fileNames(s).signed, { italics: true })); break; }
      content.push({
        columns: mins.slice(i, i + 2).map(img => ({ width: '*', image: img, fit: [(CW - 16) / 2, H - TOP - 120], alignment: 'center' })),
        columnGap: 16
      });
    }

    // ===== 6. Hình ảnh nội dung kiểm kê =====
    const scene = [];
    if (s.checkIn) scene.push({ data: s.checkIn.data, caption: `Bắt đầu – ${Stamp.dt(new Date(s.checkIn.time))} – ${Geo.fmt(s.checkIn.geo)}` });
    if (s.checkOut) scene.push({ data: s.checkOut.data, caption: `Kết thúc – ${Stamp.dt(new Date(s.checkOut.time))} – ${Geo.fmt(s.checkOut.geo)}` });
    (s.generalPhotos || []).forEach(g => scene.push({ data: g.data, caption: g.caption || 'Ảnh tại kho' }));
    content.push(slide('05', 'Ảnh kiểm kê', 'Ảnh lúc bắt đầu, kết thúc và tại kho, có ngày giờ và vị trí GPS.'));
    if (scene.length) content.push(...photoGrid(scene, 3, 175)); else content.push(P('Không có ảnh.', { italics: true, color: MUTED }));

    // ===== 7. Hình ảnh sản phẩm kiểm kho =====
    const issueTags = it => {
      const v = it.var, tags = [];
      if (v && v.qty < 0) tags.push(['Thiếu', RED]);
      if (v && v.qty > 0) tags.push(['Thừa', BLUE]);
      if (v && v.qty === 0 && Math.abs(v.wgh) > 0.0005) tags.push(['Lệch trọng lượng', RED]);
      if (it.exp.status === 'expired') tags.push(['Hết hạn', RED]);
      if (it.exp.status === 'near') tags.push(['Sắp hết hạn', ORANGE]);
      if (it.isExtra) tags.push(['Ngoài sổ sách', '#6a1b9a']);
      return tags;
    };
    const issues = items.filter(it => issueTags(it).length);
    const issueIds = new Set(issues.map(i => i.id));
    const productPhotos = [];
    items.filter(it => !issueIds.has(it.id) && (it.photos || []).length).forEach(it =>
      it.photos.forEach(ph => productPhotos.push({ data: ph, caption: `${it.code} – ${it.name} – Lô ${it.lot}` })));
    content.push(slide('06', 'Ảnh sản phẩm', 'Một số sản phẩm chụp lúc kiểm đếm.'));
    if (productPhotos.length) content.push(...photoGrid(productPhotos, 3, 175));
    else content.push(P('Không có ảnh sản phẩm (ảnh hàng cần lưu ý ở mục sau).', { italics: true, color: MUTED }));

    // ===== 8. Hàng cần lưu ý =====
    content.push(slide('07', 'Hàng cần lưu ý', issues.length ? `${issues.length} dòng hàng cần lưu ý, kèm ghi chú và ảnh.` : 'Không có hàng cần lưu ý.'));
    const issueCard = it => {
      const v = it.var;
      return { stack: [
        { text: [{ text: `${it.code} – ${it.name}  `, bold: true, fontSize: 10, color: DARK },
          ...issueTags(it).flatMap(([t, c]) => [{ text: ` ${t} `, color: '#fff', background: c, bold: true, fontSize: 7.5 }, ' '])] },
        { text: `Lô ${it.lot} · ${it.warehouse} · HSD ${Util.vnDate(it.exp.expDate)} (${it.exp.label})`, fontSize: 7.5, color: MUTED, margin: [0, 2, 0, 2] },
        v ? { text: `Sổ ${F(it.sysQty)} ${unitOf([it])} / ${F(it.sysWgh)} kg   |   Thực tế ${F(it.actualQty)} ${unitOf([it])} / ${F(it.aWgh)} kg   |   Lệch ${signed(v.qty)} ${unitOf([it])} / ${signed(v.wgh)} kg`, fontSize: 8.5 } : { text: 'Chưa kiểm', fontSize: 8.5, color: MUTED },
        it.note ? { text: [{ text: 'Ghi chú: ', bold: true }, it.note], fontSize: 8.5, margin: [0, 2, 0, 0] } : '',
        (it.photos || []).length ? { columns: it.photos.slice(0, 3).map(ph => ({ image: ph, fit: [110, 85] })), columnGap: 6, margin: [0, 4, 0, 0] } : ''
      ], margin: [0, 0, 0, 10], unbreakable: true };
    };
    if (issues.length) {
      for (let i = 0; i < issues.length; i += 2) {
        content.push({ columns: [issueCard(issues[i]), issues[i + 1] ? issueCard(issues[i + 1]) : { text: '' }], columnGap: 20 });
      }
    }
    if (unknown) content.push(P(`Tem không có trong sổ (${unknown}): ` + s.unknownScans.map(u => u.text).join(' · '), { fontSize: 8, color: RED }));
    if (uncounted.length) content.push(P(`Chưa kiểm (${uncounted.length}): ` + uncounted.map(i => `${i.code}/${i.lot}`).join(', '), { fontSize: 8, color: MUTED }));

    // ===== 9. Kế hoạch hành động & kết luận =====
    content.push(slide('08', 'Kết luận và việc cần làm', 'Việc cần làm sau kiểm kê, ai phụ trách, hạn hoàn thành.'));
    content.push({ table: { headerRows: 1, widths: [20, '*', '*', 110, 70], body: [
      ['#', 'Vấn đề', 'Việc cần làm', 'Phụ trách', 'Hạn'].map(th),
      ...actions.map((a, i) => [{ text: i + 1, fontSize: 9 }, { text: a.issue, fontSize: 9 }, { text: a.action, fontSize: 9 }, { text: a.owner, fontSize: 9 }, { text: Util.vnDate(a.due), fontSize: 9, bold: true }])
    ] }, layout: tableLayout, margin: [0, 0, 0, 12] });
    content.push({
      columns: [
        { width: '*', stack: [
          { text: 'KẾT LUẬN', bold: true, color: GREEN, fontSize: 10, margin: [0, 0, 0, 3] },
          P(tr.conclusion || findings.join(' '), { fontSize: 9.5 }),
          tr.recommendation ? { text: 'KIẾN NGHỊ', bold: true, color: GREEN, fontSize: 10, margin: [0, 6, 0, 3] } : '',
          tr.recommendation ? P(tr.recommendation, { fontSize: 9.5 }) : ''
        ] },
        { width: 200, alignment: 'center', stack: [
          { text: dateWords(s.countDate), italics: true, fontSize: 9 },
          { text: 'NGƯỜI KIỂM TRA', bold: true, fontSize: 10 },
          s.reporterSignature ? { image: s.reporterSignature, fit: [130, 55], margin: [0, 4, 0, 2] } : { text: ' ', margin: [0, 25, 0, 25] },
          { text: user.name || '', bold: true }
        ] }
      ], columnGap: 24, unbreakable: true
    });

    // ===== 10. Thank You =====
    content.push(
      { text: '', pageBreak: 'before' },
      { canvas: [{ type: 'rect', x: 0, y: 0, w: W, h: H, color: GREEN }, { type: 'rect', x: 0, y: H - 70, w: W, h: 6, color: ACCENT }], absolutePosition: { x: 0, y: 0 } },
      logo ? { canvas: [{ type: 'rect', x: 0, y: 0, w: 280, h: 86, r: 10, color: '#ffffff' }], absolutePosition: { x: 60, y: 70 } } : '',
      logo ? { image: 'logo', fit: [250, 66], absolutePosition: { x: 75, y: 80 } } : '',
      { text: 'XIN CẢM ƠN', color: '#ffffff', fontSize: 60, bold: true, absolutePosition: { x: 60, y: 230 } },
      { text: s.companyName, color: '#ffffff', fontSize: 11, bold: true, absolutePosition: { x: 64, y: 360 } },
      { text: `${s.factory.name} · ${Util.vnDate(s.countDate)} · ${docNo(s)}`, color: '#d6f5e1', fontSize: 10, absolutePosition: { x: 64, y: 378 } }
    );

    return {
      pageSize: 'A4', pageOrientation: 'landscape', pageMargins: [M, TOP, M, 34],
      defaultStyle: { font: 'Roboto', fontSize: 10, color: DARK },
      images, header, footer,
      info: { title: 'Báo cáo kiểm kê ' + docNo(s) },
      content
    };

    // Kế hoạch hành động tự đề xuất từ kết quả (có thể sửa bằng phần Kiến nghị)
    function actionPlan() {
      const d = n => Util.addDays(s.countDate, n);
      const list = [];
      const short = diff.filter(i => i.var.qty < 0 || (i.var.qty === 0 && i.var.wgh < 0));
      const over = diff.filter(i => i.var.qty > 0 || (i.var.qty === 0 && i.var.wgh > 0));
      if (short.length) list.push({ issue: `${short.length} dòng thiếu (${signed(Util.round(short.reduce((a, i) => a + i.var.qty, 0)))} ${mainUnit}, ${signed(Util.round(short.reduce((a, i) => a + i.var.wgh, 0), 2))} kg)`, action: 'Đối chiếu phiếu nhập/xuất, giải trình lý do, điều chỉnh sổ khi được duyệt', owner: 'Thủ kho + Kế toán', due: d(2) });
      if (over.length) list.push({ issue: `${over.length} dòng thừa (${signed(Util.round(over.reduce((a, i) => a + i.var.qty, 0)))} ${mainUnit}, ${signed(Util.round(over.reduce((a, i) => a + i.var.wgh, 0), 2))} kg)`, action: 'Tìm phiếu nhập chưa ghi sổ, nhập bổ sung vào hệ thống', owner: 'Thủ kho + Kế toán', due: d(2) });
      if (expired.length) list.push({ issue: `${expired.length} dòng hết hạn`, action: 'Để riêng hàng, lập biên bản xử lý hoặc hủy', owner: 'QA + Quản lý kho', due: d(1) });
      if (near.length) list.push({ issue: `${near.length} dòng sắp hết hạn`, action: 'Xuất trước hàng gần hết hạn, báo bộ phận bán hàng', owner: 'Quản lý kho', due: d(1) });
      if (uncounted.length) list.push({ issue: `${uncounted.length} dòng chưa kiểm`, action: 'Kiểm bổ sung, cập nhật biên bản', owner: 'Kế toán', due: d(1) });
      if (unknown) list.push({ issue: `${unknown} tem không có trong sổ`, action: 'Kiểm tra lại tem, xem hàng đã nhập hệ thống chưa', owner: 'Thủ kho', due: d(2) });
      if (!list.length) list.push({ issue: 'Không có hàng lệch sổ', action: 'Giữ cách quản lý kho hiện tại, kiểm kê định kỳ', owner: 'Quản lý kho', due: d(30) });
      return list;
    }
  }

  function toBlob(doc) {
    return new Promise((resolve, reject) => {
      try { pdfMake.createPdf(doc).getBlob(resolve); } catch (e) { reject(e); }
    });
  }

  // Excel kết quả để kế toán xử lý tiếp
  function excelBlob(s) {
    const { items } = summary(s);
    const rows = items.map((it, i) => ({
      STT: i + 1, 'Mã hàng': it.code, 'Tên hàng': it.name, 'Số lô': it.lot, 'Kho': it.warehouse,
      'Ngày SX': Util.vnDate(it.prodDate), 'Hạn dùng (ngày)': it.shelfLife, 'Hạn SD': Util.vnDate(it.exp.expDate),
      'SL sổ sách': it.sysQty, 'KL sổ sách': it.sysWgh, 'SL thực tế': it.actualQty, 'KL thực tế': it.aWgh,
      'CL SL': it.var ? it.var.qty : null, 'CL KL': it.var ? it.var.wgh : null,
      'Tình trạng HSD': it.exp.label, 'Ngoài sổ sách': it.isExtra ? 'x' : '', 'Số ảnh': (it.photos || []).length, 'Ghi chú': it.note
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'KetQuaKiemKe');
    // Tổng theo mã hàng (cộng các lô / các lần cân)
    const byCode = new Map();
    items.forEach(it => {
      const r = byCode.get(it.code) || { 'Mã hàng': it.code, 'Tên hàng': it.name, 'Số dòng': 0, 'SL sổ sách': 0, 'KL sổ sách': 0, 'SL thực tế': 0, 'KL thực tế': 0, 'Số lần cân/quét': 0 };
      r['Số dòng']++; r['SL sổ sách'] += it.sysQty; r['KL sổ sách'] = Util.round(r['KL sổ sách'] + it.sysWgh);
      if (it.actualQty != null) { r['SL thực tế'] += it.actualQty; r['KL thực tế'] = Util.round(r['KL thực tế'] + it.aWgh); }
      r['Số lần cân/quét'] += (it.weighs || []).length;
      byCode.set(it.code, r);
    });
    const codeRows = [...byCode.values()].map(r => Object.assign(r, { 'CL SL': Util.round(r['SL thực tế'] - r['SL sổ sách']), 'CL KL': Util.round(r['KL thực tế'] - r['KL sổ sách']) }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(codeRows), 'TheoMaHang');
    // Nhật ký từng lần cân / quét tem
    const log = [];
    items.forEach(it => (it.weighs || []).forEach((w, i) => log.push({
      'Mã hàng': it.code, 'Tên hàng': it.name, 'Số lô': it.lot, 'Lần': i + 1, 'SL': w.qty, 'KL (kg)': w.wgh,
      'Nguồn': w.src === 'scan' ? 'Quét tem' : 'Cân tay', 'KL ước tính': w.estimated ? 'x' : '', 'Thời gian': Util.vnDateTime(w.time), 'Nội dung tem': w.tag || ''
    })));
    (s.unknownScans || []).forEach(u => log.push({ 'Mã hàng': '?', 'Tên hàng': 'Tem không có trong sổ', 'Thời gian': Util.vnDateTime(u.time), 'Nội dung tem': u.text }));
    if (log.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(log), 'CacLanCanQuet');
    const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    return new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }

  function fileNames(s) {
    const base = `${docNo(s)}`;
    return {
      signed: `${base}_BienBan_DaKy.pdf`,
      unsigned: `${base}_BienBan_KyTay.pdf`,
      trip: `${base}_BaoCaoKiemKe.pdf`,
      excel: `${base}_KetQua.xlsx`
    };
  }

  return { inventoryDoc, tripDoc, toBlob, excelBlob, summary, fileNames, docNo, storeTitle };
})();
