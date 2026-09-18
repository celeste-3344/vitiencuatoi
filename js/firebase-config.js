/* =====================================================
   js/firebase-config.js
   -----------------------------------------------------
   Khởi tạo Firebase App + Auth + Firestore và export ra
   cho auth.js / data.js dùng chung.

   LƯU Ý: Nếu bạn đã có sẵn file cấu hình của riêng mình,
   chỉ cần đảm bảo nó export đúng 3 thứ: app, auth, db.
===================================================== */
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import { getAuth, setPersistence, browserLocalPersistence } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';

const firebaseConfig = {
  apiKey: 'AIzaSyBNG5_UZ7hkp51B2xikdYpp6CXvuK7hb2w',
  authDomain: 'budget-dcebf.firebaseapp.com',
  databaseURL: 'https://budget-dcebf-default-rtdb.asia-southeast1.firebasedatabase.app',
  projectId: 'budget-dcebf',
  storageBucket: 'budget-dcebf.firebasestorage.app',
  messagingSenderId: '764645880037',
  appId: '1:764645880037:web:4d262bb5ab1ed1bedfe40c',
  measurementId: 'G-8JE28V51VE',
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

// Giữ phiên đăng nhập ngay cả khi đóng trình duyệt (mặc định của Firebase,
// khai báo tường minh để tránh phụ thuộc vào thay đổi mặc định về sau).
setPersistence(auth, browserLocalPersistence).catch((err) => {
  console.warn('[Sổ Chi Tiêu] Không thiết lập được chế độ lưu phiên đăng nhập.', err);
});
