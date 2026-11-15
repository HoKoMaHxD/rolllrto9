import { Game } from './engine.js';
import { gamePayload,gameComponents,controlComponents,shopPayload,winPayload,resultsPayload,lobbyContent } from './views.js';
import { ComponentType, MessageFlags } from 'discord.js';

function lockTurnComponents(components) {
  return components.map(component=>{
    const data=component.toJSON();
    if(data.type!==ComponentType.ActionRow)return data;
    return {...data,components:data.components.map(button=>({...button,disabled:true}))};
  });
}

export class SerialQueue {
  constructor(){this.tails=new Map();}
  run(key,fn){
    const next=(this.tails.get(key)||Promise.resolve()).then(fn);
    const tail=next.catch(()=>{});this.tails.set(key,tail);
    tail.finally(()=>{if(this.tails.get(key)===tail)this.tails.delete(key);});
    return next;
  }
}
export class GameManager {
  constructor(store,config,{payload=gamePayload,winner=winPayload,now=()=>Date.now()}={}){
    this.store=store;this.config=config;this.queue=new SerialQueue();this.games=new Map();this.now=now;
    this.payload=payload;this.winnerPayload=winner;
    this.eyes={};
    store.db.exec('CREATE TABLE IF NOT EXISTS active_messages (game TEXT PRIMARY KEY, channel TEXT, main TEXT, controls TEXT, extra TEXT)');
  }
  remember(e){this.store.db.prepare('INSERT OR REPLACE INTO active_messages(game,channel,main,controls,extra) VALUES(?,?,?,?,?)').run(e.game.id,e.channel.id,e.main?.id||null,e.controls?.id||null,e.extra?.id||null);}
  forget(e){clearTimeout(e.timer);clearTimeout(e.repaint);if(this.games.get(e.channel.id)===e)this.games.delete(e.channel.id);this.store.db.prepare('DELETE FROM active_messages WHERE game=?').run(e.game.id);}
  scheduleSync(e){
    if(e.repaint)return;
    e.repaint=setTimeout(()=>{
      e.repaint=null;
      this.queue.run(e.channel.id,async()=>{if(this.games.get(e.channel.id)===e)await this.sync(e);}).catch(error=>this.fail(e,error));
    },450);
    e.repaint.unref?.();
  }
  async start(channel,type,host){
    return this.queue.run(channel.id,async()=>{
      if(this.games.has(channel.id))throw new Error('يوجد قيم شغال في هذا الروم. انتظر نهايته أو استخدم +وقف.');
      const game=new Game({type,guild:channel.guild.id,channel:channel.id,host,store:this.store,settings:this.config});
      const e={game,channel,main:null,controls:null,extra:null,timer:null};this.games.set(channel.id,e);
      try{await this.sync(e);}catch(error){await this.fail(e,error);throw error;}
      return e;
    });
  }
  async sync(e){
    clearTimeout(e.repaint);e.repaint=null;
    const g=e.game;
    if(['ended','cancelled'].includes(g.phase)){
      clearTimeout(e.timer);
      if(e.announced)return;
      // Commit the result before doing network I/O. Repeated calls cannot award twice.
      const stats=g.winner?this.store.reward(g.id,g.guild,g.winner):null;
      try{
        await this.closePanel(e);
        await this.publishResults(e);
        const payload=g.phase==='ended'?await this.winnerPayload(g,stats):{content:g.cancelReason,allowedMentions:{parse:[]}};
        await e.channel.send(payload);e.announced=true;
      }finally{this.forget(e);}
      return;
    }

    const changed=g.version!==e.renderedVersion;
    const registrationClosed=e.renderedPhase==='lobby'&&g.phase!=='lobby';
    const sameChairPanel=e.renderedPhase==='chair-ready'&&g.phase==='chairs';
    const replacePanel=e.main&&changed&&!sameChairPanel&&g.type!=='hide';
    if(replacePanel||registrationClosed){
      await this.closePanel(e);
      e.main=null;
      e.turnComponents=null;
      this.remember(e);
    }
    if(registrationClosed&&g.type==='roulette'){
      await e.channel.send({content:'تم الانتهاء من تسجيل جميع اللاعبين',allowedMentions:{parse:[]}});
    }
    if(g.phase==='intermission'){
      if(e.main)await this.closePanel(e); // Preserve the eye positions visibly on the hide board.
      await this.publishResults(e);
      if(!g.deadline)g.deadline=this.now()+g.duration;
      this.armTimer(e);
      return;
    }
    if(g.phase!=='chairs')await this.publishResults(e);
    const openChairRound=g.phase==='chairs'&&!g.deadline;
    if(!g.deadline&&g.phase!=='turn'&&!openChairRound)g.deadline=this.now()+g.duration;
    const payload=await this.payload(g);
    if(!g.deadline&&!openChairRound)g.deadline=this.now()+g.duration;
    const board=gameComponents(g,{eyes:this.eyes});
    const controls=controlComponents(g);
    const galleryTurn=payload.flags===MessageFlags.IsComponentsV2;
    const inlineControls=galleryTurn?board.length<=5:board.length<5;
    const actionRows=board.slice(0,5).concat(inlineControls?controls:[]);
    payload.components=galleryTurn?payload.components.concat(actionRows):actionRows;
    // Membership updates reuse the existing banner instead of reuploading a PNG for every click.
    if(e.main&&g.phase==='lobby'&&!changed){delete payload.files;delete payload.attachments;}
    if(e.main)await e.main.edit(payload);else e.main=await e.channel.send(payload);
    e.turnComponents=galleryTurn?payload.components:null;
    e.renderedVersion=g.version;
    e.renderedPhase=g.phase;
    this.remember(e);
    const extraRows=board.slice(5,10);
    if(extraRows.length){
      const extra={content:'بقية الخيارات',components:extraRows,allowedMentions:{parse:[]}};
      if(e.extra)await e.extra.edit(extra);else e.extra=await e.channel.send(extra);
      this.remember(e);
    }else if(e.extra)await e.extra.edit({content:'—',components:[]});
    if(!inlineControls&&controls.length){
      const options={content:'خيارات القيم',components:controls,allowedMentions:{parse:[]}};
      if(e.controls)await e.controls.edit(options);else e.controls=await e.channel.send(options);
      this.remember(e);
    }
    // Let players see all enabled seats before the short reservation window starts.
    if(openChairRound)g.deadline=this.now()+g.duration;
    this.armTimer(e);
  }
  async closePanel(e){
    const keepBoard=['duel','seeking'].includes(e.renderedPhase);
    let board=[];
    if(e.turnComponents)board=lockTurnComponents(e.turnComponents);
    else if(keepBoard)board=gameComponents(e.game,{phase:e.renderedPhase,locked:true,eyes:this.eyes});
    const messages=[{message:e.main,components:board},{message:e.extra,components:[]},{message:e.controls,components:[]}];
    await Promise.all(messages.map(async ({message,components})=>{
      if(!message)return;
      const update={components,allowedMentions:{parse:[]}};
      if(message===e.main&&e.renderedPhase==='lobby')update.content=lobbyContent(e.game);
      try{await message.edit(update);}
      catch(error){if(error.code!==10008)throw error;} // A deleted round has no buttons left to close.
    }));
    e.extra=null;
    e.controls=null;
  }
  async publishResults(e){
    const results=e.game.results;
    if(!results.length)return;
    await e.channel.send(resultsPayload(e.game,results));
    e.game.results=[];
  }
  armTimer(e){
    const g=e.game;
    clearTimeout(e.timer);
    const version=g.version;
    e.timer=setTimeout(()=>{this.queue.run(e.channel.id,async()=>{
      if(this.games.get(e.channel.id)!==e||g.version!==version)return;
      if(g.timeout(version))await this.sync(e);
    }).catch(error=>this.fail(e,error));},Math.max(1,g.deadline-this.now()));
    e.timer.unref?.();
  }
  async fail(e,error){
    console.error('[GAME_ERROR]',error.code||error.name); // Never log tokens or interaction objects.
    this.forget(e);
    for(const m of [e.main,e.controls,e.extra])if(m){
      const components=m===e.main&&e.turnComponents?lockTurnComponents(e.turnComponents):[];
      await m.edit({components,allowedMentions:{parse:[]}}).catch(()=>{});
    }
    const message=e.game.winner?'تعذر عرض بطاقة الفوز؛ احتُسبت نقطة الفوز والفوزة.':'توقف القيم بسبب خطأ في إرسال الرسائل. راجع صلاحيات البوت وسجل الاستضافة.';
    await e.channel.send({content:message,allowedMentions:{parse:[]}}).catch(()=>{});
  }
  async click({channelId,guildId,id,version,action,value,user,receivedAt,respond}){
    return this.queue.run(channelId,async()=>{
      const e=this.games.get(channelId);
      if(!e||e.game.id!==id||e.game.guild!==guildId)throw new Error('انتهى هذا القيم أو أُعيد تشغيل البوت.');
      const g=e.game;
      g.check(version);
      // A late request must not beat an expired timer that is still in the event queue.
      if(g.deadline && receivedAt>=g.deadline){g.timeout(g.version);try{await this.sync(e);}catch(error){await this.fail(e,error);}throw new Error('انتهت مهلة هذا الدور.');}
      let response=null,dirty=true;
      switch(action){
        case 'join':g.add({...user,joinedAt:receivedAt});response='تم الدخول';break;
        case 'leave':g.remove(user.id);response='تم الخروج';break;
        case 'shop':g.requirePlayer(user.id);if(g.phase!=='lobby'||g.type!=='roulette')throw new Error('المتجر مغلق.');await respond(shopPayload(g,user.id));return;
        case 'buy':g.buy(user.id,value);await respond({...shopPayload(g,user.id),content:'تم الشراء ✅'});return;
        case 'kick':g.kick(user.id,value);break;
        case 'random-kick':g.kick(user.id,null);break;
        case 'withdraw':g.withdraw(user.id);break;
        case 'reveal':{
          const ids=g.reveal(user.id);response=ids.length?`🔎 معهم مرتدة الآن: ${ids.map(x=>`<@${x}>`).join('، ')}\nتم استهلاك كشف واحد.`:'🔎 لا يوجد لاعب متبقٍ معه مرتدة. تم استهلاك كشف واحد.';dirty=false;break;
        }
        case 'nuke':g.nuke(user.id);break;
        case 'hide':g.hide(user.id,Number(value));response=`اختبأت في المربع ${value}. اختيارك سري.`;break;
        case 'seek':g.seek(user.id,Number(value));break;
        case 'chair':g.chair(user.id,Number(value));break;
        case 'mine':g.mine(user.id,Number(value));break;
        default:throw new Error('زر غير معروف.');
      }
      // Result persistence must not depend on the ephemeral confirmation succeeding.
      if(g.winner)this.store.reward(g.id,g.guild,g.winner);
      if(response)await respond({content:response,embeds:[],components:[],allowedMentions:{parse:[]}});
      if(dirty){
        if(g.version===version)this.scheduleSync(e);
        else try{await this.sync(e);}catch(error){await this.fail(e,error);}
      }
    });
  }
  async stop(channelId,userId,admin){
    return this.queue.run(channelId,async()=>{
      const e=this.games.get(channelId);if(!e)throw new Error('لا يوجد قيم شغال هنا.');
      if(!admin&&e.game.host!==userId)throw new Error('الإيقاف لصاحب القيم أو الإدارة فقط.');
      e.game.cancel('تم إيقاف القيم.');await this.sync(e);
    });
  }
  async recover(client){
    // In-progress rounds are cancelled on restart, but stats and inventory survive.
    for(const row of this.store.db.prepare('SELECT * FROM active_messages').all()){
      try{
        const channel=await client.channels.fetch(row.channel);
        if(channel?.isTextBased()){
          for(const id of [row.main,row.controls,row.extra].filter(Boolean)){
            try{
              const m=await channel.messages.fetch(id);
              const components=m.flags?.has(MessageFlags.IsComponentsV2)?lockTurnComponents(m.components):[];
              await m.edit({components,allowedMentions:{parse:[]}});
            }catch{}
          }
          await channel.send({content:'أُعيد تشغيل البوت؛ أُلغي القيم السابق. النقاط والفوزات والأغراض محفوظة. ابدأ قيمًا جديدًا.',allowedMentions:{parse:[]}});
        }
      }catch(error){console.error('[RECOVER]',error.code||error.name);}
      this.store.db.prepare('DELETE FROM active_messages WHERE game=?').run(row.game);
    }
  }
  async shutdown(){
    await Promise.all([...this.games.values()].map(e=>this.queue.run(e.channel.id,async()=>{e.game.cancel('توقف البوت؛ أُلغي القيم. النقاط والفوزات والأغراض محفوظة.');await this.sync(e).catch(error=>this.fail(e,error));})));
  }
}
