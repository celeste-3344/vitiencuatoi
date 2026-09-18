/* =====================================================
   js/auth.js — XÁC THỰC NGƯỜI DÙNG (FIREBASE AUTH)
   -----------------------------------------------------
   Hỗ trợ: Email/Mật khẩu, Google (popup, tự chuyển sang
   redirect nếu popup bị chặn) và Quên mật khẩu.

   TRƯỚC KHI CHẠY, trong Firebase Console > Authentication
   > Sign-in method, hãy BẬT 2 provider:
     - Email/Password
     - Google
   Và thêm domain của bạn (localhost, 127.0.0.1,
   <tên-tài-khoản>.github.io) vào mục Authorized domains.
===================================================== */
import { auth } from './firebase-config.js';
import {
  GoogleAuthProvider,
  EmailAuthProvider,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  sendPasswordResetEmail,
  onAuthStateChanged,
  updateProfile,
  updatePassword,
  linkWithCredential,
  reauthenticateWithCredential,
  reauthenticateWithPopup,
  signOut,
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';

/* Thông tin người dùng vừa điền ở form Đăng ký — được app.js lấy lại
   sau khi Firestore khởi tạo xong hồ sơ, tránh tình trạng onAuthStateChanged
   chạy trước khi kịp lưu tên hiển thị. */
let pendingProfile = null;

export function consumePendingProfile() {
  const p = pendingProfile;
  pendingProfile = null;
  return p;
}

/* =====================================================
   THEO DÕI PHIÊN ĐĂNG NHẬP
===================================================== */
export function watchAuth(onLogin, onLogout) {
  // Bắt kết quả trả về nếu trước đó phải đăng nhập Google bằng redirect.
  getRedirectResult(auth).catch((err) => {
    if (err && err.code !== 'auth/no-auth-event') {
      console.warn('[Sổ Chi Tiêu] Lỗi khi nhận kết quả đăng nhập Google.', err);
    }
  });

  return onAuthStateChanged(auth, (user) => {
    if (user) onLogin(user);
    else onLogout();
  });
}

export function getCurrentUser() {
  return auth.currentUser;
}

/* =====================================================
   ĐĂNG NHẬP / ĐĂNG KÝ BẰNG EMAIL
===================================================== */
export async function loginWithEmail(email, password) {
  const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
  return cred.user;
}

export async function registerWithEmail({ name, username, email, password }) {
  const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
  pendingProfile = { name: name.trim(), username: username.trim().toLowerCase() };
  try {
    await updateProfile(cred.user, { displayName: name.trim() });
  } catch (err) {
    console.warn('[Sổ Chi Tiêu] Không cập nhật được tên hiển thị trên Firebase Auth.', err);
  }
  return cred.user;
}

/* =====================================================
   ĐĂNG NHẬP BẰNG GOOGLE
===================================================== */
export async function loginWithGoogle() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  try {
    const cred = await signInWithPopup(auth, provider);
    return cred.user;
  } catch (err) {
    // Trình duyệt chặn popup (hoặc người dùng đang ở webview) -> dùng redirect.
    if (
      err.code === 'auth/popup-blocked'
      || err.code === 'auth/operation-not-supported-in-this-environment'
      || err.code === 'auth/cancelled-popup-request'
    ) {
      await signInWithRedirect(auth, provider);
      return null;
    }
    throw err;
  }
}

/* =====================================================
   QUÊN MẬT KHẨU
===================================================== */
export async function sendResetEmail(email) {
  await sendPasswordResetEmail(auth, email.trim());
}

/* =====================================================
   QUẢN LÝ MẬT KHẨU (thêm mật khẩu cho tài khoản Google /
   đổi mật khẩu cho tài khoản Email)
   -----------------------------------------------------
   Một tài khoản Firebase có thể có nhiều "provider" cùng
   trỏ tới 1 user (liên kết qua cùng uid). Ta dựa vào
   user.providerData để biết user hiện đã có provider
   'password' (email/mật khẩu) hay chưa:
     - Đăng ký bằng Google  -> chỉ có provider 'google.com'
     - Đăng ký bằng Email   -> có provider 'password'
   Sau khi "thêm mật khẩu" (link) cho tài khoản Google,
   user sẽ có CẢ HAI provider và từ đó có thể:
     - Đăng nhập bằng email/mật khẩu vừa tạo
     - Dùng chức năng "Quên mật khẩu" để nhận email reset
       (trước đó không nhận được vì tài khoản chưa hề có
       mật khẩu nào để "quên").
===================================================== */

// Kiểm tra user hiện tại đã có provider 'password' hay chưa.
export function hasPasswordProvider(user) {
  const target = user || auth.currentUser;
  if (!target) return false;
  return (target.providerData || []).some((p) => p.providerId === 'password');
}

// Liệt kê tên các provider đang liên kết (để hiển thị UI nếu cần).
export function listProviders(user) {
  const target = user || auth.currentUser;
  if (!target) return [];
  return (target.providerData || []).map((p) => p.providerId);
}

/* Thêm mật khẩu cho tài khoản đang đăng nhập bằng Google (chưa có mật khẩu).
   Dùng linkWithCredential để "gắn" thêm provider 'password' vào CÙNG uid,
   không tạo tài khoản mới. Sau thao tác này user có thể đăng nhập bằng cả
   Google lẫn Email/Mật khẩu, và nhận được email "Quên mật khẩu". */
export async function addPasswordToAccount(newPassword) {
  const user = auth.currentUser;
  if (!user) throw new Error('Chưa đăng nhập.');
  if (!user.email) throw new Error('Tài khoản Google này không có email để gắn mật khẩu.');
  const credential = EmailAuthProvider.credential(user.email, newPassword);
  try {
    await linkWithCredential(user, credential);
  } catch (err) {
    // Thao tác nhạy cảm (link credential) đôi khi yêu cầu phiên đăng nhập
    // "mới" (gần đây) -> Firebase trả requires-recent-login. Ta chủ động
    // yêu cầu đăng nhập lại bằng Google rồi thử link lại một lần.
    if (err && err.code === 'auth/requires-recent-login') {
      await reauthWithGoogle();
      await linkWithCredential(auth.currentUser, credential);
      return;
    }
    throw err;
  }
}

/* Đổi mật khẩu cho tài khoản đã có provider 'password'. Firebase yêu cầu
   xác thực lại bằng mật khẩu CŨ trước khi cho updatePassword, để tránh
   trường hợp lộ phiên đăng nhập (ví dụ máy công cộng) bị đổi mật khẩu. */
export async function changePassword(currentPassword, newPassword) {
  const user = auth.currentUser;
  if (!user || !user.email) throw new Error('Chưa đăng nhập.');
  const credential = EmailAuthProvider.credential(user.email, currentPassword);
  await reauthenticateWithCredential(user, credential);
  await updatePassword(user, newPassword);
}

// Xác thực lại bằng popup Google — dùng khi thao tác nhạy cảm (link mật
// khẩu, đổi mật khẩu...) bị Firebase từ chối vì phiên đăng nhập đã cũ.
export async function reauthWithGoogle() {
  const user = auth.currentUser;
  if (!user) throw new Error('Chưa đăng nhập.');
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  await reauthenticateWithPopup(user, provider);
}

/* =====================================================
   ĐĂNG XUẤT
===================================================== */
export async function logout() {
  await signOut(auth);
}

/* =====================================================
   DỊCH MÃ LỖI FIREBASE SANG TIẾNG VIỆT
===================================================== */
const ERROR_MESSAGES = {
  'auth/invalid-email': 'Địa chỉ email không hợp lệ.',
  'auth/user-disabled': 'Tài khoản này đã bị vô hiệu hóa.',
  'auth/user-not-found': 'Email này chưa được đăng ký.',
  'auth/wrong-password': 'Mật khẩu không đúng. Vui lòng thử lại.',
  'auth/invalid-credential': 'Email hoặc mật khẩu không đúng.',
  'auth/invalid-login-credentials': 'Email hoặc mật khẩu không đúng.',
  'auth/email-already-in-use': 'Email này đã được đăng ký. Hãy đăng nhập hoặc dùng email khác.',
  'auth/weak-password': 'Mật khẩu quá yếu — cần tối thiểu 6 ký tự.',
  'auth/missing-password': 'Vui lòng nhập mật khẩu.',
  'auth/too-many-requests': 'Bạn đã thử quá nhiều lần. Vui lòng đợi ít phút rồi thử lại.',
  'auth/network-request-failed': 'Mất kết nối mạng. Vui lòng kiểm tra Internet và thử lại.',
  'auth/popup-closed-by-user': 'Bạn đã đóng cửa sổ đăng nhập Google.',
  'auth/popup-blocked': 'Trình duyệt đã chặn cửa sổ đăng nhập. Vui lòng cho phép popup và thử lại.',
  'auth/unauthorized-domain': 'Tên miền hiện tại chưa được cấp phép trong Firebase Console (Authentication > Settings > Authorized domains).',
  'auth/account-exists-with-different-credential': 'Email này đã đăng ký bằng phương thức khác. Hãy đăng nhập bằng email & mật khẩu.',
  'auth/operation-not-allowed': 'Phương thức đăng nhập này chưa được bật trong Firebase Console.',
  'auth/requires-recent-login': 'Vì lý do bảo mật, vui lòng đăng nhập lại rồi thử lại.',
  'auth/credential-already-in-use': 'Email này đã được liên kết với một tài khoản khác.',
  'auth/provider-already-linked': 'Tài khoản của bạn đã có mật khẩu rồi.',
  'auth/wrong-password-current': 'Mật khẩu hiện tại không đúng.',
};

export function authErrorMessage(err) {
  if (!err) return 'Đã xảy ra lỗi không xác định.';
  const code = err.code || '';
  return ERROR_MESSAGES[code] || err.message || 'Đã xảy ra lỗi không xác định.';
}
