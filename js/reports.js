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

  // Đầu trang giống biên bản mẫu: tên công ty / chi nhánh / địa chỉ
  function headerBlock(s, rightText) {
    return {
      columns: [
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
        withSignatures && p.signature ? { image: p.signature, fit: [105, 46], margin: [0, 0, 0, 2] } : { text: ' ', margin: [0, 22, 0, 22] },
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
        H(cfg.systemName || 'SmartSoft_Food', { colSpan: 2 }), {}, H('Kiểm Thực Tế', { colSpan: 2 }), {}, H('Chênh Lệch', { colSpan: 2 }), {},
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
      body.push([{ text: `Warehouse : ${w.warehouseCode}   ${whName(w)}`, colSpan: 12, bold: true, decoration: 'underline', fontSize: 8 }, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}]);
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
      body.push(['', '', { text: 'Tổng Cộng', bold: true, alignment: 'center' }, '', '',
        ...[Q(t[0]), N(t[1], 2), Q(t[2]), N(t[3], 2), D(Util.round(t[4])), D(Util.round(t[5]), 2)].map((x, i) => ({ text: x, bold: true, alignment: i > 3 ? 'center' : 'right' })), '']);
    }
    const g = tot(items);
    body.push([{ text: 'TỔNG', colSpan: 5, bold: true, alignment: 'center', fontSize: 8 }, {}, {}, {}, {},
      ...[Q(g[0]), N(g[1], 2), Q(g[2]), N(g[3], 2), D(Util.round(g[4])), D(Util.round(g[5]), 2)].map((x, i) => ({ text: x, bold: true, alignment: i > 3 ? 'center' : 'right' })), '']);

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
          s.opinion ? { text: [{ text: 'Ý kiến giải quyết chênh lệch: ', bold: true }, s.opinion] } : '',
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
        th: { alignment: 'center', fontSize: 7 }
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
    return `Cách toạ độ nhà máy ${d >= 1000 ? (d / 1000).toFixed(1) + ' km' : d + ' m'}`;
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

  // ---------- Báo cáo kiểm kê: trang bìa / nội dung / Thank You ----------
  // opts.minutesImages: ảnh các trang biên bản đã ký; opts.cover: ảnh bìa nhà máy
  function tripDoc(s, opts = {}) {
    const { items, sum } = summary(s);
    const tr = s.trip || {};
    const user = s.user || {};
    const BRAND = '#0b3d91', ACCENT = '#f5b400';
    const W = 595.28, Hh = 841.89;
    const p = (t, o = {}) => Object.assign({ text: t, margin: [0, 2, 0, 2] }, o);
    const cover = opts.cover || s.coverPhoto || (s.checkIn && s.checkIn.data) || null;
    const st = startTime(s), en = endTime(s);
    const inspectors = s.committee.filter(m => m.name).map(m => `${m.name}${m.role ? ' – ' + m.role : ''}`);

    // ===== Trang 1: bìa =====
    const infoRow = (k, v) => [{ text: k, color: '#5f6b7a', fontSize: 10 }, { text: v || '', bold: true, fontSize: 11 }];
    const coverPage = [
      { canvas: [{ type: 'rect', x: 0, y: 0, w: W, h: 150, color: BRAND }, { type: 'rect', x: 0, y: 150, w: W, h: 6, color: ACCENT }], absolutePosition: { x: 0, y: 0 } },
      { text: s.companyName.toUpperCase(), color: '#ffffff', fontSize: 11, bold: true, absolutePosition: { x: 40, y: 34 } },
      { text: s.factory.name, color: '#dbe6ff', fontSize: 10, absolutePosition: { x: 40, y: 52 } },
      { text: 'BÁO CÁO KIỂM KÊ', color: '#ffffff', fontSize: 30, bold: true, absolutePosition: { x: 40, y: 80 } },
      { text: 'Hàng tồn kho · ' + Util.vnDate(s.countDate), color: '#ffd76a', fontSize: 12, absolutePosition: { x: 42, y: 118 } },
      cover
        ? { image: cover, fit: [W - 80, 340], alignment: 'center', margin: [0, 140, 0, 18] }
        : { canvas: [{ type: 'rect', x: 0, y: 0, w: W - 80, h: 260, color: '#e8eef8' }], margin: [0, 140, 0, 18] },
      {
        table: {
          widths: [110, '*'],
          body: [
            infoRow('Ngày kiểm kê', dateWords(s.countDate).replace(/^ngày/, 'Ngày')),
            infoRow('Nhà máy', s.factory.name),
            s.factory.address ? infoRow('Địa chỉ', s.factory.address) : infoRow('', ''),
            infoRow('Kho kiểm kê', storeTitle(s)),
            infoRow('Người kiểm tra', `${user.name || ''}${user.email ? ' (' + user.email + ')' : ''}`),
            infoRow('Thời gian', `${hm(st)}${en ? ' – ' + hm(en) : ''}`),
            infoRow('Số biên bản', docNo(s))
          ]
        },
        layout: { hLineWidth: (i, node) => (i === 0 || i === node.table.body.length) ? 0 : 0.5, vLineWidth: () => 0, hLineColor: () => '#d5dce6', paddingTop: () => 5, paddingBottom: () => 5 },
        margin: [0, 0, 0, 0]
      },
      { text: '', pageBreak: 'after' }
    ];

    // ===== Trang nội dung =====
    const issueOf = it => {
      const v = it.var;
      const tags = [];
      if (it.actualQty == null) tags.push({ t: 'Chưa kiểm', c: '#757575' });
      if (v && v.qty < 0) tags.push({ t: 'Thiếu', c: '#c62828' });
      if (v && v.qty > 0) tags.push({ t: 'Thừa', c: '#1565c0' });
      if (v && v.qty === 0 && Math.abs(v.wgh) > 0.0005) tags.push({ t: 'Lệch trọng lượng', c: '#c62828' });
      if (it.exp.status === 'expired') tags.push({ t: 'Hết hạn', c: '#c62828' });
      if (it.exp.status === 'near') tags.push({ t: 'Sắp hết hạn', c: '#e65100' });
      if (it.isExtra) tags.push({ t: 'Ngoài sổ sách', c: '#6a1b9a' });
      return tags;
    };
    const issues = items.filter(it => issueOf(it).some(t => t.t !== 'Chưa kiểm'));
    const uncounted = items.filter(i => i.actualQty == null);

    const section = t => ({ text: t, fontSize: 14, bold: true, color: BRAND, margin: [0, 6, 0, 6] });
    const photoGrid = (list) => {
      const out = [];
      for (let i = 0; i < list.length; i += 2) {
        out.push({
          columns: list.slice(i, i + 2).map(x => ({ width: '*', stack: [{ image: x.data, fit: [250, 230] }, { text: x.caption || '', fontSize: 8, color: '#444', margin: [0, 2, 0, 0] }] })).concat(list.length - i === 1 ? [{ width: '*', text: '' }] : []),
          columnGap: 14, margin: [0, 0, 0, 10], unbreakable: true
        });
      }
      return out;
    };

    const content = [...coverPage];

    // 1. Biên bản có chữ ký
    content.push(section('1. BIÊN BẢN KIỂM KÊ (CÓ CHỮ KÝ)'));
    content.push(p(`Đã kiểm ${sum.counted}/${sum.lines} dòng hàng tại ${byWarehouse(items).size} kho. Trọng lượng sổ sách ${F(sum.sysWgh)} kg, thực tế ${F(sum.actWgh)} kg. ${sum.overLines} dòng thừa, ${sum.shortLines} dòng thiếu, ${sum.expired} dòng hết hạn, ${sum.near} dòng sắp hết hạn.`, { fontSize: 10 }));
    if (opts.minutesImages && opts.minutesImages.length) {
      opts.minutesImages.forEach((img, i) => content.push({ image: img, fit: [W - 72, Hh - 150], alignment: 'center', margin: [0, 6, 0, 0], pageBreak: i > 0 ? 'before' : undefined }));
    } else {
      content.push(p('Xem file biên bản kiểm kê đã ký kèm theo: ' + fileNames(s).signed, { italics: true }));
    }

    // 2. Hình ảnh một số sản phẩm kiểm kho
    const productPhotos = [];
    if (s.checkIn) productPhotos.push({ data: s.checkIn.data, caption: `Bắt đầu kiểm kê – ${Stamp.dt(new Date(s.checkIn.time))} – ${Geo.fmt(s.checkIn.geo)}` });
    if (s.checkOut) productPhotos.push({ data: s.checkOut.data, caption: `Kết thúc kiểm kê – ${Stamp.dt(new Date(s.checkOut.time))} – ${Geo.fmt(s.checkOut.geo)}` });
    const issueIds = new Set(issues.map(i => i.id));
    items.filter(it => !issueIds.has(it.id) && (it.photos || []).length).forEach(it =>
      it.photos.forEach(ph => productPhotos.push({ data: ph, caption: `${it.code} – ${it.name} – Lô ${it.lot}` })));
    (s.generalPhotos || []).forEach(g => productPhotos.push({ data: g.data, caption: g.caption || 'Hình ảnh hiện trường' }));
    content.push(Object.assign(section('2. HÌNH ẢNH KIỂM KHO'), { pageBreak: 'before' }));
    if (productPhotos.length) content.push(...photoGrid(productPhotos));
    else content.push(p('Không có ảnh.', { italics: true }));

    // 3. Vấn đề phát sinh
    content.push(Object.assign(section('3. VẤN ĐỀ PHÁT SINH'), { pageBreak: 'before' }));
    if (!issues.length && !uncounted.length) content.push(p('Không có vấn đề phát sinh: số lượng khớp sổ sách, không có hàng hết hạn.'));
    issues.forEach((it, n) => {
      const v = it.var;
      const tags = issueOf(it);
      const block = [
        { text: [{ text: `${n + 1}. ${it.code} – ${it.name}  `, bold: true }, ...tags.map(t => ({ text: ` ${t.t} `, color: '#fff', background: t.c, bold: true, fontSize: 8 })).flatMap(x => [x, ' '])], fontSize: 10 },
        { text: `Lô ${it.lot} · ${it.warehouse} · NSX ${Util.vnDate(it.prodDate)} · HSD ${Util.vnDate(it.exp.expDate)} (${it.exp.label})`, fontSize: 8, color: '#555', margin: [0, 1, 0, 2] },
        v ? { text: `Sổ sách ${F(it.sysQty)} / ${F(it.sysWgh)} kg   |   Thực tế ${F(it.actualQty)} / ${F(it.aWgh)} kg   |   Chênh lệch ${signed(v.qty)} / ${signed(v.wgh)} kg`, fontSize: 9 } : '',
        it.note ? { text: [{ text: 'Ghi chú: ', bold: true }, it.note], fontSize: 9, margin: [0, 2, 0, 0] } : ''
      ];
      content.push({ stack: block, margin: [0, 6, 0, 4], unbreakable: true });
      if ((it.photos || []).length) content.push(...photoGrid(it.photos.map(ph => ({ data: ph, caption: `${it.code} – Lô ${it.lot}` }))));
      content.push({ canvas: [{ type: 'line', x1: 0, y1: 0, x2: W - 72, y2: 0, lineWidth: 0.5, lineColor: '#d5dce6' }], margin: [0, 2, 0, 2] });
    });
    if (uncounted.length) content.push(p(`Chưa kiểm ${uncounted.length} dòng: ` + uncounted.map(i => `${i.code}/${i.lot}`).join(', '), { fontSize: 9, color: '#555' }));

    content.push({ text: 'Kết luận', bold: true, fontSize: 11, color: BRAND, margin: [0, 10, 0, 2] });
    content.push(p(tr.conclusion || '........................................................................................................'));
    content.push({ text: 'Kiến nghị', bold: true, fontSize: 11, color: BRAND, margin: [0, 8, 0, 2] });
    content.push(p(tr.recommendation || '........................................................................................................'));
    content.push({
      columns: [{ width: '*', text: '' }, { width: 200, alignment: 'center', stack: [
        { text: dateWords(s.countDate), italics: true, fontSize: 9 },
        { text: 'NGƯỜI KIỂM TRA', bold: true },
        s.reporterSignature ? { image: s.reporterSignature, fit: [120, 50], margin: [0, 4, 0, 2] } : { text: ' ', margin: [0, 25, 0, 25] },
        { text: user.name || '', bold: true }
      ] }], margin: [0, 12, 0, 0], unbreakable: true
    });

    // ===== Trang cuối: Thank You =====
    content.push(
      { text: '', pageBreak: 'before' },
      { canvas: [{ type: 'rect', x: 0, y: 0, w: W, h: Hh, color: BRAND }, { type: 'rect', x: 0, y: Hh / 2 + 70, w: W, h: 6, color: ACCENT }], absolutePosition: { x: 0, y: 0 } },
      { text: 'THANK YOU', color: '#ffffff', fontSize: 54, bold: true, alignment: 'center', absolutePosition: { x: 0, y: Hh / 2 - 70 } },
      { text: 'Xin cảm ơn!', color: '#ffd76a', fontSize: 18, alignment: 'center', absolutePosition: { x: 0, y: Hh / 2 + 5 } },
      { text: s.companyName, color: '#ffffff', fontSize: 11, bold: true, alignment: 'center', absolutePosition: { x: 0, y: Hh / 2 + 100 } },
      { text: `${s.factory.name} · ${Util.vnDate(s.countDate)}`, color: '#dbe6ff', fontSize: 10, alignment: 'center', absolutePosition: { x: 0, y: Hh / 2 + 118 } }
    );

    return {
      pageSize: 'A4', pageMargins: [36, 36, 36, 36],
      defaultStyle: { font: 'Roboto', fontSize: 10 },
      footer: (pg, n) => (pg === 1 || pg === n) ? null : ({ text: `Báo cáo kiểm kê ${docNo(s)}   ·   ${pg}/${n}`, alignment: 'right', fontSize: 7, color: '#777', margin: [0, 10, 36, 0] }),
      info: { title: 'Báo cáo kiểm kê ' + docNo(s) },
      content
    };
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
