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
     users/{uid}/savingsGoals/{goalId}  -> mục tiêu tích lũy
     users/{uid}/meta/categories        -> danh mục thu/chi
     users/{uid}/meta/state             -> nhật ký chuyển ví, thông báo đã đọc/đã ẩn
     emailToUid/{emailThường}           -> { uid } — tra cứu mời thành viên vào nhóm bằng email
     usernameToUid/{usernameThường}     -> { uid } — tra cứu mời thành viên vào nhóm bằng username
     groups/{groupId}                   -> nhóm/cặp đôi (members, memberEmails, createdBy...)
     groups/{groupId}/wallets/{id}      -> ví dùng chung của nhóm
     groups/{groupId}/transactions/{id} -> giao dịch của nhóm (có createdBy, paidBy)

   QUY TẮC BẢO MẬT FIRESTORE cần dán trong Firebase Console (xem đầy đủ trong README.md):
     rules_version = '2';
     service cloud.firestore {
       match /databases/{database}/documents {
         match /users/{userId}/{document=**} {
           allow read, write: if request.auth != null && request.auth.uid == userId;
         }
         match /emailToUid/{emailKey} {
           allow read: if request.auth != null;
           allow write: if request.auth != null && request.resource.data.uid == request.auth.uid;
         }
         match /usernameToUid/{usernameKey} {
           allow read: if request.auth != null;
           allow write: if request.auth != null && request.resource.data.uid == request.auth.uid;
         }
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
===================================================== */
import { db } from './firebase-config.js';
import {
  collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc,
  writeBatch, query, orderBy, where, arrayUnion,
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
  savingsGoals: [],
  groups: [],
  activeGroupId: null,
  groupWallets: [],
  groupTransactions: [],
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

  const [walletSnap, txSnap, budgetSnap, recSnap, debtSnap, catSnap, metaSnap, goalSnap] = await Promise.all([
    getDocs(colRef('wallets')),
    getDocs(query(colRef('transactions'), orderBy('date', 'desc'))),
    getDocs(colRef('budgets')),
    getDocs(colRef('recurring')),
    getDocs(colRef('debts')),
    getDoc(doc(db, 'users', state.uid, 'meta', 'categories')),
    getDoc(doc(db, 'users', state.uid, 'meta', 'state')),
    getDocs(colRef('savingsGoals')),
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

  state.budgets = budgetSnap.docs.map((d) => {
    const data = d.data();
    return {
      category: d.id,
      limit: num(data.limit),
      // Ngân sách cũ chưa có field này -> mặc định BẬT cộng dồn (giữ hành vi mới cho toàn bộ ngân sách sẵn có).
      rollover: data.rollover !== false,
      createdAt: data.createdAt ? num(data.createdAt) : null,
    };
  });

  state.savingsGoals = goalSnap.docs.map((d) => {
    const g = d.data();
    return {
      id: d.id,
      name: g.name || '',
      targetAmount: num(g.targetAmount),
      currentAmount: num(g.currentAmount),
      icon: g.icon || 'fa-piggy-bank',
      color: g.color || '#5FB0B7',
      createdAt: num(g.createdAt),
    };
  });

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

  // Tính năng Nhóm: không chặn luồng tải chính nếu lỗi (ví dụ mất mạng lúc này) —
  // người dùng vẫn dùng được không gian cá nhân bình thường.
  await Promise.allSettled([ensureEmailIndex(), ensureUsernameIndex(), loadUserGroups()]);

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
  state.savingsGoals = [];
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
  state.savingsGoals = [];
  state.groups = [];
  state.activeGroupId = null;
  state.groupWallets = [];
  state.groupTransactions = [];
  state.transferLog = [];
  state.readNotifications = [];
  state.dismissedNotifications = [];
}

/* =====================================================
   HỒ SƠ CÁ NHÂN
===================================================== */
export async function saveProfile(patch) {
  if (patch.username !== undefined) {
    const newKey = usernameKey(patch.username);
    const oldKey = usernameKey(state.user.username);
    if (newKey && newKey !== oldKey) {
      const existing = await getDoc(doc(db, 'usernameToUid', newKey));
      if (existing.exists() && existing.data().uid !== state.uid) {
        throw new Error('USERNAME_TAKEN');
      }
    }
  }
  Object.assign(state.user, patch);
  await setDoc(userRef(), clean(patch), { merge: true });
  if (patch.username !== undefined) await ensureUsernameIndex();
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
  state.transferLog.push({ fromName: from.name, toName: to.name, amount: value, at: Date.now() });

  const batch = writeBatch(db);
  const walletDocRef = (wid) => docRef('wallets', wid);
  applyWalletDelta(state.wallets, fromId, -value, batch, walletDocRef);
  applyWalletDelta(state.wallets, toId, value, batch, walletDocRef);
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
// Số tiền có DẤU mà 1 giao dịch tác động lên số dư ví: thu = dương, chi = âm.
// Dùng chung cho cả ví cá nhân lẫn ví nhóm để không phải viết lại phép tính này nhiều lần.
function txEffect(type, amount) {
  return type === 'income' ? num(amount) : -num(amount);
}

// Cộng "delta" (số có dấu) vào số dư 1 ví trong mảng `wallets`, đồng thời gộp
// việc ghi vào `batch` qua `walletDocRef(id)`. Dùng chung cho ví cá nhân (state.wallets)
// và ví nhóm (state.groupWallets) — chỉ khác nhau ở mảng dữ liệu và đường dẫn Firestore.
function applyWalletDelta(wallets, walletId, delta, batch, walletDocRef) {
  if (!walletId || !delta) return;
  const wallet = wallets.find((w) => w.id === walletId);
  if (!wallet) return;
  wallet.balance = num(wallet.balance) + delta;
  batch.update(walletDocRef(walletId), { balance: wallet.balance });
}

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
  applyWalletDelta(state.wallets, payload.walletId, txEffect(payload.type, payload.amount), batch, (id) => docRef('wallets', id));
  await batch.commit();

  const created = { id: ref.id, ...payload };
  state.transactions.push(created);
  return created;
}

// Sửa 1 giao dịch đã có. Tự động tính lại đúng số dư ví — kể cả khi người dùng
// đổi số tiền, đổi loại thu/chi, hoặc chuyển giao dịch sang một ví khác.
export async function updateTransaction(id, patch) {
  const tx = state.transactions.find((t) => t.id === id);
  if (!tx) return;

  const oldWalletId = tx.walletId;
  const newWalletId = patch.walletId !== undefined ? patch.walletId : oldWalletId;
  const newAmount = patch.amount !== undefined ? num(patch.amount) : num(tx.amount);
  const newType = patch.type !== undefined ? patch.type : tx.type;
  const oldEffect = txEffect(tx.type, tx.amount);
  const newEffect = txEffect(newType, newAmount);

  const batch = writeBatch(db);
  batch.update(docRef('transactions', id), clean({ ...patch, amount: newAmount }));
  const walletDocRef = (wid) => docRef('wallets', wid);

  if (oldWalletId === newWalletId) {
    // Cùng 1 ví: chỉ cần áp phần chênh lệch giữa giá trị cũ và mới.
    applyWalletDelta(state.wallets, newWalletId, newEffect - oldEffect, batch, walletDocRef);
  } else {
    // Đổi sang ví khác: hoàn tác ảnh hưởng cũ ở ví cũ, áp ảnh hưởng mới ở ví mới.
    applyWalletDelta(state.wallets, oldWalletId, -oldEffect, batch, walletDocRef);
    applyWalletDelta(state.wallets, newWalletId, newEffect, batch, walletDocRef);
  }

  await batch.commit();
  Object.assign(tx, patch, { amount: newAmount });
}

/* Xoá 1 giao dịch VÀ hoàn tác ảnh hưởng của nó lên số dư ví. */
export async function removeTransaction(id) {
  const tx = state.transactions.find((t) => t.id === id);
  if (!tx) return;

  const batch = writeBatch(db);
  batch.delete(docRef('transactions', id));
  applyWalletDelta(state.wallets, tx.walletId, -txEffect(tx.type, tx.amount), batch, (wid) => docRef('wallets', wid));
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
export async function saveBudget(category, limit, rollover = true) {
  const value = num(limit);
  const existing = state.budgets.find((b) => b.category === category);
  const createdAt = existing && existing.createdAt ? existing.createdAt : Date.now();
  if (existing) {
    existing.limit = value;
    existing.rollover = rollover;
    existing.createdAt = createdAt;
  } else {
    state.budgets.push({ category, limit: value, rollover, createdAt });
  }
  await setDoc(docRef('budgets', category), { limit: value, rollover, createdAt });
}

export async function removeBudget(category) {
  state.budgets = state.budgets.filter((b) => b.category !== category);
  await deleteDoc(docRef('budgets', category));
}

/* =====================================================
   MỤC TIÊU TÍCH LŨY (SAVINGS GOALS)
   documentId tự sinh (addDoc) vì 1 người có thể có nhiều mục tiêu.
===================================================== */
export async function saveSavingsGoal(id, patch) {
  const value = {
    name: String(patch.name || '').trim(),
    targetAmount: num(patch.targetAmount),
    icon: patch.icon || 'fa-piggy-bank',
    color: patch.color || '#5FB0B7',
  };

  if (id) {
    const existing = state.savingsGoals.find((g) => g.id === id);
    if (existing) Object.assign(existing, value);
    await setDoc(docRef('savingsGoals', id), clean({
      ...value,
      currentAmount: existing ? num(existing.currentAmount) : 0,
      createdAt: existing && existing.createdAt ? existing.createdAt : Date.now(),
    }));
    return id;
  }

  const createdAt = Date.now();
  const ref = await addDoc(colRef('savingsGoals'), clean({ ...value, currentAmount: 0, createdAt }));
  state.savingsGoals.push({ id: ref.id, ...value, currentAmount: 0, createdAt });
  return ref.id;
}

export async function removeSavingsGoal(id) {
  state.savingsGoals = state.savingsGoals.filter((g) => g.id !== id);
  await deleteDoc(docRef('savingsGoals', id));
}

// Nạp tiền vào 1 quỹ mục tiêu. Nếu có walletId -> trừ luôn số dư ví đó (coi như
// "cất tiền vào quỹ"); nếu walletId là null -> chỉ là con số theo dõi riêng,
// không đụng đến ví/giao dịch nào cả (do người dùng tự chọn ở giao diện).
export async function depositToSavingsGoal(goalId, amount, walletId) {
  const goal = state.savingsGoals.find((g) => g.id === goalId);
  if (!goal) throw new Error('Không tìm thấy mục tiêu tích lũy.');

  const value = num(amount);
  goal.currentAmount = num(goal.currentAmount) + value;

  const batch = writeBatch(db);
  batch.set(docRef('savingsGoals', goalId), clean({
    name: goal.name, targetAmount: goal.targetAmount, currentAmount: goal.currentAmount,
    icon: goal.icon, color: goal.color, createdAt: goal.createdAt,
  }));

  if (walletId) {
    const wallet = state.wallets.find((w) => w.id === walletId);
    if (!wallet) throw new Error('Không tìm thấy ví.');
    state.transferLog.push({ fromName: wallet.name, toName: `Quỹ "${goal.name}"`, amount: value, at: Date.now() });
    applyWalletDelta(state.wallets, walletId, -value, batch, (wid) => docRef('wallets', wid));
    batch.set(doc(db, 'users', requireUid(), 'meta', 'state'), {
      transferLog: state.transferLog.slice(-50),
    }, { merge: true });
  }

  await batch.commit();
}

/* =====================================================
   KHÔNG GIAN CHUNG CHO NHÓM/CẶP ĐÔI (SHARED WALLETS & GROUP FUNDS)
   - groups/{groupId}                     -> { name, members:[uid...], memberEmails:[...], createdBy, createdAt }
   - groups/{groupId}/wallets/{walletId}  -> giống ví cá nhân
   - groups/{groupId}/transactions/{txId} -> giống giao dịch cá nhân, có thêm createdBy + paidBy
   - emailToUid/{emailThường}             -> { uid } — để mời thành viên bằng email (đọc được bởi mọi user đã đăng nhập)
   - usernameToUid/{usernameThường}       -> { uid } — để mời thành viên bằng username (đọc được bởi mọi user đã đăng nhập)
===================================================== */
function emailKey(email) {
  return String(email || '').trim().toLowerCase();
}
function usernameKey(username) {
  return String(username || '').trim().toLowerCase();
}

// Ghi/cập nhật ánh xạ email -> uid của CHÍNH người dùng hiện tại, để người khác mời được mình vào nhóm.
// Gọi lại mỗi lần tải dữ liệu để tự "vá" cho cả các tài khoản đã tạo từ trước tính năng này.
async function ensureEmailIndex() {
  if (!state.uid || !state.user.email) return;
  try {
    await setDoc(doc(db, 'emailToUid', emailKey(state.user.email)), { uid: state.uid }, { merge: true });
  } catch (err) {
    console.warn('Không thể cập nhật chỉ mục email cho tính năng Nhóm:', err);
  }
}

// Tương tự ensureEmailIndex nhưng cho username -> để mời thành viên bằng username cũng được.
async function ensureUsernameIndex() {
  if (!state.uid || !state.user.username) return;
  try {
    await setDoc(doc(db, 'usernameToUid', usernameKey(state.user.username)), { uid: state.uid }, { merge: true });
  } catch (err) {
    console.warn('Không thể cập nhật chỉ mục username cho tính năng Nhóm:', err);
  }
}

export async function loadUserGroups() {
  const snap = await getDocs(query(collection(db, 'groups'), where('members', 'array-contains', state.uid)));
  state.groups = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function createGroup(name) {
  const data = {
    name: String(name || '').trim(),
    members: [state.uid],
    memberEmails: [state.user.email],
    createdBy: state.uid,
    createdAt: Date.now(),
  };
  const ref = await addDoc(collection(db, 'groups'), data);
  state.groups.push({ id: ref.id, ...data });
  return ref.id;
}

export async function renameGroup(groupId, name) {
  const value = String(name || '').trim();
  await updateDoc(doc(db, 'groups', groupId), { name: value });
  const g = state.groups.find((x) => x.id === groupId);
  if (g) g.name = value;
}

// Lưu thông tin ngân hàng của CHÍNH MÌNH để các thành viên khác trong nhóm quét mã QR
// chuyển tiền lại (VD: sau khi "Chia tiền"). Ghi theo dạng field lồng "memberBankInfo.<uid>"
// nên chỉ đụng đúng 1 phần tử trong map, không ảnh hưởng dữ liệu của thành viên khác —
// và vẫn hợp lệ với rule hiện có (thành viên nào cũng update được doc nhóm).
export async function setMyGroupBankInfo(groupId, info) {
  const value = {
    bankBin: info.bankBin || '',
    bankName: info.bankName || '',
    accountNumber: info.accountNumber || '',
    accountHolder: info.accountHolder || '',
  };
  await updateDoc(doc(db, 'groups', groupId), { [`memberBankInfo.${state.uid}`]: value });
  const g = state.groups.find((x) => x.id === groupId);
  if (g) {
    if (!g.memberBankInfo) g.memberBankInfo = {};
    g.memberBankInfo[state.uid] = value;
  }
}

export async function deleteGroup(groupId) {
  await deleteDoc(doc(db, 'groups', groupId));
  state.groups = state.groups.filter((g) => g.id !== groupId);
}

// Thêm thành viên bằng EMAIL hoặc USERNAME (tự nhận diện: có "@" thì tra theo email,
// không thì tra theo username). Ném lỗi 'NOT_FOUND' nếu chưa ai từng đăng nhập ứng dụng
// với email/username đó, hoặc 'ALREADY_MEMBER' nếu đã có trong nhóm.
export async function addGroupMember(groupId, identifier) {
  const raw = String(identifier || '').trim();
  const isEmail = raw.includes('@');
  const key = isEmail ? emailKey(raw) : usernameKey(raw);
  const idxSnap = await getDoc(doc(db, isEmail ? 'emailToUid' : 'usernameToUid', key));
  if (!idxSnap.exists()) throw new Error('NOT_FOUND');
  const uid = idxSnap.data().uid;

  const group = state.groups.find((g) => g.id === groupId);
  if (group && group.members.includes(uid)) throw new Error('ALREADY_MEMBER');

  await updateDoc(doc(db, 'groups', groupId), {
    members: arrayUnion(uid),
    memberEmails: arrayUnion(key),
  });
  if (group) {
    group.members.push(uid);
    group.memberEmails.push(key);
  }
}

export async function loadGroupSpace(groupId) {
  const [wSnap, tSnap] = await Promise.all([
    getDocs(collection(db, 'groups', groupId, 'wallets')),
    getDocs(query(collection(db, 'groups', groupId, 'transactions'), orderBy('date', 'desc'))),
  ]);
  state.activeGroupId = groupId;
  state.groupWallets = wSnap.docs.map((d) => ({ id: d.id, ...d.data(), balance: num(d.data().balance) }));
  state.groupTransactions = tSnap.docs.map((d) => ({ id: d.id, ...d.data(), amount: num(d.data().amount) }));
}

export function exitGroupSpace() {
  state.activeGroupId = null;
  state.groupWallets = [];
  state.groupTransactions = [];
}

export async function saveGroupWallet(groupId, id, patch) {
  const value = { name: patch.name, icon: patch.icon, gradient: patch.gradient, balance: num(patch.balance) };
  if (id) {
    await setDoc(doc(db, 'groups', groupId, 'wallets', id), value, { merge: true });
    const existing = state.groupWallets.find((w) => w.id === id);
    if (existing) Object.assign(existing, value);
    return id;
  }
  const ref = await addDoc(collection(db, 'groups', groupId, 'wallets'), value);
  state.groupWallets.push({ id: ref.id, ...value });
  return ref.id;
}

export async function removeGroupWallet(groupId, id) {
  state.groupWallets = state.groupWallets.filter((w) => w.id !== id);
  await deleteDoc(doc(db, 'groups', groupId, 'wallets', id));
}

// Giao dịch nhóm: createdBy = người ghi nhận giao dịch, paidBy = người thực chi/thu tiền (có thể khác nhau).
export async function saveGroupTransaction(groupId, payload) {
  const amount = num(payload.amount);
  const value = {
    type: payload.type, category: payload.category, amount,
    date: payload.date, note: payload.note || '', walletId: payload.walletId,
    attachments: Array.isArray(payload.attachments) ? payload.attachments : [],
    createdBy: state.uid, paidBy: payload.paidBy || state.uid,
    createdAt: Date.now(),
  };

  const batch = writeBatch(db);
  const txRef = doc(collection(db, 'groups', groupId, 'transactions'));
  batch.set(txRef, value);
  applyWalletDelta(state.groupWallets, payload.walletId, txEffect(payload.type, amount), batch, (wid) => doc(db, 'groups', groupId, 'wallets', wid));
  await batch.commit();
  state.groupTransactions.unshift({ id: txRef.id, ...value });
}

// Sửa 1 giao dịch nhóm đã có — tính lại đúng số dư ví nhóm, kể cả khi đổi
// số tiền, loại thu/chi, hoặc chuyển sang ví nhóm khác (dùng chung logic với updateTransaction cá nhân).
export async function updateGroupTransaction(groupId, txId, patch) {
  const tx = state.groupTransactions.find((t) => t.id === txId);
  if (!tx) return;

  const oldWalletId = tx.walletId;
  const newWalletId = patch.walletId !== undefined ? patch.walletId : oldWalletId;
  const newAmount = patch.amount !== undefined ? num(patch.amount) : num(tx.amount);
  const newType = patch.type !== undefined ? patch.type : tx.type;
  const oldEffect = txEffect(tx.type, tx.amount);
  const newEffect = txEffect(newType, newAmount);

  const value = clean({
    type: newType,
    category: patch.category !== undefined ? patch.category : tx.category,
    amount: newAmount,
    date: patch.date !== undefined ? patch.date : tx.date,
    note: patch.note !== undefined ? patch.note : tx.note,
    walletId: newWalletId,
    paidBy: patch.paidBy !== undefined ? patch.paidBy : tx.paidBy,
    attachments: patch.attachments !== undefined ? patch.attachments : (tx.attachments || []),
  });

  const batch = writeBatch(db);
  batch.update(doc(db, 'groups', groupId, 'transactions', txId), value);
  const walletDocRef = (wid) => doc(db, 'groups', groupId, 'wallets', wid);

  if (oldWalletId === newWalletId) {
    applyWalletDelta(state.groupWallets, newWalletId, newEffect - oldEffect, batch, walletDocRef);
  } else {
    applyWalletDelta(state.groupWallets, oldWalletId, -oldEffect, batch, walletDocRef);
    applyWalletDelta(state.groupWallets, newWalletId, newEffect, batch, walletDocRef);
  }

  await batch.commit();
  Object.assign(tx, value);
}

export async function removeGroupTransaction(groupId, txId) {
  const tx = state.groupTransactions.find((t) => t.id === txId);
  if (!tx) return;

  const batch = writeBatch(db);
  batch.delete(doc(db, 'groups', groupId, 'transactions', txId));
  applyWalletDelta(state.groupWallets, tx.walletId, -txEffect(tx.type, tx.amount), batch, (wid) => doc(db, 'groups', groupId, 'wallets', wid));
  await batch.commit();
  state.groupTransactions = state.groupTransactions.filter((t) => t.id !== txId);
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
