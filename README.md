# CPV SLH Kiem Kho (app kiểm kê kho cho kế toán)

App kiểm kê hàng tồn kho chạy trên điện thoại, **không cần mạng khi kiểm kê**. Dạng PWA: mở link một lần rồi
"Thêm vào màn hình chính" là dùng như app (Android Chrome, iPhone Safari). Không cần cài từ kho ứng dụng.

## Quy trình

1. **Đăng nhập** bằng tài khoản Microsoft 365 công ty (giới hạn theo tên miền email) hoặc tài khoản nội bộ.
2. **Chọn nhà máy** đang đến kiểm.
3. **Tải dữ liệu tồn kho** theo form mẫu `FDREPORT-xxx.xlsx` (cột `PRODUCT_CODE, PRODUCT_NAME, LOT, Location,
   production_date, QTY, WGH, Ages(day), shelf life Ages`):
   - trực tiếp từ OneDrive (`Apps Kiem Kho/Input`, tự tìm file mới nhất theo mẫu tên của nhà máy), hoặc
   - chọn file trên máy / từ app OneDrive trên điện thoại.
   Tên hàng font TCVN3 (`RM ThÞt Vai`) được tự chuyển sang Unicode (`RM Thịt Vai`). Dữ liệu lưu trên máy.
4. **Kiểm kê offline**: nhập số lượng / khối lượng thực tế theo mã hàng, lô, kho; nút "= Sổ" khi khớp.
   Ngày kiểm kê tự lấy ngày hiện tại; app tự tính HSD = ngày sản xuất + shelf life và cảnh báo
   **Hết hạn** / **Sắp hết hạn**. Mỗi dòng có thể chụp ảnh, ghi chú; thêm được hàng ngoài sổ sách.
5. **Xem lại & ký**: tổng hợp chênh lệch, hàng hết hạn, dòng chưa kiểm; ban kiểm kê ký trực tiếp trên màn hình.
6. **Kết thúc** → app tạo:
   - Biên bản kiểm kê hàng tồn kho PDF có chữ ký (kèm phụ lục ảnh),
   - Biên bản PDF để in ký tay (gửi về `Apps Kiem Kho/Output` trên OneDrive),
   - Báo cáo đi kiểm kê kho PDF,
   - File Excel kết quả.
   Nếu đang offline, file được giữ lại và tự gửi lên OneDrive khi có mạng.


## Cài đặt cho công ty

### 1. Đưa app lên GitHub Pages
Repo → Settings → Pages → Source: *Deploy from a branch*, branch `main`, thư mục `/ (root)`.
Link app: `https://<tài-khoản>.github.io/<tên-repo>/`.

### 2. Bật đăng nhập Microsoft 365 + OneDrive (cần IT/admin Azure)
1. Azure Portal → Microsoft Entra ID → App registrations → New registration.
2. Supported account types: *Accounts in this organizational directory only*.
3. Redirect URI: chọn **Single-page application (SPA)**, nhập link GitHub Pages ở trên.
4. API permissions → Microsoft Graph → Delegated: `User.Read`, `Files.ReadWrite` → Grant admin consent.
5. Copy *Application (client) ID* và *Directory (tenant) ID* vào app: ⚙ Cài đặt → Microsoft 365 / OneDrive
   (hoặc sửa sẵn trong `js/config.js` để mọi máy dùng chung).

Chưa có Client ID thì app dùng tài khoản nội bộ (tạo ở màn hình đầu tiên / Cài đặt) và nhập file thủ công.

### 3. Nhà máy và quy tắc cảnh báo
⚙ Cài đặt: danh sách nhà máy (mã, tên, địa chỉ in trên biên bản, mẫu tên file input như `FDREPORT-333*.xlsx`),
ngưỡng "sắp hết hạn" (mặc định còn ≤ 25% hạn dùng, tối thiểu 1 ngày), thành phần ban kiểm kê mặc định.

## Kỹ thuật
- HTML/JS thuần, không cần build. Thư viện đi kèm trong `vendor/`: SheetJS (đọc/ghi Excel), pdfmake (PDF, font
  Roboto có tiếng Việt), MSAL (đăng nhập Microsoft).
- Dữ liệu lưu IndexedDB trên máy; service worker (`sw.js`) lưu app để mở được khi không có mạng.
  Khi sửa code, tăng `CACHE` trong `sw.js` và `APP_VERSION` trong `index.html` để máy nhận bản mới.
- Chạy thử trên máy tính: phục vụ thư mục này bằng web server bất kỳ (ví dụ `npx serve .`) rồi mở `http://localhost:...`.
