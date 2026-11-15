import path from 'node:path';
import { Client,Events,GatewayIntentBits,PermissionFlagsBits,MessageFlags,EmbedBuilder } from 'discord.js';
import { config,PREFIXES,ITEMS } from './config.js';
import { Store } from './store.js';
import { GameManager } from './manager.js';
import { registerCommands } from './commands.js';
import { prepareEyes } from './eyes.js';

if(!config.token||config.token==='PUT_YOUR_BOT_TOKEN_HERE'){
  console.error('ضع BOT_TOKEN في .env أو في متغيرات الاستضافة. لا ترسل التوكن لأي شخص.');process.exit(1);
}
const client=new Client({intents:[GatewayIntentBits.Guilds,GatewayIntentBits.GuildMessages,GatewayIntentBits.MessageContent],allowedMentions:{parse:[]}});
const store=new Store(path.join(config.dataDir,'arena.sqlite'));
const manager=new GameManager(store,config);
let ready=false,closing=false;
const admin=(id,permissions)=>config.admins.has(id)||permissions?.has(PermissionFlagsBits.Administrator);
const profile=(user,member)=>({id:user.id,name:member?.displayName||member?.nick||user.globalName||user.username,avatar:member?.displayAvatarURL?.({extension:'png',size:512})||user.displayAvatarURL({extension:'png',size:512})});
const help=()=>new EmbedBuilder().setColor(0xa76acb).setTitle('🎮 ألعاب السيرفر').setDescription([
  '`+r` روليت • اختر من تطرده، ولديك 20 ثانية افتراضيًا.',
  '`+h` هايد • اختبئ في مربع ثم اكشف مخابئ الآخرين.',
  '`+m` ألغام • مواجهة على لوحة 3×3 فيها لغم واحد.',
  '`+c` كراسي • احجز الأخضر، ولا تضغط الأحمر.',
  '`-r` روليت عكسي • من تختاره الروليت يخرج تلقائيًا.',
  '', 'المتجر في تسجيل الروليت: مرتدة **2**، كشف **1**، نووي **10** نقاط.',
  'كل فوز = نقطة واحدة + فوزة واحدة. البيانات خاصة بكل سيرفر.',
  '`/نقاط` • `/المتصدرين`',
  '`+s` أو `+وقف` أو `/ايقاف` • إيقاف القيم لصاحبه أو الإدارة.',
  'للإدارة: `/اضافة نقاط` و`/ازالة نقاط` ثم الشخص والعدد.',
].join('\n'));

client.once(Events.ClientReady,async c=>{
  console.log(`جاهز: ${c.user.tag} | +r +h +m +c -r +s +وقف`);
  await manager.recover(c);
  manager.eyes=await prepareEyes(c.application);
  ready=true;
  try{const count=await registerCommands(config.token,c.user.id,config.guildId);console.log(`تم تسجيل ${count} أوامر ${config.guildId?'في السيرفر المحدد':'عالميًا'}.`);}
  catch(error){console.error('[SLASH_REGISTER]',error.code||error.name,'تحقق من GUILD_ID وإضافة البوت بنطاق applications.commands.');}
});
client.on(Events.MessageCreate,async message=>{
  if(message.author.bot||!message.guild||!ready||closing)return;
  const input=message.content.trim();
  if(input==='+help'||input==='+مساعدة'){await message.reply({embeds:[help()]}).catch(()=>{});return;}
  const stopRequested=input==='+s'||input==='+وقف';
  const type=Object.hasOwn(PREFIXES,input)?PREFIXES[input]:null;
  if(!type&&!stopRequested)return;
  try{
    const isAdmin=admin(message.author.id,message.member?.permissions);
    if(stopRequested){
      await manager.stop(message.channel.id,message.author.id,isAdmin);
      return;
    }
    if(config.channels.size&&!config.channels.has(message.channel.id)&&!isAdmin)throw new Error('هذا الروم غير مخصص للألعاب.');
    if(config.roleId&&!message.member.roles.cache.has(config.roleId)&&!isAdmin)throw new Error('بدء الألعاب متاح للرتبة المحددة فقط.');
    const me=message.guild.members.me||await message.guild.members.fetchMe();
    const permissions=message.channel.permissionsFor(me);
    const needed=[PermissionFlagsBits.ViewChannel,PermissionFlagsBits.EmbedLinks,PermissionFlagsBits.AttachFiles,PermissionFlagsBits.ReadMessageHistory,
      message.channel.isThread()?PermissionFlagsBits.SendMessagesInThreads:PermissionFlagsBits.SendMessages];
    if(!permissions?.has(needed))throw new Error('يحتاج البوت: View Channel، Send Messages، Embed Links، Attach Files، Read Message History.');
    await manager.start(message.channel,type,message.author.id);
  }catch(error){await message.reply({content:error.message.slice(0,1800),allowedMentions:{parse:[]}}).catch(()=>{});}
});

// Deduplicate gateway redelivery. A separate click has its own interaction ID.
const seen=new Set();
const privateReplyButtons=new Set(['join','leave','shop','buy','reveal','hide']);
client.on(Events.InteractionCreate,async i=>{
  if(!i.isButton()&&!i.isChatInputCommand())return;
  if(i.isButton()&&!i.customId.startsWith('ag:'))return;
  if(seen.has(i.id))return;seen.add(i.id);if(seen.size>5000)seen.delete(seen.values().next().value);
  const buttonData=i.isButton()?i.customId.split(':'):null;
  const silent=buttonData&&!privateReplyButtons.has(buttonData[3]);
  try{
    // Acknowledge before rendering or waiting for a per-channel queue.
    if(silent)await i.deferUpdate();
    else await i.deferReply({flags:MessageFlags.Ephemeral});
    if(!i.inGuild())throw new Error('استخدم البوت داخل السيرفر.');
    if(!ready||closing)throw new Error('البوت يجهز الآن؛ حاول بعد لحظات.');
    const respond=payload=>{
      if(silent)return;
      return i.editReply(payload).catch(error=>console.error('[REPLY]',error.code||error.name));
    };
    if(i.isButton()){
      const [,id,version,action,value]=buttonData;
      await manager.click({channelId:i.channelId,guildId:i.guildId,id,version:Number(version),action,value,user:profile(i.user,i.member),receivedAt:i.createdTimestamp,respond});
    }else if(['اضافة','ازالة'].includes(i.commandName)){
      if(!admin(i.user.id,i.memberPermissions))throw new Error('إدارة النقاط متاحة للإدارة فقط.');
      const user=i.options.getUser('الشخص',true),number=i.options.getInteger('العدد',true);
      if(user.bot)throw new Error('اختر لاعبًا، وليس بوتًا.');
      const p=store.adjust(i.guildId,user.id,i.commandName==='اضافة'?number:-number,i.user.id);
      await respond({content:`تم ${i.commandName==='اضافة'?'إضافة':'إزالة'} ${number} نقطة ${i.commandName==='اضافة'?'إلى':'من'} <@${user.id}>.\nرصيده الحالي: **${p.points}** نقطة.`,allowedMentions:{parse:[]}});
    }else if(i.commandName==='نقاط'){
      const u=i.options.getUser('الشخص')||i.user,p=store.get(i.guildId,u.id);
      const embed=new EmbedBuilder().setColor(0xa76acb).setTitle('نقاط وفوزات اللاعب').setThumbnail(u.displayAvatarURL({extension:'png',size:256}))
        .setDescription(`<@${u.id}>\nنقاط الألعاب: **${p.points}**\nالفوزات: **${p.wins}**\n\n${Object.entries(ITEMS).map(([key,item])=>`${item.emoji} ${item.name}: **${p[key]}**`).join('\n')}`);
      await respond({embeds:[embed],allowedMentions:{parse:[]}});
    }else if(i.commandName==='المتصدرين'){
      const top=store.top(i.guildId);await respond({embeds:[new EmbedBuilder().setColor(0xa76acb).setTitle('🏆 المتصدرين')
        .setDescription(top.length?top.map((p,n)=>`${n+1}. <@${p.user}> — ${p.wins} فوز | ${p.points} نقطة`).join('\n'):'لا توجد نتائج بعد.')],allowedMentions:{parse:[]}});
    }else if(i.commandName==='العاب')await respond({embeds:[help()]});
    else if(i.commandName==='ايقاف'){await manager.stop(i.channelId,i.user.id,admin(i.user.id,i.memberPermissions));await respond({content:'أُوقف القيم.'});}
    else await respond({content:'هذا الأمر غير مدعوم في هذا الإصدار.'});
  }catch(error){
    const payload={content:`❌ ${String(error.message||'حدث خطأ.').slice(0,1800)}`,allowedMentions:{parse:[]}};
    if(silent&&i.deferred)await i.followUp({...payload,flags:MessageFlags.Ephemeral}).catch(()=>{});
    else if(i.deferred||i.replied)await i.editReply(payload).catch(()=>{});
    else await i.reply({...payload,flags:MessageFlags.Ephemeral}).catch(()=>{});
  }
});
client.on(Events.Error,error=>console.error('[DISCORD]',error.code||error.name));
process.on('unhandledRejection',error=>console.error('[UNHANDLED]',error?.code||error?.name||'UnknownError'));
async function shutdown(){
  if(closing)return;closing=true;ready=false;
  const timer=setTimeout(()=>process.exit(0),10000);timer.unref();
  try{await manager.shutdown();}finally{client.destroy();store.close();process.exit(0);}
}
process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
client.login(config.token).catch(error=>{console.error('[LOGIN_FAILED]',error.code||error.name,'تحقق من BOT_TOKEN وتفعيل Message Content Intent.');store.close();process.exit(1);});
