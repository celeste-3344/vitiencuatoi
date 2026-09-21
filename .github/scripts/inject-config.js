/* =====================================================
   .github/scripts/inject-config.js
   -----------------------------------------------------
   Chạy bởi GitHub Actions lúc build & deploy (KHÔNG chạy ở máy bạn).
   Thay các placeholder __FIREBASE_...__ trong dist/js/firebase-config.js
   bằng giá trị thật lấy từ GitHub Secrets (đã được workflow đưa vào
   biến môi trường process.env.* trước khi gọi script này).

   Nếu thiếu bất kỳ secret nào, build sẽ DỪNG LUÔN (exit 1) thay vì
   âm thầm deploy 1 trang web với apiKey rỗng/placeholder.
===================================================== */
const fs = require('fs');
const path = require('path');

const configPath = path.join(__dirname, '..', '..', 'dist', 'js', 'firebase-config.js');

if (!fs.existsSync(configPath)) {
  console.error(`❌ Không tìm thấy file: ${configPath}`);
  process.exit(1);
}

let content = fs.readFileSync(configPath, 'utf8');

const replacements = {
  __FIREBASE_API_KEY__: process.env.FIREBASE_API_KEY,
  __FIREBASE_AUTH_DOMAIN__: process.env.FIREBASE_AUTH_DOMAIN,
  __FIREBASE_DATABASE_URL__: process.env.FIREBASE_DATABASE_URL,
  __FIREBASE_PROJECT_ID__: process.env.FIREBASE_PROJECT_ID,
  __FIREBASE_STORAGE_BUCKET__: process.env.FIREBASE_STORAGE_BUCKET,
  __FIREBASE_MESSAGING_SENDER_ID__: process.env.FIREBASE_MESSAGING_SENDER_ID,
  __FIREBASE_APP_ID__: process.env.FIREBASE_APP_ID,
  __FIREBASE_MEASUREMENT_ID__: process.env.FIREBASE_MEASUREMENT_ID,
};

const missing = [];
for (const [token, value] of Object.entries(replacements)) {
  if (!value) {
    missing.push(token.replace(/^__|__$/g, ''));
    continue;
  }
  content = content.split(token).join(value);
}

if (missing.length) {
  console.error('❌ Thiếu GitHub Secrets sau đây, build đã bị dừng:');
  missing.forEach((name) => console.error(`   - ${name}`));
  console.error('\n👉 Vào repo trên GitHub: Settings → Secrets and variables → Actions');
  console.error('   → New repository secret, thêm đủ các secret bị thiếu ở trên rồi chạy lại workflow.');
  process.exit(1);
}

fs.writeFileSync(configPath, content, 'utf8');
console.log('✅ Đã điền đầy đủ Firebase config từ GitHub Secrets vào bản build.');
