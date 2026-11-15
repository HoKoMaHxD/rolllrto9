import { REST, Routes } from 'discord.js';
import { BRAND_NAME, config } from '../src/config.js';
import { brandAvatar } from '../src/art.js';

if(!config.token||config.token==='PUT_YOUR_BOT_TOKEN_HERE') {
  console.error('ضع BOT_TOKEN في ملف .env أو في متغيرات البيئة أولًا.');
  process.exit(1);
}

try {
  const rest=new REST({version:'10',rejectOnRateLimit:()=>true}).setToken(config.token);
  const route=Routes.user();
  const current=await rest.get(route);
  if(!current.bot)throw new Error('BOT_TOKEN must belong to a bot.');

  const png=await brandAvatar();
  const body={avatar:`data:image/png;base64,${png.toString('base64')}`};
  if(current.username!==BRAND_NAME)body.username=BRAND_NAME;
  const updated=await rest.patch(route,{body});
  console.log(`تم تحديث اسم البوت وأفتاره في ديسكورد: ${updated.username}`);
} catch(error) {
  console.error('تعذّر تحديث هوية البوت في ديسكورد.',error.code||error.status||error.name);
  process.exitCode=1;
}
