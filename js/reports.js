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
  function inventoryDoc(s, withSignatures) {
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

    if (withSignatures) {
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

  // ---------- Báo cáo đi kiểm kê kho ----------
  function tripDoc(s) {
    const { items, sum } = summary(s);
    const tr = s.trip || {};
    const user = s.user || {};
    const p = t => ({ text: t, margin: [0, 2, 0, 2] });
    const tableStyle = { hLineWidth: () => 0.5, vLineWidth: () => 0.5, hLineColor: () => '#9e9e9e', vLineColor: () => '#9e9e9e' };

    const whRows = [[{ text: 'Kho', style: 'th' }, { text: 'Số dòng', style: 'th' }, { text: 'Đã KK', style: 'th' }, { text: 'SL sổ sách', style: 'th' }, { text: 'SL thực tế', style: 'th' }, { text: 'KL sổ sách', style: 'th' }, { text: 'KL thực tế', style: 'th' }, { text: 'CL KL', style: 'th' }]];
    for (const [wh, list] of byWarehouse(items)) {
      const c = list.filter(i => i.actualQty != null);
      const a = list.reduce((x, i) => x + i.sysQty, 0), b = c.reduce((x, i) => x + i.actualQty, 0);
      const w1 = list.reduce((x, i) => x + i.sysWgh, 0), w2 = c.reduce((x, i) => x + i.aWgh, 0);
      const dw = c.reduce((x, i) => x + i.var.wgh, 0); // chỉ tính trên các dòng đã kiểm
      whRows.push([wh, { text: list.length, alignment: 'right' }, { text: c.length, alignment: 'right' }, { text: F(a), alignment: 'right' }, { text: F(b), alignment: 'right' }, { text: F(w1), alignment: 'right' }, { text: F(w2), alignment: 'right' }, { text: signed(Util.round(dw)), alignment: 'right' }]);
    }

    const diff = items.filter(i => i.var && (i.var.qty !== 0 || Math.abs(i.var.wgh) > 0.0005));
    const diffRows = [[ 'Mã', 'Tên hàng', 'Lô', 'Kho', 'CL SL', 'CL KL', 'Ghi chú' ].map(t => ({ text: t, style: 'th' }))]
      .concat(diff.map(i => [i.code, i.name, i.lot, i.warehouseCode, { text: signed(i.var.qty), alignment: 'right' }, { text: signed(i.var.wgh), alignment: 'right' }, i.note || '']));

    const expItems = items.filter(i => i.exp.status === 'expired' || i.exp.status === 'near');
    const expRows = [[ 'Mã', 'Tên hàng', 'Lô', 'Kho', 'NSX', 'HSD', 'SL', 'Tình trạng' ].map(t => ({ text: t, style: 'th' }))]
      .concat(expItems.map(i => [i.code, i.name, i.lot, i.warehouseCode, Util.vnDate(i.prodDate), Util.vnDate(i.exp.expDate), { text: F(i.actualQty != null ? i.actualQty : i.sysQty), alignment: 'right' }, { text: i.exp.label, color: STATUS_COLOR[i.exp.status] }]));

    const uncounted = items.filter(i => i.actualQty == null);

    const content = [
      headerBlock(s, [{ text: 'Số: BC-' + docNo(s), bold: true }]),
      { text: 'BÁO CÁO ĐI KIỂM KÊ KHO', style: 'title' },
      { text: dateWords(s.countDate), alignment: 'center', italics: true, margin: [0, 0, 0, 10] },
      { text: 'I. THÔNG TIN CHUNG', style: 'h2' },
      p(`Nhà máy / địa điểm: ${s.factory.name}${s.factory.address ? ' – ' + s.factory.address : ''}`),
      p(`Thời gian: bắt đầu ${Stamp.dt(new Date(startTime(s)))}${endTime(s) ? ', kết thúc ' + Stamp.dt(new Date(endTime(s))) : ''}`),
      s.checkIn ? p(`Vị trí lúc bắt đầu: ${Geo.fmt(s.checkIn.geo)}${distanceText(s, s.checkIn) ? ' – ' + distanceText(s, s.checkIn) : ''}`) : '',
      s.checkOut ? p(`Vị trí lúc kết thúc: ${Geo.fmt(s.checkOut.geo)}${distanceText(s, s.checkOut) ? ' – ' + distanceText(s, s.checkOut) : ''}`) : '',
      ...presenceBlock(s),
      p(`Người lập báo cáo: ${user.name || ''} (${user.email || ''})`),
      p('Thành phần tham gia: ' + s.committee.filter(m => m.name).map(m => `${m.name} (${m.title || m.role})`).join('; ')),
      p('Mục đích: ' + (tr.purpose || 'Kiểm kê định kỳ, đối chiếu số lượng tồn kho thực tế với số liệu sổ sách, kiểm tra hạn sử dụng hàng tồn.')),
      p(`Dữ liệu đối chiếu: ${s.sourceFile || ''} (${sum.lines} dòng hàng).`),
      { text: 'II. KẾT QUẢ KIỂM KÊ THEO KHO', style: 'h2' },
      { table: { headerRows: 1, widths: ['*', 34, 30, 50, 50, 55, 55, 45], body: whRows }, layout: tableStyle, fontSize: 8 },
      p(`Đã kiểm ${sum.counted}/${sum.lines} dòng. Tổng KL sổ sách ${F(sum.sysWgh)} kg, thực tế ${F(sum.actWgh)} kg. Có ${sum.overLines} dòng thừa, ${sum.shortLines} dòng thiếu.`),
      { text: 'III. HÀNG CHÊNH LỆCH', style: 'h2' },
      diff.length ? { table: { headerRows: 1, widths: [40, '*', 70, 28, 34, 40, 90], body: diffRows }, layout: tableStyle, fontSize: 8 } : p('Không có chênh lệch.'),
      { text: 'IV. HẠN SỬ DỤNG', style: 'h2' },
      p(`${sum.expired} dòng đã hết hạn, ${sum.near} dòng sắp hết hạn (tính đến ngày kiểm kê ${Util.vnDate(s.countDate)}).`),
      expItems.length ? { table: { headerRows: 1, widths: [40, '*', 70, 28, 46, 46, 30, 80], body: expRows }, layout: tableStyle, fontSize: 8 } : '',
      uncounted.length ? { text: 'V. HÀNG CHƯA KIỂM: ' + uncounted.map(i => `${i.code}/${i.lot}`).join(', '), style: 'h2' } : '',
      { text: (uncounted.length ? 'VI' : 'V') + '. NHẬN XÉT, KẾT LUẬN', style: 'h2' },
      p(tr.conclusion || '...........................................................................................................'),
      { text: (uncounted.length ? 'VII' : 'VI') + '. KIẾN NGHỊ', style: 'h2' },
      p(tr.recommendation || '...........................................................................................................'),
      {
        columns: [{ width: '*', text: '' }, { width: 200, alignment: 'center', stack: [
          { text: dateWords(s.countDate), italics: true, fontSize: 9 },
          { text: 'NGƯỜI LẬP BÁO CÁO', bold: true },
          s.reporterSignature ? { image: s.reporterSignature, fit: [120, 50], margin: [0, 4, 0, 2] } : { text: ' ', margin: [0, 25, 0, 25] },
          { text: user.name || '', bold: true }
        ] }], margin: [0, 14, 0, 0], unbreakable: true
      }
    ];

    const pics = photoAppendix(items);
    (s.generalPhotos || []).forEach(g => pics.push({ text: g.caption || 'Hình ảnh hiện trường', bold: true, fontSize: 8, margin: [0, 6, 0, 2] }, { image: g.data, fit: [360, 240] }));
    if (pics.length) content.push({ text: 'PHỤ LỤC HÌNH ẢNH', style: 'h2', pageBreak: 'before' }, ...pics);

    return {
      pageSize: 'A4', pageMargins: [36, 30, 36, 34],
      defaultStyle: { font: 'Roboto', fontSize: 10 },
      styles: {
        title: { fontSize: 15, bold: true, alignment: 'center', margin: [0, 6, 0, 2] },
        h2: { fontSize: 11, bold: true, margin: [0, 10, 0, 4], color: '#0b3d91' },
        th: { bold: true, alignment: 'center', fillColor: '#c9d6ea' }
      },
      footer: (pg, n) => ({ text: `BC-${docNo(s)}   ·   Trang ${pg}/${n}`, alignment: 'right', fontSize: 7, color: '#777', margin: [0, 10, 36, 0] }),
      info: { title: 'Báo cáo đi kiểm kê kho ' + docNo(s) },
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
      trip: `${base}_BaoCaoDiKiemKe.pdf`,
      excel: `${base}_KetQua.xlsx`
    };
  }

  return { inventoryDoc, tripDoc, toBlob, excelBlob, summary, fileNames, docNo, storeTitle };
})();
