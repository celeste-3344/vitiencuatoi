/* =====================================================
   js/data.js — TẦNG DỮ LIỆU (CLOUD FIRESTORE)
   -----------------------------------------------------
   Toàn bộ thao tác đọc/ghi Firestore được gom vào đây.
   app.js KHÔNG gọi trực tiếp Firestore, chỉ gọi các hàm
   export từ file này.

   CẤU TRÚC DATABASE (an toàn theo từng người dùng):
     users/{uid}                        -> hồ sơ cá nhân
     users/{uid}/wallets/{walletId}     -> ví / nguồn tiền
     users/{uid}/transactions/{txId}    -> giao dịch thu chi
     users/{uid}/budgets/{categoryId}   -> hạn mức ngân sách
     users/{uid}/debts/{debtId}         -> sổ công nợ
     users/{uid}/recurring/{recId}      -> hóa đơn định kỳ
     users/{uid}/meta/categories        -> danh mục thu/chi
     users/{uid}/meta/state             -> nhật ký chuyển ví, thông báo đã đọc/đã ẩn

   QUY TẮC BẢO MẬT FIRESTORE cần dán trong Firebase Console:
     rules_version = '2';
     service cloud.firestore {
       match /databases/{database}/documents {
         match /users/{userId}/{document=**} {
           allow read, write: if request.auth != null && request.auth.uid == userId;
         }
       }
     }
===================================================== */
import { db } from './firebase-config.js';
import {
  collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc,
  writeBatch, query, orderBy,
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';

/* =====================================================
   DỮ LIỆU MẶC ĐỊNH CHO NGƯỜI DÙNG MỚI
===================================================== */
export const DEFAULT_CATEGORIES = {
  expense: [
    { id: 'an-uong',  label: 'Ăn uống', icon: 'fa-utensils',     color: '#D96868' },
    { id: 'di-lai',   label: 'Đi lại',  icon: 'fa-motorcycle',   color: '#E0A85A' },
    { id: 'hoa-don',  label: 'Hóa đơn', icon: 'fa-file-invoice', color: '#7A8FC2' },
    { id: 'giai-tri', label: 'Giải trí', icon: 'fa-film',        color: '#9C7BC9' },
    { id: 'mua-sam',  label: 'Mua sắm', icon: 'fa-bag-shopping', color: '#5FB0B7' },
  ],
  income: [
    { id: 'luong',  label: 'Lương',            icon: 'fa-sack-dollar', color: '#689D4B' },
    { id: 'thuong', label: 'Thưởng/Freelance', icon: 'fa-gift',        color: '#91AE6E' },
  ],
};

// Người dùng mới được tạo sẵn 2 ví mặc định với số dư 0đ.
export const DEFAULT_WALLETS = [
  { id: 'tienmat',  name: 'Tiền mặt',            icon: 'fa-money-bill-wave', balance: 0, gradient: 'linear-gradient(160deg,#689D4B,#4f7c37)', order: 0 },
  { id: 'nganhang', name: 'Tài khoản ngân hàng', icon: 'fa-building-columns', balance: 0, gradient: 'linear-gradient(160deg,#7A8FC2,#556aa3)', order: 1 },
];

/* =====================================================
   STATE CỤC BỘ (bản sao trong bộ nhớ của dữ liệu trên cloud)
   Mọi hàm bên dưới đều cập nhật ĐỒNG THỜI state + Firestore,
   nhờ đó giao diện luôn phản hồi tức thì (optimistic UI).
===================================================== */
export const state = {
  uid: null,
  user: { name: '', username: '', email: '', photoURL: '' },
  categories: { expense: [], income: [] },
  wallets: [],
  transactions: [],
  budgets: [],
  recurring: [],
  debts: [],
  transferLog: [],
  readNotifications: [],
  dismissedNotifications: [],
};

/* =====================================================
   TIỆN ÍCH NỘI BỘ
===================================================== */
function requireUid() {
  if (!state.uid) throw new Error('Chưa đăng nhập — không thể truy cập dữ liệu.');
  return state.uid;
}
function userRef() { return doc(db, 'users', requireUid()); }
function colRef(name) { return collection(db, 'users', requireUid(), name); }
function docRef(name, id) { return doc(db, 'users', requireUid(), name, String(id)); }

// Firestore không chấp nhận giá trị undefined -> loại bỏ trước khi ghi.
function clean(obj) {
  const out = {};
  Object.keys(obj || {}).forEach((k) => {
    const v = obj[k];
    if (v !== undefined) out[k] = v;
  });
  return out;
}

function num(v) { return Number.isFinite(Number(v)) ? Number(v) : 0; }

/* =====================================================
   NẠP TOÀN BỘ DỮ LIỆU CỦA NGƯỜI DÙNG
===================================================== */
export async function loadAllData(firebaseUser) {
  state.uid = firebaseUser.uid;

  const profileSnap = await getDoc(userRef());
  const isNewUser = !profileSnap.exists();

  if (isNewUser) {
    await seedNewUser(firebaseUser);
  } else {
    const p = profileSnap.data() || {};
    state.user = {
      name: p.name || firebaseUser.displayName || (firebaseUser.email || '').split('@')[0] || 'Người dùng',
      username: p.username || makeUsernameFromEmail(firebaseUser.email),
      email: p.email || firebaseUser.email || '',
      photoURL: p.photoURL || firebaseUser.photoURL || '',
    };
  }

  const [walletSnap, txSnap, budgetSnap, recSnap, debtSnap, catSnap, metaSnap] = await Promise.all([
    getDocs(colRef('wallets')),
    getDocs(query(colRef('transactions'), orderBy('date', 'desc'))),
    getDocs(colRef('budgets')),
    getDocs(colRef('recurring')),
    getDocs(colRef('debts')),
    getDoc(doc(db, 'users', state.uid, 'meta', 'categories')),
    getDoc(doc(db, 'users', state.uid, 'meta', 'state')),
  ]);

  state.wallets = walletSnap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => num(a.order) - num(b.order));

  state.transactions = txSnap.docs.map((d) => {
    const t = d.data();
    return {
      id: d.id,
      type: t.type,
      category: t.category,
      amount: num(t.amount),
      date: t.date,
      note: t.note || '',
      walletId: t.walletId || '',
      attachments: Array.isArray(t.attachments) ? t.attachments : [],
      createdAt: num(t.createdAt),
    };
  });

  state.budgets = budgetSnap.docs.map((d) => ({ category: d.id, limit: num(d.data().limit) }));

  state.recurring = recSnap.docs
    .map((d) => ({ id: d.id, ...d.data(), amount: num(d.data().amount) }))
    .sort((a, b) => num(a.createdAt) - num(b.createdAt));

  state.debts = debtSnap.docs
    .map((d) => {
      const x = d.data();
      return {
        id: d.id,
        type: x.type,
        person: x.person || '',
        amount: num(x.amount),
        originalAmount: num(x.originalAmount || x.amount),
        date: x.date || '',
        dueDate: x.dueDate || null,
        note: x.note || '',
        bankBin: x.bankBin || '',
        bankName: x.bankName || '',
        accountNumber: x.accountNumber || '',
        accountHolder: x.accountHolder || '',
        status: x.status || 'unpaid',
        payments: Array.isArray(x.payments) ? x.payments : [],
        createdAt: num(x.createdAt),
      };
    })
    .sort((a, b) => num(a.createdAt) - num(b.createdAt));

  if (catSnap.exists()) {
    const c = catSnap.data();
    // Gán từng thuộc tính (KHÔNG thay thế cả object) vì app.js giữ tham chiếu
    // trực tiếp tới state.categories.
    state.categories.expense = Array.isArray(c.expense) && c.expense.length ? c.expense : DEFAULT_CATEGORIES.expense.slice();
    state.categories.income = Array.isArray(c.income) && c.income.length ? c.income : DEFAULT_CATEGORIES.income.slice();
  } else {
    state.categories.expense = DEFAULT_CATEGORIES.expense.slice();
    state.categories.income = DEFAULT_CATEGORIES.income.slice();
    await saveCategories();
  }

  const meta = metaSnap.exists() ? metaSnap.data() : {};
  state.transferLog = Array.isArray(meta.transferLog) ? meta.transferLog : [];
  state.readNotifications = Array.isArray(meta.readNotifications) ? meta.readNotifications : [];
  state.dismissedNotifications = Array.isArray(meta.dismissedNotifications) ? meta.dismissedNotifications : [];

  return { isNewUser };
}

function makeUsernameFromEmail(email) {
  const base = String(email || 'user').split('@')[0].toLowerCase().replace(/[^a-z0-9.]/g, '');
  return base.length >= 2 ? base : 'user';
}

/* =====================================================
   KHỞI TẠO DỮ LIỆU CHO NGƯỜI DÙNG HOÀN TOÀN MỚI
   (hồ sơ + 2 ví mặc định số dư 0đ + danh mục mặc định)
===================================================== */
export async function seedNewUser(firebaseUser) {
  state.uid = firebaseUser.uid;

  const fallbackName = firebaseUser.displayName
    || (firebaseUser.email || '').split('@')[0]
    || 'Người dùng';

  state.user = {
    name: fallbackName,
    username: makeUsernameFromEmail(firebaseUser.email),
    email: firebaseUser.email || '',
    photoURL: firebaseUser.photoURL || '',
  };

  const batch = writeBatch(db);
  batch.set(userRef(), clean({ ...state.user, createdAt: Date.now() }));

  DEFAULT_WALLETS.forEach((w) => {
    batch.set(docRef('wallets', w.id), clean({
      name: w.name, icon: w.icon, balance: 0, gradient: w.gradient, order: w.order,
    }));
  });

  batch.set(doc(db, 'users', state.uid, 'meta', 'categories'), {
    expense: DEFAULT_CATEGORIES.expense,
    income: DEFAULT_CATEGORIES.income,
  });
  batch.set(doc(db, 'users', state.uid, 'meta', 'state'), {
    transferLog: [], readNotifications: [], dismissedNotifications: [],
  });

  await batch.commit();

  state.wallets = DEFAULT_WALLETS.map((w) => ({ ...w, balance: 0 }));
  state.categories.expense = DEFAULT_CATEGORIES.expense.slice();
  state.categories.income = DEFAULT_CATEGORIES.income.slice();
  state.transactions = [];
  state.budgets = [];
  state.recurring = [];
  state.debts = [];
  state.transferLog = [];
  state.readNotifications = [];
  state.dismissedNotifications = [];
}

/* Xoá sạch state khi đăng xuất (tránh rò rỉ dữ liệu sang tài khoản khác). */
export function resetState() {
  state.uid = null;
  state.user = { name: '', username: '', email: '', photoURL: '' };
  state.categories.expense = [];
  state.categories.income = [];
  state.wallets = [];
  state.transactions = [];
  state.budgets = [];
  state.recurring = [];
  state.debts = [];
  state.transferLog = [];
  state.readNotifications = [];
  state.dismissedNotifications = [];
}

/* =====================================================
   HỒ SƠ CÁ NHÂN
===================================================== */
export async function saveProfile(patch) {
  Object.assign(state.user, patch);
  await setDoc(userRef(), clean(patch), { merge: true });
}

/* =====================================================
   DANH MỤC THU / CHI  (1 document duy nhất: meta/categories)
===================================================== */
export async function saveCategories() {
  await setDoc(doc(db, 'users', requireUid(), 'meta', 'categories'), {
    expense: state.categories.expense,
    income: state.categories.income,
  });
}

/* =====================================================
   META STATE (nhật ký chuyển ví + thông báo đã đọc/đã ẩn)
===================================================== */
export async function saveMeta() {
  await setDoc(doc(db, 'users', requireUid(), 'meta', 'state'), {
    // Chỉ lưu 50 lượt chuyển gần nhất để document không phình to.
    transferLog: state.transferLog.slice(-50),
    readNotifications: state.readNotifications.slice(-300),
    dismissedNotifications: state.dismissedNotifications.slice(-300),
  }, { merge: true });
}

/* =====================================================
   VÍ / NGUỒN TIỀN
===================================================== */
export async function addWallet(wallet) {
  const payload = clean({
    name: wallet.name,
    icon: wallet.icon,
    balance: num(wallet.balance),
    gradient: wallet.gradient,
    bankBin: wallet.bankBin || '',
    bankName: wallet.bankName || '',
    bankAccountNumber: wallet.bankAccountNumber || '',
    bankAccountHolder: wallet.bankAccountHolder || '',
    order: state.wallets.length,
  });
  const ref = await addDoc(colRef('wallets'), payload);
  const created = { id: ref.id, ...payload };
  state.wallets.push(created);
  return created;
}

export async function updateWallet(id, patch) {
  const w = state.wallets.find((x) => x.id === id);
  if (w) Object.assign(w, patch);
  await updateDoc(docRef('wallets', id), clean(patch));
}

export async function removeWallet(id) {
  state.wallets = state.wallets.filter((w) => w.id !== id);
  await deleteDoc(docRef('wallets', id));
}

/* Cộng/trừ số dư ví (dùng chung cho giao dịch, chuyển tiền, công nợ). */
export async function adjustWalletBalance(walletId, delta) {
  const w = state.wallets.find((x) => x.id === walletId);
  if (!w) return;
  w.balance = num(w.balance) + num(delta);
  await updateDoc(docRef('wallets', walletId), { balance: w.balance });
}

export async function transferBetweenWallets(fromId, toId, amount) {
  const from = state.wallets.find((w) => w.id === fromId);
  const to = state.wallets.find((w) => w.id === toId);
  if (!from || !to) throw new Error('Không tìm thấy ví.');

  const value = num(amount);
  from.balance = num(from.balance) - value;
  to.balance = num(to.balance) + value;
  state.transferLog.push({ fromName: from.name, toName: to.name, amount: value, at: Date.now() });

  const batch = writeBatch(db);
  batch.update(docRef('wallets', fromId), { balance: from.balance });
  batch.update(docRef('wallets', toId), { balance: to.balance });
  batch.set(doc(db, 'users', requireUid(), 'meta', 'state'), {
    transferLog: state.transferLog.slice(-50),
  }, { merge: true });
  await batch.commit();
}

/* =====================================================
   GIAO DỊCH THU / CHI
   Ghi giao dịch + cập nhật số dư ví trong CÙNG một batch
   để dữ liệu luôn nhất quán.
===================================================== */
export async function addTransaction(tx) {
  const payload = clean({
    type: tx.type,
    category: tx.category,
    amount: num(tx.amount),
    date: tx.date,
    note: tx.note || '',
    walletId: tx.walletId || '',
    attachments: Array.isArray(tx.attachments) ? tx.attachments : [],
    createdAt: Date.now(),
  });

  const ref = doc(colRef('transactions'));
  const batch = writeBatch(db);
  batch.set(ref, payload);

  const wallet = state.wallets.find((w) => w.id === payload.walletId);
  if (wallet) {
    wallet.balance = num(wallet.balance) + (payload.type === 'income' ? payload.amount : -payload.amount);
    batch.update(docRef('wallets', wallet.id), { balance: wallet.balance });
  }
  await batch.commit();

  const created = { id: ref.id, ...payload };
  state.transactions.push(created);
  return created;
}

export async function updateTransaction(id, patch) {
  const tx = state.transactions.find((t) => t.id === id);
  if (tx) Object.assign(tx, patch);
  await updateDoc(docRef('transactions', id), clean(patch));
}

/* Xoá 1 giao dịch VÀ hoàn tác ảnh hưởng của nó lên số dư ví. */
export async function removeTransaction(id) {
  const tx = state.transactions.find((t) => t.id === id);
  if (!tx) return;

  const batch = writeBatch(db);
  batch.delete(docRef('transactions', id));

  const wallet = state.wallets.find((w) => w.id === tx.walletId);
  if (wallet) {
    wallet.balance = num(wallet.balance) + (tx.type === 'income' ? -num(tx.amount) : num(tx.amount));
    batch.update(docRef('wallets', wallet.id), { balance: wallet.balance });
  }
  await batch.commit();
  state.transactions = state.transactions.filter((t) => t.id !== id);
}

/* Xoá toàn bộ lịch sử giao dịch (KHÔNG đụng tới số dư ví). */
export async function clearTransactions() {
  const ids = state.transactions.map((t) => t.id);
  for (let i = 0; i < ids.length; i += 400) {
    const batch = writeBatch(db);
    ids.slice(i, i + 400).forEach((id) => batch.delete(docRef('transactions', id)));
    await batch.commit();
  }
  state.transactions = [];
}

/* =====================================================
   NGÂN SÁCH (documentId = id danh mục -> luôn duy nhất)
===================================================== */
export async function saveBudget(category, limit) {
  const value = num(limit);
  const existing = state.budgets.find((b) => b.category === category);
  if (existing) existing.limit = value;
  else state.budgets.push({ category, limit: value });
  await setDoc(docRef('budgets', category), { limit: value });
}

export async function removeBudget(category) {
  state.budgets = state.budgets.filter((b) => b.category !== category);
  await deleteDoc(docRef('budgets', category));
}

/* =====================================================
   HÓA ĐƠN ĐỊNH KỲ
===================================================== */
export async function addRecurring(item) {
  const payload = clean({
    name: item.name,
    amount: num(item.amount),
    dueDate: item.dueDate,
    status: item.status || 'due',
    icon: item.icon || 'fa-receipt',
    auto: !!item.auto,
    createdAt: Date.now(),
  });
  const ref = await addDoc(colRef('recurring'), payload);
  const created = { id: ref.id, ...payload };
  state.recurring.push(created);
  return created;
}

export async function updateRecurring(id, patch) {
  const item = state.recurring.find((r) => r.id === id);
  if (item) Object.assign(item, patch);
  await updateDoc(docRef('recurring', id), clean(patch));
}

export async function removeRecurring(id) {
  state.recurring = state.recurring.filter((r) => r.id !== id);
  await deleteDoc(docRef('recurring', id));
}

/* =====================================================
   CÔNG NỢ
===================================================== */
export async function addDebt(debt, walletDelta) {
  const payload = clean({
    type: debt.type,
    person: debt.person,
    amount: num(debt.amount),
    originalAmount: num(debt.originalAmount ?? debt.amount),
    date: debt.date,
    dueDate: debt.dueDate || null,
    note: debt.note || '',
    bankBin: debt.bankBin || '',
    bankName: debt.bankName || '',
    accountNumber: debt.accountNumber || '',
    accountHolder: debt.accountHolder || '',
    status: debt.status || 'unpaid',
    payments: [],
    createdAt: Date.now(),
  });

  const ref = doc(colRef('debts'));
  const batch = writeBatch(db);
  batch.set(ref, payload);

  if (walletDelta && walletDelta.walletId) {
    const wallet = state.wallets.find((w) => w.id === walletDelta.walletId);
    if (wallet) {
      wallet.balance = num(wallet.balance) + num(walletDelta.delta);
      batch.update(docRef('wallets', wallet.id), { balance: wallet.balance });
    }
  }
  await batch.commit();

  const created = { id: ref.id, ...payload };
  state.debts.push(created);
  return created;
}

export async function updateDebt(id, patch) {
  const d = state.debts.find((x) => x.id === id);
  if (d) Object.assign(d, patch);
  await updateDoc(docRef('debts', id), clean(patch));
}

export async function removeDebt(id) {
  state.debts = state.debts.filter((d) => d.id !== id);
  await deleteDoc(docRef('debts', id));
}

/* Ghi nhận 1 lần thanh toán công nợ: cập nhật khoản nợ + số dư ví trong 1 batch. */
export async function settleDebt(debtId, payment, walletDelta) {
  const d = state.debts.find((x) => x.id === debtId);
  if (!d) throw new Error('Không tìm thấy khoản công nợ.');

  const paid = num(payment.amount);
  d.payments = Array.isArray(d.payments) ? d.payments : [];
  d.payments.unshift({
    id: payment.id,
    amount: paid,
    date: payment.date,
    walletId: payment.walletId || '',
    note: payment.note || '',
    attachments: Array.isArray(payment.attachments) ? payment.attachments : [],
  });
  d.amount = Math.max(0, num(d.amount) - paid);
  if (d.amount <= 0) { d.amount = 0; d.status = 'paid'; }

  const batch = writeBatch(db);
  batch.update(docRef('debts', debtId), { payments: d.payments, amount: d.amount, status: d.status });

  if (walletDelta && walletDelta.walletId) {
    const wallet = state.wallets.find((w) => w.id === walletDelta.walletId);
    if (wallet) {
      wallet.balance = num(wallet.balance) + num(walletDelta.delta);
      batch.update(docRef('wallets', wallet.id), { balance: wallet.balance });
    }
  }
  await batch.commit();
  return d;
}

/* Cập nhật ảnh minh chứng cho MỘT lần trả nợ đã ghi nhận. */
export async function saveDebtPayments(debtId, payments) {
  const d = state.debts.find((x) => x.id === debtId);
  if (d) d.payments = payments;
  await updateDoc(docRef('debts', debtId), { payments });
}
