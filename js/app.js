/* =====================================================
   js/app.js — GIAO DIỆN, SỰ KIỆN & LUỒNG ỨNG DỤNG
   -----------------------------------------------------
   File này chỉ lo phần hiển thị (DOM, biểu đồ SVG, modal,
   toast, dark mode...). Mọi thao tác đọc/ghi dữ liệu đều
   đi qua js/data.js, mọi thao tác đăng nhập đi qua js/auth.js.
===================================================== */
import * as Auth from './auth.js';
import * as Data from './data.js';
import { state } from './data.js';

/* `appData` là bí danh của state trong data.js — giữ nguyên tên cũ để
   toàn bộ code hiển thị bên dưới không phải viết lại. */
const appData = state;
const CATS = state.categories;

function findCat(id){
  return [...CATS.expense, ...CATS.income].find(c => c.id === id) || { label:id, icon:'fa-circle', color:'#999' };
}

/* Sinh id cục bộ (dùng cho từng lần trả nợ nằm bên trong document công nợ). */
function newLocalId(){
  return `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

/* =====================================================
   LỚP PHỦ "ĐANG TẢI" & XỬ LÝ LỖI KHI GHI LÊN FIRESTORE
===================================================== */
function showLoading(text){
  const box = document.getElementById('globalLoading');
  const label = document.getElementById('globalLoadingText');
  if(label && text) label.textContent = text;
  if(box) box.classList.remove('hidden');
}
function hideLoading(){
  const box = document.getElementById('globalLoading');
  if(box) box.classList.add('hidden');
}

/* Bọc một tác vụ ghi dữ liệu: hiện spinner, bắt lỗi và báo bằng toast. */
async function withLoading(task, loadingText){
  showLoading(loadingText || 'Đang đồng bộ...');
  try {
    return await task();
  } catch(err){
    console.error('[Sổ Chi Tiêu] Lỗi khi ghi dữ liệu lên Firestore:', err);
    showToast(firestoreErrorMessage(err), 'error');
    throw err;
  } finally {
    hideLoading();
  }
}

function firestoreErrorMessage(err){
  const code = (err && err.code) || '';
  if(code === 'permission-denied') return 'Không có quyền ghi dữ liệu. Hãy kiểm tra lại Rules của Cloud Firestore.';
  if(code === 'unavailable') return 'Mất kết nối tới máy chủ. Vui lòng kiểm tra Internet rồi thử lại.';
  if(code === 'invalid-argument') return 'Dữ liệu quá lớn hoặc không hợp lệ (ảnh minh chứng tối đa ~1MB/giao dịch).';
  return 'Không lưu được dữ liệu lên máy chủ. Vui lòng thử lại.';
}

/* Nút submit: khoá lại + hiện spinner nhỏ trong lúc chờ Firebase phản hồi. */
function setButtonBusy(btn, busy, busyText){
  if(!btn) return;
  if(busy){
    btn.dataset.originalHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<span class="btn-inline-spinner"></span> ${busyText || 'Đang xử lý...'}`;
  } else {
    btn.disabled = false;
    if(btn.dataset.originalHtml) btn.innerHTML = btn.dataset.originalHtml;
  }
}

/* =====================================================
   NÉN ẢNH MINH CHỨNG TRƯỚC KHI LƯU
   Firestore giới hạn 1MB/document, ảnh chụp từ điện thoại
   thường 3-5MB. Hàm này thu nhỏ về tối đa 1000px và nén
   JPEG ~72% -> mỗi ảnh còn khoảng 80-200KB.
===================================================== */
const ATTACH_MAX_SIZE = 1000;
const ATTACH_QUALITY = 0.72;

function compressImage(file){
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('read-error'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('decode-error'));
      img.onload = () => {
        try {
          let { width, height } = img;
          const scale = Math.min(1, ATTACH_MAX_SIZE / Math.max(width, height));
          width = Math.round(width * scale);
          height = Math.round(height * scale);

          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(0, 0, width, height);
          ctx.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL('image/jpeg', ATTACH_QUALITY));
        } catch(err){
          reject(err);
        }
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

// Danh sách biểu tượng gợi ý dùng chung cho "Thêm danh mục" và "Thêm khoản định kỳ".
const ICON_CHOICES = [
  'fa-tag','fa-receipt','fa-house','fa-bolt','fa-wifi','fa-tv','fa-mobile-screen','fa-car','fa-motorcycle','fa-bus',
  'fa-plane','fa-utensils','fa-mug-hot','fa-cart-shopping','fa-bag-shopping','fa-shirt','fa-dumbbell','fa-heart-pulse',
  'fa-pills','fa-graduation-cap','fa-book','fa-gamepad','fa-film','fa-music','fa-paw','fa-baby','fa-gift',
  'fa-piggy-bank','fa-sack-dollar','fa-credit-card','fa-file-invoice','fa-hand-holding-dollar','fa-umbrella',
  'fa-tree','fa-droplet','fa-briefcase','fa-child',
];

// Chuyển tên tiếng Việt có dấu thành slug không dấu để làm id danh mục (vd "Du lịch" -> "du-lich").
function slugifyVN(str){
  const map = {
    à:'a',á:'a',ạ:'a',ả:'a',ã:'a',â:'a',ầ:'a',ấ:'a',ậ:'a',ẩ:'a',ẫ:'a',ă:'a',ằ:'a',ắ:'a',ặ:'a',ẳ:'a',ẵ:'a',
    è:'e',é:'e',ẹ:'e',ẻ:'e',ẽ:'e',ê:'e',ề:'e',ế:'e',ệ:'e',ể:'e',ễ:'e',
    ì:'i',í:'i',ị:'i',ỉ:'i',ĩ:'i',
    ò:'o',ó:'o',ọ:'o',ỏ:'o',õ:'o',ô:'o',ồ:'o',ố:'o',ộ:'o',ổ:'o',ỗ:'o',ơ:'o',ờ:'o',ớ:'o',ợ:'o',ở:'o',ỡ:'o',
    ù:'u',ú:'u',ụ:'u',ủ:'u',ũ:'u',ư:'u',ừ:'u',ứ:'u',ự:'u',ử:'u',ữ:'u',
    ỳ:'y',ý:'y',ỵ:'y',ỷ:'y',ỹ:'y',đ:'d',
  };
  return str.toLowerCase().split('').map(ch => map[ch] || ch).join('')
    .replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-').replace(/-+/g, '-');
}

// Vẽ lưới chọn biểu tượng (dùng chung cho modal Danh mục và modal Định kỳ).
function renderIconPicker(pickerId, hiddenInputId, selected){
  const picker = document.getElementById(pickerId);
  picker.innerHTML = ICON_CHOICES.map(ic => `
    <button type="button" class="icon-pick ${ic === selected ? 'active' : ''}" onclick="selectIcon('${pickerId}','${hiddenInputId}','${ic}')" title="${ic}">
      <i class="fa-solid ${ic}"></i>
    </button>`).join('');
}
function selectIcon(pickerId, hiddenInputId, icon){
  document.getElementById(hiddenInputId).value = icon;
  document.querySelectorAll(`#${pickerId} .icon-pick`).forEach(btn => btn.classList.remove('active'));
  const idx = ICON_CHOICES.indexOf(icon);
  const btns = document.querySelectorAll(`#${pickerId} .icon-pick`);
  if(idx > -1 && btns[idx]) btns[idx].classList.add('active');
}

// Sinh ngày mẫu (demo) luôn nằm trong THÁNG HIỆN TẠI theo ngày thực của hệ thống,
// để dữ liệu demo hiển thị đúng bất kể người dùng mở file vào thời điểm nào.

function currentMonthLabelVI(){
  const now = new Date();
  return `Tháng ${now.getMonth() + 1}, ${now.getFullYear()}`;
}

let currentTxType = 'expense';
let currentAnalyticsRange = 'month';
let currentDebtTab = 'owed_to_me';
let currentDebtType = 'owed_to_me';
let editingDebtId = null;
let settlingDebtId = null;
let editingWalletId = null;
let currentAttachments = []; // ảnh minh chứng (base64) đang đính kèm ở modal Thêm giao dịch
const MAX_ATTACHMENTS = 5;
let settleAttachImages = []; // ảnh minh chứng đính kèm khi ghi nhận thanh toán công nợ
let currentHistoryDebtId = null; // id khoản công nợ đang mở ở modal "Lịch sử trả nợ"
let editingDebtPaymentDebtId = null; // đang bổ sung/sửa ảnh minh chứng cho lần trả nợ nào
let editingDebtPaymentId = null;
let editingDebtPaymentImages = [];
let editingCategoryId = null;
let editingCategoryType = null;
let currentCatMgrType = 'expense';
let editingAttachTxId = null;
let editingAttachImages = []; // ảnh minh chứng đang chỉnh sửa cho một giao dịch đã tạo trước đó
let lightboxImages = [];
let lightboxIndex = 0;

// Bảng màu gradient dùng chung cho các ví/nguồn tiền
const WALLET_GRADIENTS = [
  'linear-gradient(160deg,#689D4B,#4f7c37)',
  'linear-gradient(160deg,#D96868,#b34d4d)',
  'linear-gradient(160deg,#7A8FC2,#556aa3)',
  'linear-gradient(160deg,#E0A85A,#b8813a)',
  'linear-gradient(160deg,#9C7BC9,#7452a0)',
  'linear-gradient(160deg,#5FB0B7,#3d8a90)',
  'linear-gradient(160deg,#5A5A5A,#333333)',
];

// Danh sách ngân hàng phổ biến tại Việt Nam kèm mã BIN (theo chuẩn Napas/VietQR),
// dùng để tạo mã QR nhận tiền cho ví có gắn tài khoản ngân hàng.
const VIETQR_BANKS = [
  { bin:'970436', name:'Vietcombank' },
  { bin:'970415', name:'VietinBank' },
  { bin:'970418', name:'BIDV' },
  { bin:'970405', name:'Agribank' },
  { bin:'970407', name:'Techcombank' },
  { bin:'970422', name:'MB Bank' },
  { bin:'970416', name:'ACB' },
  { bin:'970432', name:'VPBank' },
  { bin:'970403', name:'Sacombank' },
  { bin:'970423', name:'TPBank' },
  { bin:'970431', name:'Eximbank' },
  { bin:'970437', name:'HDBank' },
  { bin:'970441', name:'VIB' },
  { bin:'970443', name:'SHB' },
  { bin:'970426', name:'MSB' },
  { bin:'970448', name:'OCB' },
  { bin:'970440', name:'SeABank' },
  { bin:'970449', name:'LPBank' },
  { bin:'970428', name:'Nam A Bank' },
  { bin:'970429', name:'SCB' },
  { bin:'970425', name:'ABBank' },
  { bin:'970438', name:'BaoViet Bank' },
  { bin:'970409', name:'Bac A Bank' },
  { bin:'970412', name:'PVcomBank' },
  { bin:'970452', name:'Kienlongbank' },
  { bin:'970433', name:'VietBank' },
  { bin:'970400', name:'SaigonBank' },
  { bin:'970419', name:'NCB' },
  { bin:'970427', name:'VietABank' },
  { bin:'970430', name:'PGBank' },
];

/* =====================================================
   HELPERS
===================================================== */
function formatCurrency(n){
  const sign = n < 0 ? '-' : '';
  return sign + Math.round(Math.abs(n)).toLocaleString('vi-VN') + ' đ';
}
function formatDate(d){
  const dt = new Date(d + 'T00:00:00');
  return dt.toLocaleDateString('vi-VN', { day:'2-digit', month:'2-digit', year:'numeric' });
}
function currentMonthKey(){
  // Luôn lấy tháng/năm hiện tại theo thời gian thực của hệ thống (local time),
  // không phụ thuộc vào ngày tháng của các giao dịch đã nhập (tránh lỗi khi có giao dịch tương lai/quá khứ).
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}
// Trả về monthKey ("YYYY-MM") của tháng cách `baseDate` một số tháng `offset` (có thể âm).
function getMonthKeyOffset(baseDate, offset){
  const d = new Date(baseDate.getFullYear(), baseDate.getMonth() + offset, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
// Nhãn hiển thị ngắn gọn kiểu "Th9" từ monthKey "YYYY-MM"
function monthKeyToLabel(monthKey){
  return 'Th' + parseInt(monthKey.slice(5, 7), 10);
}
// Nhãn hiển thị đầy đủ kiểu "Tháng 9/2026" từ monthKey "YYYY-MM" (dùng cho bảng tổng kết nhiều tháng/nhiều năm).
function monthKeyToFullLabel(monthKey){
  const [y, m] = monthKey.split('-');
  return `Tháng ${parseInt(m, 10)}/${y}`;
}
// Nhóm appData.transactions theo tháng và trả về dữ liệu của `count` tháng gần nhất
// tính từ thời điểm hiện tại (bao gồm cả những tháng không có giao dịch nào -> income/expense = 0).
function getMonthlyTrendData(count){
  const now = new Date();
  const result = [];
  for(let i = count - 1; i >= 0; i--){
    const monthKey = getMonthKeyOffset(now, -i);
    const monthTx = appData.transactions.filter(t => t.date.startsWith(monthKey));
    const income = monthTx.filter(t => t.type === 'income').reduce((s,t) => s + t.amount, 0);
    const expense = monthTx.filter(t => t.type === 'expense').reduce((s,t) => s + t.amount, 0);
    result.push({ month: monthKeyToLabel(monthKey), monthKey, income, expense });
  }
  return result;
}
function findWallet(id){ return appData.wallets.find(w => w.id === id); }
function isDark(){ return document.body.classList.contains('dark-theme'); }

/* =====================================================
   LIVE TIME WIDGET (Quốc gia / Múi giờ)
===================================================== */
// Danh sách quốc gia/múi giờ phổ biến — value là timezone chuẩn IANA.
const TIMEZONE_OPTIONS = [
  { value:'Asia/Ho_Chi_Minh', flag:'🇻🇳', label:'Việt Nam (Hà Nội)',   locationLabel:'Hà Nội, Việt Nam' },
  { value:'Asia/Tokyo',       flag:'🇯🇵', label:'Nhật Bản (Tokyo)',    locationLabel:'Tokyo, Nhật Bản' },
  { value:'Asia/Seoul',       flag:'🇰🇷', label:'Hàn Quốc (Seoul)',    locationLabel:'Seoul, Hàn Quốc' },
  { value:'America/New_York', flag:'🇺🇸', label:'Mỹ (New York)',      locationLabel:'New York, Mỹ' },
  { value:'Europe/London',    flag:'🇬🇧', label:'Anh (London)',       locationLabel:'London, Anh' },
  { value:'Australia/Sydney', flag:'🇦🇺', label:'Úc (Sydney)',        locationLabel:'Sydney, Úc' },
  { value:'Europe/Paris',     flag:'🇫🇷', label:'Pháp (Paris)',       locationLabel:'Paris, Pháp' },
];

// Đọc timezone đã lưu trong localStorage; nếu chưa có, mặc định Asia/Ho_Chi_Minh.
function getStoredTimezone(){
  try {
    return localStorage.getItem('userTimezone') || 'Asia/Ho_Chi_Minh';
  } catch(err){
    console.warn('[Sổ Chi Tiêu] Không truy cập được localStorage, dùng múi giờ mặc định.', err);
    return 'Asia/Ho_Chi_Minh';
  }
}

let currentTimezone = getStoredTimezone();
let liveClockInterval = null;

function getTimezoneOption(tz){
  return TIMEZONE_OPTIONS.find(o => o.value === tz) || null;
}
function getTimezoneLocationLabel(tz){
  const opt = getTimezoneOption(tz);
  return opt ? opt.locationLabel : tz;
}

// Điền danh sách <option> cho select ở Cài đặt, đồng thời chọn sẵn timezone hiện tại.
function populateTimezoneOptions(){
  const select = document.getElementById('timezoneSelect');
  if(!select) return;
  select.innerHTML = TIMEZONE_OPTIONS.map(o =>
    `<option value="${o.value}">${o.flag} ${o.label}</option>`
  ).join('');
  select.value = currentTimezone;
}

// Cập nhật đồng hồ trực tiếp (giờ:phút:giây, thứ/ngày/tháng/năm, địa điểm) theo timezone đang chọn.
function updateLiveClock(){
  const timeEl = document.getElementById('liveClockTime');
  const dateEl = document.getElementById('liveClockDate');
  const locEl  = document.getElementById('liveClockLocation');
  if(!timeEl || !dateEl || !locEl) return; // widget chỉ có trên Dashboard

  const now = new Date();
  try {
    const timeFormatter = new Intl.DateTimeFormat('vi-VN', {
      timeZone: currentTimezone, hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false,
    });
    const dateFormatter = new Intl.DateTimeFormat('vi-VN', {
      timeZone: currentTimezone, weekday:'long', day:'2-digit', month:'2-digit', year:'numeric',
    });
    timeEl.textContent = timeFormatter.format(now);
    dateEl.textContent = dateFormatter.format(now);
  } catch(err){
    console.error('[Sổ Chi Tiêu] Timezone không hợp lệ, dùng giờ hệ thống mặc định.', err);
    timeEl.textContent = now.toLocaleTimeString('vi-VN', { hour12:false });
    dateEl.textContent = now.toLocaleDateString('vi-VN', { weekday:'long', day:'2-digit', month:'2-digit', year:'numeric' });
  }
  locEl.textContent = getTimezoneLocationLabel(currentTimezone);
}

// Khởi động đồng hồ live, chạy cập nhật mỗi giây.
function startLiveClock(){
  updateLiveClock();
  if(liveClockInterval) clearInterval(liveClockInterval);
  liveClockInterval = setInterval(updateLiveClock, 1000);
}

// Khi người dùng đổi lựa chọn Quốc gia/Múi giờ trong Cài đặt.
function handleTimezoneChange(value){
  currentTimezone = value;
  try {
    localStorage.setItem('userTimezone', value);
  } catch(err){
    console.warn('[Sổ Chi Tiêu] Không lưu được múi giờ vào localStorage.', err);
  }
  updateLiveClock();
  showToast(`Đã chuyển múi giờ hiển thị sang ${getTimezoneLocationLabel(value)}.`);
}


/* =====================================================
   MÀN HÌNH XÁC THỰC (giao tiếp với js/auth.js)
===================================================== */
function switchAuthTab(tab){
  document.getElementById('tabLogin').classList.toggle('active', tab === 'login');
  document.getElementById('tabRegister').classList.toggle('active', tab === 'register');
  document.getElementById('loginForm').classList.toggle('hidden', tab !== 'login');
  document.getElementById('registerForm').classList.toggle('hidden', tab !== 'register');
}

const VN_DIACRITICS_REGEX = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđÀÁẠẢÃÂẦẤẬẨẪĂẰẮẶẲẴÈÉẸẺẼÊỀẾỆỂỄÌÍỊỈĨÒÓỌỎÕÔỒỐỘỔỖƠỜỚỢỞỠÙÚỤỦŨƯỪỨỰỬỮỲÝỴỶỸĐ]/;

function getUsernameValidationError(username){
  if(!username) return 'Vui lòng nhập tên đăng nhập.';
  if(/\s/.test(username)) return 'Tên đăng nhập không được chứa dấu cách.';
  if(VN_DIACRITICS_REGEX.test(username)) return 'Tên đăng nhập không được chứa dấu tiếng Việt.';
  if(/[A-Z]/.test(username)) return 'Tên đăng nhập phải viết thường, không chứa chữ in hoa.';
  if(/[^a-z0-9.]/.test(username)) return 'Tên đăng nhập không được chứa ký tự đặc biệt (chỉ gồm chữ thường, số và dấu chấm).';
  if(username.length < 2) return 'Tên đăng nhập phải có tối thiểu 2 ký tự.';
  return '';
}

function isValidEmail(email){
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/* ---- Đăng nhập bằng email & mật khẩu ---- */
async function handleLoginSubmit(e){
  e.preventDefault();
  const email = document.getElementById('loginEmailInput').value.trim();
  const password = document.getElementById('loginPasswordInput').value;
  const btn = document.getElementById('btnLoginSubmit');

  if(!isValidEmail(email)){ showToast('Vui lòng nhập địa chỉ email hợp lệ.', 'error'); return; }
  if(!password){ showToast('Vui lòng nhập mật khẩu.', 'error'); return; }

  setButtonBusy(btn, true, 'Đang đăng nhập...');
  try {
    await Auth.loginWithEmail(email, password);
    // onAuthStateChanged sẽ tự động nạp dữ liệu và mở Dashboard.
  } catch(err){
    showToast(Auth.authErrorMessage(err), 'error');
  } finally {
    setButtonBusy(btn, false);
  }
}

/* ---- Đăng ký tài khoản mới ---- */
async function handleRegisterSubmit(e){
  e.preventDefault();
  const name = document.getElementById('registerNameInput').value.trim();
  const username = document.getElementById('registerUsernameInput').value.trim().toLowerCase();
  const email = document.getElementById('registerEmailInput').value.trim();
  const password = document.getElementById('registerPasswordInput').value;
  const btn = document.getElementById('btnRegisterSubmit');

  if(!name){ showToast('Vui lòng nhập tên của bạn.', 'error'); return; }
  const usernameError = getUsernameValidationError(username);
  if(usernameError){ showToast(usernameError, 'error'); return; }
  if(!isValidEmail(email)){ showToast('Vui lòng nhập địa chỉ email hợp lệ.', 'error'); return; }
  if(password.length < 6){ showToast('Mật khẩu phải có tối thiểu 6 ký tự.', 'error'); return; }

  setButtonBusy(btn, true, 'Đang tạo tài khoản...');
  try {
    await Auth.registerWithEmail({ name, username, email, password });
    showToast('Tạo tài khoản thành công. Chào mừng bạn!');
  } catch(err){
    showToast(Auth.authErrorMessage(err), 'error');
  } finally {
    setButtonBusy(btn, false);
  }
}

/* ---- Đăng nhập bằng Google ---- */
async function handleGoogleSignIn(btn){
  setButtonBusy(btn, true, 'Đang kết nối Google...');
  try {
    await Auth.loginWithGoogle();
  } catch(err){
    showToast(Auth.authErrorMessage(err), 'error');
  } finally {
    setButtonBusy(btn, false);
  }
}

/* ---- Quên mật khẩu ---- */
function openForgotModal(){
  const input = document.getElementById('forgotEmailInput');
  const loginEmail = document.getElementById('loginEmailInput');
  if(input) input.value = (loginEmail && loginEmail.value.trim()) || '';
  document.getElementById('forgotModalOverlay').classList.remove('hidden');
  if(input) setTimeout(() => input.focus(), 60);
}
function closeForgotModal(){
  document.getElementById('forgotModalOverlay').classList.add('hidden');
}

async function handleForgotSubmit(e){
  e.preventDefault();
  const email = document.getElementById('forgotEmailInput').value.trim();
  const btn = document.getElementById('btnForgotSubmit');

  if(!isValidEmail(email)){ showToast('Vui lòng nhập địa chỉ email hợp lệ.', 'error'); return; }

  setButtonBusy(btn, true, 'Đang gửi...');
  try {
    await Auth.sendResetEmail(email);
    closeForgotModal();
    showToast('Vui lòng kiểm tra hộp thư đến để đặt lại mật khẩu!');
  } catch(err){
    // Firebase có thể trả auth/user-not-found nếu email chưa đăng ký.
    if(err && (err.code === 'auth/user-not-found' || err.code === 'auth/invalid-credential')){
      showToast('Email này chưa được đăng ký trong hệ thống.', 'error');
    } else {
      showToast(Auth.authErrorMessage(err), 'error');
    }
  } finally {
    setButtonBusy(btn, false);
  }
}

/* ---- Đăng xuất ---- */
async function handleLogout(){
  if(!confirm('Bạn có chắc chắn muốn đăng xuất?')) return;
  showLoading('Đang đăng xuất...');
  try {
    await Auth.logout();
  } catch(err){
    showToast(Auth.authErrorMessage(err), 'error');
  } finally {
    hideLoading();
  }
}

/* =====================================================
   ĐIỀU HƯỚNG GIỮA MÀN HÌNH AUTH VÀ DASHBOARD
===================================================== */
function showAuthScreen(){
  document.getElementById('appScreen').classList.add('hidden');
  document.getElementById('authScreen').classList.remove('hidden');
  switchAuthTab('login');
  const pw = document.getElementById('loginPasswordInput');
  if(pw) pw.value = '';
}

function showAppScreen(){
  document.getElementById('authScreen').classList.add('hidden');
  document.getElementById('appScreen').classList.remove('hidden');
}

/* =====================================================
   MENU DI ĐỘNG (drawer trượt cho màn hình nhỏ)
===================================================== */
function openMobileDrawer(){
  document.querySelectorAll('.sidebar').forEach(s => s.classList.add('mobile-open'));
  document.querySelectorAll('.sidebar-backdrop').forEach(b => b.classList.add('show'));
  document.body.style.overflow = 'hidden';
}
function closeMobileDrawer(){
  document.querySelectorAll('.sidebar').forEach(s => s.classList.remove('mobile-open'));
  document.querySelectorAll('.sidebar-backdrop').forEach(b => b.classList.remove('show'));
  document.body.style.overflow = '';
}

function renderUser(){
  document.getElementById('userName').textContent = appData.user.name;
  document.getElementById('userEmail').textContent = appData.user.email;
  const initial = appData.user.name.trim().charAt(0).toUpperCase();
  document.getElementById('userAvatar').textContent = initial;
  const mobileAvatar = document.getElementById('userAvatarMobile');
  if(mobileAvatar) mobileAvatar.textContent = initial;
  const preview = document.getElementById('settingsProfilePreview');
  if(preview) preview.textContent = `${appData.user.name} · @${appData.user.username || '—'} · ${appData.user.email}`;
  renderSecurityRow();
}

// Cập nhật dòng "Bảo mật & Mật khẩu" trong Cài đặt tùy theo tài khoản
// hiện tại đã có mật khẩu (đăng ký bằng email) hay chưa (đăng nhập Google).
function renderSecurityRow(){
  const desc = document.getElementById('securityDesc');
  const label = document.getElementById('btnSecurityActionLabel');
  if(!desc || !label) return;
  if(Auth.hasPasswordProvider()){
    desc.textContent = 'Tài khoản của bạn đã có mật khẩu. Bạn có thể đổi mật khẩu bất cứ lúc nào.';
    label.textContent = 'Đổi mật khẩu';
  } else {
    desc.textContent = 'Bạn đang đăng nhập bằng Google và chưa có mật khẩu. Thêm mật khẩu để có thể đăng nhập bằng email hoặc dùng chức năng "Quên mật khẩu".';
    label.textContent = 'Thêm mật khẩu';
  }
}

/* =====================================================
   MODAL: SỬA THÔNG TIN CÁ NHÂN
===================================================== */
function openProfileModal(){
  document.getElementById('profileInputName').value = appData.user.name;
  document.getElementById('profileInputUsername').value = appData.user.username || '';
  document.getElementById('profileInputEmail').value = appData.user.email;
  document.getElementById('profileModalOverlay').classList.remove('hidden');
}
function closeProfileModal(){ document.getElementById('profileModalOverlay').classList.add('hidden'); }

async function handleSaveProfile(e){
  e.preventDefault();
  const name = document.getElementById('profileInputName').value.trim();
  const username = document.getElementById('profileInputUsername').value.trim();
  const email = document.getElementById('profileInputEmail').value.trim();

  if(!name){ showToast('Vui lòng nhập họ và tên.', 'error'); return; }

  const usernameError = getUsernameValidationError(username);
  if(usernameError){ showToast(usernameError, 'error'); return; }

  // Nếu đổi sang một tên đăng nhập khác (khác tên hiện tại của chính mình) thì
  // phải kiểm tra xem tên đó đã có ai dùng chưa.
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  if(!emailOk){ showToast('Vui lòng nhập địa chỉ email hợp lệ.', 'error'); return; }

  // Email dùng để ĐĂNG NHẬP do Firebase Authentication quản lý và không đổi ở đây;
  // ô email bên dưới chỉ là email liên hệ hiển thị trong hồ sơ.
  await withLoading(() => Data.saveProfile({ name, username, email }), 'Đang lưu hồ sơ...');

  closeProfileModal();
  renderUser();
  showToast('Đã cập nhật thông tin cá nhân.');
}

document.getElementById('profileModalOverlay').addEventListener('click', (e) => { if(e.target.id === 'profileModalOverlay') closeProfileModal(); });

/* =====================================================
   MODAL: THÊM / ĐỔI MẬT KHẨU
   -----------------------------------------------------
   - Tài khoản Google chưa có mật khẩu -> chế độ "Thêm mật khẩu"
     (không cần nhập mật khẩu cũ, chỉ cần đặt mật khẩu mới).
   - Tài khoản đã có mật khẩu -> chế độ "Đổi mật khẩu"
     (bắt buộc nhập mật khẩu hiện tại để xác thực lại).
===================================================== */
function openSecurityModal(){
  const isChangeMode = Auth.hasPasswordProvider();
  document.getElementById('securityForm').reset();

  document.getElementById('securityModalTitle').textContent = isChangeMode ? 'Đổi mật khẩu' : 'Thêm mật khẩu';
  document.getElementById('securityModalHint').textContent = isChangeMode
    ? 'Nhập mật khẩu hiện tại và mật khẩu mới.'
    : 'Bạn đang đăng nhập bằng Google. Đặt một mật khẩu để có thể đăng nhập bằng email hoặc dùng chức năng "Quên mật khẩu" sau này.';
  document.getElementById('fieldCurrentPassword').classList.toggle('hidden', !isChangeMode);
  document.getElementById('securityCurrentPassword').required = isChangeMode;
  document.getElementById('securityNewPasswordLabel').textContent = isChangeMode ? 'Mật khẩu mới' : 'Đặt mật khẩu';

  document.getElementById('securityModalOverlay').classList.remove('hidden');
  setTimeout(() => {
    const first = isChangeMode
      ? document.getElementById('securityCurrentPassword')
      : document.getElementById('securityNewPassword');
    if(first) first.focus();
  }, 60);
}
function closeSecurityModal(){
  document.getElementById('securityModalOverlay').classList.add('hidden');
}
document.getElementById('securityModalOverlay').addEventListener('click', (e) => { if(e.target.id === 'securityModalOverlay') closeSecurityModal(); });

async function handleSecuritySubmit(e){
  e.preventDefault();
  const isChangeMode = Auth.hasPasswordProvider();
  const newPassword = document.getElementById('securityNewPassword').value;
  const confirmPassword = document.getElementById('securityConfirmPassword').value;
  const currentPassword = document.getElementById('securityCurrentPassword').value;
  const btn = document.getElementById('btnSecuritySubmit');

  if(newPassword.length < 6){ showToast('Mật khẩu mới cần tối thiểu 6 ký tự.', 'error'); return; }
  if(newPassword !== confirmPassword){ showToast('Mật khẩu xác nhận không khớp.', 'error'); return; }
  if(isChangeMode && !currentPassword){ showToast('Vui lòng nhập mật khẩu hiện tại.', 'error'); return; }

  setButtonBusy(btn, true, 'Đang lưu...');
  try {
    if(isChangeMode){
      await Auth.changePassword(currentPassword, newPassword);
      showToast('Đã đổi mật khẩu thành công.');
    } else {
      await Auth.addPasswordToAccount(newPassword);
      showToast('Đã thêm mật khẩu. Từ nay bạn có thể đăng nhập bằng email hoặc dùng "Quên mật khẩu".');
    }
    closeSecurityModal();
    renderSecurityRow();
  } catch(err){
    console.error('[Sổ Chi Tiêu] Lỗi thêm/đổi mật khẩu:', err);
    showToast(Auth.authErrorMessage(err), 'error');
  } finally {
    setButtonBusy(btn, false);
  }
}

/* =====================================================
   NAVIGATION
===================================================== */
// Chạy một hàm render một cách "an toàn": nếu nó lỗi, chỉ phần đó báo lỗi
// trong console và hiển thị thông báo, KHÔNG làm crash và chặn đứng các
// phần render còn lại phía sau.
function safeRun(fn, label, canvasId){
  try {
    fn();
  } catch(err){
    console.error(`[Sổ Chi Tiêu] Lỗi khi hiển thị "${label}":`, err);
    if(canvasId){
      const el = document.getElementById(canvasId);
      if(el){
        el.innerHTML = `
          <div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--color-expense);font-size:0.85rem;text-align:center;padding:0 12px;">
            <div>
              <i class="fa-solid fa-triangle-exclamation" style="display:block;font-size:1.4rem;margin-bottom:8px;"></i>
              Không thể vẽ biểu đồ. Vui lòng thử tải lại trang.
            </div>
          </div>`;
      }
    }
  }
}

function switchView(view){
  document.querySelectorAll('.nav-item, .bn-item[data-view]').forEach(el => el.classList.toggle('active', el.dataset.view === view));
  ['dashboard','transactions','budgets','wallets','debts','analytics','recurring','notifications','settings'].forEach(v => {
    document.getElementById('view-' + v).classList.toggle('hidden', v !== view);
  });
  closeMobileDrawer();

  const titles = {
    dashboard:    ['Tổng quan tháng này', `${currentMonthLabelVI()} · Cập nhật theo thời gian thực`],
    transactions: ['Giao dịch', 'Toàn bộ lịch sử thu chi của bạn'],
    budgets:      ['Quản lý ngân sách', 'Theo dõi giới hạn chi tiêu theo danh mục'],
    wallets:      ['Ví &amp; Chuyển tiền', 'Quản lý số dư và chuyển tiền giữa các ví'],
    debts:        ['Công nợ', 'Theo dõi khoản mình cho vay và khoản mình đi vay'],
    analytics:    ['Phân tích chuyên sâu', 'Xu hướng thu chi và các danh mục tốn kém nhất'],
    recurring:    ['Giao dịch định kỳ', 'Theo dõi các hóa đơn lặp lại hàng tháng'],
    notifications:['Thông báo', 'Các nhắc nhở quan trọng về tài chính của bạn'],
    settings:     ['Cài đặt', 'Tùy chỉnh giao diện và dữ liệu của bạn'],
  };
  document.getElementById('pageTitle').innerHTML = titles[view][0];
  document.getElementById('pageSub').textContent = titles[view][1];
  document.getElementById('btnAddTx').classList.toggle('hidden', !['dashboard','transactions'].includes(view));

  renderCore();

  if(view === 'dashboard') safeRun(renderDonutChart, 'Biểu đồ donut', 'donutChart');
  if(view === 'analytics'){
    safeRun(renderTrendChart, 'Biểu đồ xu hướng', 'trendChart');
    safeRun(renderBarChart, 'Biểu đồ cột 6 tháng', 'barChart');
    safeRun(renderTopSpend, 'Top 3 danh mục');
    safeRun(renderMonthlySummary, 'Tổng kết thu chi theo tháng');
  }
}

/* =====================================================
   MONTHLY STATS (shared)
===================================================== */
function computeMonthlyStats(){
  const monthKey = currentMonthKey();
  const monthTx = appData.transactions.filter(t => t.date.startsWith(monthKey));
  const income = monthTx.filter(t => t.type === 'income').reduce((s,t) => s + t.amount, 0);
  const expense = monthTx.filter(t => t.type === 'expense').reduce((s,t) => s + t.amount, 0);
  // Tổng số dư = tổng tiền hiện có trong tất cả các ví (không phải thu trừ chi trong tháng)
  const totalBalance = appData.wallets.reduce((s, w) => s + w.balance, 0);
  return { monthKey, monthTx, income, expense, totalBalance };
}

/* =====================================================
   RENDER: CORE (stats, transactions, budgets, wallets, recurring)
===================================================== */
function renderCore(){
  const { monthKey, income, expense, totalBalance } = computeMonthlyStats();

  document.getElementById('statIncome').textContent = formatCurrency(income);
  document.getElementById('statExpense').textContent = formatCurrency(expense);
  // "Tổng số dư" = tổng tiền trong tất cả các ví, KHÔNG phải (thu - chi) của riêng tháng này
  document.getElementById('statBalance').textContent = formatCurrency(totalBalance);

  renderTransactionTable('txTableBodyDash', 5);
  renderTransactionTable('txTableBodyFull', 999);
  renderBudgetOverview(monthKey);
  renderBudgets('budgetListFull', monthKey);
  renderWallets();
  renderWalletLog();
  renderRecurring();
  renderDebts();
  renderDashboardDebtOverview();
  renderNotifications();
}

/* =====================================================
   RENDER: TRANSACTIONS TABLE
===================================================== */
function renderTransactionTable(targetId, limit){
  const tbody = document.getElementById(targetId);
  if(!tbody) return;
  const sorted = [...appData.transactions].sort((a,b) => new Date(b.date) - new Date(a.date));
  const list = sorted.slice(0, limit);

  if(list.length === 0){
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--text-muted);padding:24px 0;">Chưa có giao dịch nào.</td></tr>`;
    return;
  }

  tbody.innerHTML = list.map(t => {
    const cat = findCat(t.category);
    const wallet = findWallet(t.walletId);
    const sign = t.type === 'income' ? '+' : '−';
    return `
      <tr>
        <td>
          <div class="tx-name-cell">
            <span class="tx-cat-icon" style="background:${cat.color}22;color:${cat.color}"><i class="fa-solid ${cat.icon}"></i></span>
            <div>
              <div>${cat.label}${t.attachments && t.attachments.length
                ? `<button type="button" class="tx-attach-badge" title="Xem / quản lý ảnh minh chứng" onclick="openTxAttachModal('${t.id}')"><i class="fa-solid fa-paperclip"></i> ${t.attachments.length}</button>`
                : `<button type="button" class="tx-attach-badge tx-attach-empty" title="Thêm ảnh minh chứng" onclick="openTxAttachModal('${t.id}')"><i class="fa-solid fa-camera"></i> Thêm ảnh</button>`}</div>
              <div class="tx-note">${t.note ? t.note + ' · ' : ''}${wallet ? wallet.name : ''}</div>
            </div>
          </div>
        </td>
        <td><span class="type-pill ${t.type}">${t.type === 'income' ? 'Thu' : 'Chi'}</span></td>
        <td class="tx-date">${formatDate(t.date)}</td>
        <td class="tx-amount ${t.type}">${sign} ${formatCurrency(t.amount)}</td>
        <td><button class="tx-del" onclick="deleteTransaction('${t.id}')" title="Xóa giao dịch"><i class="fa-solid fa-trash"></i></button></td>
      </tr>
    `;
  }).join('');
}

async function deleteTransaction(id){
  const tx = appData.transactions.find(t => t.id === id);
  if(!tx) return;
  if(!confirm('Bạn có chắc chắn muốn xóa giao dịch này? Số dư ví sẽ được hoàn tác tương ứng.')) return;
  // Firestore: xoá giao dịch + hoàn tác số dư ví trong cùng một batch.
  await withLoading(() => Data.removeTransaction(id), 'Đang xóa giao dịch...');
  showToast('Đã xóa giao dịch.');
  const activeView = document.querySelector('.nav-item.active')?.dataset.view || 'dashboard';
  switchView(activeView);
}

// Xóa vĩnh viễn TOÀN BỘ lịch sử giao dịch (khác với xóa từng giao dịch: không hoàn tác
// số dư ví, vì số tiền thực tế trong ví vẫn còn — chỉ dọn sạch nhật ký thu/chi).
async function deleteAllTransactions(){
  if(appData.transactions.length === 0){
    showToast('Bạn hiện chưa có giao dịch nào để xóa.', 'error');
    return;
  }
  const ok = confirm(`Bạn có chắc chắn muốn xóa vĩnh viễn toàn bộ ${appData.transactions.length} giao dịch đã ghi nhận?\n\nSố dư các ví, ngân sách, hóa đơn định kỳ và công nợ sẽ được giữ nguyên. Hành động này không thể hoàn tác.`);
  if(!ok) return;

  await withLoading(() => Data.clearTransactions(), 'Đang xóa toàn bộ giao dịch...');

  const activeView = document.querySelector('.nav-item.active')?.dataset.view || 'dashboard';
  switchView(activeView);
  showToast('Đã xóa toàn bộ lịch sử giao dịch.');
}

/* =====================================================
   RENDER: DONUT CHART (dashboard)
===================================================== */
function renderDonutChart(){
  const holder = document.getElementById('donutChart');
  if(!holder) return;
  const monthKey = currentMonthKey();
  const monthExpenses = appData.transactions.filter(t => t.type === 'expense' && t.date.startsWith(monthKey));

  const totals = {};
  monthExpenses.forEach(t => { totals[t.category] = (totals[t.category] || 0) + t.amount; });
  const entries = Object.entries(totals).sort((a,b) => b[1]-a[1]);
  const total = entries.reduce((s,[,v]) => s+v, 0) || 1;

  const legend = document.getElementById('chartLegend');
  if(entries.length === 0){
    holder.innerHTML = '';
    legend.innerHTML = `<div style="color:var(--text-muted);font-size:0.85rem;text-align:center;">Chưa có chi tiêu trong tháng.</div>`;
    return;
  }

  // Vẽ donut bằng các đoạn <circle> với stroke-dasharray, xoay -90° để bắt đầu từ đỉnh 12h.
  const size = 200, cx = size/2, cy = size/2, r = 76, strokeW = 26;
  const circumference = 2 * Math.PI * r;
  let cumulative = 0;

  const segments = entries.map(([id, val]) => {
    const cat = findCat(id);
    const frac = val / total;
    const dash = Math.max(frac * circumference - 1.5, 0); // trừ khoảng hở nhỏ giữa các lát
    const offset = circumference - (cumulative * circumference);
    cumulative += frac;
    const pct = Math.round(frac * 100);
    return `<circle class="donut-seg" cx="${cx}" cy="${cy}" r="${r}" fill="none"
        stroke="${cat.color}" stroke-width="${strokeW}"
        stroke-dasharray="${dash} ${circumference - dash}" stroke-dashoffset="${offset}"
        stroke-linecap="butt"><title>${cat.label}: ${formatCurrency(val)} (${pct}%)</title></circle>`;
  }).join('');

  holder.innerHTML = `
    <svg viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
      <g transform="rotate(-90 ${cx} ${cy})">${segments}</g>
      <text x="${cx}" y="${cy - 6}" text-anchor="middle" font-family="Manrope, Inter, sans-serif" font-weight="800" font-size="17" fill="var(--text-main)">${formatCurrency(total)}</text>
      <text x="${cx}" y="${cy + 16}" text-anchor="middle" font-family="Inter, sans-serif" font-size="11" fill="var(--text-muted)">Tổng chi tháng này</text>
    </svg>`;

  legend.innerHTML = entries.map(([id, val]) => {
    const cat = findCat(id);
    const pct = Math.round((val/total)*100);
    return `<div class="legend-row"><span class="legend-dot" style="background:${cat.color}"></span><span class="cat">${cat.label}</span><span class="pct">${pct}%</span></div>`;
  }).join('');
}

/* =====================================================
   RENDER: BUDGET OVERVIEW (dashboard — bản tóm tắt, khác trang Quản lý ngân sách)
===================================================== */
function renderBudgetOverview(monthKey){
  const el = document.getElementById('budgetOverviewDash');
  if(!el) return;

  if(appData.budgets.length === 0){
    el.innerHTML = `
      <div class="budget-empty">
        <div class="budget-empty-icon"><i class="fa-solid fa-chart-pie"></i></div>
        <div class="budget-empty-text">Bạn chưa thiết lập ngân sách nào. Thiết lập ngay để theo dõi chi tiêu theo từng danh mục.</div>
        <button class="btn btn-outline" onclick="switchView('budgets')"><i class="fa-solid fa-plus"></i> Thiết lập ngay</button>
      </div>`;
    return;
  }

  const rows = appData.budgets.map(b => {
    const cat = findCat(b.category);
    const spent = appData.transactions
      .filter(t => t.type === 'expense' && t.category === b.category && t.date.startsWith(monthKey))
      .reduce((s,t) => s + t.amount, 0);
    const pct = Math.min(100, Math.round((spent / b.limit) * 100));
    return { cat, limit:b.limit, spent, pct, isOver: spent > b.limit * 0.8 };
  });

  const totalLimit = rows.reduce((s,r) => s + r.limit, 0);
  const totalSpent = rows.reduce((s,r) => s + r.spent, 0);
  const top = rows.slice().sort((a,b) => b.pct - a.pct).slice(0,3);
  const remaining = rows.length - top.length;

  el.innerHTML = `
    <div class="budget-summary-top">
      <div class="bs-item"><div class="lbl">Tổng ngân sách</div><div class="val">${formatCurrency(totalLimit)}</div></div>
      <div class="bs-item"><div class="lbl">Đã chi</div><div class="val expense">${formatCurrency(totalSpent)}</div></div>
      <div class="bs-item"><div class="lbl">Còn lại</div><div class="val income">${formatCurrency(Math.max(0, totalLimit - totalSpent))}</div></div>
    </div>
    ${top.map(r => `
      <div class="budget-mini-row">
        <div class="budget-mini-icon" style="background:${r.cat.color}22;color:${r.cat.color}"><i class="fa-solid ${r.cat.icon}"></i></div>
        <div class="budget-mini-info">
          <div class="name"><span>${r.cat.label}</span><span class="pct ${r.isOver ? 'over' : ''}">${r.pct}%</span></div>
          <div class="budget-mini-track"><div class="budget-mini-fill ${r.isOver ? 'over' : ''}" style="width:${r.pct}%"></div></div>
        </div>
      </div>`).join('')}
    ${remaining > 0 ? `<div style="text-align:center;margin-top:12px;"><button class="link" onclick="switchView('budgets')">+${remaining} danh mục ngân sách khác</button></div>` : ''}
  `;
}

/* =====================================================
   RENDER: BUDGETS (trang Quản lý ngân sách — có thể sửa/xóa)
===================================================== */
function renderBudgets(targetId, monthKey){
  const list = document.getElementById(targetId);
  if(!list) return;

  if(appData.budgets.length === 0){
    list.innerHTML = `<div style="color:var(--text-muted);font-size:0.87rem;">Chưa có ngân sách nào. Nhấn "Thêm ngân sách" để bắt đầu quản lý chi tiêu theo danh mục.</div>`;
    return;
  }

  list.innerHTML = appData.budgets.map(b => {
    const cat = findCat(b.category);
    const spent = appData.transactions
      .filter(t => t.type === 'expense' && t.category === b.category && t.date.startsWith(monthKey))
      .reduce((s,t) => s + t.amount, 0);
    const pct = Math.min(100, Math.round((spent / b.limit) * 100));
    const isOver = spent > b.limit * 0.8;

    return `
      <div class="budget-row">
        <div class="budget-top">
          <div class="budget-cat">
            <span class="tx-cat-icon" style="width:26px;height:26px;font-size:0.72rem;background:${cat.color}22;color:${cat.color}"><i class="fa-solid ${cat.icon}"></i></span>
            ${cat.label}
          </div>
          <div class="budget-right">
            <div class="budget-numbers"><strong>${formatCurrency(spent)}</strong> / ${formatCurrency(b.limit)}</div>
            <div class="budget-row-edit">
              <button class="icon-btn" title="Sửa ngân sách" onclick="openBudgetModal('${b.category}')"><i class="fa-solid fa-pen"></i></button>
              <button class="icon-btn danger" title="Xóa ngân sách" onclick="deleteBudget('${b.category}')"><i class="fa-solid fa-trash"></i></button>
            </div>
          </div>
        </div>
        <div class="progress-track"><div class="progress-fill ${isOver ? 'over' : ''}" style="width:${pct}%"></div></div>
        <div class="budget-status ${isOver ? 'over' : ''}">
          ${isOver ? `Đã dùng ${pct}% ngân sách — cân nhắc giảm chi tiêu ở danh mục này.` : `Đã dùng ${pct}% ngân sách, vẫn trong mức an toàn.`}
        </div>
      </div>
    `;
  }).join('');
}

/* =====================================================
   MODAL: THÊM / SỬA NGÂN SÁCH
===================================================== */
let editingBudgetCategory = null;

function populateBudgetCategoryOptions(){
  const select = document.getElementById('budgetInputCategory');
  const budgeted = new Set(appData.budgets.map(b => b.category));
  const options = CATS.expense.filter(c => !budgeted.has(c.id) || c.id === editingBudgetCategory);

  if(options.length === 0){
    select.innerHTML = `<option value="">-- Tất cả danh mục đã có ngân sách --</option>`;
    select.disabled = true;
  } else {
    select.disabled = false;
    select.innerHTML = options.map(c => `<option value="${c.id}">${c.label}</option>`).join('');
  }
}

function openBudgetModal(categoryId){
  editingBudgetCategory = categoryId || null;
  const isEdit = !!editingBudgetCategory;

  populateBudgetCategoryOptions();
  const select = document.getElementById('budgetInputCategory');

  if(!isEdit && (select.disabled || !select.value)){
    showToast('Tất cả danh mục chi tiêu đã có ngân sách. Hãy thêm danh mục mới trước.', 'error');
    return;
  }

  document.getElementById('budgetModalTitle').textContent = isEdit ? 'Sửa ngân sách' : 'Thêm ngân sách';
  const limitInput = document.getElementById('budgetInputLimit');

  if(isEdit){
    select.value = editingBudgetCategory;
    select.disabled = true;
    const existing = appData.budgets.find(b => b.category === editingBudgetCategory);
    limitInput.value = existing ? existing.limit : '';
  } else {
    limitInput.value = '';
  }

  document.getElementById('budgetModalOverlay').classList.remove('hidden');
}
function closeBudgetModal(){ document.getElementById('budgetModalOverlay').classList.add('hidden'); }

async function handleSaveBudget(e){
  e.preventDefault();
  const category = document.getElementById('budgetInputCategory').value;
  const limit = parseFloat(document.getElementById('budgetInputLimit').value);

  if(!category){ showToast('Vui lòng chọn danh mục.', 'error'); return; }
  if(!limit || limit <= 0){ showToast('Vui lòng nhập hạn mức hợp lệ.', 'error'); return; }

  const wasEdit = !!editingBudgetCategory;
  await withLoading(() => Data.saveBudget(category, limit), 'Đang lưu ngân sách...');

  closeBudgetModal();
  renderCore();
  showToast(wasEdit ? 'Đã cập nhật ngân sách.' : 'Đã thêm ngân sách mới.');
}

async function deleteBudget(category){
  if(!confirm('Bạn có chắc chắn muốn xóa hạn mức ngân sách này?')) return;
  await withLoading(() => Data.removeBudget(category), 'Đang xóa ngân sách...');
  renderCore();
  showToast('Đã xóa ngân sách.');
}

document.getElementById('budgetModalOverlay').addEventListener('click', (e) => { if(e.target.id === 'budgetModalOverlay') closeBudgetModal(); });

/* =====================================================
   MODAL: THÊM DANH MỤC CHI TIÊU
===================================================== */
function openCategoryModal(){
  setCatMgrType('expense');
  cancelEditCategory();
  document.getElementById('categoryModalOverlay').classList.remove('hidden');
}
function closeCategoryModal(){
  document.getElementById('categoryModalOverlay').classList.add('hidden');
  cancelEditCategory();
}

function setCatMgrType(type){
  currentCatMgrType = type;
  document.getElementById('btnCatMgrExpense').classList.toggle('active', type === 'expense');
  document.getElementById('btnCatMgrIncome').classList.toggle('active', type === 'income');
  cancelEditCategory();
  renderCategoryList();
}

function renderCategoryList(){
  const list = document.getElementById('categoryList');
  if(!list) return;
  const cats = CATS[currentCatMgrType];
  if(cats.length === 0){
    list.innerHTML = `<div class="empty-note">Chưa có danh mục nào. Hãy thêm danh mục mới bên dưới.</div>`;
    return;
  }
  list.innerHTML = cats.map(c => `
    <div class="category-list-item">
      <div class="cli-icon" style="background:${c.color}"><i class="fa-solid ${c.icon}"></i></div>
      <div class="cli-label">${c.label}</div>
      <div class="cli-actions">
        <button type="button" class="icon-btn" title="Sửa" onclick="editCategory('${currentCatMgrType}','${c.id}')"><i class="fa-solid fa-pen"></i></button>
        <button type="button" class="icon-btn danger" title="Xóa" onclick="deleteCategory('${currentCatMgrType}','${c.id}')"><i class="fa-solid fa-trash"></i></button>
      </div>
    </div>`).join('');
}

// Đồng bộ ô nhập mã HEX khi người dùng chọn màu bằng color picker.
function syncCategoryColorFromPicker(){
  const picker = document.getElementById('categoryInputColor');
  const hexInput = document.getElementById('categoryInputColorHex');
  hexInput.value = picker.value.replace('#','').toUpperCase();
  hexInput.classList.remove('invalid');
}

// Đồng bộ color picker khi người dùng tự gõ mã HEX (chấp nhận dạng RGB hoặc RRGGBB).
function syncCategoryColorFromHex(input){
  let raw = input.value.trim().replace('#','').toUpperCase();
  const isValid = /^[0-9A-F]{3}$/.test(raw) || /^[0-9A-F]{6}$/.test(raw);
  if(isValid){
    const full = raw.length === 3 ? raw.split('').map(ch => ch + ch).join('') : raw;
    document.getElementById('categoryInputColor').value = '#' + full;
    input.classList.remove('invalid');
  } else {
    input.classList.add('invalid');
  }
}

function editCategory(type, id){
  const cat = CATS[type].find(c => c.id === id);
  if(!cat) return;
  editingCategoryId = id;
  editingCategoryType = type;
  document.getElementById('categoryInputLabel').value = cat.label;
  document.getElementById('categoryInputColor').value = cat.color;
  document.getElementById('categoryInputColorHex').value = (cat.color || '#7A8FC2').replace('#','').toUpperCase();
  document.getElementById('categoryInputColorHex').classList.remove('invalid');
  document.getElementById('categoryInputIcon').value = cat.icon;
  renderIconPicker('categoryIconPicker', 'categoryInputIcon', cat.icon);
  document.getElementById('categoryFormTitle').textContent = 'Sửa danh mục';
  document.getElementById('categoryEditHint').classList.remove('hidden');
  document.getElementById('categorySubmitBtn').innerHTML = '<i class="fa-solid fa-check"></i> Cập nhật danh mục';
  document.getElementById('categoryInputLabel').focus();
}

function cancelEditCategory(){
  editingCategoryId = null;
  editingCategoryType = null;
  document.getElementById('categoryForm').reset();
  document.getElementById('categoryInputColor').value = '#7A8FC2';
  document.getElementById('categoryInputColorHex').value = '7A8FC2';
  document.getElementById('categoryInputColorHex').classList.remove('invalid');
  document.getElementById('categoryInputIcon').value = 'fa-tag';
  renderIconPicker('categoryIconPicker', 'categoryInputIcon', 'fa-tag');
  document.getElementById('categoryFormTitle').textContent = 'Thêm danh mục mới';
  document.getElementById('categoryEditHint').classList.add('hidden');
  document.getElementById('categorySubmitBtn').innerHTML = '<i class="fa-solid fa-check"></i> Lưu danh mục';
  renderCategoryList();
}

function categoryInUse(type, id){
  const usedInTx = appData.transactions.some(t => t.type === type && t.category === id);
  const usedInBudget = type === 'expense' && appData.budgets.some(b => b.category === id);
  return usedInTx || usedInBudget;
}

async function deleteCategory(type, id){
  if(CATS[type].length <= 1){
    showToast('Không thể xóa: bạn cần giữ lại ít nhất 1 danh mục cho mỗi loại thu/chi.', 'error');
    return;
  }
  if(categoryInUse(type, id)){
    showToast('Không thể xóa danh mục này vì đang có giao dịch hoặc ngân sách sử dụng. Hãy xóa/chuyển các giao dịch liên quan trước.', 'error');
    return;
  }
  const backup = CATS[type].slice();
  CATS[type] = CATS[type].filter(c => c.id !== id);
  try {
    await withLoading(() => Data.saveCategories(), 'Đang cập nhật danh mục...');
  } catch(err){
    CATS[type] = backup; // ghi thất bại -> khôi phục lại danh sách cũ
    return;
  }
  if(editingCategoryId === id) cancelEditCategory();
  renderCategoryList();
  populateCategoryOptions();
  showToast('Đã xóa danh mục.');
}

async function handleSaveCategory(e){
  e.preventDefault();
  const label = document.getElementById('categoryInputLabel').value.trim();
  const color = document.getElementById('categoryInputColor').value;
  const icon = document.getElementById('categoryInputIcon').value || 'fa-tag';

  if(!label){ showToast('Vui lòng nhập tên danh mục.', 'error'); return; }

  if(editingCategoryId){
    const cat = CATS[editingCategoryType].find(c => c.id === editingCategoryId);
    if(cat){
      Object.assign(cat, { label, icon, color });
      await withLoading(() => Data.saveCategories(), 'Đang lưu danh mục...');
      cancelEditCategory();
      populateCategoryOptions();
      renderCore();
      showToast(`Đã cập nhật danh mục "${label}".`);
    }
    return;
  }

  const base = slugifyVN(label) || 'danh-muc';
  const exists = (checkId) => [...CATS.expense, ...CATS.income].some(c => c.id === checkId);
  let uniqueId = base, n = 2;
  while(exists(uniqueId)){ uniqueId = `${base}-${n++}`; }

  CATS[currentCatMgrType].push({ id: uniqueId, label, icon, color });
  await withLoading(() => Data.saveCategories(), 'Đang lưu danh mục...');

  cancelEditCategory();
  populateCategoryOptions(); // cập nhật danh sách danh mục trong modal "Thêm giao dịch"
  showToast(`Đã thêm danh mục "${label}". Giờ bạn có thể thiết lập ngân sách cho danh mục này.`);
}

document.getElementById('categoryModalOverlay').addEventListener('click', (e) => { if(e.target.id === 'categoryModalOverlay') closeCategoryModal(); });

/* =====================================================
   RENDER: WALLETS
===================================================== */
function renderWallets(){
  const grid = document.getElementById('walletGrid');
  if(!grid) return;
  grid.innerHTML = appData.wallets.map(w => `
    <div class="wallet-card" style="background:${w.gradient}">
      <div class="w-top">
        <div class="w-top-left">
          <div class="w-icon"><i class="fa-solid ${w.icon}"></i></div>
          <div class="w-name">${w.name}</div>
        </div>
        <div class="w-actions">
          ${(w.bankBin && w.bankBin !== 'other' && w.bankAccountNumber) ? `<button title="Tạo mã QR nhận chuyển khoản" onclick="openBankQrModal('wallet', '${w.id}')"><i class="fa-solid fa-qrcode"></i></button>` : ''}
          <button title="Sửa ví / chỉnh số dư" onclick="openWalletModal('${w.id}')"><i class="fa-solid fa-pen"></i></button>
          <button title="Xóa ví" onclick="deleteWallet('${w.id}')"><i class="fa-solid fa-trash"></i></button>
        </div>
      </div>
      <div class="w-balance">${formatCurrency(w.balance)}</div>
    </div>
  `).join('') + `
    <div class="wallet-card add-wallet-card" onclick="openWalletModal()">
      <div class="w-add-inner"><i class="fa-solid fa-plus"></i> Thêm ví mới</div>
    </div>`;

  const fromSel = document.getElementById('transferFrom');
  const toSel = document.getElementById('transferTo');
  const walletSel = document.getElementById('inputWallet');
  const opts = appData.wallets.map(w => `<option value="${w.id}">${w.name} (${formatCurrency(w.balance)})</option>`).join('');
  if(fromSel){
    const prevFrom = fromSel.value, prevTo = toSel.value;
    fromSel.innerHTML = opts;
    toSel.innerHTML = opts;
    if(appData.wallets.some(w => w.id === prevFrom)) fromSel.value = prevFrom;
    if(appData.wallets.some(w => w.id === prevTo)) toSel.value = prevTo;
    else if(appData.wallets.length > 1) toSel.selectedIndex = 1;
  }
  if(walletSel){
    const prevWallet = walletSel.value;
    walletSel.innerHTML = appData.wallets.map(w => `<option value="${w.id}">${w.name}</option>`).join('');
    if(appData.wallets.some(w => w.id === prevWallet)) walletSel.value = prevWallet;
  }
}

function renderWalletLog(){
  const log = document.getElementById('walletLog');
  if(!log) return;
  if(appData.transferLog.length === 0){
    log.innerHTML = `<div style="color:var(--text-muted);font-size:0.87rem;">Chưa có giao dịch chuyển tiền nào.</div>`;
    return;
  }
  log.innerHTML = appData.transferLog.slice().reverse().map(t => `
    <div class="wallet-log-row"><span>Chuyển từ <strong>${t.fromName}</strong> sang <strong>${t.toName}</strong></span><span class="wl-desc">${formatCurrency(t.amount)}</span></div>
  `).join('');
}

async function handleTransfer(){
  const fromId = document.getElementById('transferFrom').value;
  const toId = document.getElementById('transferTo').value;
  const amount = parseFloat(document.getElementById('transferAmount').value);

  if(fromId === toId){ showToast('Vui lòng chọn hai ví khác nhau.', 'error'); return; }
  if(!amount || amount <= 0){ showToast('Vui lòng nhập số tiền hợp lệ.', 'error'); return; }

  const fromWallet = findWallet(fromId);
  const toWallet = findWallet(toId);
  if(!fromWallet || !toWallet){ showToast('Không tìm thấy ví được chọn.', 'error'); return; }

  await withLoading(() => Data.transferBetweenWallets(fromId, toId, amount), 'Đang chuyển tiền...');

  document.getElementById('transferAmount').value = '';
  renderWallets();
  renderWalletLog();
  showToast(`Đã chuyển ${formatCurrency(amount)} từ ${fromWallet.name} sang ${toWallet.name}.`);
}

/* =====================================================
   MODAL: THÊM / SỬA VÍ (bao gồm tùy chỉnh số dư trực tiếp)
===================================================== */
function renderWalletGradientPicker(selected){
  const picker = document.getElementById('walletGradientPicker');
  picker.innerHTML = WALLET_GRADIENTS.map(g => `
    <button type="button" class="gradient-swatch ${g === selected ? 'active' : ''}" style="background:${g}" onclick="selectWalletGradient('${g.replace(/'/g,"\\'")}')"></button>
  `).join('');
}
function selectWalletGradient(gradient){
  document.getElementById('walletInputGradient').value = gradient;
  renderWalletGradientPicker(gradient);
}

function openWalletModal(walletId){
  editingWalletId = walletId || null;
  const isEdit = !!editingWalletId;
  const w = isEdit ? findWallet(walletId) : null;

  document.getElementById('walletModalTitle').textContent = isEdit ? 'Sửa ví / chỉnh số dư' : 'Thêm ví / nguồn tiền';
  document.getElementById('walletInputName').value = isEdit ? w.name : '';
  document.getElementById('walletInputBalance').value = isEdit ? w.balance : '';

  const icon = isEdit ? w.icon : 'fa-wallet';
  document.getElementById('walletInputIcon').value = icon;
  renderIconPicker('walletIconPicker', 'walletInputIcon', icon);

  const gradient = isEdit ? w.gradient : WALLET_GRADIENTS[0];
  document.getElementById('walletInputGradient').value = gradient;
  renderWalletGradientPicker(gradient);

  const hasBankInfo = isEdit && !!(w.bankBin || w.bankAccountNumber || w.bankAccountHolder);
  document.getElementById('walletInputIsBank').checked = hasBankInfo;
  toggleWalletBankFields(hasBankInfo);
  renderWalletBankSelect(isEdit ? w.bankBin : null, isEdit ? w.bankName : null);
  document.getElementById('walletInputBankAccountNumber').value = isEdit ? (w.bankAccountNumber || '') : '';
  document.getElementById('walletInputBankAccountHolder').value = isEdit ? (w.bankAccountHolder || '') : '';

  document.getElementById('walletModalOverlay').classList.remove('hidden');
}
function closeWalletModal(){ document.getElementById('walletModalOverlay').classList.add('hidden'); }

async function handleSaveWallet(e){
  e.preventDefault();
  const name = document.getElementById('walletInputName').value.trim();
  const balance = parseFloat(document.getElementById('walletInputBalance').value);
  const icon = document.getElementById('walletInputIcon').value || 'fa-wallet';
  const gradient = document.getElementById('walletInputGradient').value;

  if(!name){ showToast('Vui lòng nhập tên ví.', 'error'); return; }
  if(isNaN(balance)){ showToast('Vui lòng nhập số dư hợp lệ.', 'error'); return; }

  const isBank = document.getElementById('walletInputIsBank').checked;
  let bankBin = null, bankName = null, bankAccountNumber = null, bankAccountHolder = null;
  if(isBank){
    // Không bắt buộc chọn ngân hàng / nhập số tài khoản ngay lúc này — cho phép lưu ví trước,
    // bổ sung thông tin sau (mã QR chỉ hiện khi đã có đủ ngân hàng + số tài khoản).
    const bankBinSel = document.getElementById('walletInputBankBin').value || null;
    if(bankBinSel === 'other'){
      bankBin = 'other';
      bankName = document.getElementById('walletInputBankNameOther').value.trim() || null;
    } else if(bankBinSel){
      bankBin = bankBinSel;
      bankName = (VIETQR_BANKS.find(b => b.bin === bankBin) || {}).name || null;
    }
    bankAccountNumber = document.getElementById('walletInputBankAccountNumber').value.trim() || null;
    bankAccountHolder = document.getElementById('walletInputBankAccountHolder').value.trim().toUpperCase() || null;
  }

  const wasEdit = !!editingWalletId;
  const payload = {
    name, balance, icon, gradient,
    bankBin: bankBin || '', bankName: bankName || '',
    bankAccountNumber: bankAccountNumber || '', bankAccountHolder: bankAccountHolder || '',
  };

  if(wasEdit){
    await withLoading(() => Data.updateWallet(editingWalletId, payload), 'Đang lưu ví...');
  } else {
    await withLoading(() => Data.addWallet(payload), 'Đang tạo ví mới...');
  }

  closeWalletModal();
  renderCore();
  showToast(wasEdit ? 'Đã cập nhật ví.' : 'Đã thêm ví mới.');
}

async function deleteWallet(id){
  if(appData.wallets.length <= 1){
    showToast('Bạn cần giữ lại ít nhất một ví.', 'error');
    return;
  }
  const usedInTx = appData.transactions.some(t => t.walletId === id);
  if(usedInTx && !confirm('Ví này đang có giao dịch liên kết. Xóa ví sẽ không xóa các giao dịch đó. Bạn có chắc muốn xóa?')) return;

  await withLoading(() => Data.removeWallet(id), 'Đang xóa ví...');
  renderCore();
  showToast('Đã xóa ví.');
}

document.getElementById('walletModalOverlay').addEventListener('click', (e) => { if(e.target.id === 'walletModalOverlay') closeWalletModal(); });

/* =====================================================
   MODAL: MÃ QR NHẬN CHUYỂN KHOẢN (VIETQR) — dùng chung cho Ví & Công nợ
===================================================== */
let currentBankQrContext = null; // { type: 'wallet' | 'debt', id }

// Lấy thông tin ngân hàng chuẩn hoá (bankBin, bankName, accountNumber, accountHolder, label)
// bất kể nguồn dữ liệu là Ví hay một khoản Công nợ.
function getBankQrSource(){
  if(!currentBankQrContext) return null;
  if(currentBankQrContext.type === 'wallet'){
    const w = findWallet(currentBankQrContext.id);
    if(!w) return null;
    return { bankBin: w.bankBin, bankName: w.bankName, accountNumber: w.bankAccountNumber, accountHolder: w.bankAccountHolder, label: w.name };
  }
  const d = appData.debts.find(x => x.id === currentBankQrContext.id);
  if(!d) return null;
  return { bankBin: d.bankBin, bankName: d.bankName, accountNumber: d.accountNumber, accountHolder: d.accountHolder, label: d.person };
}

// Bỏ dấu tiếng Việt — VietQR khuyến nghị nội dung/​tên chủ TK trong link QR nên là chữ không dấu
// để hiển thị đúng trên mọi app ngân hàng.
function stripVietnameseTones(str){
  return String(str || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'D');
}

function buildVietQrUrl(source, amount, note){
  const base = `https://img.vietqr.io/image/${source.bankBin}-${source.accountNumber}-compact2.png`;
  const params = new URLSearchParams();
  if(amount){ params.set('amount', String(Math.round(amount))); }
  if(note){ params.set('addInfo', stripVietnameseTones(note)); }
  if(source.accountHolder){ params.set('accountName', stripVietnameseTones(source.accountHolder)); }
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

// type: 'wallet' | 'debt'
function openBankQrModal(type, id){
  currentBankQrContext = { type, id };
  const source = getBankQrSource();
  if(!source || !source.bankBin || source.bankBin === 'other' || !source.accountNumber){ showToast('Chưa có đủ thông tin tài khoản ngân hàng (cần chọn đúng ngân hàng trong danh sách).', 'error'); return; }

  document.getElementById('bankQrBankName').textContent = source.bankName || 'Ngân hàng';
  document.getElementById('bankQrAccountHolder').textContent = source.accountHolder || '';
  document.getElementById('bankQrAccountNumber').querySelector('span').textContent = source.accountNumber;

  // Với khoản công nợ, gợi ý sẵn số tiền còn lại và nội dung nhắc khoản nợ; với ví thì để trống cho người dùng tự nhập.
  if(type === 'debt'){
    const d = appData.debts.find(x => x.id === id);
    document.getElementById('bankQrAmount').value = d ? d.amount : '';
    document.getElementById('bankQrNote').value = d ? `Tra no ${stripVietnameseTones(d.person)}` : '';
  } else {
    document.getElementById('bankQrAmount').value = '';
    document.getElementById('bankQrNote').value = '';
  }

  updateBankQrImage();
  document.getElementById('bankQrModalOverlay').classList.remove('hidden');
}
function closeBankQrModal(){
  document.getElementById('bankQrModalOverlay').classList.add('hidden');
  currentBankQrContext = null;
}
function updateBankQrImage(){
  const source = getBankQrSource();
  if(!source) return;
  const amount = parseFloat(document.getElementById('bankQrAmount').value);
  const note = document.getElementById('bankQrNote').value.trim();
  const url = buildVietQrUrl(source, isNaN(amount) ? null : amount, note);
  document.getElementById('bankQrImage').src = url;
  document.getElementById('bankQrDownloadBtn').href = url;
}
function copyBankQrAccountNumber(){
  const source = getBankQrSource();
  if(!source) return;
  const text = source.bankName ? `${source.bankName} - ${source.accountNumber}` : source.accountNumber;
  copyToClipboard(text, `Đã sao chép thông tin tài khoản ngân hàng${source.label ? ' của ' + source.label : ''}.`);
}
document.getElementById('bankQrModalOverlay').addEventListener('click', (e) => { if(e.target.id === 'bankQrModalOverlay') closeBankQrModal(); });

/* =====================================================
   COMBOBOX "GÕ ĐỂ TÌM NGÂN HÀNG" — dùng chung cho modal Ví & Công nợ
===================================================== */
function bankComboOptions(includeOther, includeBlank){
  const opts = VIETQR_BANKS.map(b => ({ value: b.bin, label: b.name }));
  if(includeOther) opts.push({ value: 'other', label: 'Khác (nhập tên ngân hàng)' });
  if(includeBlank) opts.unshift({ value: '', label: '-- Để trống --' });
  return opts;
}

// Khởi tạo hành vi gõ-tìm cho 1 combobox ngân hàng. Chỉ cần gọi 1 lần khi trang tải xong.
// searchId: input text hiển thị cho người dùng gõ/xem tên ngân hàng đã chọn
// hiddenId: input hidden lưu giá trị thật (mã BIN hoặc 'other') — các hàm lưu dữ liệu khác vẫn đọc từ đây
// menuId/comboId: khung danh sách gợi ý và khung bao ngoài (để bắt sự kiện click ra ngoài)
function initBankCombo({ comboId, searchId, hiddenId, menuId, includeOther, includeBlank, onSelect }){
  const combo = document.getElementById(comboId);
  const searchInput = document.getElementById(searchId);
  const hidden = document.getElementById(hiddenId);
  const menu = document.getElementById(menuId);
  if(!combo || !searchInput || !hidden || !menu) return;

  function renderMenu(filterText){
    const q = (filterText || '').trim().toLowerCase();
    const opts = bankComboOptions(includeOther, includeBlank).filter(o => !q || o.label.toLowerCase().includes(q));
    menu.innerHTML = opts.length
      ? opts.map(o => `<div class="bank-combo-item" data-value="${o.value}" data-label="${o.label.replace(/"/g,'&quot;')}">${o.label}</div>`).join('')
      : `<div class="bank-combo-empty">Không tìm thấy ngân hàng phù hợp</div>`;
    menu.classList.remove('hidden');
  }

  searchInput.addEventListener('focus', () => renderMenu(searchInput.value));
  searchInput.addEventListener('input', () => renderMenu(searchInput.value));
  searchInput.addEventListener('keydown', (e) => {
    if(e.key !== 'Enter') return;
    e.preventDefault(); // không cho Enter submit form khi đang gõ tìm ngân hàng
    const firstItem = menu.querySelector('.bank-combo-item');
    if(!menu.classList.contains('hidden') && firstItem){
      hidden.value = firstItem.dataset.value;
      searchInput.value = firstItem.dataset.label;
      menu.classList.add('hidden');
      if(onSelect) onSelect(firstItem.dataset.value);
    }
  });
  // Nếu người dùng gõ rồi click ra ngoài mà chưa chọn dòng nào, khôi phục lại tên ngân hàng đã chọn trước đó (hoặc để trống).
  searchInput.addEventListener('blur', () => {
    setTimeout(() => {
      const current = bankComboOptions(includeOther, includeBlank).find(o => o.value === hidden.value);
      searchInput.value = current ? current.label : '';
    }, 150);
  });
  // Dùng mousedown thay vì click để sự kiện này chạy trước khi input bị blur.
  menu.addEventListener('mousedown', (e) => {
    const item = e.target.closest('.bank-combo-item');
    if(!item) return;
    e.preventDefault();
    hidden.value = item.dataset.value;
    searchInput.value = item.dataset.label;
    menu.classList.add('hidden');
    if(onSelect) onSelect(item.dataset.value);
  });
  document.addEventListener('click', (e) => { if(!combo.contains(e.target)) menu.classList.add('hidden'); });
}

// Gán giá trị đã chọn sẵn (khi mở modal để sửa) cho combobox ngân hàng.
function setBankComboValue(searchId, hiddenId, bin, includeOther, fallbackLabel){
  const hidden = document.getElementById(hiddenId);
  const search = document.getElementById(searchId);
  hidden.value = bin || '';
  if(bin === 'other') search.value = fallbackLabel || 'Khác (nhập tên ngân hàng)';
  else if(!bin) search.value = '';
  else {
    const b = VIETQR_BANKS.find(x => x.bin === bin);
    search.value = b ? b.name : '';
  }
}

initBankCombo({ comboId:'walletBankCombo', searchId:'walletInputBankBinSearch', hiddenId:'walletInputBankBin', menuId:'walletBankComboMenu', includeOther:true, includeBlank:true, onSelect: toggleWalletBankOtherField });
initBankCombo({ comboId:'debtBankCombo', searchId:'debtInputBankBinSearch', hiddenId:'debtInputBankBin', menuId:'debtBankComboMenu', includeOther:true, onSelect: toggleDebtBankOtherField });

/* =====================================================
   TOGGLE TRƯỜNG TÀI KHOẢN NGÂN HÀNG TRONG MODAL VÍ
===================================================== */
// selectedBin: mã BIN đã lưu (nếu có); '' / null = để trống; 'other' = ngân hàng tự nhập.
// fallbackName: tên ngân hàng tự nhập đã lưu trước đó (khi bin === 'other').
function renderWalletBankSelect(selectedBin, fallbackName){
  setBankComboValue('walletInputBankBinSearch', 'walletInputBankBin', selectedBin || '', true, fallbackName);
  document.getElementById('walletInputBankNameOther').value = (selectedBin === 'other') ? (fallbackName || '') : '';
  toggleWalletBankOtherField();
}
function toggleWalletBankOtherField(){
  const isOther = document.getElementById('walletInputBankBin').value === 'other';
  document.getElementById('walletBankOtherFieldWrap').classList.toggle('hidden', !isOther);
}
function toggleWalletBankFields(checked){
  document.getElementById('walletBankFieldsWrap').classList.toggle('hidden', !checked);
}

/* =====================================================
   CÔNG NỢ (DEBTS) — mình nợ ai / ai nợ mình
===================================================== */
function debtAvatarColor(name){
  const colors = ['#689D4B','#D96868','#7A8FC2','#E0A85A','#9C7BC9','#5FB0B7'];
  let hash = 0;
  for(let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}
function initials(name){
  const parts = name.trim().split(/\s+/);
  return (parts[parts.length-1] || '?').charAt(0).toUpperCase();
}

function computeDebtStats(){
  const owedToMe = appData.debts.filter(d => d.type === 'owed_to_me').reduce((s,d) => s + d.amount, 0);
  const iOwe = appData.debts.filter(d => d.type === 'i_owe').reduce((s,d) => s + d.amount, 0);
  return { owedToMe, iOwe, net: owedToMe - iOwe };
}

function setDebtTab(tab){
  currentDebtTab = tab;
  document.getElementById('btnDebtTabOwed').classList.toggle('active', tab === 'owed_to_me');
  document.getElementById('btnDebtTabOwe').classList.toggle('active', tab === 'i_owe');
  renderDebts();
}

function renderDebts(){
  const stats = computeDebtStats();
  const elOwed = document.getElementById('statDebtOwedToMe');
  const elOwe = document.getElementById('statDebtIOwe');
  const elNet = document.getElementById('statDebtNet');
  if(!elOwed) return; // view chưa được render (chưa vào trang Công nợ lần nào)

  elOwed.textContent = formatCurrency(stats.owedToMe);
  elOwe.textContent = formatCurrency(stats.iOwe);
  elNet.textContent = (stats.net >= 0 ? '+' : '') + formatCurrency(stats.net);
  elNet.style.color = stats.net >= 0 ? 'var(--color-income)' : 'var(--color-expense)';

  const owedCount = appData.debts.filter(d => d.type === 'owed_to_me' && d.status !== 'paid').length;
  const oweCount = appData.debts.filter(d => d.type === 'i_owe' && d.status !== 'paid').length;
  document.getElementById('debtCntOwed').textContent = owedCount;
  document.getElementById('debtCntOwe').textContent = oweCount;

  const list = document.getElementById('debtList');
  const items = appData.debts.filter(d => d.type === currentDebtTab)
    .sort((a,b) => (a.status === 'paid') - (b.status === 'paid'));

  if(items.length === 0){
    list.innerHTML = `<div class="empty-note">${currentDebtTab === 'owed_to_me' ? 'Chưa có ai nợ bạn khoản nào.' : 'Bạn hiện không nợ ai khoản nào.'}</div>`;
  } else {
    const today = new Date().toISOString().slice(0,10);
    list.innerHTML = items.map(d => {
      const pct = d.originalAmount ? Math.round(((d.originalAmount - d.amount) / d.originalAmount) * 100) : 0;
      const isOverdue = d.status !== 'paid' && d.dueDate && d.dueDate < today;
      const statusClass = d.status === 'paid' ? 'paid' : (isOverdue ? 'overdue' : 'unpaid');
      const statusLabel = d.status === 'paid' ? 'Đã tất toán' : (isOverdue ? 'Quá hạn' : 'Chưa trả');
      const hasPayInfo = d.bankName || d.accountNumber || d.accountHolder;
      const payInfoHtml = hasPayInfo ? `
          <div class="debt-payinfo">
            ${d.bankName ? `<span class="ppill"><i class="fa-solid fa-building-columns"></i> ${d.bankName}</span>` : ''}
            ${d.accountNumber ? `<span class="ppill"><i class="fa-solid fa-credit-card"></i> ${d.accountNumber} <button type="button" class="copy-btn" title="Sao chép số tài khoản" onclick="copyDebtAccountNumber('${d.id}')"><i class="fa-solid fa-copy"></i></button></span>` : ''}
            ${d.accountHolder ? `<span class="ppill"><i class="fa-solid fa-user"></i> ${d.accountHolder}</span>` : ''}
          </div>` : '';
      return `
      <div class="debt-row">
        <div class="debt-avatar" style="background:${debtAvatarColor(d.person)}">${initials(d.person)}</div>
        <div class="debt-info">
          <div class="dname">${d.person}</div>
          <div class="dmeta">${d.note ? d.note + ' · ' : ''}Phát sinh ${formatDate(d.date)}${d.dueDate ? ' · Hạn trả ' + formatDate(d.dueDate) : ''}</div>
          ${d.originalAmount !== d.amount ? `<div class="debt-progress-track"><div class="debt-progress-fill" style="width:${pct}%"></div></div>` : ''}
          ${payInfoHtml}
        </div>
        <div class="debt-amounts">
          <div class="remain">${formatCurrency(d.amount)}</div>
          ${d.originalAmount !== d.amount ? `<div class="orig">${formatCurrency(d.originalAmount)}</div>` : ''}
        </div>
        <span class="debt-status ${statusClass}">${statusLabel}</span>
        <div class="debt-actions">
          ${d.status !== 'paid' ? `<button class="icon-btn" title="Ghi nhận thanh toán" onclick="openSettleDebtModal('${d.id}')"><i class="fa-solid fa-hand-holding-dollar"></i></button>` : ''}
          ${(d.bankBin && d.bankBin !== 'other' && d.accountNumber) ? `<button class="icon-btn" title="Tạo mã QR nhận/chuyển khoản" onclick="openBankQrModal('debt', '${d.id}')"><i class="fa-solid fa-qrcode"></i></button>` : ''}
          <button class="icon-btn" title="Lịch sử trả nợ" onclick="openDebtHistoryModal('${d.id}')"><i class="fa-solid fa-clock-rotate-left"></i></button>
          <button class="icon-btn" title="Sửa" onclick="openDebtModal('${d.id}')"><i class="fa-solid fa-pen"></i></button>
          <button class="icon-btn danger" title="Xóa" onclick="deleteDebt('${d.id}')"><i class="fa-solid fa-trash"></i></button>
        </div>
      </div>`;
    }).join('');
  }

  const totalUnpaid = appData.debts.filter(d => d.status !== 'paid').length;
  const badge = document.getElementById('debtBadge');
  if(badge){
    badge.textContent = totalUnpaid;
    badge.classList.toggle('hidden', totalUnpaid === 0);
  }
}

/* =====================================================
   TRANG TỔNG QUAN: BẢNG & THÔNG ĐIỆP CÔNG NỢ
===================================================== */
function renderDashboardDebtOverview(){
  const bannerEl = document.getElementById('dashDebtStatusBanner');
  const tableWrapEl = document.getElementById('dashDebtTableWrap');
  if(!bannerEl || !tableWrapEl) return;

  const owedToMeList = appData.debts.filter(d => d.type === 'owed_to_me' && d.status !== 'paid');
  const iOweList = appData.debts.filter(d => d.type === 'i_owe' && d.status !== 'paid');
  const hasOwedToMe = owedToMeList.length > 0;
  const hasIOwe = iOweList.length > 0;

  let bannerClass = 'debt-status-banner', icon = 'fa-face-smile', title = '', sub = '';

  if(!hasOwedToMe && !hasIOwe){
    icon = 'fa-face-smile';
    title = 'Bạn hiện không nợ ai và cũng không ai nợ bạn';
    sub = 'Sổ công nợ của bạn đang trống — cứ tiếp tục giữ vững phong độ này nhé!';
  } else if(hasOwedToMe && !hasIOwe){
    icon = 'fa-hand-holding-dollar';
    title = `Đang có ${owedToMeList.length} người nợ bạn, bạn không nợ ai`;
    sub = `Tổng cộng ${formatCurrency(owedToMeList.reduce((s,d) => s + d.amount, 0))} đang chờ được thu hồi.`;
  } else if(!hasOwedToMe && hasIOwe){
    bannerClass += ' mixed';
    icon = 'fa-file-invoice-dollar';
    title = `Bạn đang nợ ${iOweList.length} người, hiện không ai nợ bạn`;
    sub = `Tổng cộng ${formatCurrency(iOweList.reduce((s,d) => s + d.amount, 0))} bạn cần thanh toán.`;
  } else {
    bannerClass += ' mixed';
    icon = 'fa-scale-balanced';
    title = `Bạn đang nợ ${iOweList.length} người và có ${owedToMeList.length} người nợ bạn`;
    sub = 'Theo dõi kỹ để cân đối thu hồi và thanh toán đúng hạn.';
  }

  bannerEl.className = bannerClass;
  bannerEl.innerHTML = `
    <div class="dsb-icon"><i class="fa-solid ${icon}"></i></div>
    <div><div class="dsb-title">${title}</div><div class="dsb-sub">${sub}</div></div>`;

  const allActive = [...owedToMeList, ...iOweList].sort((a,b) => (a.dueDate || '9999') < (b.dueDate || '9999') ? -1 : 1);
  if(allActive.length === 0){
    tableWrapEl.innerHTML = '';
    return;
  }
  tableWrapEl.innerHTML = `
    <table class="tx-table">
      <thead><tr><th>Đối tượng</th><th>Loại</th><th>Còn lại</th><th>Hạn trả</th><th></th></tr></thead>
      <tbody>
        ${allActive.slice(0, 6).map(d => `
          <tr>
            <td>${d.person}</td>
            <td><span class="type-pill ${d.type === 'owed_to_me' ? 'income' : 'expense'}">${d.type === 'owed_to_me' ? 'Nợ tôi' : 'Tôi nợ'}</span></td>
            <td class="tx-amount ${d.type === 'owed_to_me' ? 'income' : 'expense'}">${formatCurrency(d.amount)}</td>
            <td class="tx-date">${d.dueDate ? formatDate(d.dueDate) : '—'}</td>
            <td><button class="icon-btn" title="Ghi nhận thanh toán" onclick="openSettleDebtModal('${d.id}')"><i class="fa-solid fa-hand-holding-dollar"></i></button></td>
          </tr>`).join('')}
      </tbody>
    </table>`;
}

/* =====================================================
   THÔNG BÁO — tổng hợp từ hóa đơn định kỳ, ngân sách, công nợ
===================================================== */
// Gom tất cả điều kiện cần nhắc nhở trong app thành 1 danh sách thông báo thống nhất.
function computeNotifications(){
  const notifs = [];
  const today = new Date().toISOString().slice(0,10);
  const monthKey = currentMonthKey();

  // 1) Hóa đơn định kỳ sắp đến hạn
  appData.recurring.filter(r => r.status === 'due').forEach(r => {
    notifs.push({
      id: `recurring:${r.id}`,
      icon: r.icon || 'fa-repeat',
      colorBg: 'var(--color-expense-soft)',
      colorFg: 'var(--color-expense)',
      title: `Hóa đơn "${r.name}" sắp đến hạn`,
      desc: `Số tiền ${formatCurrency(r.amount)} · ${r.dueDate}`,
      time: 'Định kỳ hàng tháng',
      view: 'recurring',
    });
  });

  // 2) Ngân sách đã dùng trên 80% hạn mức
  appData.budgets.forEach(b => {
    const cat = findCat(b.category);
    const spent = appData.transactions
      .filter(t => t.type === 'expense' && t.category === b.category && t.date.startsWith(monthKey))
      .reduce((s,t) => s + t.amount, 0);
    if(spent > b.limit * 0.8){
      const pct = Math.round((spent / b.limit) * 100);
      const isOverLimit = spent > b.limit;
      notifs.push({
        id: `budget:${b.category}`,
        icon: cat.icon || 'fa-chart-pie',
        colorBg: 'var(--color-expense-soft)',
        colorFg: 'var(--color-expense)',
        title: isOverLimit ? `Đã vượt ngân sách "${cat.label}"` : `Ngân sách "${cat.label}" sắp hết hạn mức`,
        desc: `Đã dùng ${formatCurrency(spent)} / ${formatCurrency(b.limit)} (${pct}%)`,
        time: currentMonthLabelVI(),
        view: 'budgets',
      });
    }
  });

  // 3) Công nợ: khoản mình đi vay đã quá hạn trả
  appData.debts.filter(d => d.type === 'i_owe' && d.status !== 'paid' && d.dueDate && d.dueDate < today).forEach(d => {
    notifs.push({
      id: `debt-owe:${d.id}`,
      icon: 'fa-file-invoice-dollar',
      colorBg: 'var(--color-expense-soft)',
      colorFg: 'var(--color-expense)',
      title: `Quá hạn trả nợ cho ${d.person}`,
      desc: `Còn lại ${formatCurrency(d.amount)} · Hạn trả ${formatDate(d.dueDate)}`,
      time: 'Công nợ',
      view: 'debts',
    });
  });

  // 4) Công nợ: khoản người khác nợ mình đã quá hạn thu hồi
  appData.debts.filter(d => d.type === 'owed_to_me' && d.status !== 'paid' && d.dueDate && d.dueDate < today).forEach(d => {
    notifs.push({
      id: `debt-owed:${d.id}`,
      icon: 'fa-hand-holding-dollar',
      colorBg: 'var(--color-accent-soft)',
      colorFg: 'var(--color-accent)',
      title: `${d.person} đã quá hạn trả bạn`,
      desc: `Còn lại ${formatCurrency(d.amount)} · Hạn trả ${formatDate(d.dueDate)}`,
      time: 'Công nợ',
      view: 'debts',
    });
  });

  // Loại bỏ các thông báo đã bị người dùng xoá (dismissed) khỏi danh sách hiển thị.
  const visibleNotifs = notifs.filter(n => !appData.dismissedNotifications.includes(n.id));

  // Gắn trạng thái đã đọc/chưa đọc cho từng thông báo — KHÔNG loại bỏ khỏi danh sách,
  // để "đánh dấu đã đọc" chỉ đổi màu hiển thị chứ không làm mất thông báo.
  return visibleNotifs.map(n => ({...n, read: appData.readNotifications.includes(n.id)}));
}

// Trạng thái tab lọc đang chọn trong view "Thông báo": 'all' | 'unread'.
let notifFilterMode = 'all';

// Chuyển tab lọc (Tất cả / Chưa đọc) và vẽ lại danh sách.
function setNotifFilter(mode){
  notifFilterMode = mode;
  document.querySelectorAll('.notif-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.notifFilter === mode);
  });
  renderNotifications();
}

// Vẽ danh sách thông báo vào view "Thông báo" và cập nhật số đếm trên sidebar.
function renderNotifications(){
  const list = document.getElementById('notificationsList');
  const notifs = computeNotifications();
  const unreadNotifs = notifs.filter(n => !n.read);

  const badge = document.getElementById('notifBadge');
  if(badge){
    badge.textContent = unreadNotifs.length;
    badge.classList.toggle('hidden', unreadNotifs.length === 0);
  }

  const markAllBtn = document.getElementById('btnMarkAllNotifRead');
  if(markAllBtn) markAllBtn.classList.toggle('hidden', unreadNotifs.length === 0);

  const clearAllBtn = document.getElementById('btnClearAllNotif');
  if(clearAllBtn) clearAllBtn.classList.toggle('hidden', notifs.length === 0);

  const countAll = document.getElementById('notifCountAll');
  const countUnread = document.getElementById('notifCountUnread');
  if(countAll) countAll.textContent = notifs.length;
  if(countUnread) countUnread.textContent = unreadNotifs.length;

  if(!list) return; // View "Thông báo" chưa được mở, chỉ cần cập nhật badge là đủ.

  if(notifs.length === 0){
    list.innerHTML = `<div class="empty-note">Không có thông báo nào — mọi thứ đều đang ổn!</div>`;
    return;
  }

  // Sắp xếp: thông báo chưa đọc lên trước để dễ theo dõi việc mới nhất.
  const sorted = [...notifs].sort((a,b) => Number(a.read) - Number(b.read));
  const visible = notifFilterMode === 'unread' ? sorted.filter(n => !n.read) : sorted;

  if(visible.length === 0){
    list.innerHTML = `<div class="empty-note"><i class="fa-solid fa-circle-check" style="color:var(--color-income);margin-right:6px;"></i>Bạn đã đọc hết thông báo!</div>`;
    return;
  }

  list.innerHTML = visible.map(n => `
    <div class="notif-item ${n.read ? 'is-read' : 'is-unread'}" style="cursor:pointer;" onclick="switchView('${n.view}')">
      <div class="notif-icon" style="background:${n.colorBg};color:${n.colorFg}"><i class="fa-solid ${n.icon}"></i></div>
      <div class="notif-body">
        <div class="notif-title-row">
          ${n.read ? '' : '<span class="notif-dot"></span>'}
          <div class="notif-title">${n.title}</div>
          ${n.read ? '' : '<span class="notif-badge-new">MỚI</span>'}
        </div>
        <div class="notif-desc">${n.desc}</div>
        <div class="notif-time"><i class="fa-solid fa-clock"></i> ${n.time}</div>
      </div>
      <div class="notif-dismiss" style="display:flex;align-items:center;gap:4px;">
        ${n.read
          ? `<span class="notif-read-mark" title="Đã đọc"><i class="fa-solid fa-check"></i></span>`
          : `<button type="button" class="icon-btn" title="Đánh dấu đã đọc" onclick="markNotificationRead(event,'${n.id}')"><i class="fa-solid fa-check"></i></button>`}
        <button type="button" class="icon-btn" title="Xoá thông báo" onclick="dismissNotification(event,'${n.id}')"><i class="fa-solid fa-xmark"></i></button>
      </div>
    </div>`).join('');
}

// Đánh dấu 1 thông báo cụ thể là đã đọc (chỉ đổi màu hiển thị, KHÔNG xoá khỏi danh sách).
function markNotificationRead(event, id){
  if(event) event.stopPropagation();
  if(!appData.readNotifications.includes(id)) appData.readNotifications.push(id);
  renderNotifications();
  syncMetaSilently();
}

// Đánh dấu toàn bộ thông báo hiện có là đã đọc — thông báo vẫn giữ nguyên trong danh sách,
// chỉ chuyển sang màu "đã đọc" (nhạt hơn) thay vì bị xoá đi.
function markAllNotificationsRead(){
  computeNotifications().forEach(n => {
    if(!appData.readNotifications.includes(n.id)) appData.readNotifications.push(n.id);
  });
  renderNotifications();
  syncMetaSilently();
  showToast('Đã đánh dấu tất cả thông báo là đã đọc.');
}

// Xoá 1 thông báo cụ thể khỏi danh sách hiển thị (ẩn đi, không ảnh hưởng dữ liệu gốc).
function dismissNotification(event, id){
  if(event) event.stopPropagation();
  if(!appData.dismissedNotifications.includes(id)) appData.dismissedNotifications.push(id);
  renderNotifications();
  syncMetaSilently();
}

// Xoá toàn bộ thông báo đang hiển thị — thông báo sẽ biến mất khỏi danh sách,
// nhưng nếu điều kiện phát sinh lại sau này (vd. hóa đơn mới quá hạn) thì vẫn sẽ hiện lại.
function clearAllNotifications(){
  computeNotifications().forEach(n => {
    if(!appData.dismissedNotifications.includes(n.id)) appData.dismissedNotifications.push(n.id);
  });
  renderNotifications();
  syncMetaSilently();
  showToast('Đã xoá tất cả thông báo.');
}

function populateDebtWalletSelect(selectId, type){


  const select = document.getElementById(selectId);
  if(!select) return;
  const opts = appData.wallets.map(w => `<option value="${w.id}">${w.name} (${formatCurrency(w.balance)})</option>`).join('');
  select.innerHTML = `<option value="">-- Không ghi nhận giao dịch vào ví --</option>${opts}`;
}

function setDebtType(type){
  currentDebtType = type;
  document.getElementById('debtInputType').value = type;
  document.getElementById('btnDebtTypeOwedToMe').classList.toggle('active', type === 'owed_to_me');
  document.getElementById('btnDebtTypeIOwe').classList.toggle('active', type === 'i_owe');

  document.getElementById('debtPersonLabel').textContent = type === 'owed_to_me' ? 'Tên người nợ tôi' : 'Tên người tôi nợ';
  document.getElementById('debtInputPerson').placeholder = type === 'owed_to_me' ? 'Ví dụ: Nguyễn Văn A (người mượn tiền bạn)' : 'Ví dụ: Nguyễn Văn A (người bạn mượn tiền)';
  document.getElementById('debtWalletLabel').textContent = type === 'owed_to_me' ? 'Trừ từ ví khi cho vay (không bắt buộc)' : 'Cộng vào ví khi nhận vay (không bắt buộc)';
  document.getElementById('debtWalletHint').textContent = type === 'owed_to_me'
    ? 'Nếu chọn, số tiền cho vay sẽ được trừ ngay khỏi ví này.'
    : 'Nếu chọn, số tiền vay được sẽ được cộng ngay vào ví này.';
}

// Gán sẵn lựa chọn ngân hàng cho combobox trong modal công nợ.
// selectedBin: mã BIN đã lưu (nếu có) -> ưu tiên dùng để chọn sẵn.
// fallbackName: tên ngân hàng cũ dạng chữ tự do (dữ liệu trước khi có bankBin) -> thử khớp theo tên, nếu không khớp thì chọn "Khác".
function renderDebtBankSelect(selectedBin, fallbackName){
  let bin = selectedBin || null;
  if(!bin && fallbackName){
    const matched = VIETQR_BANKS.find(b => b.name.toLowerCase() === fallbackName.trim().toLowerCase());
    bin = matched ? matched.bin : 'other';
  }
  setBankComboValue('debtInputBankBinSearch', 'debtInputBankBin', bin, true, fallbackName);
  document.getElementById('debtInputBankNameOther').value = (bin === 'other') ? (fallbackName || '') : '';
  toggleDebtBankOtherField();
}
function toggleDebtBankOtherField(){
  const isOther = document.getElementById('debtInputBankBin').value === 'other';
  document.getElementById('debtBankOtherFieldWrap').classList.toggle('hidden', !isOther);
}


function openDebtModal(id){
  editingDebtId = id || null;
  const isEdit = !!editingDebtId;
  const d = isEdit ? appData.debts.find(x => x.id === id) : null;

  document.getElementById('debtModalTitle').textContent = isEdit ? 'Sửa khoản công nợ' : 'Thêm khoản công nợ';
  setDebtType(isEdit ? d.type : 'owed_to_me');
  document.getElementById('debtInputPerson').value = isEdit ? d.person : '';
  document.getElementById('debtInputAmount').value = isEdit ? d.amount : '';
  document.getElementById('debtInputDate').value = isEdit ? d.date : new Date().toISOString().slice(0,10);
  document.getElementById('debtInputDueDate').value = isEdit ? (d.dueDate || '') : '';
  document.getElementById('debtInputNote').value = isEdit ? (d.note || '') : '';
  renderDebtBankSelect(isEdit ? d.bankBin : null, isEdit ? d.bankName : null);
  document.getElementById('debtInputAccountNumber').value = isEdit ? (d.accountNumber || '') : '';
  document.getElementById('debtInputAccountHolder').value = isEdit ? (d.accountHolder || '') : '';

  populateDebtWalletSelect('debtInputWallet', currentDebtType);
  // Ô chọn ví luôn hiển thị (kể cả khi sửa) để có thể bổ sung ghi nhận vào ví
  // cho khoản công nợ đã tạo trước đó mà lúc tạo chưa chọn ví.
  document.getElementById('debtWalletFieldWrap').classList.remove('hidden');
  document.getElementById('debtInputWallet').value = '';
  if(isEdit){
    document.getElementById('debtWalletHint').textContent += ' Bỏ trống nếu bạn không muốn ghi nhận thêm giao dịch vào ví lúc này.';
  }

  document.getElementById('debtModalOverlay').classList.remove('hidden');
}
function closeDebtModal(){ document.getElementById('debtModalOverlay').classList.add('hidden'); }

async function handleSaveDebt(e){
  e.preventDefault();
  const type = document.getElementById('debtInputType').value;
  const person = document.getElementById('debtInputPerson').value.trim();
  const amount = parseFloat(document.getElementById('debtInputAmount').value);
  const date = document.getElementById('debtInputDate').value;
  const dueDate = document.getElementById('debtInputDueDate').value || null;
  const note = document.getElementById('debtInputNote').value.trim();
  const walletId = document.getElementById('debtInputWallet').value;
  const bankBinSel = document.getElementById('debtInputBankBin').value;
  let bankBin = null, bankName = '';
  if(bankBinSel === 'other'){
    bankName = document.getElementById('debtInputBankNameOther').value.trim();
  } else if(bankBinSel){
    bankBin = bankBinSel;
    bankName = (VIETQR_BANKS.find(b => b.bin === bankBin) || {}).name || '';
  }
  const accountNumber = document.getElementById('debtInputAccountNumber').value.trim();
  const accountHolder = document.getElementById('debtInputAccountHolder').value.trim().toUpperCase();

  if(!person){ showToast('Vui lòng nhập tên người liên quan.', 'error'); return; }
  if(!amount || amount <= 0){ showToast('Vui lòng nhập số tiền hợp lệ.', 'error'); return; }

  const wasEdit = !!editingDebtId;
  // Cho vay -> tiền rời khỏi ví; đi vay -> tiền vào ví.
  const delta = (type === 'owed_to_me' ? -amount : amount);

  if(wasEdit){
    const d = appData.debts.find(x => x.id === editingDebtId);
    if(!d){ showToast('Không tìm thấy khoản công nợ.', 'error'); return; }

    const patch = {
      type, person, date,
      dueDate: dueDate || null,
      note,
      bankBin: bankBin || '',
      bankName: bankName || '',
      accountNumber, accountHolder,
    };
    if(amount !== d.originalAmount){
      const paidSoFar = d.originalAmount - d.amount;
      patch.originalAmount = amount;
      patch.amount = Math.max(0, amount - paidSoFar);
    }

    await withLoading(async () => {
      await Data.updateDebt(editingDebtId, patch);
      if(walletId) await Data.adjustWalletBalance(walletId, delta);
    }, 'Đang lưu công nợ...');
  } else {
    await withLoading(() => Data.addDebt({
      type, person, amount, originalAmount: amount, date,
      dueDate: dueDate || null, note,
      bankBin: bankBin || '', bankName: bankName || '',
      accountNumber, accountHolder, status: 'unpaid',
    }, walletId ? { walletId, delta } : null), 'Đang lưu công nợ...');
  }

  closeDebtModal();
  renderCore();
  showToast(wasEdit
    ? (walletId ? 'Đã cập nhật khoản công nợ và ghi nhận vào ví.' : 'Đã cập nhật khoản công nợ.')
    : 'Đã thêm khoản công nợ mới.');
}

async function deleteDebt(id){
  if(!confirm('Bạn có chắc chắn muốn xóa khoản công nợ này? Lịch sử trả nợ kèm theo cũng sẽ bị xoá.')) return;
  await withLoading(() => Data.removeDebt(id), 'Đang xóa công nợ...');
  renderCore();
  showToast('Đã xóa khoản công nợ.');
}

document.getElementById('debtModalOverlay').addEventListener('click', (e) => { if(e.target.id === 'debtModalOverlay') closeDebtModal(); });

/* =====================================================
   THANH TOÁN CÔNG NỢ (tất toán một phần hoặc toàn bộ)
===================================================== */
function openSettleDebtModal(id){
  settlingDebtId = id;
  const d = appData.debts.find(x => x.id === id);
  if(!d) return;

  document.getElementById('settleDebtModalTitle').textContent = d.type === 'owed_to_me' ? `Ghi nhận ${d.person} trả nợ` : `Ghi nhận trả nợ cho ${d.person}`;
  document.getElementById('settleInputAmount').value = d.amount;
  document.getElementById('settleInputAmount').max = d.amount;
  document.getElementById('settleRemainHint').textContent = `Số tiền còn nợ hiện tại: ${formatCurrency(d.amount)}`;
  document.getElementById('settleWalletLabel').textContent = d.type === 'owed_to_me' ? 'Ví nhận tiền trả nợ (không bắt buộc)' : 'Ví dùng để thanh toán (không bắt buộc)';
  populateDebtWalletSelect('settleInputWallet', d.type);
  document.getElementById('settleInputNote').value = '';
  settleAttachImages = [];
  document.getElementById('settleAttachInput').value = '';
  renderSettleAttachPreview();

  document.getElementById('settleDebtModalOverlay').classList.remove('hidden');
}
function closeSettleDebtModal(){
  document.getElementById('settleDebtModalOverlay').classList.add('hidden');
  settleAttachImages = [];
}

async function handleSettleDebt(e){
  e.preventDefault();
  const d = appData.debts.find(x => x.id === settlingDebtId);
  if(!d) return;

  const amount = parseFloat(document.getElementById('settleInputAmount').value);
  const walletId = document.getElementById('settleInputWallet').value;
  const note = document.getElementById('settleInputNote').value.trim();

  if(!amount || amount <= 0){ showToast('Vui lòng nhập số tiền hợp lệ.', 'error'); return; }
  if(amount > d.amount){ showToast('Số tiền thanh toán không được lớn hơn số tiền còn nợ.', 'error'); return; }

  // Người khác trả mình -> tiền vào ví; mình trả người khác -> tiền ra khỏi ví.
  const delta = (d.type === 'owed_to_me' ? amount : -amount);

  await withLoading(() => Data.settleDebt(d.id, {
    id: newLocalId(),
    amount,
    date: new Date().toISOString().slice(0, 10),
    walletId: walletId || '',
    note,
    attachments: [...settleAttachImages],
  }, walletId ? { walletId, delta } : null), 'Đang ghi nhận thanh toán...');

  closeSettleDebtModal();
  renderCore();
  showToast(d.status === 'paid' ? `Đã tất toán khoản công nợ với ${d.person}.` : `Đã ghi nhận ${formatCurrency(amount)} thanh toán từ/cho ${d.person}.`);
}

document.getElementById('settleDebtModalOverlay').addEventListener('click', (e) => { if(e.target.id === 'settleDebtModalOverlay') closeSettleDebtModal(); });

/* =====================================================
   ẢNH MINH CHỨNG KHI GHI NHẬN THANH TOÁN CÔNG NỢ
===================================================== */
function renderSettleAttachPreview(){
  const grid = document.getElementById('settleAttachPreviewGrid');
  const desc = document.getElementById('settleAttachDropDesc');
  if(!grid) return;
  grid.innerHTML = settleAttachImages.map((src, idx) => `
    <div class="attach-thumb">
      <img src="${src}" onclick="previewSettleAttachmentAt(${idx})" alt="Ảnh minh chứng ${idx+1}">
      <button type="button" class="rm-btn" title="Xóa ảnh" onclick="removeSettleAttachment(${idx})"><i class="fa-solid fa-xmark"></i></button>
    </div>`).join('');
  if(desc){
    desc.textContent = settleAttachImages.length >= MAX_ATTACHMENTS
      ? `Đã đạt tối đa ${MAX_ATTACHMENTS} ảnh`
      : `Nhấn để chọn ảnh minh chứng thanh toán (${settleAttachImages.length}/${MAX_ATTACHMENTS})`;
  }
}
function handleSettleAttachSelect(e){
  const files = Array.from(e.target.files || []);
  if(files.length === 0) return;

  const remaining = MAX_ATTACHMENTS - settleAttachImages.length;
  if(remaining <= 0){
    showToast(`Bạn chỉ có thể đính kèm tối đa ${MAX_ATTACHMENTS} ảnh.`, 'error');
    e.target.value = '';
    return;
  }

  const filesToUse = files.slice(0, remaining);
  if(files.length > remaining){
    showToast(`Chỉ thêm được ${remaining} ảnh nữa (tối đa ${MAX_ATTACHMENTS} ảnh/lần thanh toán).`, 'error');
  }

  filesToUse.forEach(file => {
    if(!file.type.startsWith('image/')) return;
    // Nén ảnh trước khi lưu để không vượt giới hạn 1MB/document của Firestore.
    compressImage(file)
      .then(dataUrl => {
        settleAttachImages.push(dataUrl);
        renderSettleAttachPreview();
      })
      .catch(() => { showToast('Không thể đọc một trong các ảnh đã chọn.', 'error'); });
  });

  e.target.value = '';
}
function removeSettleAttachment(idx){
  settleAttachImages.splice(idx, 1);
  renderSettleAttachPreview();
}
function previewSettleAttachmentAt(idx){
  lightboxImages = settleAttachImages;
  lightboxIndex = idx;
  showLightbox();
}

/* =====================================================
   XEM LỊCH SỬ TRẢ NỢ CỦA TỪNG ĐỐI TƯỢNG
===================================================== */
function copyToClipboard(text, successMsg){
  const done = () => showToast(successMsg || 'Đã sao chép vào bộ nhớ tạm.');
  const fail = () => showToast('Không thể sao chép tự động. Vui lòng sao chép thủ công.', 'error');
  if(navigator.clipboard && navigator.clipboard.writeText){
    navigator.clipboard.writeText(text).then(done).catch(() => {
      fallbackCopy(text) ? done() : fail();
    });
  } else {
    fallbackCopy(text) ? done() : fail();
  }
}
function fallbackCopy(text){
  try{
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus(); ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch(err){ return false; }
}
function copyDebtAccountNumber(id){
  const d = appData.debts.find(x => x.id === id);
  if(!d || !d.accountNumber) return;
  const text = d.bankName ? `${d.bankName} - ${d.accountNumber}` : d.accountNumber;
  copyToClipboard(text, `Đã sao chép ${d.bankName ? 'ngân hàng và ' : ''}số tài khoản của ${d.person}.`);
}

function openDebtHistoryModal(id){
  const d = appData.debts.find(x => x.id === id);
  if(!d) return;
  currentHistoryDebtId = id;
  document.getElementById('debtHistoryModalTitle').textContent = `Lịch sử trả nợ · ${d.person}`;
  document.getElementById('debtHistoryModalSub').textContent =
    `${d.type === 'owed_to_me' ? 'Người khác nợ tôi' : 'Tôi nợ người khác'} · Còn lại ${formatCurrency(d.amount)} / ${formatCurrency(d.originalAmount)}`;
  renderDebtHistory(d);
  document.getElementById('debtHistoryModalOverlay').classList.remove('hidden');
}
function closeDebtHistoryModal(){
  document.getElementById('debtHistoryModalOverlay').classList.add('hidden');
  currentHistoryDebtId = null;
}

function renderDebtHistory(d){
  const list = document.getElementById('debtHistoryList');
  const payments = d.payments || [];
  if(payments.length === 0){
    list.innerHTML = `<div class="empty-note">Chưa có lần thanh toán nào được ghi nhận cho khoản công nợ này.</div>`;
    return;
  }
  list.innerHTML = payments.map(p => {
    const wallet = p.walletId ? findWallet(p.walletId) : null;
    const hasImgs = p.attachments && p.attachments.length > 0;
    const imgs = hasImgs ? p.attachments.map((src, idx) => `<img src="${src}" onclick="previewDebtHistoryAttachmentAt('${d.id}','${p.id}',${idx})" alt="Ảnh minh chứng thanh toán">`).join('') : '';
    return `
    <div class="debt-history-item ${d.type === 'i_owe' ? 'type-i-owe' : ''}">
      <div class="dh-top">
        <div class="dh-amount">${d.type === 'owed_to_me' ? '+' : '−'} ${formatCurrency(p.amount)}</div>
        <div class="dh-meta">${formatDate(p.date)}</div>
      </div>
      <div class="dh-meta">${wallet ? wallet.name : 'Không ghi nhận vào ví'}${p.note ? ' · ' + p.note : ''}</div>
      ${imgs ? `<div class="dh-imgs">${imgs}</div>` : ''}
      <button type="button" class="tx-attach-badge ${hasImgs ? '' : 'tx-attach-empty'}" style="margin:9px 0 0 0;" onclick="openDebtPaymentAttachModal('${d.id}','${p.id}')">
        <i class="fa-solid ${hasImgs ? 'fa-paperclip' : 'fa-camera'}"></i> ${hasImgs ? `Quản lý ảnh (${p.attachments.length})` : 'Thêm ảnh minh chứng'}
      </button>
    </div>`;
  }).join('');
}
function previewDebtHistoryAttachmentAt(debtId, paymentId, imgIdx){
  const d = appData.debts.find(x => x.id === debtId);
  const p = d && d.payments && d.payments.find(x => x.id === paymentId);
  if(!p) return;
  lightboxImages = p.attachments;
  lightboxIndex = imgIdx;
  showLightbox();
}
document.getElementById('debtHistoryModalOverlay').addEventListener('click', (e) => { if(e.target.id === 'debtHistoryModalOverlay') closeDebtHistoryModal(); });

/* =====================================================
   THÊM / SỬA ẢNH MINH CHỨNG CHO 1 LẦN TRẢ NỢ ĐÃ GHI NHẬN
===================================================== */
function openDebtPaymentAttachModal(debtId, paymentId){
  const d = appData.debts.find(x => x.id === debtId);
  const p = d && d.payments && d.payments.find(x => x.id === paymentId);
  if(!p) return;

  editingDebtPaymentDebtId = debtId;
  editingDebtPaymentId = paymentId;
  editingDebtPaymentImages = [...(p.attachments || [])];

  document.getElementById('debtPaymentAttachModalSub').textContent =
    `${d.person} · ${formatDate(p.date)} · ${d.type === 'owed_to_me' ? '+' : '−'} ${formatCurrency(p.amount)}`;

  document.getElementById('debtPaymentAttachInput').value = '';
  renderDebtPaymentAttachPreview();
  document.getElementById('debtPaymentAttachModalOverlay').classList.remove('hidden');
}
function closeDebtPaymentAttachModal(){
  document.getElementById('debtPaymentAttachModalOverlay').classList.add('hidden');
  editingDebtPaymentDebtId = null;
  editingDebtPaymentId = null;
  editingDebtPaymentImages = [];
}

function renderDebtPaymentAttachPreview(){
  const grid = document.getElementById('debtPaymentAttachPreviewGrid');
  const desc = document.getElementById('debtPaymentAttachDropDesc');
  if(!grid) return;
  grid.innerHTML = editingDebtPaymentImages.map((src, idx) => `
    <div class="attach-thumb">
      <img src="${src}" onclick="previewDebtPaymentAttachmentAt(${idx})" alt="Ảnh minh chứng ${idx+1}">
      <button type="button" class="rm-btn" title="Xóa ảnh" onclick="removeDebtPaymentAttachment(${idx})"><i class="fa-solid fa-xmark"></i></button>
    </div>`).join('');
  if(desc){
    desc.textContent = editingDebtPaymentImages.length >= MAX_ATTACHMENTS
      ? `Đã đạt tối đa ${MAX_ATTACHMENTS} ảnh`
      : `Nhấn để chọn ảnh minh chứng thanh toán (${editingDebtPaymentImages.length}/${MAX_ATTACHMENTS})`;
  }
}

function handleDebtPaymentAttachSelect(e){
  const files = Array.from(e.target.files || []);
  if(files.length === 0) return;

  const remaining = MAX_ATTACHMENTS - editingDebtPaymentImages.length;
  if(remaining <= 0){
    showToast(`Bạn chỉ có thể đính kèm tối đa ${MAX_ATTACHMENTS} ảnh.`, 'error');
    e.target.value = '';
    return;
  }

  const filesToUse = files.slice(0, remaining);
  if(files.length > remaining){
    showToast(`Chỉ thêm được ${remaining} ảnh nữa (tối đa ${MAX_ATTACHMENTS} ảnh/lần thanh toán).`, 'error');
  }

  filesToUse.forEach(file => {
    if(!file.type.startsWith('image/')) return;
    // Nén ảnh trước khi lưu để không vượt giới hạn 1MB/document của Firestore.
    compressImage(file)
      .then(dataUrl => {
        editingDebtPaymentImages.push(dataUrl);
        renderDebtPaymentAttachPreview();
      })
      .catch(() => { showToast('Không thể đọc một trong các ảnh đã chọn.', 'error'); });
  });

  e.target.value = '';
}
function removeDebtPaymentAttachment(idx){
  editingDebtPaymentImages.splice(idx, 1);
  renderDebtPaymentAttachPreview();
}
function previewDebtPaymentAttachmentAt(idx){
  lightboxImages = editingDebtPaymentImages;
  lightboxIndex = idx;
  showLightbox();
}

async function saveDebtPaymentAttachments(){
  const d = appData.debts.find(x => x.id === editingDebtPaymentDebtId);
  const p = d && d.payments && d.payments.find(x => x.id === editingDebtPaymentId);
  if(!p) return;
  p.attachments = [...editingDebtPaymentImages];
  await withLoading(() => Data.saveDebtPayments(d.id, d.payments), 'Đang lưu ảnh minh chứng...');
  closeDebtPaymentAttachModal();
  if(currentHistoryDebtId === d.id) renderDebtHistory(d);
  showToast('Đã cập nhật ảnh minh chứng cho lần trả nợ này.');
}
document.getElementById('debtPaymentAttachModalOverlay').addEventListener('click', (e) => { if(e.target.id === 'debtPaymentAttachModalOverlay') closeDebtPaymentAttachModal(); });

/* =====================================================
   RENDER: ANALYTICS
===================================================== */
function setAnalyticsRange(range){
  currentAnalyticsRange = range;
  document.querySelectorAll('[data-range]').forEach(btn => btn.classList.toggle('active', btn.dataset.range === range));
  safeRun(renderTrendChart, 'Biểu đồ xu hướng', 'trendChart');
}
// Nhóm giao dịch theo từng ngày trong tháng hiện tại (ngày 1 -> ngày cuối tháng, dữ liệu thật, không ước lượng).
function getMonthlyDailyTrendData(){
  const now = new Date();
  const year = now.getFullYear(), month = now.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const result = [];
  for(let day = 1; day <= daysInMonth; day++){
    const dateKey = `${year}-${String(month + 1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    const dayTx = appData.transactions.filter(t => t.date === dateKey);
    const income = dayTx.filter(t => t.type === 'income').reduce((s,t) => s + t.amount, 0);
    const expense = dayTx.filter(t => t.type === 'expense').reduce((s,t) => s + t.amount, 0);
    result.push({ day: String(day), dateKey, income, expense });
  }
  return result;
}

// Nhóm giao dịch theo 12 tháng của năm hiện tại (Tháng 1 -> Tháng 12, dữ liệu thật, không ước lượng).
function getYearlyTrendData(){
  const year = new Date().getFullYear();
  const result = [];
  for(let m = 0; m < 12; m++){
    const monthKey = `${year}-${String(m + 1).padStart(2,'0')}`;
    const monthTx = appData.transactions.filter(t => t.date.startsWith(monthKey));
    const income = monthTx.filter(t => t.type === 'income').reduce((s,t) => s + t.amount, 0);
    const expense = monthTx.filter(t => t.type === 'expense').reduce((s,t) => s + t.amount, 0);
    result.push({ month: monthKeyToLabel(monthKey), monthKey, income, expense });
  }
  return result;
}

// Nhóm giao dịch theo từng ngày trong tuần hiện tại (Thứ 2 -> Chủ nhật, tính theo thời gian thực tại của hệ thống).
function getWeeklyTrendData(){
  const now = new Date();
  const dow = now.getDay(); // 0 = Chủ nhật ... 6 = Thứ 7
  const diffToMonday = (dow === 0 ? -6 : 1 - dow);
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + diffToMonday);
  const dayLabels = ['T2','T3','T4','T5','T6','T7','CN'];

  return dayLabels.map((label, i) => {
    const d = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i);
    const dateKey = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    const dayTx = appData.transactions.filter(t => t.date === dateKey);
    const income = dayTx.filter(t => t.type === 'income').reduce((s,t) => s + t.amount, 0);
    const expense = dayTx.filter(t => t.type === 'expense').reduce((s,t) => s + t.amount, 0);
    return { day: label, dateKey, income, expense };
  });
}

function renderTrendChart(){
  const holder = document.getElementById('trendChart');
  if(!holder) return;

  let labels, incomeData, expenseData;
  if(currentAnalyticsRange === 'week'){
    // "Tuần này": dùng đúng dữ liệu giao dịch thực tế theo từng ngày, không ước lượng bằng hệ số.
    const weekData = getWeeklyTrendData();
    labels = weekData.map(d => d.day);
    incomeData = weekData.map(d => d.income);
    expenseData = weekData.map(d => d.expense);
  } else if(currentAnalyticsRange === 'month'){
    // "Tháng này": dữ liệu thật theo từng ngày trong tháng hiện tại, không ước lượng bằng hệ số.
    const monthData = getMonthlyDailyTrendData();
    labels = monthData.map(d => d.day);
    incomeData = monthData.map(d => d.income);
    expenseData = monthData.map(d => d.expense);
  } else {
    // "Năm nay": dữ liệu thật theo 12 tháng của năm hiện tại, không ước lượng bằng hệ số.
    const yearData = getYearlyTrendData();
    labels = yearData.map(d => d.month);
    incomeData = yearData.map(d => d.income);
    expenseData = yearData.map(d => d.expense);
  }

  const W = 620, H = 300;
  const padL = 46, padR = 14, padT = 14, padB = 46;
  const plotW = W - padL - padR, plotH = H - padT - padB;

  const maxVal = Math.max(1, ...incomeData, ...expenseData);
  // Chọn bước lưới "đẹp" (làm tròn lên theo bậc 10) để trục Y dễ đọc
  const niceMax = (() => {
    const magnitude = Math.pow(10, Math.floor(Math.log10(maxVal || 1)));
    const steps = [1, 2, 2.5, 5, 10];
    for(const s of steps){ if(maxVal <= s * magnitude) return s * magnitude; }
    return 10 * magnitude;
  })();
  const gridLines = 4;
  const xStep = plotW / (labels.length - 1 || 1);
  const yFor = (v) => padT + plotH - (v / niceMax) * plotH;
  const xFor = (i) => padL + i * xStep;

  const pathFor = (data) => data.map((v,i) => `${i===0?'M':'L'} ${xFor(i).toFixed(1)} ${yFor(v).toFixed(1)}`).join(' ');
  const areaFor = (data) => `${pathFor(data)} L ${xFor(data.length-1).toFixed(1)} ${yFor(0).toFixed(1)} L ${xFor(0).toFixed(1)} ${yFor(0).toFixed(1)} Z`;

  const gridSvg = Array.from({length: gridLines+1}, (_,i) => {
    const val = niceMax * i / gridLines;
    const y = yFor(val);
    return `
      <line x1="${padL}" y1="${y.toFixed(1)}" x2="${W-padR}" y2="${y.toFixed(1)}" stroke="var(--border-soft)" stroke-width="1"/>
      <text x="${padL - 8}" y="${(y+4).toFixed(1)}" text-anchor="end" font-family="Inter, sans-serif" font-size="10.5" fill="var(--text-muted)">${(val/1000000).toFixed(0)}tr</text>`;
  }).join('');

  // Khi có nhiều điểm (VD: hiển thị theo ngày trong tháng, tới 31 điểm), giãn bớt nhãn trục X để tránh chữ chồng lên nhau,
  // nhưng vẫn giữ đủ tất cả điểm dữ liệu trên đường biểu đồ.
  const labelStep = Math.max(1, Math.ceil(labels.length / 10));
  const xLabelsSvg = labels.map((l,i) => {
    if(i % labelStep !== 0 && i !== labels.length - 1) return '';
    return `<text x="${xFor(i).toFixed(1)}" y="${H-14}" text-anchor="middle" font-family="Inter, sans-serif" font-size="11" fill="var(--text-muted)">${l}</text>`;
  }).join('');

  const seriesSvg = (data, color, name) => `
    <path d="${areaFor(data)}" fill="${color}" fill-opacity="0.13" stroke="none"></path>
    <path d="${pathFor(data)}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"></path>
    ${data.map((v,i) => `<circle class="trend-pt" cx="${xFor(i).toFixed(1)}" cy="${yFor(v).toFixed(1)}" r="4" fill="${color}" stroke="var(--bg-card)" stroke-width="2"><title>${name} — ${labels[i]}: ${formatCurrency(v)}</title></circle>`).join('')}
  `;

  holder.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet">
      ${gridSvg}
      ${xLabelsSvg}
      ${seriesSvg(incomeData, '#689D4B', 'Thu nhập')}
      ${seriesSvg(expenseData, '#D96868', 'Chi tiêu')}
    </svg>
    <div class="svg-legend">
      <span><span class="dot" style="background:#689D4B"></span>Thu nhập</span>
      <span><span class="dot" style="background:#D96868"></span>Chi tiêu</span>
    </div>`;
}

function renderBarChart(){
  const holder = document.getElementById('barChart');
  if(!holder) return;
  // Nhóm dữ liệu giao dịch theo tháng, lấy 6 tháng gần nhất tính từ thời điểm hiện tại (new Date())
  const barData = getMonthlyTrendData(6);
  const labels = barData.map(d => d.month);
  const expenseData = barData.map(d => d.expense);

  const W = 560, H = 260;
  const padL = 44, padR = 10, padT = 10, padB = 30;
  const plotW = W - padL - padR, plotH = H - padT - padB;

  const maxVal = Math.max(1, ...expenseData);
  const niceMax = (() => {
    const magnitude = Math.pow(10, Math.floor(Math.log10(maxVal || 1)));
    const steps = [1, 2, 2.5, 5, 10];
    for(const s of steps){ if(maxVal <= s * magnitude) return s * magnitude; }
    return 10 * magnitude;
  })();
  const gridLines = 3;
  const slot = plotW / expenseData.length;
  const barW = Math.min(34, slot * 0.5);
  const yFor = (v) => padT + plotH - (v / niceMax) * plotH;

  const gridSvg = Array.from({length: gridLines+1}, (_,i) => {
    const val = niceMax * i / gridLines;
    const y = yFor(val);
    return `
      <line x1="${padL}" y1="${y.toFixed(1)}" x2="${W-padR}" y2="${y.toFixed(1)}" stroke="var(--border-soft)" stroke-width="1"/>
      <text x="${padL - 8}" y="${(y+4).toFixed(1)}" text-anchor="end" font-family="Inter, sans-serif" font-size="10.5" fill="var(--text-muted)">${(val/1000000).toFixed(0)}tr</text>`;
  }).join('');

  const barsSvg = expenseData.map((v,i) => {
    const cx = padL + slot * i + slot/2;
    const y = yFor(v);
    const h = Math.max(0, (padT + plotH) - y);
    const r = Math.min(6, barW/2);
    return `
      <rect class="bar-rect" x="${(cx - barW/2).toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" rx="${r}" ry="${r}" fill="#D96868">
        <title>${labels[i]}: ${formatCurrency(v)}</title>
      </rect>
      <text x="${cx.toFixed(1)}" y="${H-10}" text-anchor="middle" font-family="Inter, sans-serif" font-size="11" fill="var(--text-muted)">${labels[i]}</text>`;
  }).join('');

  holder.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet">
      ${gridSvg}
      ${barsSvg}
    </svg>`;
}

function renderTopSpend(){
  const list = document.getElementById('topSpendList');
  if(!list) return;
  const monthKey = currentMonthKey();
  const totals = {};
  appData.transactions
    .filter(t => t.type === 'expense' && t.date.startsWith(monthKey))
    .forEach(t => { totals[t.category] = (totals[t.category] || 0) + t.amount; });

  const sorted = Object.entries(totals).sort((a,b) => b[1]-a[1]).slice(0,3);
  const max = sorted[0]?.[1] || 1;

  if(sorted.length === 0){
    list.innerHTML = `<div style="color:var(--text-muted);font-size:0.87rem;">Chưa có chi tiêu trong tháng.</div>`;
    return;
  }

  list.innerHTML = sorted.map(([id, amount], i) => {
    const cat = findCat(id);
    return `
      <div class="top-spend-row">
        <div class="rank-badge ${i === 0 ? 'r1' : ''}">${i+1}</div>
        <div class="top-spend-info">
          <div class="name">${cat.label}</div>
          <div class="bar-track"><div class="bar-fill" style="width:${Math.round((amount/max)*100)}%;background:${cat.color}"></div></div>
        </div>
        <div class="top-spend-amt">${formatCurrency(amount)}</div>
      </div>
    `;
  }).join('');
}

/* =====================================================
   RENDER: TỔNG KẾT THU CHI THEO THÁNG (mục Phân tích chuyên sâu)
===================================================== */
function renderMonthlySummary(){
  const tbody = document.getElementById('monthlySummaryBody');
  if(!tbody) return;

  const rangeSelect = document.getElementById('monthlySummaryRange');
  const monthCount = parseInt(rangeSelect?.value || '12', 10);
  // getMonthlyTrendData trả về từ cũ -> mới; đảo lại để tháng gần nhất hiển thị lên đầu bảng.
  const data = [...getMonthlyTrendData(monthCount)].reverse();

  if(data.every(d => d.income === 0 && d.expense === 0)){
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--text-muted);padding:24px 0;">Chưa có giao dịch nào trong khoảng thời gian này.</td></tr>`;
    return;
  }

  tbody.innerHTML = data.map(d => {
    const net = d.income - d.expense;
    const netClass = net >= 0 ? 'income' : 'expense';
    const netSign = net > 0 ? '+' : (net < 0 ? '−' : '');
    return `
      <tr class="month-detail-row" onclick="openMonthDetailModal('${d.monthKey}')" title="Xem chi tiết ${monthKeyToFullLabel(d.monthKey)}">
        <td>${monthKeyToFullLabel(d.monthKey)}</td>
        <td class="tx-amount income">${formatCurrency(d.income)}</td>
        <td class="tx-amount expense">${formatCurrency(d.expense)}</td>
        <td class="tx-amount ${netClass}" style="font-weight:800;">${netSign} ${formatCurrency(Math.abs(net))}</td>
        <td><button type="button" class="icon-btn" title="Xem chi tiết" onclick="event.stopPropagation();openMonthDetailModal('${d.monthKey}')"><i class="fa-solid fa-chevron-right"></i></button></td>
      </tr>`;
  }).join('');
}

/* =====================================================
   MODAL: CHI TIẾT CHI TIÊU 1 THÁNG CỤ THỂ
   (mở từ bảng "Tổng kết thu chi theo tháng" ở mục Phân tích chuyên sâu)
===================================================== */
function openMonthDetailModal(monthKey){
  renderMonthDetailModal(monthKey);
  document.getElementById('monthDetailModalOverlay').classList.remove('hidden');
}
function closeMonthDetailModal(){
  document.getElementById('monthDetailModalOverlay').classList.add('hidden');
}

function renderMonthDetailModal(monthKey){
  const monthTx = appData.transactions
    .filter(t => t.date.startsWith(monthKey))
    .sort((a,b) => new Date(b.date) - new Date(a.date));

  const income = monthTx.filter(t => t.type === 'income').reduce((s,t) => s + t.amount, 0);
  const expense = monthTx.filter(t => t.type === 'expense').reduce((s,t) => s + t.amount, 0);
  const net = income - expense;

  // Tiêu đề & thống kê tổng quan của tháng
  document.getElementById('monthDetailModalTitle').textContent = `Chi tiết ${monthKeyToFullLabel(monthKey)}`;
  document.getElementById('monthDetailIncome').textContent = formatCurrency(income);
  document.getElementById('monthDetailExpense').textContent = formatCurrency(expense);
  const netEl = document.getElementById('monthDetailNet');
  netEl.textContent = `${net > 0 ? '+' : (net < 0 ? '−' : '')} ${formatCurrency(Math.abs(net))}`;
  netEl.style.color = net >= 0 ? 'var(--color-income)' : 'var(--color-expense)';

  // Chi tiêu theo danh mục trong tháng, sắp xếp giảm dần theo số tiền
  const catList = document.getElementById('monthDetailCategoryList');
  const totalsByCat = {};
  monthTx.filter(t => t.type === 'expense').forEach(t => {
    totalsByCat[t.category] = (totalsByCat[t.category] || 0) + t.amount;
  });
  const sortedCats = Object.entries(totalsByCat).sort((a,b) => b[1]-a[1]);
  const maxCatAmount = sortedCats[0]?.[1] || 1;

  if(sortedCats.length === 0){
    catList.innerHTML = `<div class="empty-note">Không có khoản chi tiêu nào trong tháng này.</div>`;
  } else {
    catList.innerHTML = sortedCats.map(([id, amount]) => {
      const cat = findCat(id);
      const pct = expense > 0 ? Math.round((amount/expense)*100) : 0;
      return `
        <div class="top-spend-row">
          <span class="tx-cat-icon" style="background:${cat.color}22;color:${cat.color}"><i class="fa-solid ${cat.icon}"></i></span>
          <div class="top-spend-info">
            <div class="name">${cat.label} <span style="color:var(--text-muted);font-weight:500;">· ${pct}%</span></div>
            <div class="bar-track"><div class="bar-fill" style="width:${Math.round((amount/maxCatAmount)*100)}%;background:${cat.color}"></div></div>
          </div>
          <div class="top-spend-amt">${formatCurrency(amount)}</div>
        </div>`;
    }).join('');
  }

  // Danh sách toàn bộ giao dịch (thu + chi) phát sinh trong tháng
  document.getElementById('monthDetailTxCount').textContent = monthTx.length;
  const txBody = document.getElementById('monthDetailTxBody');
  if(monthTx.length === 0){
    txBody.innerHTML = `<tr><td colspan="4" style="text-align:center;color:var(--text-muted);padding:20px 0;">Không có giao dịch nào trong tháng này.</td></tr>`;
    return;
  }
  txBody.innerHTML = monthTx.map(t => {
    const cat = findCat(t.category);
    const wallet = findWallet(t.walletId);
    const sign = t.type === 'income' ? '+' : '−';
    return `
      <tr>
        <td>
          <div class="tx-name-cell">
            <span class="tx-cat-icon" style="background:${cat.color}22;color:${cat.color}"><i class="fa-solid ${cat.icon}"></i></span>
            <div>
              <div>${cat.label}</div>
              <div class="tx-note">${t.note ? t.note + ' · ' : ''}${wallet ? wallet.name : ''}</div>
            </div>
          </div>
        </td>
        <td><span class="type-pill ${t.type}">${t.type === 'income' ? 'Thu' : 'Chi'}</span></td>
        <td class="tx-date">${formatDate(t.date)}</td>
        <td class="tx-amount ${t.type}">${sign} ${formatCurrency(t.amount)}</td>
      </tr>`;
  }).join('');
}
document.getElementById('monthDetailModalOverlay').addEventListener('click', (e) => { if(e.target.id === 'monthDetailModalOverlay') closeMonthDetailModal(); });

/* =====================================================
   RENDER: RECURRING
===================================================== */
function renderRecurring(){
  const list = document.getElementById('recurringList');
  if(!list) return;

  if(appData.recurring.length === 0){
    list.innerHTML = `<div style="color:var(--text-muted);font-size:0.87rem;">Chưa có khoản định kỳ nào. Nhấn "Thêm khoản định kỳ" để bắt đầu theo dõi các hóa đơn lặp lại hàng tháng.</div>`;
  } else {
    list.innerHTML = appData.recurring.map(r => `
      <div class="recurring-row">
        <div class="rec-icon" style="background:${r.status === 'due' ? 'var(--color-expense-soft)' : 'var(--color-income-soft)'};color:${r.status === 'due' ? 'var(--color-expense)' : 'var(--color-income)'}"><i class="fa-solid ${r.icon}"></i></div>
        <div class="rec-info"><div class="rname">${r.name}</div><div class="rmeta">${r.dueDate}</div></div>
        <span class="rec-status ${r.status}">${r.status === 'due' ? 'Sắp đến hạn' : 'Đã thanh toán'}</span>
        <div class="rec-amount">${formatCurrency(r.amount)}</div>
        <label class="switch" title="Tự động thanh toán">
          <input type="checkbox" ${r.auto ? 'checked' : ''} onchange="toggleRecurringAuto('${r.id}', this.checked)">
          <span class="slider"></span>
        </label>
        <div class="rec-actions">
          <button class="icon-btn" title="Sửa khoản định kỳ" onclick="openRecurringModal('${r.id}')"><i class="fa-solid fa-pen"></i></button>
          <button class="icon-btn danger" title="Xóa khoản định kỳ" onclick="deleteRecurring('${r.id}')"><i class="fa-solid fa-trash"></i></button>
        </div>
      </div>
    `).join('');
  }

  const dueCount = appData.recurring.filter(r => r.status === 'due').length;
  const badge = document.getElementById('recurringBadge');
  badge.textContent = dueCount;
  badge.classList.toggle('hidden', dueCount === 0);
}

async function toggleRecurringAuto(id, checked){
  const item = appData.recurring.find(r => r.id === id);
  if(!item) return;
  await withLoading(() => Data.updateRecurring(id, { auto: checked }), 'Đang cập nhật...');
  showToast(`Đã ${checked ? 'bật' : 'tắt'} tự động thanh toán cho ${item.name}.`);
}

/* =====================================================
   MODAL: THÊM / SỬA GIAO DỊCH ĐỊNH KỲ
===================================================== */
let editingRecurringId = null;

function populateRecurringDayOptions(){
  const select = document.getElementById('recurringInputDay');
  select.innerHTML = Array.from({length:28}, (_,i) => i+1)
    .map(d => `<option value="${d}">Ngày ${String(d).padStart(2,'0')}</option>`).join('');
}
function setRecurringStatus(status){
  document.getElementById('recurringInputStatus').value = status;
  document.getElementById('btnRecStatusDue').classList.toggle('active', status === 'due');
  document.getElementById('btnRecStatusPaid').classList.toggle('active', status === 'paid');
}
function openRecurringModal(id){
  editingRecurringId = id || null;
  const isEdit = !!editingRecurringId;
  const item = isEdit ? appData.recurring.find(r => r.id === editingRecurringId) : null;

  document.getElementById('recurringModalTitle').textContent = isEdit ? 'Sửa khoản định kỳ' : 'Thêm khoản định kỳ';
  populateRecurringDayOptions();

  document.getElementById('recurringInputName').value = item ? item.name : '';
  document.getElementById('recurringInputAmount').value = item ? item.amount : '';
  document.getElementById('recurringInputAuto').checked = item ? item.auto : false;
  setRecurringStatus(item ? item.status : 'due');

  const dayMatch = item ? item.dueDate.match(/\d+/) : null;
  document.getElementById('recurringInputDay').value = dayMatch ? String(parseInt(dayMatch[0], 10)) : '1';

  const icon = item ? item.icon : 'fa-receipt';
  document.getElementById('recurringInputIcon').value = icon;
  renderIconPicker('recurringIconPicker', 'recurringInputIcon', icon);

  document.getElementById('recurringModalOverlay').classList.remove('hidden');
}
function closeRecurringModal(){ document.getElementById('recurringModalOverlay').classList.add('hidden'); }

async function handleSaveRecurring(e){
  e.preventDefault();
  const name = document.getElementById('recurringInputName').value.trim();
  const amount = parseFloat(document.getElementById('recurringInputAmount').value);
  const day = parseInt(document.getElementById('recurringInputDay').value, 10);
  const status = document.getElementById('recurringInputStatus').value;
  const icon = document.getElementById('recurringInputIcon').value || 'fa-receipt';
  const auto = document.getElementById('recurringInputAuto').checked;

  if(!name){ showToast('Vui lòng nhập tên khoản định kỳ.', 'error'); return; }
  if(!amount || amount <= 0){ showToast('Vui lòng nhập số tiền hợp lệ.', 'error'); return; }

  const dueDate = `Ngày ${String(day).padStart(2,'0')} hàng tháng`;
  const wasEdit = !!editingRecurringId;

  if(wasEdit){
    await withLoading(() => Data.updateRecurring(editingRecurringId, { name, amount, dueDate, status, icon, auto }), 'Đang lưu...');
  } else {
    await withLoading(() => Data.addRecurring({ name, amount, dueDate, status, icon, auto }), 'Đang lưu...');
  }

  closeRecurringModal();
  renderRecurring();
  showToast(wasEdit ? 'Đã cập nhật khoản định kỳ.' : 'Đã thêm khoản định kỳ mới.');
}

async function deleteRecurring(id){
  if(!confirm('Bạn có chắc chắn muốn xóa khoản định kỳ này?')) return;
  await withLoading(() => Data.removeRecurring(id), 'Đang xóa...');
  renderRecurring();
  showToast('Đã xóa khoản định kỳ.');
}

document.getElementById('recurringModalOverlay').addEventListener('click', (e) => { if(e.target.id === 'recurringModalOverlay') closeRecurringModal(); });

/* =====================================================
   MODAL: ADD TRANSACTION
===================================================== */
function populateCategoryOptions(){
  const select = document.getElementById('inputCategory');
  select.innerHTML = CATS[currentTxType].map(c => `<option value="${c.id}">${c.label}</option>`).join('');
}
function setTxType(type){
  currentTxType = type;
  document.getElementById('btnTypeExpense').classList.toggle('active', type === 'expense');
  document.getElementById('btnTypeIncome').classList.toggle('active', type === 'income');
  populateCategoryOptions();
}
function openModal(){
  setTxType('expense');
  document.getElementById('inputAmount').value = '';
  document.getElementById('inputNote').value = '';
  document.getElementById('inputDate').value = new Date().toISOString().slice(0,10);
  renderWallets();
  resetAttachments();
  document.getElementById('modalOverlay').classList.remove('hidden');
}
function closeModal(){ document.getElementById('modalOverlay').classList.add('hidden'); resetAttachments(); }

async function handleAddTransaction(e){
  e.preventDefault();
  const amount = parseFloat(document.getElementById('inputAmount').value);
  const category = document.getElementById('inputCategory').value;
  const date = document.getElementById('inputDate').value;
  const note = document.getElementById('inputNote').value.trim();
  const walletId = document.getElementById('inputWallet').value;

  if(!amount || amount <= 0){ showToast('Vui lòng nhập số tiền hợp lệ.', 'error'); return; }

  // Firestore: ghi giao dịch + cập nhật số dư ví trong cùng một batch.
  await withLoading(() => Data.addTransaction({
    type: currentTxType, category, amount, date, note, walletId,
    attachments: [...currentAttachments],
  }), 'Đang lưu giao dịch...');

  closeModal();
  switchView('dashboard');
  showToast('Đã thêm giao dịch mới thành công!');
}

document.getElementById('modalOverlay').addEventListener('click', (e) => { if(e.target.id === 'modalOverlay') closeModal(); });

/* =====================================================
   ẢNH MINH CHỨNG (tối đa 5 ảnh mỗi giao dịch)
===================================================== */
function resetAttachments(){
  currentAttachments = [];
  const fileInput = document.getElementById('inputAttachments');
  if(fileInput) fileInput.value = '';
  renderAttachPreview();
}

function renderAttachPreview(){
  const grid = document.getElementById('attachPreviewGrid');
  const desc = document.getElementById('attachDropDesc');
  if(!grid) return;
  grid.innerHTML = currentAttachments.map((src, idx) => `
    <div class="attach-thumb">
      <img src="${src}" onclick="previewAttachmentAt(${idx})" alt="Ảnh minh chứng ${idx+1}">
      <button type="button" class="rm-btn" title="Xóa ảnh" onclick="removeAttachment(${idx})"><i class="fa-solid fa-xmark"></i></button>
    </div>`).join('');
  if(desc){
    desc.textContent = currentAttachments.length >= MAX_ATTACHMENTS
      ? `Đã đạt tối đa ${MAX_ATTACHMENTS} ảnh`
      : `Nhấn để chọn ảnh hoá đơn / biên lai (${currentAttachments.length}/${MAX_ATTACHMENTS})`;
  }
}

function handleAttachmentSelect(e){
  const files = Array.from(e.target.files || []);
  if(files.length === 0) return;

  const remaining = MAX_ATTACHMENTS - currentAttachments.length;
  if(remaining <= 0){
    showToast(`Bạn chỉ có thể đính kèm tối đa ${MAX_ATTACHMENTS} ảnh.`, 'error');
    e.target.value = '';
    return;
  }

  const filesToUse = files.slice(0, remaining);
  if(files.length > remaining){
    showToast(`Chỉ thêm được ${remaining} ảnh nữa (tối đa ${MAX_ATTACHMENTS} ảnh/giao dịch).`, 'error');
  }

  let loaded = 0;
  filesToUse.forEach(file => {
    if(!file.type.startsWith('image/')) { loaded++; return; }
    // Nén ảnh trước khi lưu để không vượt giới hạn 1MB/document của Firestore.
    compressImage(file)
      .then(dataUrl => {
        currentAttachments.push(dataUrl);
        renderAttachPreview();
      })
      .catch(() => { showToast('Không thể đọc một trong các ảnh đã chọn.', 'error'); });
  });

  e.target.value = ''; // cho phép chọn lại cùng file nếu cần
}

function removeAttachment(idx){
  currentAttachments.splice(idx, 1);
  renderAttachPreview();
}

function previewAttachmentAt(idx){
  lightboxImages = currentAttachments;
  lightboxIndex = idx;
  showLightbox();
}

/* =====================================================
   BỔ SUNG ẢNH MINH CHỨNG CHO GIAO DỊCH ĐÃ TẠO TRƯỚC ĐÓ
===================================================== */
function openTxAttachModal(txId){
  const tx = appData.transactions.find(t => t.id === txId);
  if(!tx) return;

  editingAttachTxId = txId;
  editingAttachImages = [...(tx.attachments || [])];

  const cat = findCat(tx.category);
  const sign = tx.type === 'income' ? '+' : '−';
  document.getElementById('txAttachModalSub').textContent =
    `${cat.label} · ${formatDate(tx.date)} · ${sign} ${formatCurrency(tx.amount)}${tx.note ? ' · ' + tx.note : ''}`;

  document.getElementById('txAttachInput').value = '';
  renderTxAttachPreview();
  document.getElementById('txAttachModalOverlay').classList.remove('hidden');
}
function closeTxAttachModal(){
  document.getElementById('txAttachModalOverlay').classList.add('hidden');
  editingAttachTxId = null;
  editingAttachImages = [];
}

function renderTxAttachPreview(){
  const grid = document.getElementById('txAttachPreviewGrid');
  const desc = document.getElementById('txAttachDropDesc');
  if(!grid) return;
  grid.innerHTML = editingAttachImages.map((src, idx) => `
    <div class="attach-thumb">
      <img src="${src}" onclick="previewTxAttachmentAt(${idx})" alt="Ảnh minh chứng ${idx+1}">
      <button type="button" class="rm-btn" title="Xóa ảnh" onclick="removeTxAttachment(${idx})"><i class="fa-solid fa-xmark"></i></button>
    </div>`).join('');
  if(desc){
    desc.textContent = editingAttachImages.length >= MAX_ATTACHMENTS
      ? `Đã đạt tối đa ${MAX_ATTACHMENTS} ảnh`
      : `Nhấn để chọn ảnh hoá đơn / biên lai (${editingAttachImages.length}/${MAX_ATTACHMENTS})`;
  }
}

function handleTxAttachSelect(e){
  const files = Array.from(e.target.files || []);
  if(files.length === 0) return;

  const remaining = MAX_ATTACHMENTS - editingAttachImages.length;
  if(remaining <= 0){
    showToast(`Bạn chỉ có thể đính kèm tối đa ${MAX_ATTACHMENTS} ảnh.`, 'error');
    e.target.value = '';
    return;
  }

  const filesToUse = files.slice(0, remaining);
  if(files.length > remaining){
    showToast(`Chỉ thêm được ${remaining} ảnh nữa (tối đa ${MAX_ATTACHMENTS} ảnh/giao dịch).`, 'error');
  }

  filesToUse.forEach(file => {
    if(!file.type.startsWith('image/')) return;
    // Nén ảnh trước khi lưu để không vượt giới hạn 1MB/document của Firestore.
    compressImage(file)
      .then(dataUrl => {
        editingAttachImages.push(dataUrl);
        renderTxAttachPreview();
      })
      .catch(() => { showToast('Không thể đọc một trong các ảnh đã chọn.', 'error'); });
  });

  e.target.value = '';
}

function removeTxAttachment(idx){
  editingAttachImages.splice(idx, 1);
  renderTxAttachPreview();
}

function previewTxAttachmentAt(idx){
  lightboxImages = editingAttachImages;
  lightboxIndex = idx;
  showLightbox();
}

async function saveTxAttachments(){
  const tx = appData.transactions.find(t => t.id === editingAttachTxId);
  if(!tx) return;
  const images = [...editingAttachImages];
  await withLoading(() => Data.updateTransaction(tx.id, { attachments: images }), 'Đang lưu ảnh minh chứng...');
  closeTxAttachModal();
  renderCore();
  showToast('Đã cập nhật ảnh minh chứng cho giao dịch.');
}

document.getElementById('txAttachModalOverlay').addEventListener('click', (e) => { if(e.target.id === 'txAttachModalOverlay') closeTxAttachModal(); });

/* =====================================================
   LIGHTBOX: XEM ẢNH MINH CHỨNG CỦA GIAO DỊCH ĐÃ LƯU
===================================================== */
function openLightbox(txId){
  const tx = appData.transactions.find(t => t.id === txId);
  if(!tx || !tx.attachments || tx.attachments.length === 0) return;
  lightboxImages = tx.attachments;
  lightboxIndex = 0;
  showLightbox();
}
function showLightbox(){
  if(lightboxImages.length === 0) return;
  document.getElementById('lightboxImg').src = lightboxImages[lightboxIndex];
  document.getElementById('lightboxCount').textContent = `${lightboxIndex + 1} / ${lightboxImages.length}`;
  document.getElementById('lightboxOverlay').classList.remove('hidden');
}
function closeLightbox(){ document.getElementById('lightboxOverlay').classList.add('hidden'); }
function lightboxPrev(){ lightboxIndex = (lightboxIndex - 1 + lightboxImages.length) % lightboxImages.length; showLightbox(); }
function lightboxNext(){ lightboxIndex = (lightboxIndex + 1) % lightboxImages.length; showLightbox(); }
function handleLightboxOverlayClick(e){ if(e.target.id === 'lightboxOverlay') closeLightbox(); }

/* =====================================================
   DARK MODE
===================================================== */
function toggleDarkMode(isDarkOn){
  document.body.classList.toggle('dark-theme', isDarkOn);
  document.getElementById('darkModeToggleSide').checked = isDarkOn;
  document.getElementById('darkModeToggleSettings').checked = isDarkOn;

  // Ghi nhớ lựa chọn giao diện cho lần mở sau (theo từng thiết bị).
  try { localStorage.setItem('theme', isDarkOn ? 'dark' : 'light'); }
  catch(err){ console.warn('[Sổ Chi Tiêu] Không lưu được chế độ giao diện.', err); }

  // Chưa đăng nhập thì chưa có dữ liệu để vẽ lại biểu đồ.
  if(!state.uid) return;

  const dashVisible = !document.getElementById('view-dashboard').classList.contains('hidden');
  const analyticsVisible = !document.getElementById('view-analytics').classList.contains('hidden');
  if(dashVisible) safeRun(renderDonutChart, 'Biểu đồ donut', 'donutChart');
  if(analyticsVisible){
    safeRun(renderTrendChart, 'Biểu đồ xu hướng', 'trendChart');
    safeRun(renderBarChart, 'Biểu đồ cột 6 tháng', 'barChart');
  }
}

/* =====================================================
   XUẤT EXCEL (.xlsx) — có màu sắc & định dạng
   Ghi chú: định dạng màu chỉ tồn tại được trong file Excel thật (.xlsx),
   file .csv thuần văn bản không lưu được màu sắc/kiểu ô, nên hàm này
   dùng thư viện ExcelJS để xuất ra .xlsx thay vì .csv.
===================================================== */
const XLSX_PALETTE = {
  red:      'FFD96868', // chi tiêu / cảnh báo / sắp đến hạn
  gray:     'FFF2F2F2', // nền phụ, băng màu xen kẽ
  lightGreen:'FF91AE6E', // xanh nhạt - phụ trợ
  green:    'FF689D4B', // thu nhập / tiêu đề chính
  white:    'FFFFFFFF',
  textDark: 'FF2E2E2E',
};

function xlFill(argb){ return { type:'pattern', pattern:'solid', fgColor:{argb} }; }
function xlThinBorder(){
  const c = { style:'thin', color:{argb:'FFE2E2E2'} };
  return { top:c, left:c, bottom:c, right:c };
}

// Vẽ 1 banner tiêu đề (merge toàn bộ chiều rộng bảng) cho mỗi sheet.
function xlAddBanner(sheet, title, subtitle, colSpan, fillArgb){
  sheet.mergeCells(1, 1, 1, colSpan);
  const titleCell = sheet.getCell(1, 1);
  titleCell.value = title;
  titleCell.font = { name:'Calibri', size:15, bold:true, color:{argb:XLSX_PALETTE.white} };
  titleCell.alignment = { vertical:'middle', horizontal:'left', indent:1 };
  titleCell.fill = xlFill(fillArgb);
  sheet.getRow(1).height = 28;

  sheet.mergeCells(2, 1, 2, colSpan);
  const subCell = sheet.getCell(2, 1);
  subCell.value = subtitle;
  subCell.font = { name:'Calibri', size:9.5, italic:true, color:{argb:'FF6B6B6B'} };
  subCell.alignment = { vertical:'middle', horizontal:'left', indent:1 };
  sheet.getRow(2).height = 18;
}

// Vẽ dòng tiêu đề cột (header) ngay dưới banner, có nền màu + chữ trắng đậm.
function xlAddHeaderRow(sheet, rowIndex, headers, fillArgb){
  const row = sheet.getRow(rowIndex);
  headers.forEach((h, i) => {
    const cell = row.getCell(i + 1);
    cell.value = h;
    cell.font = { name:'Calibri', size:10.5, bold:true, color:{argb:XLSX_PALETTE.white} };
    cell.fill = xlFill(fillArgb);
    cell.alignment = { vertical:'middle', horizontal:'center', wrapText:true };
    cell.border = xlThinBorder();
  });
  row.height = 22;
  sheet.views = [{ state:'frozen', ySplit: rowIndex }];
}

// Tô băng màu xen kẽ (zebra striping) + viền nhẹ cho toàn bộ vùng dữ liệu.
function xlZebraAndBorder(sheet, startRow, endRow, colCount){
  for(let r = startRow; r <= endRow; r++){
    const isEven = (r - startRow) % 2 === 1;
    for(let c = 1; c <= colCount; c++){
      const cell = sheet.getRow(r).getCell(c);
      if(isEven) cell.fill = xlFill(XLSX_PALETTE.gray);
      cell.border = xlThinBorder();
      if(!cell.alignment) cell.alignment = { vertical:'middle' };
    }
  }
}

// Đặt màu "huy hiệu" (chữ trắng, nền đậm) cho 1 ô theo trạng thái/loại.
function xlBadge(cell, text, fillArgb){
  cell.value = text;
  cell.font = { name:'Calibri', size:10, bold:true, color:{argb:XLSX_PALETTE.white} };
  cell.fill = xlFill(fillArgb);
  cell.alignment = { vertical:'middle', horizontal:'center' };
}

// Tự co giãn độ rộng cột theo nội dung dài nhất (giới hạn min/max cho gọn).
function xlAutoWidth(sheet, colCount, minW = 10, maxW = 42){
  for(let c = 1; c <= colCount; c++){
    let maxLen = minW;
    sheet.eachRow({ includeEmpty:false }, row => {
      const v = row.getCell(c).value;
      const len = v == null ? 0 : String(v).length;
      if(len > maxLen) maxLen = len;
    });
    sheet.getColumn(c).width = Math.min(maxLen + 3, maxW);
  }
}

const CURRENCY_FMT = '#,##0" đ"';

async function exportExcel(){
  if(typeof ExcelJS === 'undefined'){
    showToast('Không thể tải thư viện xuất Excel. Vui lòng kiểm tra kết nối mạng và thử lại.', 'error');
    return;
  }

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Sổ Chi Tiêu';
  workbook.created = new Date();
  const now = new Date();
  const exportedAt = `Xuất ngày: ${now.toLocaleDateString('vi-VN')} lúc ${now.toLocaleTimeString('vi-VN')}`;

  /* ---------- SHEET 1: GIAO DỊCH ---------- */
  const shTx = workbook.addWorksheet('Giao dịch', { tabColor:{argb:XLSX_PALETTE.green} });
  shTx.properties.defaultRowHeight = 20;
  const txHeaders = ['Ngày', 'Loại', 'Danh mục', 'Số tiền (đ)', 'Ví', 'Ghi chú'];
  xlAddBanner(shTx, 'DANH SÁCH GIAO DỊCH', exportedAt, txHeaders.length, XLSX_PALETTE.green);
  xlAddHeaderRow(shTx, 3, txHeaders, XLSX_PALETTE.green);

  let totalIncome = 0, totalExpense = 0;
  appData.transactions.forEach((t, idx) => {
    const r = 4 + idx;
    const isIncome = t.type === 'income';
    if(isIncome) totalIncome += Number(t.amount) || 0; else totalExpense += Number(t.amount) || 0;
    shTx.getCell(r, 1).value = t.date;
    xlBadge(shTx.getCell(r, 2), isIncome ? 'Thu' : 'Chi', isIncome ? XLSX_PALETTE.lightGreen : XLSX_PALETTE.red);
    shTx.getCell(r, 3).value = findCat(t.category).label;
    const amtCell = shTx.getCell(r, 4);
    amtCell.value = Number(t.amount) || 0;
    amtCell.numFmt = CURRENCY_FMT;
    amtCell.font = { color:{argb: isIncome ? XLSX_PALETTE.green : XLSX_PALETTE.red}, bold:true };
    amtCell.alignment = { horizontal:'right' };
    shTx.getCell(r, 5).value = findWallet(t.walletId)?.name || '';
    shTx.getCell(r, 6).value = t.note || '';
  });
  const txLastRow = 3 + appData.transactions.length;
  xlZebraAndBorder(shTx, 4, txLastRow, txHeaders.length);

  const totalRow = txLastRow + 2;
  shTx.mergeCells(totalRow, 1, totalRow, 3);
  const sumLabelCell = shTx.getCell(totalRow, 1);
  sumLabelCell.value = 'TỔNG THU';
  sumLabelCell.font = { bold:true, color:{argb:XLSX_PALETTE.white} };
  sumLabelCell.fill = xlFill(XLSX_PALETTE.lightGreen);
  sumLabelCell.alignment = { vertical:'middle', horizontal:'center' };
  const incCell = shTx.getCell(totalRow, 4);
  incCell.value = totalIncome; incCell.numFmt = CURRENCY_FMT;
  incCell.font = { bold:true, color:{argb:XLSX_PALETTE.green} };
  incCell.alignment = { horizontal:'right' };

  const totalRow2 = totalRow + 1;
  shTx.mergeCells(totalRow2, 1, totalRow2, 3);
  const sumLabelCell2 = shTx.getCell(totalRow2, 1);
  sumLabelCell2.value = 'TỔNG CHI';
  sumLabelCell2.font = { bold:true, color:{argb:XLSX_PALETTE.white} };
  sumLabelCell2.fill = xlFill(XLSX_PALETTE.red);
  sumLabelCell2.alignment = { vertical:'middle', horizontal:'center' };
  const expCell = shTx.getCell(totalRow2, 4);
  expCell.value = totalExpense; expCell.numFmt = CURRENCY_FMT;
  expCell.font = { bold:true, color:{argb:XLSX_PALETTE.red} };
  expCell.alignment = { horizontal:'right' };

  const totalRow3 = totalRow2 + 1;
  shTx.mergeCells(totalRow3, 1, totalRow3, 3);
  const sumLabelCell3 = shTx.getCell(totalRow3, 1);
  sumLabelCell3.value = 'SỐ DƯ RÒNG';
  sumLabelCell3.font = { bold:true, color:{argb:XLSX_PALETTE.white} };
  sumLabelCell3.fill = xlFill(XLSX_PALETTE.textDark);
  sumLabelCell3.alignment = { vertical:'middle', horizontal:'center' };
  const netCell = shTx.getCell(totalRow3, 4);
  netCell.value = totalIncome - totalExpense; netCell.numFmt = CURRENCY_FMT;
  netCell.font = { bold:true, color:{argb:XLSX_PALETTE.textDark} };
  netCell.alignment = { horizontal:'right' };

  xlAutoWidth(shTx, txHeaders.length);
  shTx.getColumn(6).width = 30;

  /* ---------- SHEET 2: VÍ ---------- */
  const shWallet = workbook.addWorksheet('Ví', { tabColor:{argb:XLSX_PALETTE.lightGreen} });
  const walletHeaders = ['Tên ví', 'Số dư (đ)'];
  xlAddBanner(shWallet, 'SỐ DƯ CÁC VÍ', exportedAt, walletHeaders.length, XLSX_PALETTE.lightGreen);
  xlAddHeaderRow(shWallet, 3, walletHeaders, XLSX_PALETTE.lightGreen);
  appData.wallets.forEach((w, idx) => {
    const r = 4 + idx;
    shWallet.getCell(r, 1).value = w.name;
    const balCell = shWallet.getCell(r, 2);
    balCell.value = Number(w.balance) || 0;
    balCell.numFmt = CURRENCY_FMT;
    balCell.alignment = { horizontal:'right' };
    balCell.font = { bold:true, color:{argb: (w.balance < 0) ? XLSX_PALETTE.red : XLSX_PALETTE.textDark} };
  });
  xlZebraAndBorder(shWallet, 4, 3 + appData.wallets.length, walletHeaders.length);
  xlAutoWidth(shWallet, walletHeaders.length);

  /* ---------- SHEET 3: GIAO DỊCH ĐỊNH KỲ ---------- */
  const shRec = workbook.addWorksheet('Định kỳ', { tabColor:{argb:XLSX_PALETTE.red} });
  const recHeaders = ['Tên', 'Số tiền (đ)', 'Ngày đến hạn', 'Trạng thái', 'Tự động thanh toán'];
  xlAddBanner(shRec, 'GIAO DỊCH ĐỊNH KỲ', exportedAt, recHeaders.length, XLSX_PALETTE.red);
  xlAddHeaderRow(shRec, 3, recHeaders, XLSX_PALETTE.red);
  appData.recurring.forEach((rec, idx) => {
    const r = 4 + idx;
    shRec.getCell(r, 1).value = rec.name;
    const amtCell = shRec.getCell(r, 2);
    amtCell.value = Number(rec.amount) || 0;
    amtCell.numFmt = CURRENCY_FMT;
    amtCell.alignment = { horizontal:'right' };
    shRec.getCell(r, 3).value = rec.dueDate;
    const isDue = rec.status === 'due';
    xlBadge(shRec.getCell(r, 4), isDue ? 'Sắp đến hạn' : 'Đã thanh toán', isDue ? XLSX_PALETTE.red : XLSX_PALETTE.green);
    xlBadge(shRec.getCell(r, 5), rec.auto ? 'Bật' : 'Tắt', rec.auto ? XLSX_PALETTE.lightGreen : 'FFB5B5B5');
  });
  xlZebraAndBorder(shRec, 4, 3 + appData.recurring.length, recHeaders.length);
  xlAutoWidth(shRec, recHeaders.length);

  /* ---------- SHEET 4: CÔNG NỢ ---------- */
  const shDebt = workbook.addWorksheet('Công nợ', { tabColor:{argb:XLSX_PALETTE.green} });
  const debtHeaders = ['Loại', 'Người liên quan', 'Số tiền còn lại (đ)', 'Số tiền gốc (đ)', 'Ngày phát sinh', 'Hạn trả', 'Trạng thái', 'Ngân hàng', 'Số tài khoản', 'Chủ tài khoản', 'Số lần đã trả', 'Ghi chú'];
  xlAddBanner(shDebt, 'CÔNG NỢ', exportedAt, debtHeaders.length, XLSX_PALETTE.green);
  xlAddHeaderRow(shDebt, 3, debtHeaders, XLSX_PALETTE.green);
  appData.debts.forEach((d, idx) => {
    const r = 4 + idx;
    const isOwedToMe = d.type === 'owed_to_me';
    xlBadge(shDebt.getCell(r, 1), isOwedToMe ? 'Người khác nợ tôi' : 'Tôi nợ người khác', isOwedToMe ? XLSX_PALETTE.green : XLSX_PALETTE.red);
    shDebt.getCell(r, 2).value = d.person;
    const remainCell = shDebt.getCell(r, 3);
    remainCell.value = Number(d.amount) || 0; remainCell.numFmt = CURRENCY_FMT; remainCell.alignment = { horizontal:'right' };
    remainCell.font = { bold:true, color:{argb: isOwedToMe ? XLSX_PALETTE.green : XLSX_PALETTE.red} };
    const origCell = shDebt.getCell(r, 4);
    origCell.value = Number(d.originalAmount) || 0; origCell.numFmt = CURRENCY_FMT; origCell.alignment = { horizontal:'right' };
    shDebt.getCell(r, 5).value = d.date;
    shDebt.getCell(r, 6).value = d.dueDate || '';
    const isPaid = d.status === 'paid';
    xlBadge(shDebt.getCell(r, 7), isPaid ? 'Đã tất toán' : 'Chưa trả', isPaid ? XLSX_PALETTE.lightGreen : XLSX_PALETTE.red);
    shDebt.getCell(r, 8).value = d.bankName || '';
    shDebt.getCell(r, 9).value = d.accountNumber || '';
    shDebt.getCell(r, 10).value = d.accountHolder || '';
    shDebt.getCell(r, 11).value = (d.payments || []).length;
    shDebt.getCell(r, 11).alignment = { horizontal:'center' };
    shDebt.getCell(r, 12).value = d.note || '';
  });
  xlZebraAndBorder(shDebt, 4, 3 + appData.debts.length, debtHeaders.length);
  xlAutoWidth(shDebt, debtHeaders.length);

  try{
    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'so-chi-tieu-du-lieu.xlsx';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    showToast('Đang tải xuống dữ liệu... Đã xuất file Excel thành công!');
  }catch(err){
    console.error('Lỗi xuất Excel:', err);
    showToast('Có lỗi xảy ra khi xuất file Excel. Vui lòng thử lại.', 'error');
  }
}


/* =====================================================
   TOAST
===================================================== */
function showToast(msg, type){
  const stack = document.getElementById('toastStack');
  const toast = document.createElement('div');
  toast.className = 'toast';
  const iconClass = type === 'error' ? 'fa-circle-exclamation' : 'fa-circle-check';
  const iconColor = type === 'error' ? 'var(--color-expense)' : 'var(--color-income)';
  toast.innerHTML = `<i class="fa-solid ${iconClass}" style="color:${iconColor}"></i> <span>${msg}</span>`;
  stack.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    toast.style.transition = 'all .25s ease';
    setTimeout(() => toast.remove(), 260);
  }, 4200);
}

/* =====================================================
   ĐỒNG BỘ TRẠNG THÁI PHỤ (thông báo đã đọc / đã ẩn)
   Chạy ngầm, gộp nhiều thay đổi liên tiếp thành 1 lần ghi.
===================================================== */
let metaSyncTimer = null;
function syncMetaSilently(){
  if(!state.uid) return;
  clearTimeout(metaSyncTimer);
  metaSyncTimer = setTimeout(() => {
    Data.saveMeta().catch(err => console.warn('[Sổ Chi Tiêu] Không đồng bộ được trạng thái thông báo.', err));
  }, 600);
}

/* =====================================================
   CẦU NỐI RA WINDOW
   Các nút trong index.html dùng onclick="..." nên cần các
   hàm này tồn tại ở phạm vi toàn cục. ES Module có scope
   riêng, vì vậy ta gắn tường minh (và CHỈ) những hàm cần thiết.
===================================================== */
Object.assign(window, {
  // Điều hướng & giao diện chung
  switchView, switchAuthTab, toggleDarkMode, handleLogout,
  openMobileDrawer, closeMobileDrawer, handleTimezoneChange,
  // Hồ sơ
  openProfileModal, closeProfileModal, handleSaveProfile,
  // Bảo mật / Mật khẩu
  openSecurityModal, closeSecurityModal, handleSecuritySubmit,
  // Giao dịch
  openModal, closeModal, setTxType, handleAddTransaction,
  deleteTransaction, deleteAllTransactions,
  handleAttachmentSelect, removeAttachment, previewAttachmentAt,
  openTxAttachModal, closeTxAttachModal, handleTxAttachSelect,
  removeTxAttachment, previewTxAttachmentAt, saveTxAttachments,
  // Ngân sách
  openBudgetModal, closeBudgetModal, handleSaveBudget, deleteBudget,
  // Danh mục
  openCategoryModal, closeCategoryModal, setCatMgrType, handleSaveCategory,
  editCategory, cancelEditCategory, deleteCategory, selectIcon,
  syncCategoryColorFromPicker, syncCategoryColorFromHex,
  // Ví
  openWalletModal, closeWalletModal, handleSaveWallet, deleteWallet,
  handleTransfer, toggleWalletBankFields, selectWalletGradient,
  openBankQrModal, closeBankQrModal, updateBankQrImage, copyBankQrAccountNumber,
  // Công nợ
  openDebtModal, closeDebtModal, handleSaveDebt, deleteDebt, setDebtType, setDebtTab,
  openSettleDebtModal, closeSettleDebtModal, handleSettleDebt,
  handleSettleAttachSelect, removeSettleAttachment, previewSettleAttachmentAt,
  openDebtHistoryModal, closeDebtHistoryModal, previewDebtHistoryAttachmentAt,
  openDebtPaymentAttachModal, closeDebtPaymentAttachModal, handleDebtPaymentAttachSelect,
  removeDebtPaymentAttachment, previewDebtPaymentAttachmentAt, saveDebtPaymentAttachments,
  copyDebtAccountNumber,
  // Định kỳ
  openRecurringModal, closeRecurringModal, handleSaveRecurring, deleteRecurring,
  setRecurringStatus, toggleRecurringAuto,
  // Phân tích
  setAnalyticsRange, renderMonthlySummary, openMonthDetailModal, closeMonthDetailModal,
  // Thông báo
  setNotifFilter, markNotificationRead, markAllNotificationsRead,
  dismissNotification, clearAllNotifications,
  // Lightbox & tiện ích
  openLightbox, closeLightbox, lightboxPrev, lightboxNext, handleLightboxOverlayClick,
  exportExcel, showToast,
});

/* =====================================================
   GẮN SỰ KIỆN CHO MÀN HÌNH ĐĂNG NHẬP
===================================================== */
function bindAuthUI(){
  document.querySelectorAll('[data-auth-tab]').forEach(btn => {
    btn.addEventListener('click', () => switchAuthTab(btn.dataset.authTab));
  });

  document.getElementById('loginForm').addEventListener('submit', handleLoginSubmit);
  document.getElementById('registerForm').addEventListener('submit', handleRegisterSubmit);
  document.getElementById('forgotForm').addEventListener('submit', handleForgotSubmit);

  document.querySelectorAll('[data-google-signin]').forEach(btn => {
    btn.addEventListener('click', () => handleGoogleSignIn(btn));
  });

  document.getElementById('btnForgotPassword').addEventListener('click', openForgotModal);
  document.getElementById('btnCloseForgot').addEventListener('click', closeForgotModal);
  document.getElementById('forgotModalOverlay').addEventListener('click', (e) => {
    if(e.target.id === 'forgotModalOverlay') closeForgotModal();
  });

  // Nút hiện / ẩn mật khẩu
  document.querySelectorAll('.pw-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const input = document.getElementById(btn.dataset.pwTarget);
      if(!input) return;
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.innerHTML = `<i class="fa-regular ${show ? 'fa-eye-slash' : 'fa-eye'}"></i>`;
    });
  });

  // Đóng mọi modal bằng phím Esc
  document.addEventListener('keydown', (e) => {
    if(e.key !== 'Escape') return;
    document.querySelectorAll('.modal-overlay:not(.hidden)').forEach(m => m.classList.add('hidden'));
    const lightbox = document.getElementById('lightboxOverlay');
    if(lightbox && !lightbox.classList.contains('hidden')) lightbox.classList.add('hidden');
  });
}

/* =====================================================
   KHÔI PHỤC DARK MODE ĐÃ LƯU
===================================================== */
function restoreTheme(){
  let saved = null;
  try { saved = localStorage.getItem('theme'); } catch(err){ /* bỏ qua */ }
  const isDarkOn = saved
    ? saved === 'dark'
    : window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  toggleDarkMode(!!isDarkOn);
  const a = document.getElementById('darkModeToggleSide');
  const b = document.getElementById('darkModeToggleSettings');
  if(a) a.checked = !!isDarkOn;
  if(b) b.checked = !!isDarkOn;
}

/* =====================================================
   VÒNG ĐỜI ỨNG DỤNG
===================================================== */
let appInitialized = false;

async function onUserLoggedIn(user){
  showLoading('Đang tải dữ liệu của bạn...');
  try {
    const { isNewUser } = await Data.loadAllData(user);

    // Nếu vừa đăng ký bằng email, cập nhật tên & tên đăng nhập đã nhập ở form.
    const pending = Auth.consumePendingProfile();
    if(pending) await Data.saveProfile(pending);

    showAppScreen();
    renderUser();
    populateCategoryOptions();
    switchView('dashboard');

    if(isNewUser){
      showToast('Đã tạo sẵn 2 ví mặc định (Tiền mặt & Ngân hàng) với số dư 0đ.');
    } else {
      showToast(`Chào mừng trở lại, ${appData.user.name}!`);
      setTimeout(() => {
        const due = appData.recurring.filter(r => r.status === 'due');
        if(due.length > 0){
          showToast(`Bạn có ${due.length} hóa đơn sắp đến hạn (${due[0].name})!`, 'error');
        }
      }, 900);
    }
  } catch(err){
    console.error('[Sổ Chi Tiêu] Không tải được dữ liệu:', err);
    showToast(firestoreErrorMessage(err), 'error');
    showAuthScreen();
  } finally {
    hideLoading();
  }
}

function onUserLoggedOut(){
  Data.resetState();
  hideLoading();
  showAuthScreen();
}

function initApp(){
  if(appInitialized) return;
  appInitialized = true;

  bindAuthUI();
  restoreTheme();
  populateTimezoneOptions();
  startLiveClock();

  // Firebase quyết định hiển thị màn hình nào.
  Auth.watchAuth(onUserLoggedIn, onUserLoggedOut);

  // Mạng chập chờn khiến Firebase không phản hồi: sau 12 giây vẫn chưa xác định
  // được phiên đăng nhập thì bỏ lớp phủ và hiện màn hình đăng nhập cho người dùng.
  setTimeout(() => {
    const appHidden = document.getElementById('appScreen').classList.contains('hidden');
    const authHidden = document.getElementById('authScreen').classList.contains('hidden');
    if(appHidden && authHidden){
      hideLoading();
      showAuthScreen();
      showToast('Không kết nối được tới máy chủ Firebase. Vui lòng kiểm tra Internet.', 'error');
    }
  }, 12000);
}

if(document.readyState === 'loading'){
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}
