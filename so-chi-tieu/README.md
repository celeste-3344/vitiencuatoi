# Sổ Chi Tiêu — phiên bản Firebase (Modular SPA)

Ứng dụng quản lý thu chi cá nhân chạy hoàn toàn phía client (Vanilla JS + ES Modules),
dùng Firebase Authentication và Cloud Firestore qua CDN — **không cần Node.js/Webpack**,
deploy thẳng lên GitHub Pages.

## 1. Cấu trúc thư mục

```
index.html              Giao diện chính (đã tách CSS/JS)
css/style.css           Toàn bộ CSS + responsive PC/Tablet/Mobile
js/firebase-config.js   Khởi tạo Firebase (export app, auth, db) — chỉ chứa placeholder, xem mục 5
js/auth.js              Đăng nhập / Đăng ký / Google / Quên mật khẩu
js/data.js              CRUD với Cloud Firestore
js/app.js               DOM, sự kiện, biểu đồ SVG, modal, toast
.github/workflows/deploy.yml   Workflow tự build + điền Secrets + minify + deploy GitHub Pages
.github/scripts/inject-config.js  Script điền Firebase Secrets vào bản build (mục 5)
```

> Nếu bạn đã tự tạo `firebase-config.js`, chỉ cần đảm bảo file đó export đúng
> 3 thứ: `app`, `auth`, `db`. Ngược lại dùng luôn file có sẵn ở đây.

## 2. Thiết lập trên Firebase Console (bắt buộc)

**Authentication → Sign-in method** — bật 2 provider:
- Email/Password
- Google

**Authentication → Settings → Authorized domains** — thêm:
- `localhost`
- `127.0.0.1`
- `<tên-tài-khoản>.github.io`

**Firestore Database** — tạo database, rồi dán Rules sau:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }

    // Tra cứu email -> uid, dùng để mời thành viên vào nhóm (tính năng Không gian chung).
    // Ai đã đăng nhập cũng ĐỌC được (cần thiết để tra ra người khác), nhưng
    // mỗi người chỉ được GHI đúng 1 bản ghi ứng với email của chính mình.
    match /emailToUid/{emailKey} {
      allow read: if request.auth != null;
      allow write: if request.auth != null && request.resource.data.uid == request.auth.uid;
    }

    // Tương tự emailToUid nhưng theo username — để mời thành viên bằng username cũng được.
    match /usernameToUid/{usernameKey} {
      allow read: if request.auth != null;
      allow write: if request.auth != null && request.resource.data.uid == request.auth.uid;
    }

    // Không gian chung cho Nhóm/Cặp đôi: chỉ những uid có mặt trong mảng
    // "members" của nhóm mới được đọc/ghi nhóm đó và mọi ví + giao dịch bên trong.
    match /groups/{groupId} {
      allow read, update, delete: if request.auth != null && request.auth.uid in resource.data.members;
      allow create: if request.auth != null && request.auth.uid in request.resource.data.members;

      match /{subCollection}/{docId} {
        allow read, write: if request.auth != null &&
          request.auth.uid in get(/databases/$(database)/documents/groups/$(groupId)).data.members;
      }
    }
  }
}
```

> **Nếu bạn đã bật tính năng Không gian chung (Nhóm) trước đó với rules cũ**, nhớ vào
> Firebase Console → Firestore Database → **Rules** → dán đè bộ rules mới ở trên
> rồi bấm **Publish**. Thiếu 2 khối `emailToUid` và `groups` thì mời thành viên
> hoặc tạo/xem ví-giao dịch nhóm sẽ báo lỗi "Missing or insufficient permissions".

## 3. App Check — chống bot / spam gọi thẳng API (khuyến nghị bật)

App Check giúp Firebase chỉ chấp nhận request đến từ chính website của bạn
(qua reCAPTCHA v3 chạy ẩn, người dùng không thấy captcha nào), chặn được
trường hợp ai đó lấy API key rồi tự viết script gọi thẳng vào Auth/Firestore
của bạn để spam tài khoản hoặc đọc trộm dữ liệu.

**Bước 1 — Lấy site key reCAPTCHA v3:**
1. Vào https://www.google.com/recaptcha/admin/create
2. Chọn loại **reCAPTCHA v3**, đặt tên bất kỳ (vd. "Sổ Chi Tiêu")
3. Ở mục Domains, thêm: `localhost`, `127.0.0.1`, `<tên-tài-khoản>.github.io`
   (và domain riêng nếu có)
4. Bấm Submit — bạn sẽ có 2 khóa: **Site key** (công khai) và **Secret key**
   (giữ bí mật, không đưa vào code)

**Bước 2 — Đăng ký với Firebase App Check:**
1. Vào Firebase Console → **App Check** (menu bên trái, mục Build)
2. Chọn ứng dụng Web của bạn → provider **reCAPTCHA v3** → dán **Secret key**
   vừa lấy ở Bước 1 vào đây

**Bước 3 — Dán Site key vào code:**
Mở `js/firebase-config.js`, tìm dòng:
```js
const RECAPTCHA_V3_SITE_KEY = 'DÁN_RECAPTCHA_V3_SITE_KEY_VÀO_ĐÂY';
```
Thay bằng **Site key** (khóa công khai, không phải Secret key) lấy ở Bước 1.
Site key này an toàn khi đưa lên GitHub — nó được thiết kế để công khai,
giống API key của Firebase.

**Bước 4 — Test ở local trước khi bật Enforce:**
Chạy app ở `localhost`, mở Console (F12) — Firebase sẽ in ra một dòng dạng
`App Check debug token: xxxxxxxx-xxxx-...`. Copy token đó, vào Firebase
Console → App Check → góc trên bên phải → **Manage debug tokens** → thêm
token này vào, để App Check nhận app chạy ở máy bạn là hợp lệ khi test.

**Bước 5 — Bật Enforce (SAU KHI đã test ổn, không còn lỗi App Check):**
Vào Firebase Console → App Check → tab **APIs**, bật **Enforce** cho:
- Authentication
- Cloud Firestore

⚠️ Bật Enforce quá sớm (khi site key/secret key chưa đúng) sẽ khiến TOÀN BỘ
người dùng không đăng nhập/đọc-ghi dữ liệu được. Nên để App Check chạy ở chế
độ theo dõi (chưa Enforce) vài ngày, xem tab **Requests metrics** không còn
request nào bị đánh dấu "Unverified" rồi mới bật Enforce.

## 4. Chạy thử

Vì dùng ES Modules, **không mở trực tiếp file://** — hãy dùng Live Server
(VS Code) hoặc:

```bash
python3 -m http.server 5500
# rồi mở http://localhost:5500
```

> Lúc chạy thử ở máy, `js/firebase-config.js` chỉ chứa placeholder
> (`__FIREBASE_API_KEY__`...) nên app sẽ báo lỗi kết nối Firebase — đó là
> bình thường. Muốn chạy thử thật ở máy, tạm thời điền key thật thẳng vào
> các dòng `__FIREBASE_...__` trong file đó, nhưng **tuyệt đối đừng
> `git commit` lúc file đang có key thật** (xong việc thì đổi lại thành
> placeholder, hoặc `git checkout js/firebase-config.js` để bỏ thay đổi).

## 5. Triển khai lên GitHub Pages (giấu API key qua GitHub Secrets)

Repo này đã có sẵn workflow `.github/workflows/deploy.yml`: mỗi lần bạn
`git push` lên nhánh `main`, GitHub sẽ tự động điền key thật vào bản build,
nén gọn mã nguồn (HTML/CSS/JS), rồi deploy lên GitHub Pages — **key thật
không bao giờ xuất hiện trong repo hay lịch sử Git của bạn.**

**Bước 1 — Tạo 8 Secret** (vào repo trên GitHub → **Settings → Secrets and
variables → Actions → New repository secret**), lấy giá trị từ Firebase
Console → ⚙️ Project settings → phần "Your apps" → SDK setup and configuration:

| Tên Secret | Lấy từ field nào trong `firebaseConfig` |
|---|---|
| `FIREBASE_API_KEY` | `apiKey` |
| `FIREBASE_AUTH_DOMAIN` | `authDomain` |
| `FIREBASE_DATABASE_URL` | `databaseURL` |
| `FIREBASE_PROJECT_ID` | `projectId` |
| `FIREBASE_STORAGE_BUCKET` | `storageBucket` |
| `FIREBASE_MESSAGING_SENDER_ID` | `messagingSenderId` |
| `FIREBASE_APP_ID` | `appId` |
| `FIREBASE_MEASUREMENT_ID` | `measurementId` |

**Bước 2 — Bật GitHub Pages chạy bằng Actions**: Settings → **Pages** →
mục "Build and deployment" → Source chọn **GitHub Actions** (không chọn
nhánh `gh-pages` hay `main` theo kiểu cũ).

**Bước 3 — Push code lên nhánh `main`.** Vào tab **Actions** xem workflow
chạy — nếu thiếu Secret nào, build sẽ báo lỗi rõ ràng tên Secret còn thiếu
thay vì âm thầm deploy 1 trang lỗi. Chạy xong, link trang web nằm ở Settings
→ Pages, hoặc ngay trong tab Actions → lần chạy gần nhất → mục "deploy".

> **Lưu ý quan trọng:** Secrets chỉ giấu key khỏi *repo* của bạn. Trên
> trang web đã deploy, key vẫn nằm trong mã nguồn tải về máy người dùng
> (bắt buộc, vì trình duyệt cần key để gọi Firebase) — chỉ là mã đã được
> nén gọn, khó đọc bằng mắt thường chứ không phải "vô hình". An toàn dữ
> liệu thực sự nằm ở Firestore Security Rules (mục 2) và Firebase Auth,
> không nằm ở việc giấu API key.

## 6. Cấu trúc dữ liệu trên Firestore

```
users/{uid}                        Hồ sơ: name, username, email, photoURL, createdAt
users/{uid}/wallets/{walletId}     Ví: name, icon, balance, gradient, bank*
users/{uid}/transactions/{txId}    Giao dịch: type, category, amount, date, note, walletId, attachments[]
users/{uid}/budgets/{categoryId}   Ngân sách: limit, rollover, createdAt
users/{uid}/debts/{debtId}         Công nợ: type, person, amount, payments[]...
users/{uid}/recurring/{recId}      Hóa đơn định kỳ
users/{uid}/savingsGoals/{goalId}  Mục tiêu tích lũy: name, targetAmount, currentAmount, icon, color, createdAt
users/{uid}/meta/categories        Danh mục thu/chi
users/{uid}/meta/state             Nhật ký chuyển ví, thông báo đã đọc/đã ẩn

emailToUid/{emailThường}           { uid } — tra cứu để mời thành viên vào nhóm bằng email
usernameToUid/{usernameThường}     { uid } — tra cứu để mời thành viên vào nhóm bằng username
groups/{groupId}                   Nhóm/cặp đôi: name, members[uid...], memberEmails[...], memberBankInfo{uid:{bankBin,accountNumber,accountHolder}}, createdBy, createdAt
groups/{groupId}/wallets/{id}      Ví dùng chung của nhóm: name, icon, balance
groups/{groupId}/transactions/{id} Giao dịch nhóm: type, category, amount, date, note, walletId, attachments[], createdBy, paidBy
```

Người dùng mới được tạo tự động: 2 ví mặc định (Tiền mặt, Ngân hàng) số dư 0đ
và bộ danh mục thu/chi mặc định.

## 7. Ghi chú kỹ thuật

- **Ảnh minh chứng được nén** về tối đa 1000px, JPEG ~72% (≈80–200KB/ảnh) trước
  khi lưu, vì Firestore giới hạn 1MB/document.
- **Giao dịch + số dư ví ghi trong cùng một `writeBatch`** nên dữ liệu không bị lệch.
- Các hàm bị gọi từ `onclick=""` trong HTML được gắn tường minh vào `window`
  ở cuối `app.js` (ES Module có scope riêng).
- Dark Mode và múi giờ lưu trong `localStorage` theo từng thiết bị.
- Xóa giao dịch / ngân sách / công nợ / định kỳ có hộp thoại xác nhận. Muốn bỏ,
  xóa dòng `if(!confirm(...)) return;` trong hàm tương ứng ở `app.js`.
- **API key trong `firebase-config.js` là key công khai** (bắt buộc lộ ra vì
  chạy trên trình duyệt) — sự an toàn thực sự đến từ Firestore Rules + App
  Check (mục 3) + giới hạn domain/API cho key đó trong Google Cloud Console
  (APIs & Services → Credentials), không phải từ việc giấu key.
