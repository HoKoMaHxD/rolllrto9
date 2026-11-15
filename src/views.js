import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, AttachmentBuilder, TextDisplayBuilder, MediaGalleryBuilder, MessageFlags } from 'discord.js';
import { GAME_NAMES, ITEMS } from './config.js';
import { lobbyCard, rouletteCard, winnerCard } from './art.js';
import { MINE_SQUARES } from './engine.js';

const purple=0xa76acb;
export const mention=id=>`<@${id}>`;
const rows=(buttons,width=5)=>Array.from({length:Math.ceil(buttons.length/width)},(_,i)=>new ActionRowBuilder().addComponents(buttons.slice(i*width,(i+1)*width)));
const cid=(g,act,value='')=>`ag:${g.id}:${g.version}:${act}:${value}`;
const button=(g,act,label,style=ButtonStyle.Secondary,value='',disabled=false,emoji=null)=>{
  const b=new ButtonBuilder().setCustomId(cid(g,act,value)).setStyle(style).setDisabled(disabled);
  if(label)b.setLabel(label);
  if(emoji)b.setEmoji(emoji);return b;
};
const footer=g=>`الجولة ${g.round} • المتبقون ${g.alive().length}/${g.players.length}`;
const until=g=>`<t:${Math.ceil(g.deadline/1000)}:R>`;
const attachments=(buffer,name)=>[new AttachmentBuilder(buffer,{name})];
const lobbyCache=new Map();
export function lobbyContent(g){
  const count=`المشتركين: **${g.players.length}**`;
  if(g.phase!=='lobby'||!g.deadline)return count;
  return `${count}\n> ⏰ يبدأ القيم ${until(g)}`;
}
export function gameComponents(g,{phase=g.phase,locked=false,eyes={}}={}){
  const openEye=eyes.open||process.env.REVEALED_EMOJI_ID||'👁️';
  const closedEye=eyes.closed||process.env.HIDDEN_EMOJI_ID||'😌';
  let buttons=[];
  if(phase==='lobby'){
    buttons=[button(g,'join','دخول',ButtonStyle.Secondary,'',false,'➕'),button(g,'leave','خروج',ButtonStyle.Secondary,'',false,'➖')];
    if(g.type==='roulette')buttons.push(button(g,'shop','المتجر',ButtonStyle.Secondary,'',false,'🛒'));
  } else if(phase==='turn') buttons=g.alive().filter(p=>p.id!==g.actor).map(p=>button(g,'kick',`${p.number}  ${p.name}`.slice(0,70),ButtonStyle.Secondary,p.id));
  else if(phase==='hiding'||phase==='seeking'){
    const hiding=phase==='hiding';
    buttons=Array.from({length:25},(_,i)=>{
      const n=i+1,open=!hiding&&g.opened.has(n);
      return button(g,hiding?'hide':'seek',hiding?String(n):null,ButtonStyle.Secondary,String(n),locked||open,hiding?null:open?openEye:closedEye);
    });
  }else if(phase==='chair-ready'){
    buttons=Array.from({length:g.alive().length-1},(_,i)=>button(g,'chair','•',ButtonStyle.Secondary,String(i),true));
  }else if(phase==='chairs'){
    buttons=g.seats.map((p,i)=>button(g,'chair',p?'✓':'•',g.red?ButtonStyle.Danger:ButtonStyle.Success,String(i),Boolean(p)||locked));
  }else if(phase==='duel'){
    buttons=Array.from({length:MINE_SQUARES},(_,i)=>{
      const n=i+1;
      const picked=g.picked.has(n);
      const bomb=picked&&n===g.bomb;
      const style=bomb?ButtonStyle.Danger:picked?ButtonStyle.Success:ButtonStyle.Secondary;
      return button(g,'mine',picked?null:String(n),style,String(n),locked||picked,bomb?'💣':picked?openEye:null);
    });
    return rows(buttons,3);
  }
  return rows(buttons);
}
export function controlComponents(g){
  if(g.type!=='roulette'||g.phase!=='turn')return [];
  const controls=[
    button(g,'random-kick','طرد عشوائي',ButtonStyle.Secondary,'',!g.canKickRandomly(),'🎲'),
    button(g,'withdraw','انسحاب',ButtonStyle.Secondary,'',false,'👋'),
    button(g,'reveal','كشف',ButtonStyle.Secondary,'',false,'🔎'),
  ];
  const p=g.store.get(g.guild,g.actor);
  if(p.nuke>0)controls.push(button(g,'nuke','قنبلة نووية',ButtonStyle.Secondary,'',false,'☢️'));
  return rows(controls);
}
export function shopPayload(g,user){
  const p=g.store.get(g.guild,user);
  const embed=new EmbedBuilder().setColor(purple).setTitle('🛒 متجر الروليت')
    .setDescription(`رصيدك: **${p.points}** نقطة\nالأغراض تبقى معك حتى استخدامها، داخل هذا السيرفر.\nالشراء متاح للمشاركين أثناء التسجيل فقط.`)
    .addFields(Object.entries(ITEMS).map(([key,item])=>({name:`${item.emoji} ${item.name} — ${item.price} نقطة`,value:`تملك: **${p[key]}**\n${key==='reflect'?'تعكس طردًا واحدًا على المهاجم. لا تحمي من المهلة أو النووي.':key==='reveal'?'يكشف لك وحدك حاملي المرتدة الحاليين، مرة واحدة أثناء دورك.':'استخدمها أثناء دورك لإنهاء القيم والفوز.'}`})));
  return {embeds:[embed],components:rows(Object.entries(ITEMS).map(([key,item])=>button(g,'buy',`${item.name} • ${item.price}`,ButtonStyle.Secondary,key)))};
}
export async function gamePayload(g){
  if(g.phase==='turn'){
    const filename='roulette.png';
    const callout=new TextDisplayBuilder().setContent(`> • ${mention(g.actor)}`);
    const wheel=new MediaGalleryBuilder().addItems(item=>item.setURL(`attachment://${filename}`).setDescription('عجلة الروليت بأسماء المتبقين'));
    return {
      flags:MessageFlags.IsComponentsV2,
      components:[callout,wheel],
      attachments:[],files:attachments(await rouletteCard(g),filename),
      allowedMentions:{parse:[],users:[g.actor]},
    };
  }
  const embed=new EmbedBuilder().setColor(purple);
  let description='',files=[],content=null;
  if(g.phase==='lobby'){
    content=lobbyContent(g);
    if(!lobbyCache.has(g.type))lobbyCache.set(g.type,lobbyCard(g.type));
    files=attachments(await lobbyCache.get(g.type),'lobby.png');
  }else if(g.phase==='reverse'){
    content=`> 🎲 اختارت الروليت ${mention(g.actor)}. سيتم طرده ${until(g)}.`;
    files=attachments(await rouletteCard(g),'roulette.png');embed.setTitle(GAME_NAMES[g.type]).setImage('attachment://roulette.png');
  }else if(g.phase==='hiding'){
    const hidden=g.alive().filter(p=>p.spot!==null).length;
    content=`> 🕵️ لديك **${g.duration/1000} ثانية** لاختيار زر للاختباء ${until(g)}.\nاختبأ **${hidden}/${g.alive().length}** لاعب.`;
  }else if(g.phase==='seeking')content=`> 🕵️ ${mention(g.actor)} لديك **${g.duration/1000} ثانية** لكشف مربع ${until(g)}.`;
  else if(g.phase==='chair-ready')content=`> ⏰ **خلك جاهز!** الجولة ${g.round+1} تبدأ ${until(g)}.`;
  else if(g.phase==='chairs'){
    const seconds=g.duration/1000;
    content=g.red?`> 🔴 **لا تحجز!** مدة الجولة ${seconds} ثوانٍ.`:`> 🟢 **احجز!** عندك ${seconds} ثوانٍ.`;
  }else if(g.phase==='duel'){
    content=`> 🎮 الجولة **${g.round}** · الدور على ${mention(g.actor)} ${until(g)}.`;
    description=`**المواجهة:** ${g.duel.map(mention).join(' ضد ')}`;
    embed.setColor(0x29282e);
    const actor=g.player(g.actor);if(actor.avatar)embed.setThumbnail(actor.avatar);
  }
  if(description)embed.setDescription(description);
  if(g.phase==='reverse')embed.setFooter({text:footer(g)});
  const hasEmbed=Boolean(description)||g.phase==='reverse';
  return {content,embeds:hasEmbed?[embed]:[],attachments:[],files,allowedMentions:{parse:[],users:g.actor?[g.actor]:[]}};
}
export function resultsPayload(g,results){
  const grouped=new Map();
  for(const result of results){
    const key=JSON.stringify([result.bomb,result.withdrawn,result.reason,result.roulette,result.emptyHideNumber]);
    if(!grouped.has(key))grouped.set(key,[]);
    grouped.get(key).push(result);
  }
  const lines=[];
  const users=[];
  for(const group of grouped.values()){
    const first=group[0];
    if(first.emptyHideNumber!==undefined){
      lines.push(`لم يتم العثور على أحد في الرقم **${first.emptyHideNumber}**.`);
      continue;
    }
    const targets=group.map(result=>mention(result.id)).join('، ');
    const player=group.length===1?'اللاعب':'اللاعبين';
    const event=first.roulette;
    if(event?.kind==='nuke'){
      lines.push(`**قنبلة نووية!!** تم تفعيل الخاصية من قبل ${mention(event.actor)} وطرد جميع اللاعبين ☢️.`);
      users.push(event.actor);
      continue;
    }
    users.push(...group.map(result=>result.id));
    if(event?.kind==='reflect'){
      lines.push(`**هجمة مرتدة!!** محاولة لطرد ${mention(event.target)}، تم تفعيل الخاصية وطرد ${targets} 💥.`);
      users.push(event.target);
    }else if(event){
      const random=event.kind==='random'?' عشوائيًا':'';
      const next=g.alive().length>1?'، سوف تبدأ الجولة القادمة قريباً ⏰':'';
      lines.push(`تم طرد ${targets}${random}${next}`);
    }else if(first.bomb)lines.push(`💥 **بوم!** تم تفجير ${targets} وطرده من القيم.`);
    else if(first.withdrawn)lines.push(`انسحب ${player} ${targets}.`);
    else lines.push(`تم طرد ${player} ${targets}${first.reason?' '+first.reason:''}`);
    if(first.survivor&&g.alive().length>1){
      lines.push(`✅ تأهل ${mention(first.survivor)} للجولة اللي بعدها.`);
      users.push(first.survivor);
    }
  }
  return {content:lines.join('\n'),allowedMentions:{parse:[],users:[...new Set(users)]}};
}
export async function winPayload(g,stats){
  if(!g.winner)return {content:'انتهى القيم بدون فائز؛ خرج جميع اللاعبين.',embeds:[],components:[],allowedMentions:{parse:[]}};
  const p=g.player(g.winner),file=await winnerCard(p,stats);
  return {content:`🏆 ${mention(p.id)} فوز مستحق!`,
    embeds:[],files:attachments(file,'winner.png'),
    components:[],allowedMentions:{parse:[],users:[p.id]}};
}
