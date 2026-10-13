// Dịch tên vật tư tiếng Anh (file SAP) sang tiếng Việt để in trên biên bản.
// Cách làm: tìm cụm danh từ chính trong tên (vd "Proximity Sensor") và đặt bản dịch lên đầu, giữ nguyên hãng / model
// ("Omron Proximity Sensor E2E-X5Y1" -> "Cảm biến tiệm cận Omron E2E-X5Y1").
// Quản trị viên bổ sung / sửa từ điển trong Cài đặt (mỗi dòng: tiếng Anh = tiếng Việt), dùng chung cho mọi máy.
const Glossary = (function () {
  const BASE = `
set pillow block bearing ss = Bộ gối đỡ vòng bi inox
set pillow block bearing = Bộ gối đỡ vòng bi
pillow block bearing = Gối đỡ vòng bi
bearing housing = Gối đỡ vòng bi
ball bearing = Vòng bi cầu
bearing grease = Mỡ bò vòng bi
bearing = Vòng bi
thermal relay = Rơ le nhiệt
overload = Rơ le nhiệt
auxiliary contactor = Tiếp điểm phụ
auxiliary contacts = Tiếp điểm phụ
aulixiary contacts = Tiếp điểm phụ
start magnetic = Khởi động từ
start soft = Khởi động mềm
contactors = Khởi động từ
contactor = Khởi động từ
contact = Tiếp điểm
twin relay timer = Rơ le thời gian
intermediate relay = Rơ le trung gian
relay voltage protection = Rơ le bảo vệ điện áp
relay socket = Đế rơ le
soles relay = Rơ le bán dẫn
relay finder = Rơ le Finder
relay = Rơ le
valve solenoid suffer heat = Van điện từ chịu nhiệt
solenoid valve = Van điện từ
valve solenoid = Van điện từ
ball valve = Van bi
throttle valve = Van tiết lưu
valve throttle = Van tiết lưu
valve reduce pressure = Van giảm áp
valve reducing = Van giảm áp
valve safety = Van an toàn
foot valve = Van đáy
valve union = Rắc co van
pneumatic hand valve = Van tay khí nén
pneumatic bevel valve = Van góc khí nén
valve door = Van cửa
valve close open = Van đóng mở
valves = Van
valve = Van
steam trap = Bẫy hơi
switch differential pressure = Công tắc chênh áp
switch pressure gas = Công tắc áp suất gas
pressure switch = Công tắc áp suất
switch pressure = Công tắc áp suất
flow switch = Công tắc dòng chảy
limit switch = Công tắc hành trình
journey switch = Công tắc hành trình
switch = Cầu dao
aptomat rccb = Aptomat chống giật RCCB
aptomat = Aptomat
mccb = Aptomat khối MCCB
mcb = Aptomat MCB
circuit breaker motor = CB bảo vệ động cơ
engine breaker = CB bảo vệ động cơ
motor cb = CB bảo vệ động cơ
circuit breaker = CB bảo vệ động cơ
cb = CB bảo vệ động cơ
power supply = Bộ nguồn
the source = Bộ nguồn
stainless steel rod = Thanh inox
ss304 plate = Tấm inox SS304
din rail = Thanh ray DIN
spray wire inox = Dây phun inox
sensor heat = Cảm biến nhiệt
sensor pressure = Cảm biến áp suất
optical sensor = Cảm biến quang
proximity sensor = Cảm biến tiệm cận
level sensor = Cảm biến mức
cylinder sensor = Cảm biến xi lanh
sensor = Cảm biến
plastic flexible pipe = Ống nhựa mềm
galv-steel tube = Ống thép mạ kẽm
galv-steel pipe = Ống thép mạ kẽm
pneumatic steam pipe = Ống hơi khí nén
pipe sus polish = Ống inox bóng
pipe u.pvc = Ống nhựa uPVC
pipe = Ống
tarpaulin tube = Ống bạt
plug super load = Phích cắm chịu tải
transformer auto = Biến áp tự ngẫu
transformer = Biến áp
button green light = Nút nhấn đèn xanh
button light red = Nút nhấn đèn đỏ
box push button = Hộp nút nhấn
push button = Nút nhấn
emergency stop box = Hộp nút dừng khẩn cấp
electric box = Tủ điện
bulb led = Bóng đèn LED
cyliner seal kit = Bộ phớt xi lanh
set felt cylinder = Bộ phớt xi lanh
pneumatic cylinder = Xi lanh khí nén
cylinder pneumatic = Xi lanh khí nén
cylinder = Xi lanh khí nén
balance hoist = Pa lăng cân bằng
box connection loadcell = Hộp nối loadcell
loadcell = Cảm biến tải (loadcell)
galvanized v steel = Thép V mạ kẽm
steel galvaniz = Thép mạ kẽm
set ignition = Bộ đánh lửa
head burner = Đầu đốt
reducer weld = Côn hàn
numb weld = Cút hàn
warning light with buzzer = Đèn cảnh báo có còi
set wire soldering tig = Bộ dây hàn TIG
welding tig = Súng hàn TIG
belt dryer = Dây curoa máy sấy
belt toothed = Dây curoa răng
belt = Dây curoa
pressure gauge = Đồng hồ áp suất
column filter water = Cột lọc nước
barcode printhead = Đầu in mã vạch
flange = Mặt bích
plastic protective cover = Nắp bảo vệ bằng nhựa
control cable = Cáp điều khiển
gearbox = Hộp số
tee = Tê
water level controller = Bộ điều khiển mức nước
electric tong tip = Đầu kẹp điện
fat pumping breasts = Vú bơm mỡ
bung dropper blade = Lưỡi dao
guide base = Đế dẫn hướng
sprinklers = Đầu phun
naoh flake = Xút vảy NaOH
floor cleaner = Nước lau sàn
spray paint = Sơn xịt
toilet cleaner = Nước tẩy bồn cầu
poly aluminium chloride = Hóa chất PAC (Poly Aluminium Chloride)
plastic seal = Niêm phong nhựa
safety shoes = Giày bảo hộ
silk tape = Băng keo lụa
fabric softener = Nước xả vải
dishes cleaner water = Nước rửa chén
dish washing mesh = Lưới rửa chén
glass cleaner = Nước lau kính
insect spray = Bình xịt côn trùng
labor protective glass = Kính bảo hộ lao động
dustpan = Ki hốt rác
liquid omo = Nước giặt Omo
battery = Pin
lubricant filter = Lọc nhớt
lubricant = Dầu nhớt
automatic nipple = Núm uống tự động
water wiper = Cây gạt nước
hand wash = Nước rửa tay
flap disc = Đá nhám xếp
grinding wheel = Đá mài
welding helmet = Mặt nạ hàn
food fluid = Dầu bôi trơn thực phẩm
cut resistance gloves = Găng tay chống cắt
cut resistant gloves = Găng tay chống cắt
respirator protection = Mặt nạ phòng độc
chemical polymer cation = Hóa chất polymer cation
chemical polymer anion = Hóa chất polymer anion
chemical resistant clothing = Quần áo chống hóa chất
cutting wheel = Đá cắt
cutting disc = Đá cắt
safety belt = Dây an toàn
sandpaper rolls = Giấy nhám cuộn
medical gloves = Găng tay y tế
grease = Mỡ bôi trơn
chemical boiler = Hóa chất lò hơi
kit response spill chemical = Bộ ứng phó tràn hóa chất
chemical = Hóa chất
welding rod tig = Que hàn TIG
welding rod = Que hàn
iron welding electrode = Que hàn sắt
water filter = Lõi lọc nước
filter water = Lõi lọc nước
raw filter = Lõi lọc thô
oil filter = Lọc dầu
black garbage bag = Túi rác đen
protective clothing = Quần áo bảo hộ
hat clean = Mũ trùm tóc
band saw blade = Lưỡi cưa vòng
saw blade = Lưỡi cưa vòng
head cutting charge machine = Đầu máy cắt cỏ
plastic sheet = Tấm nhựa
whetstone = Đá mài dao
string lotus = Dây sen
shower = Vòi sen
oil = Dầu
powdered lime = Vôi bột
glue silicon = Keo silicon
microbiology = Chế phẩm vi sinh
probiotics = Men vi sinh
whip electric chase pig = Roi điện lùa heo
shelves pair contain vase fire = Kệ đựng bình chữa cháy
molasses = Mật rỉ đường
coolant = Nước làm mát
bag pp woven = Bao PP dệt
set lock loto padlock station = Trạm khóa an toàn LOTO
`;

  // Tách chữ dính liền: "EngineBreakerSchneider" -> "Engine Breaker Schneider"
  const split = s => String(s || '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/\s+/g, ' ').trim();
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  function parseLines(text) {
    return String(text || '').split('\n').map(l => l.split('=')).filter(a => a.length >= 2 && a[0].trim() && a[1].trim())
      .map(([en, ...vi]) => ({ en: split(en.trim()).toLowerCase(), vi: vi.join('=').trim() }));
  }
  let cache = null, cacheKey = null;
  function entries() {
    const custom = (Config.get().glossary || '');
    if (cache && cacheKey === custom) return cache;
    // Từ điển riêng ưu tiên trước; cụm dài khớp trước cụm ngắn
    const list = parseLines(custom).concat(parseLines(BASE));
    const seen = new Set();
    cache = list.filter(e => !seen.has(e.en) && seen.add(e.en))
      .map(e => Object.assign(e, { re: new RegExp('(^|[^a-z0-9])' + esc(e.en).replace(/ /g, '\\s*') + '(?=$|[^a-z0-9])', 'i') }))
      .sort((a, b) => b.en.length - a.en.length);
    cacheKey = custom;
    return cache;
  }

  // Chuỗi đã có chữ Việt có dấu thì không dịch
  const isVietnamese = s => /[ăâđêôơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/i.test(s);

  function vi(en) {
    const src = split(en);
    if (!src || isVietnamese(src)) return '';
    let best = null;
    for (const e of entries()) {
      const m = src.match(e.re);
      if (m && (!best || m.index < best.index - 2 || (Math.abs(m.index - best.index) <= 2 && e.en.length > best.e.en.length))) best = { e, index: m.index, len: m[0].length };
    }
    if (!best) return '';
    const rest = (src.slice(0, best.index) + ' ' + src.slice(best.index + best.len)).replace(/\s+/g, ' ').trim();
    return (best.e.vi + (rest ? ' ' + rest : '')).trim();
  }

  // Tên tiếng Việt của một dòng hàng: lấy từ file nếu có, không thì tự dịch
  function nameVi(it) {
    if (it.nameVi) return it.nameVi;
    return vi(it.name);
  }

  // Đơn vị tính SAP -> tiếng Việt
  const UNITS = { PC: 'Cái', PCS: 'Cái', EA: 'Cái', M: 'Mét', SET: 'Bộ', KG: 'Kg', BT: 'Chai', BOT: 'Chai', PLT: 'Tấm', RO: 'Cuộn', ROL: 'Cuộn', BOX: 'Hộp', BAG: 'Bao', CAN: 'Can', L: 'Lít', PR: 'Đôi', PAA: 'Đôi', TUB: 'Tuýp', G: 'Gram' };
  const unitVi = u => UNITS[String(u || '').trim().toUpperCase()] || u || '';

  return { vi, nameVi, unitVi, BASE };
})();
