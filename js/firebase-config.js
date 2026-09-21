/* =====================================================
   js/firebase-config.js
   -----------------------------------------------------
   Khởi tạo Firebase App + Auth + Firestore + App Check và
   export ra cho auth.js / data.js dùng chung.

   ⚠️ FILE NÀY DÙNG PLACEHOLDER, KHÔNG PHẢI KEY THẬT.
   Giá trị thật được điền tự động lúc GitHub Actions build & deploy,
   lấy từ Settings → Secrets and variables → Actions của repo
   (xem hướng dẫn đầy đủ trong README.md, mục "Triển khai lên GitHub Pages").

   CHẠY THỬ Ở MÁY (local): tạo file js/firebase-config.local.js
   (đã có trong .gitignore, KHÔNG bị đẩy lên Git) copy từ file này,
   điền key thật vào, rồi đổi tạm dòng <script type="module" src="js/app.js">
   trong index.html để trỏ qua bản local đó — hoặc đơn giản nhất: điền
   key thật thẳng vào các dòng __FIREBASE_...__ bên dưới để test, miễn là
   KHÔNG git commit lúc đang có key thật trong file.
===================================================== */
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import { getAuth, setPersistence, browserLocalPersistence } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { initializeAppCheck, ReCaptchaV3Provider } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app-check.js';

const firebaseConfig = {
  apiKey: '__FIREBASE_API_KEY__',
  authDomain: '__FIREBASE_AUTH_DOMAIN__',
  databaseURL: '__FIREBASE_DATABASE_URL__',
  projectId: '__FIREBASE_PROJECT_ID__',
  storageBucket: '__FIREBASE_STORAGE_BUCKET__',
  messagingSenderId: '__FIREBASE_MESSAGING_SENDER_ID__',
  appId: '__FIREBASE_APP_ID__',
  measurementId: '__FIREBASE_MEASUREMENT_ID__',
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

/* =====================================================
   APP CHECK (chống bot / spam gọi thẳng API, xem README
   mục "App Check" để lấy site key reCAPTCHA v3 và bật
   enforcement trong Firebase Console)
   -----------------------------------------------------
   - THAY 'DÁN_RECAPTCHA_V3_SITE_KEY_VÀO_ĐÂY' bằng site key
     (public key) lấy từ https://www.google.com/recaptcha/admin
   - Khi chạy ở localhost/127.0.0.1, Firebase sẽ in ra Console
     một "debug token" — copy token đó rồi vào Firebase Console
     > App Check > Manage debug tokens để đăng ký, nếu không App
     Check sẽ chặn app khi test ở máy (App Check không nhận diện
     được localhost qua reCAPTCHA).
   - Nếu bạn CHƯA lấy site key, cứ để nguyên placeholder — app
     vẫn chạy bình thường (Firestore sẽ chỉ thực sự chặn khi bạn
     bật "Enforce" trong Firebase Console, xem README).
===================================================== */
const RECAPTCHA_V3_SITE_KEY = 'DÁN_RECAPTCHA_V3_SITE_KEY_VÀO_ĐÂY';

if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
  // Chỉ bật debug token khi chạy local — TUYỆT ĐỐI không để dòng này
  // chạy trên bản production (đã được if bao ngoài nên an toàn).
  self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
}

export let appCheck = null;
if (RECAPTCHA_V3_SITE_KEY && RECAPTCHA_V3_SITE_KEY !== 'DÁN_RECAPTCHA_V3_SITE_KEY_VÀO_ĐÂY') {
  try {
    appCheck = initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider(RECAPTCHA_V3_SITE_KEY),
      isTokenAutoRefreshEnabled: true,
    });
  } catch (err) {
    console.warn('[Sổ Chi Tiêu] Không khởi tạo được App Check.', err);
  }
} else {
  console.warn('[Sổ Chi Tiêu] App Check chưa được cấu hình — xem hướng dẫn "App Check" trong README.md.');
}

// Giữ phiên đăng nhập ngay cả khi đóng trình duyệt (mặc định của Firebase,
// khai báo tường minh để tránh phụ thuộc vào thay đổi mặc định về sau).
setPersistence(auth, browserLocalPersistence).catch((err) => {
  console.warn('[Sổ Chi Tiêu] Không thiết lập được chế độ lưu phiên đăng nhập.', err);
});
