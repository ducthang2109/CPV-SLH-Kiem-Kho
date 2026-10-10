// Chuyển chuỗi font TCVN3 (ABC, .VnTime) sang Unicode.
// File xuất từ hệ thống có tên hàng/kho ở dạng TCVN3, ví dụ "RM ThÞt Vai" -> "RM Thịt Vai".
(function () {
  const MAP = {
    0xA1: 'Ă', 0xA2: 'Â', 0xA3: 'Ê', 0xA4: 'Ô', 0xA5: 'Ơ', 0xA6: 'Ư', 0xA7: 'Đ',
    0xA8: 'ă', 0xA9: 'â', 0xAA: 'ê', 0xAB: 'ô', 0xAC: 'ơ', 0xAD: 'ư', 0xAE: 'đ',
    0xB5: 'à', 0xB6: 'ả', 0xB7: 'ã', 0xB8: 'á', 0xB9: 'ạ',
    0xBB: 'ằ', 0xBC: 'ẳ', 0xBD: 'ẵ', 0xBE: 'ắ', 0xC6: 'ặ',
    0xC7: 'ầ', 0xC8: 'ẩ', 0xC9: 'ẫ', 0xCA: 'ấ', 0xCB: 'ậ',
    0xCC: 'è', 0xCE: 'ẻ', 0xCF: 'ẽ', 0xD0: 'é', 0xD1: 'ẹ',
    0xD2: 'ề', 0xD3: 'ể', 0xD4: 'ễ', 0xD5: 'ế', 0xD6: 'ệ',
    0xD7: 'ì', 0xD8: 'ỉ', 0xDC: 'ĩ', 0xDD: 'í', 0xDE: 'ị',
    0xDF: 'ò', 0xE1: 'ỏ', 0xE2: 'õ', 0xE3: 'ó', 0xE4: 'ọ',
    0xE5: 'ồ', 0xE6: 'ổ', 0xE7: 'ỗ', 0xE8: 'ố', 0xE9: 'ộ',
    0xEA: 'ờ', 0xEB: 'ở', 0xEC: 'ỡ', 0xED: 'ớ', 0xEE: 'ợ',
    0xEF: 'ù', 0xF1: 'ủ', 0xF2: 'ũ', 0xF3: 'ú', 0xF4: 'ụ',
    0xF5: 'ừ', 0xF6: 'ử', 0xF7: 'ữ', 0xF8: 'ứ', 0xF9: 'ự',
    0xFA: 'ỳ', 0xFB: 'ỷ', 0xFC: 'ỹ', 0xFD: 'ý', 0xFE: 'ỵ'
  };
  // Ký tự chỉ xuất hiện trong TCVN3, không phải chữ Việt Unicode hợp lệ -> dấu hiệu chuỗi là TCVN3
  const SIGNATURE = /[¡-¿Æ-ÈËÎ-ÑÓ-ØÜ-ßä-èëîïñòö-øûüþ]/;
  function looksTcvn3(s) {
    return s != null && SIGNATURE.test(String(s));
  }

  // force = true: chuyển mọi ký tự trong bảng mã (dùng khi cả file đã được xác định là TCVN3,
  // vì có tên như "Mì Bông" chỉ gồm ký tự trùng với chữ Unicode nhưng thực ra là "Mỡ Bụng").
  // Ký tự ngoài Latin-1 (đã là Unicode, ví dụ "ư", "ớ") luôn được giữ nguyên.
  function tcvn3ToUnicode(s, force) {
    if (s == null) return s;
    s = String(s);
    if (!force && !looksTcvn3(s)) return s;
    let out = '';
    for (const ch of s) out += MAP[ch.charCodeAt(0)] || ch;
    return out;
  }
  window.tcvn3ToUnicode = tcvn3ToUnicode;
  window.looksTcvn3 = looksTcvn3;
})();
