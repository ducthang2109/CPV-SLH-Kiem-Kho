// Cấu hình mặc định. Có thể sửa trực tiếp trong app (màn hình Cài đặt),
// giá trị sửa trong app được lưu trên máy và ghi đè lên file này.
window.APP_DEFAULT_CONFIG = {
  companyName: 'Công Ty Cổ Phần Chăn Nuôi C.P Việt Nam',
  // Tên hệ thống in ở cột số liệu sổ sách trên biên bản
  systemName: 'SmartSoft_Food',
  // Chỉ cho phép email thuộc các tên miền này đăng nhập (để trống = không giới hạn)
  allowedDomains: ['cp.com.vn'],

  // Đăng nhập Microsoft 365 + OneDrive (Azure AD / Entra ID app registration, loại SPA)
  // Để trống clientId thì app dùng tài khoản nội bộ (tạo trong Cài đặt).
  msal: {
    clientId: '',
    tenantId: 'organizations',
    scopes: ['User.Read', 'Files.ReadWrite']
  },

  // Thư mục trên OneDrive (tính từ gốc OneDrive của người dùng)
  oneDrive: {
    inputFolder: 'Apps Kiem Kho/Input',
    outputFolder: 'Apps Kiem Kho/Output'
  },

  // Danh sách nhà máy. code = ORG_CODE trong file tồn kho.
  // inputFile: tên file trong thư mục Input, có thể kèm thư mục con và dùng * làm ký tự đại diện
  factories: [
    { code: 'B43210', name: 'Chi Nhánh NM3 tại Hà Nội – Pha lóc', address: 'Lô CN5, KCN Phú Nghĩa, xã Phú Nghĩa, TP. Hà Nội', inputFile: 'Data Warehouse FG/B43210_*.xlsx', suppliesFile: 'Data SparePart Supplies/*.xlsx', packageFile: 'Data Package/B43210_*.pdf' },
    { code: 'B65710', name: 'Chi Nhánh NM3 tại Hà Nội – Giết mổ', address: 'Lô CN5, KCN Phú Nghĩa, xã Phú Nghĩa, TP. Hà Nội', inputFile: 'Data Warehouse FG/B65710_*.xlsx', suppliesFile: 'Data SparePart Supplies/*.xlsx', packageFile: 'Data Package/B65710_*.pdf' },
    { code: '333', name: 'Chi Nhánh NM3 tại Hà Nội', address: 'Lô CN5, KCN Phú Nghĩa, xã Phú Nghĩa, TP. Hà Nội', inputFile: 'FDREPORT-333*.xlsx' }
  ],
  // Tăng số này khi thêm nhà máy mặc định mới: máy đã lưu cài đặt cũ sẽ được bổ sung nhà máy mới
  factoriesVersion: 3,

  // Cảnh báo hạn sử dụng: "sắp hết hạn" khi số ngày còn lại <= max(nearExpiryMinDays, hạn dùng * nearExpiryRatio)
  nearExpiryRatio: 0.25,
  nearExpiryMinDays: 1,

  // Người ký biên bản mặc định (role = chức danh in dưới chữ ký, có thể sửa khi kiểm kê)
  committeeRoles: [
    { role: 'Nhân Viên Kho Pha Lóc', title: '', name: '' },
    { role: 'Quản Lý Kho Pha Lóc', title: '', name: '' },
    { role: 'Kế Toán', title: '', name: '' },
    { role: 'Giám Đốc Nhà Máy', title: '', name: '' },
    { role: 'Nhân Viên Kho Giết Mổ', title: '', name: '' },
    { role: 'Quản Lý Kho Giết Mổ', title: '', name: '' }
  ]
};
