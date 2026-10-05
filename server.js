require('dotenv').config();
const express = require('express');
const fileUpload = require('express-fileupload');
const { Telegraf, Markup } = require('telegraf');
const path = require('path');
const fs = require('fs');

const { USER_BOT_TOKEN, ADMIN_BOT_TOKEN, ADMIN_CHAT_ID, WEBAPP_URL } = process.env;
const PORT = process.env.PORT || 3000;
if (!USER_BOT_TOKEN || !ADMIN_BOT_TOKEN || !ADMIN_CHAT_ID || !WEBAPP_URL) {
  console.error("Muhit o'zgaruvchilari to'liq emas!");
  process.exit(1);
}

const userBot = new Telegraf(USER_BOT_TOKEN);
const adminBot = new Telegraf(ADMIN_BOT_TOKEN);

// ---------- Ma'lumotlar ombori (data.json + public/uploads) ----------
const DB_FILE = path.join(__dirname, 'data.json');
const UP_DIR = path.join(__dirname, 'public', 'uploads');
fs.mkdirSync(UP_DIR, { recursive: true });
let db = {
  about: "JASUR CLUB sport jamiyati 2015-yildan beri faoliyat yuritadi. Asoschi: Iskandarov Jasurbek.",
  photos: [],
  trainers: [],
};
try { db = { ...db, ...JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) }; } catch {}
const save = () => fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

async function savePhoto(ctx, fileId) {
  const link = await ctx.telegram.getFileLink(fileId);
  const buf = Buffer.from(await (await fetch(link.href || String(link))).arrayBuffer());
  const name = `${Date.now()}-${Math.round(Math.random() * 1e4)}.jpg`;
  fs.writeFileSync(path.join(UP_DIR, name), buf);
  return '/uploads/' + name;
}
const rmFile = (url) => fs.unlink(path.join(__dirname, 'public', url), () => {});

// ---------- Express ----------
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(fileUpload({ limits: { fileSize: 10 * 1024 * 1024 }, abortOnLimit: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/data', (req, res) => res.json(db));

// 1-bosqich: ma'lumot serverga olinadi (adminga hali yuborilmaydi)
const pending = new Map();
setInterval(() => {
  for (const [k, v] of pending) if (Date.now() - v.t > 10 * 60 * 1000) pending.delete(k);
}, 60 * 1000);

app.post('/prepare', (req, res) => {
  const b = req.body;
  const img = req.files && req.files.image;
  const face = req.files && req.files.face;
  const need = ['user_id', 'ism', 'familiya', 'yosh', 'manzil', 'vazn', 'ota_ism', 'ota_familiya'];
  if (need.some((k) => !b[k] || !String(b[k]).trim()) || !img || !face) {
    return res.status(400).json({ status: 'error', message: "Barcha maydonlarni to'ldiring va yuzni skanerlang!" });
  }
  if (isNaN(parseInt(b.user_id, 10))) {
    return res.status(400).json({ status: 'error', message: "Noto'g'ri foydalanuvchi ID" });
  }
  const token = Date.now() + '-' + Math.random().toString(36).slice(2);
  pending.set(token, { t: Date.now(), b, img: img.data, face: face.data });
  res.json({ status: 'success', token });
});

// 2-bosqich: tasdiqlanganda adminga yuboriladi
app.post('/confirm', async (req, res) => {
  const p = pending.get(req.body.token);
  if (!p) return res.status(400).json({ status: 'error', message: "Ariza topilmadi, qaytadan yuboring" });
  pending.delete(req.body.token);
  try {
    const { user_id, ism, familiya, yosh, manzil, vazn, ota_ism, ota_familiya } = p.b;
    const uid = parseInt(user_id, 10);
    await adminBot.telegram.sendPhoto(
      ADMIN_CHAT_ID,
      { source: p.face, filename: 'face.jpg' },
      { caption: `🧑 <b>Ota/ona yuzi (skaner):</b> ${esc(ota_ism)} ${esc(ota_familiya)}`, parse_mode: 'HTML' }
    );
    const caption =
      `📄 <b>Yangi ariza</b>\n\n` +
      `👤 <b>Ism:</b> ${esc(ism)}\n👥 <b>Familiya:</b> ${esc(familiya)}\n` +
      `🎂 <b>Yosh:</b> ${esc(yosh)}\n📍 <b>Manzil:</b> ${esc(manzil)}\n` +
      `⚖️ <b>Vazn:</b> ${esc(vazn)} kg\n` +
      `👨‍👩‍👦 <b>Ota/ona:</b> ${esc(ota_ism)} ${esc(ota_familiya)}\n🆔 <b>Telegram ID:</b> ${uid}`;
    await adminBot.telegram.sendPhoto(
      ADMIN_CHAT_ID,
      { source: p.img, filename: 'photo.jpg' },
      {
        caption,
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([[
          Markup.button.callback('✅ Qabul qilish', `accept:${uid}`),
          Markup.button.callback('❌ Rad etish', `reject:${uid}`),
        ]]),
      }
    );
    res.json({ status: 'success', message: 'Ariza yuborildi' });
  } catch (e) {
    console.error('Yuborishda xato:', e);
    res.status(500).json({ status: 'error', message: 'Serverda xatolik' });
  }
});

// ---------- Foydalanuvchi boti ----------
userBot.start((ctx) =>
  ctx.reply(
    "Assalomu alaykum! JASUR CLUB kurash zaliga xush kelibsiz 🥋\nIlovaga kirish uchun tugmani bosing:",
    Markup.inlineKeyboard([[Markup.button.webApp('🥋 Ilovaga kirish', WEBAPP_URL)]])
  )
);

// ---------- Admin boti ----------
const isAdmin = (ctx) => String(ctx.chat && ctx.chat.id) === String(ADMIN_CHAT_ID);
adminBot.use((ctx, next) => (isAdmin(ctx) ? next() : undefined));

const menu = Markup.keyboard([
  ['🖼 Zal rasmi qo\'shish', '📝 Zal haqida matn'],
  ['➕ Murabbiy qo\'shish', '🗑 O\'chirish'],
]).resize();
const state = new Map(); // chatId -> {step, data}
const st = (ctx) => state.get(ctx.chat.id);

adminBot.start((ctx) => { state.delete(ctx.chat.id); ctx.reply('Admin panel:', menu); });

adminBot.hears("🖼 Zal rasmi qo'shish", (ctx) => {
  state.set(ctx.chat.id, { step: 'gym_photo' });
  ctx.reply('Zal rasmini yuboring (bir nechta yuborsangiz bo\'ladi). Tugagach /start bosing.');
});
adminBot.hears('📝 Zal haqida matn', (ctx) => {
  state.set(ctx.chat.id, { step: 'about' });
  ctx.reply('Zal haqida yangi matnni yozing:');
});
adminBot.hears("➕ Murabbiy qo'shish", (ctx) => {
  state.set(ctx.chat.id, { step: 't_name', data: { id: String(Date.now()), photos: [] } });
  ctx.reply('Murabbiy ismini yozing:');
});
adminBot.hears("🗑 O'chirish", (ctx) => {
  const rows = [
    ...db.trainers.map((t) => [Markup.button.callback(`👤 ${t.name}`, `delt:${t.id}`)]),
    ...db.photos.map((p, i) => [Markup.button.callback(`🖼 Zal rasmi #${i + 1}`, `delp:${i}`)]),
  ];
  if (!rows.length) return ctx.reply("O'chiriladigan narsa yo'q.");
  ctx.reply("Qaysi birini o'chiramiz?", Markup.inlineKeyboard(rows));
});
adminBot.hears('✅ Tayyor', (ctx) => {
  const s = st(ctx);
  if (!s || s.step !== 't_photos') return;
  db.trainers.push(s.data);
  save();
  state.delete(ctx.chat.id);
  ctx.reply(`✅ Murabbiy "${s.data.name}" qo'shildi.`, menu);
});

adminBot.on('text', (ctx) => {
  const s = st(ctx);
  if (!s) return;
  const t = ctx.message.text;
  if (s.step === 'about') {
    db.about = t; save(); state.delete(ctx.chat.id);
    return ctx.reply('✅ Matn yangilandi.', menu);
  }
  if (s.step === 't_name') { s.data.name = t; s.step = 't_age'; return ctx.reply('Yoshini yozing:'); }
  if (s.step === 't_age') { s.data.age = t; s.step = 't_desc'; return ctx.reply('Umumiy tavsifini yozing:'); }
  if (s.step === 't_desc') {
    s.data.desc = t; s.step = 't_photos';
    return ctx.reply('Rasmlarini yuboring (bir nechta). Tugagach "✅ Tayyor" bosing.',
      Markup.keyboard([['✅ Tayyor']]).resize());
  }
});

adminBot.on('photo', async (ctx) => {
  const s = st(ctx);
  if (!s || !['gym_photo', 't_photos'].includes(s.step)) return;
  try {
    const url = await savePhoto(ctx, ctx.message.photo.pop().file_id);
    if (s.step === 'gym_photo') { db.photos.push(url); save(); ctx.reply(`✅ Qo'shildi (jami: ${db.photos.length})`); }
    else { s.data.photos.push(url); ctx.reply(`✅ Rasm ${s.data.photos.length} qabul qilindi`); }
  } catch (e) { console.error(e); ctx.reply('Rasmni saqlashda xato.'); }
});

adminBot.action(/^delt:(.+)/, async (ctx) => {
  const t = db.trainers.find((x) => x.id === ctx.match[1]);
  if (t) { t.photos.forEach(rmFile); db.trainers = db.trainers.filter((x) => x !== t); save(); }
  await ctx.answerCbQuery("O'chirildi");
  ctx.editMessageText("🗑 Murabbiy o'chirildi.");
});
adminBot.action(/^delp:(\d+)/, async (ctx) => {
  const [p] = db.photos.splice(+ctx.match[1], 1);
  if (p) { rmFile(p); save(); }
  await ctx.answerCbQuery("O'chirildi");
  ctx.editMessageText("🗑 Rasm o'chirildi.");
});

const decide = (word, userMsg, mark) => adminBot.action(new RegExp(`^${word}:(.+)`), async (ctx) => {
  try { await userBot.telegram.sendMessage(ctx.match[1], userMsg); }
  catch (e) { console.error('Foydalanuvchiga xabar yuborishda xato:', e); }
  await ctx.editMessageCaption(ctx.callbackQuery.message.caption + `\n\n${mark}`);
  await ctx.answerCbQuery('Bajarildi');
});
decide('accept', '✅ Sizning arizangiz qabul qilindi!', '✅ QABUL QILINDI');
decide('reject', "❌ Sizning arizangiz rad etildi. Sababi: hozirda bo'sh o'rin mavjud emas.", '❌ RAD ETILDI');

// ---------- Ishga tushirish ----------
app.listen(PORT, () => console.log(`Veb-server ${PORT} portda ishlamoqda`));
userBot.launch();
adminBot.launch();
console.log('Botlar ishga tushdi');
process.once('SIGINT', () => { userBot.stop('SIGINT'); adminBot.stop('SIGINT'); });
process.once('SIGTERM', () => { userBot.stop('SIGTERM'); adminBot.stop('SIGTERM'); });
