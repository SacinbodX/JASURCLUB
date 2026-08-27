require('dotenv').config();
const express = require('express');
const fileUpload = require('express-fileupload');
const { Telegraf, Markup } = require('telegraf');
const path = require('path');

// Muhit o'zgaruvchilari
const USER_BOT_TOKEN = process.env.USER_BOT_TOKEN;
const ADMIN_BOT_TOKEN = process.env.ADMIN_BOT_TOKEN;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;
const WEBAPP_URL = process.env.WEBAPP_URL;
const PORT = process.env.PORT || 3000;

if (!USER_BOT_TOKEN || !ADMIN_BOT_TOKEN || !ADMIN_CHAT_ID || !WEBAPP_URL) {
  console.error('Muhit o\'zgaruvchilari to\'liq emas!');
  process.exit(1);
}

// Botlarni yaratish
const userBot = new Telegraf(USER_BOT_TOKEN);
const adminBot = new Telegraf(ADMIN_BOT_TOKEN);

// Express ilovasi
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(fileUpload({
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  abortOnLimit: true,
}));

// Statik fayllar (index.html)
app.use(express.static(path.join(__dirname, 'public')));

// --- Foydalanuvchi bot komandalari ---

userBot.start((ctx) => {
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.webApp('📝 Ariza topshirish', WEBAPP_URL)],
    [Markup.button.callback('ℹ️ Biz haqimizda', 'about')],
  ]);
  ctx.reply('Assalomu alaykum! Quyidagi tugmalar orqali harakat qiling:', keyboard);
});

userBot.action('about', (ctx) => {
  const text = `🏢 <b>Biz haqimizda</b>\n\nBizning kompaniyamiz 2010-yildan beri xizmat ko'rsatib kelmoqda. Sifat va ishonchlilik bizning ustuvor yo'nalishimizdir.`;
  ctx.replyWithHTML(text);
  ctx.answerCbQuery();
});

// --- Admin bot tugmalari ---

adminBot.action(/^accept:(.+)/, async (ctx) => {
  const userId = ctx.match[1];
  try {
    await userBot.telegram.sendMessage(userId, '✅ Sizning arizangiz qabul qilindi!');
  } catch (err) {
    console.error('Foydalanuvchiga xabar yuborishda xato:', err);
  }
  // Xabarni yangilash
  const newCaption = ctx.callbackQuery.message.caption + '\n\n✅ <b>QABUL QILINDI</b>';
  await ctx.editMessageCaption(newCaption, { parse_mode: 'HTML' });
  await ctx.answerCbQuery('Qabul qilindi');
});

adminBot.action(/^reject:(.+)/, async (ctx) => {
  const userId = ctx.match[1];
  try {
    await userBot.telegram.sendMessage(userId, '❌ Sizning arizangiz rad etildi.');
  } catch (err) {
    console.error('Foydalanuvchiga xabar yuborishda xato:', err);
  }
  const newCaption = ctx.callbackQuery.message.caption + '\n\n❌ <b>RAD ETILDI</b>';
  await ctx.editMessageCaption(newCaption, { parse_mode: 'HTML' });
  await ctx.answerCbQuery('Rad etildi');
});

// --- Mini App formani qabul qilish ---

app.post('/submit', async (req, res) => {
  try {
    const { user_id, ism, familiya, yosh, manzil, vazn } = req.body;
    const imageFile = req.files && req.files.image;

    // Validatsiya
    if (!user_id || !ism || !familiya || !yosh || !manzil || !vazn || !imageFile) {
      return res.status(400).json({ status: 'error', message: 'Barcha maydonlarni to\'ldiring!' });
    }

    const userId = parseInt(user_id, 10);
    if (isNaN(userId)) {
      return res.status(400).json({ status: 'error', message: 'Noto\'g\'ri foydalanuvchi ID' });
    }

    // Rasm ma'lumotlari
    const imageBuffer = imageFile.data;
    const imageName = imageFile.name || 'photo.jpg';

    // Admin botga yuboriladigan caption
    const caption = `📄 <b>Yangi ariza</b>\n\n` +
      `👤 <b>Ism:</b> ${ism}\n` +
      `👥 <b>Familiya:</b> ${familiya}\n` +
      `🎂 <b>Yosh:</b> ${yosh}\n` +
      `📍 <b>Manzil:</b> ${manzil}\n` +
      `⚖️ <b>Vazn:</b> ${vazn} kg\n` +
      `🆔 <b>Telegram ID:</b> ${userId}`;

    const keyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback('✅ Qabul qilish', `accept:${userId}`),
        Markup.button.callback('❌ Rad etish', `reject:${userId}`),
      ],
    ]);

    // Rasm va captionni admin chatga yuborish
    await adminBot.telegram.sendPhoto(
      ADMIN_CHAT_ID,
      { source: imageBuffer, filename: imageName },
      {
        caption,
        parse_mode: 'HTML',
        ...keyboard,
      }
    );

    res.json({ status: 'success', message: 'Ariza qabul qilindi' });
  } catch (error) {
    console.error('Forma yuborishda xato:', error);
    res.status(500).json({ status: 'error', message: 'Serverda xatolik' });
  }
});

// --- Serverni ishga tushirish ---

async function start() {
  try {
    // Botlarni polling rejimida ishga tushirish
    await Promise.all([
      userBot.launch(),
      adminBot.launch(),
    ]);
    console.log('Botlar ishga tushdi');

    // Express serverni boshlash
    app.listen(PORT, () => {
      console.log(`Veb-server ${PORT} portda ishlamoqda`);
    });
  } catch (err) {
    console.error('Ishga tushirishda xato:', err);
    process.exit(1);
  }
}

start();

// Jarayon tugaganda botlarni to'xtatish
process.once('SIGINT', () => {
  userBot.stop('SIGINT');
  adminBot.stop('SIGINT');
});
process.once('SIGTERM', () => {
  userBot.stop('SIGTERM');
  adminBot.stop('SIGTERM');
});
