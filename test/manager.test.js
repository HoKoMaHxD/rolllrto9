import test from 'node:test';
import assert from 'node:assert/strict';
import { GameManager,SerialQueue } from '../src/manager.js';
import { Store } from '../src/store.js';
import { gameComponents,controlComponents,shopPayload,gamePayload,winPayload } from '../src/views.js';
import { commands } from '../src/commands.js';
import { ButtonStyle, ComponentType, MessageFlags, MessagePayload } from 'discord.js';

function setup(t,{roundGapMs=0,payload=async()=>({})}={}){
  const store=new Store(':memory:');let time=1000000;
  const config={name:'Test',maxPlayers:50,lobbyMs:20000,turnMs:20000,hideMs:20000,chairMs:3000,reverseMs:4000,roundGapMs};
  const sent=[];
  const channel={id:'c',guild:{id:'g'},async send(payload){
    const msg={id:String(sent.length+1),payload,async edit(p){this.payload={...this.payload,...p};return this;}};sent.push(msg);return msg;
  }};
  const manager=new GameManager(store,config,{now:()=>time,payload,winner:async(g,stats)=>({content:g.winner?`winner:${g.winner}:${stats.wins}`:'no winner'})});
  t.after(()=>{for(const e of manager.games.values()){clearTimeout(e.timer);clearTimeout(e.repaint);}store.close();});
  const replies=[];
  const click=(e,user,action,value='',version=e.game.version)=>manager.click({channelId:'c',guildId:'g',id:e.game.id,version,action,value,user:{id:user,name:user},receivedAt:time,respond:async payload=>{replies.push(payload);}});
  const expire=async e=>{time=e.game.deadline;assert.ok(e.game.timeout(e.game.version));await manager.sync(e);};
  return {manager,channel,store,sent,click,replies,expire,time:()=>time,advance:ms=>{time+=ms;}};
}
test('serial queue preserves ordering across errors without blocking another channel',async()=>{
  const q=new SerialQueue(),order=[];
  const first=q.run('a',async()=>{await new Promise(r=>setTimeout(r,10));order.push(1);throw new Error('expected');});
  const second=q.run('a',async()=>{order.push(2);});const other=q.run('b',async()=>{order.push('b');});
  await Promise.allSettled([first,second,other]);assert.deepEqual(order,['b',1,2]);
});
test('simultaneous joins preserve order and do not reset lobby deadline',async t=>{
  const {manager,channel,click}=setup(t),e=await manager.start(channel,'roulette','host');const deadline=e.game.deadline;
  await Promise.all(Array.from({length:50},(_,i)=>click(e,String(i+1),'join')));
  assert.equal(e.game.players.length,50);assert.equal(e.game.deadline,deadline);assert.equal(e.game.players[49].id,'50');
  await assert.rejects(()=>manager.start(channel,'hide','host'));await assert.rejects(()=>click(e,'1','join'));
});
test('simultaneous kicks from the same turn only eliminate one target',async t=>{
  const {manager,channel,click}=setup(t),e=await manager.start(channel,'roulette','host');
  for(const id of ['1','2','3','4'])await click(e,id,'join');e.game.start();await manager.sync(e);
  const v=e.game.version,actor=e.game.actor,targets=e.game.alive().filter(p=>p.id!==actor);
  const result=await Promise.allSettled([click(e,actor,'kick',targets[0].id,v),click(e,actor,'kick',targets[1].id,v)]);
  assert.equal(result.filter(x=>x.status==='fulfilled').length,1);assert.equal(e.game.alive().length,3);
});
test('deadline race rejects late action and eliminates timed-out actor',async t=>{
  const {manager,channel,click,advance}=setup(t),e=await manager.start(channel,'roulette','host');
  for(const id of ['1','2','3'])await click(e,id,'join');e.game.start();await manager.sync(e);
  const actor=e.game.actor,target=e.game.alive().find(p=>p.id!==actor).id;advance(20000);
  await assert.rejects(()=>click(e,actor,'kick',target));assert.equal(e.game.player(actor).alive,false);assert.equal(e.game.player(target).alive,true);
});
test('concurrent seat claims permit exactly one claimant',async t=>{
  const {manager,channel,click}=setup(t),e=await manager.start(channel,'chairs','host');
  for(const id of ['1','2','3'])await click(e,id,'join');e.game.rng=n=>n-1;e.game.start();await manager.sync(e);
  const results=await Promise.allSettled([click(e,'1','chair','0'),click(e,'2','chair','0')]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(e.game.seats.filter(Boolean).length,1);
});
test('50-player roulette splits components into legal messages; all player IDs are represented',async t=>{
  const {manager,channel,click}=setup(t,{payload:gamePayload}),e=await manager.start(channel,'roulette','host');
  for(let i=1;i<=50;i++)await click(e,String(i),'join');e.game.start();await manager.sync(e);
  const firstRows=e.main.payload.components.slice(2);
  assert.equal(firstRows.length,5);
  assert.ok(e.extra.payload.components.length<=5);
  assert.equal(e.controls.payload.components.length,1);
  const rows=[...firstRows,...e.extra.payload.components];
  assert.ok(rows.every(row=>row.toJSON().components.length<=5));
  const ids=rows.flatMap(row=>row.toJSON().components.map(button=>button.custom_id.split(':').at(-1)));
  assert.deepEqual(ids,e.game.alive().filter(player=>player.id!==e.game.actor).map(player=>player.id));
});
test('shop has latest correct prices and serializable command definitions',async t=>{
  const {manager,channel,click}=setup(t),e=await manager.start(channel,'roulette','host');await click(e,'1','join');
  const shop=shopPayload(e.game,'1');const fields=shop.embeds[0].toJSON().fields;
  assert.ok(shop.components[0].toJSON().components.every(button=>button.style===ButtonStyle.Secondary));
  assert.ok(fields[0].name.includes('2'));assert.ok(fields[1].name.includes('1'));assert.ok(fields[2].name.includes('10'));
  assert.ok(commands.find(c=>c.name==='اضافة').default_member_permissions);assert.equal(commands.find(c=>c.name==='اضافة').options[0].name,'نقاط');
});
test('hide board has 25 squares and no withdrawal control',async t=>{
  const {manager,channel,click}=setup(t),e=await manager.start(channel,'hide','host');await click(e,'1','join');await click(e,'2','join');e.game.start();await manager.sync(e);
  assert.equal(e.main.payload.components.length,5);assert.equal(controlComponents(e.game).length,0);assert.equal(e.controls,null);
  assert.equal(e.main.payload.components.flatMap(r=>r.toJSON().components).length,25);
});
test('winner is rewarded once; finished game is released and buttons disabled',async t=>{
  const {manager,channel,click,store,sent}=setup(t),e=await manager.start(channel,'roulette','host');await click(e,'1','join');await click(e,'2','join');
  e.game.start();await manager.sync(e);const winner=e.game.actor,target=e.game.alive().find(p=>p.id!==winner).id;
  await click(e,winner,'kick',target);assert.equal(store.get('g',winner).wins,1);assert.equal(store.get('g',winner).points,1);
  assert.equal(manager.games.has('c'),false);assert.deepEqual(e.main.payload.components,[]);assert.match(sent.at(-1).payload.content,/winner:/);
  await manager.sync(e);assert.equal(store.get('g',winner).wins,1);assert.equal(sent.filter(m=>m.payload.content?.startsWith('winner:')).length,1);
});
test('only host/admin can stop, cancellation grants no rewards',async t=>{
  const {manager,channel,click,store}=setup(t),e=await manager.start(channel,'roulette','host');await click(e,'1','join');
  await assert.rejects(()=>manager.stop('c','other',false));await manager.stop('c','host',false);assert.equal(store.get('g','1').wins,0);
});
test('restart recovery clears stale components and keeps inventory and points',async t=>{
  const {manager,channel,click,store,sent}=setup(t),e=await manager.start(channel,'roulette','host');await click(e,'1','join');store.adjust('g','1',5,'admin');store.buy('g','1','reflect');
  clearTimeout(e.timer);clearTimeout(e.repaint);manager.games.clear();channel.isTextBased=()=>true;channel.messages={fetch:async id=>sent.find(m=>m.id===id)};
  await manager.recover({channels:{fetch:async()=>channel}});assert.deepEqual(e.main.payload.components,[]);assert.equal(store.get('g','1').points,3);assert.equal(store.get('g','1').reflect,1);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM active_messages').get().n,0);
});

test('both roulette modes announce the victim publicly, close the turn, and post a new message after five seconds',async t=>{
  for(const type of ['roulette','reverse']){
    const {manager,channel,click,replies,sent,expire,time}=setup(t,{roundGapMs:5000,payload:gamePayload});
    const e=await manager.start(channel,type,'host');
    for(const id of ['1','2','3'])await click(e,id,'join');
    await expire(e);
    const oldPanel=e.main;
    const target=type==='reverse'?e.game.actor:e.game.alive().find(p=>p.id!==e.game.actor).id;
    const replyCount=replies.length;
    if(type==='reverse')await expire(e);
    else await click(e,e.game.actor,'kick',target);
    assert.equal(replies.length,replyCount);
    assert.equal(e.game.deadline-time(),5000);
    if(type==='roulette'){
      assert.equal(oldPanel.payload.components[0].type,ComponentType.TextDisplay);
      assert.equal(oldPanel.payload.components[1].items[0].media.url,'attachment://roulette.png');
      const buttons=oldPanel.payload.components.slice(2).flatMap(row=>row.components);
      assert.ok(buttons.length>0&&buttons.every(button=>button.disabled));
      assert.equal(sent.at(-1).payload.content,`تم طرد <@${target}>، سوف تبدأ الجولة القادمة قريباً ⏰`);
    }else{
      assert.deepEqual(oldPanel.payload.components,[]);
      assert.equal(sent.at(-1).payload.content,`تم طرد اللاعب <@${target}>`);
    }
    assert.deepEqual(sent.at(-1).payload.allowedMentions.users,[target]);
    assert.equal(e.main,null);
    await expire(e);
    assert.notEqual(e.main.id,oldPanel.id);
  }
});

test('chairs publishes a full three-second ready-to-book window after the buttons appear',async t=>{
  const {manager,channel,click,replies,sent,expire,time,advance}=setup(t,{roundGapMs:5000,payload:gamePayload});
  const e=await manager.start(channel,'chairs','host');
  for(const id of ['1','2','3','4'])await click(e,id,'join');
  let roll=0;e.game.rng=()=>roll;
  await expire(e);
  const ready=e.main;
  assert.match(ready.payload.content,/خلك جاهز/);
  assert.equal(e.game.deadline-time(),5000);
  assert.ok(ready.payload.components[0].toJSON().components.every(b=>b.disabled));
  await expire(e);
  assert.equal(e.main.id,ready.id);
  assert.match(e.main.payload.content,/لا تحجز/);
  assert.equal(e.game.deadline-time(),3000);
  const replyCount=replies.length;
  await click(e,'1','chair','0');
  assert.equal(replies.length,replyCount);
  await expire(e);
  assert.match(sent.at(-2).payload.content,/تم طرد اللاعب <@1>/);
  assert.notEqual(e.main.id,ready.id);
  assert.match(e.main.payload.content,/خلك جاهز/);
  const next=e.main.id;
  const edit=e.main.edit.bind(e.main);
  e.main.edit=async payload=>{advance(900);return edit(payload);};
  roll=99;await expire(e);
  assert.equal(e.main.id,next);
  assert.match(e.main.payload.content,/🟢 \*\*احجز.*3 ثوانٍ/);
  assert.equal(e.game.deadline-time(),3000);
  advance(2999);
  await click(e,'2','chair','0');
  assert.equal(e.game.seats[0],'2');
  advance(1);
  await assert.rejects(()=>click(e,'3','chair','1'),/انتهت مهلة/);
});

test('mines passes safe turns immediately and pauses one second before a new duel',async t=>{
  const {manager,channel,click,replies,sent,expire,time}=setup(t,{roundGapMs:5000,payload:gamePayload});
  const e=await manager.start(channel,'mines','host');
  for(const id of ['1','2','3'])await click(e,id,'join');
  e.game.rng=()=>0;await expire(e);
  const first=e.main;
  const firstActor=e.game.actor;
  assert.deepEqual(first.payload.components.slice(0,3).map(row=>row.toJSON().components.length),[3,3,3]);
  assert.equal(first.payload.components[0].toJSON().components[0].emoji,undefined);
  const replyCount=replies.length;
  const messageCount=sent.length;
  const nextActor=e.game.duel.find(id=>id!==firstActor);
  await click(e,firstActor,'mine','9');
  const safe=first.payload.components[2].toJSON().components[2];
  assert.equal(safe.style,3);assert.equal(safe.emoji.name,'👁️');assert.ok(safe.disabled);
  assert.equal(sent.length,messageCount+1);
  assert.equal(e.game.phase,'duel');
  assert.equal(e.game.actor,nextActor);
  assert.equal(e.game.deadline-time(),20000);
  const second=e.main,secondActor=e.game.actor;
  assert.notEqual(second.id,first.id);
  assert.ok(second.payload.content.includes(`<@${nextActor}>`));
  assert.ok(second.payload.components[2].toJSON().components[2].disabled);
  await click(e,secondActor,'mine','1');
  const bomb=second.payload.components[0].toJSON().components[0];
  assert.equal(bomb.style,4);assert.equal(bomb.emoji.name,'💣');assert.ok(bomb.disabled);
  assert.match(sent.at(-1).payload.content,new RegExp(`بوم.*تم تفجير <@${secondActor}>`));
  assert.match(sent.at(-1).payload.content,new RegExp(`تأهل <@${firstActor}>`));
  assert.equal(replies.length,replyCount);
  assert.equal(e.game.phase,'intermission');
  assert.equal(e.game.deadline-time(),1000);
  await expire(e);
  assert.ok(e.game.duel.includes(firstActor));
});

test('hide swaps a closed eye for an open eye without privately replying to a reveal',async t=>{
  const {manager,channel,click,replies,sent,expire}=setup(t,{roundGapMs:5000});
  manager.eyes={closed:'123456789012345678',open:'223456789012345678'};
  const e=await manager.start(channel,'hide','host');
  for(const id of ['1','2','3'])await click(e,id,'join');
  await expire(e);
  for(const id of ['1','2','3'])await click(e,id,'hide',id);
  await expire(e);
  const board=e.main;
  assert.equal(board.payload.components[0].toJSON().components[0].emoji.id,manager.eyes.closed);
  const replyCount=replies.length;
  const previousCount=sent.length;
  await click(e,e.game.actor,'seek','25');
  assert.equal(sent.length,previousCount+1);
  assert.equal(sent.at(-1).payload.content,'لم يتم العثور على أحد في الرقم **25**.');
  assert.deepEqual(sent.at(-1).payload.allowedMentions.users,[]);
  assert.equal(e.game.alive().length,3);
  assert.equal(board.payload.components[4].toJSON().components[4].emoji.id,manager.eyes.open);
  assert.equal(replies.length,replyCount);
  await expire(e);
  await click(e,e.game.actor,'seek','1');
  const opened=board.payload.components[0].toJSON().components[0];
  assert.equal(opened.emoji.id,manager.eyes.open);
  assert.ok(opened.disabled);
  assert.equal(replies.length,replyCount);
  assert.match(sent.at(-1).payload.content,/تم طرد اللاعب <@1>/);
  await expire(e);
  assert.equal(e.main.id,board.id);
  assert.equal(e.main.payload.components[0].toJSON().components[1].disabled,false);
});

test('win message contains only trophy, mention, congratulations, and award image',async()=>{
  const payload=await winPayload({winner:'1',player:()=>({id:'1',name:'Player'})},{wins:6,points:10});
  assert.equal(payload.content,'🏆 <@1> فوز مستحق!');
  assert.deepEqual(payload.embeds,[]);
  assert.equal(payload.files.length,1);
  assert.equal(payload.files[0].name,'winner.png');
  assert.deepEqual(payload.allowedMentions.users,['1']);
});

test('every game confirms lobby entry and exit with the exact short text',async t=>{
  for(const type of ['roulette','reverse','hide','chairs','mines']){
    const {manager,channel,click,replies}=setup(t);
    const e=await manager.start(channel,type,'host');
    await click(e,'1','join');
    await click(e,'1','leave');
    assert.deepEqual(replies.map(reply=>reply.content),['تم الدخول','تم الخروج']);
    assert.equal(e.game.players.length,0);
  }
});

test('withdraw is available only in regular roulette, and lobby exit cannot eliminate anyone',async t=>{
  for(const type of ['roulette','reverse','hide','chairs','mines']){
    const {manager,channel,click,expire}=setup(t);
    const e=await manager.start(channel,type,'host');
    for(const id of ['1','2','3'])await click(e,id,'join');
    await expire(e);
    const buttons=controlComponents(e.game).flatMap(row=>row.toJSON().components);
    const hasWithdraw=buttons.some(button=>button.label==='انسحاب');
    assert.equal(hasWithdraw,type==='roulette');
    await assert.rejects(()=>click(e,'1','leave'),/انتهى التسجيل/);
    if(type==='roulette'){
      await click(e,'1','withdraw');
      assert.equal(e.game.player('1').alive,false);
    }else{
      await assert.rejects(()=>click(e,'1','withdraw'),/الروليت العادي فقط/);
      assert.equal(e.game.player('1').alive,true);
    }
  }
});

test('random roulette kick is silent, excludes the actor, and disables at exactly nine players',async t=>{
  const {manager,channel,click,replies,sent,expire}=setup(t,{roundGapMs:5000});
  const e=await manager.start(channel,'roulette','host');
  for(let n=1;n<=10;n++)await click(e,String(n),'join');
  e.game.rng=()=>0;
  await expire(e);
  const randomButton=()=>controlComponents(e.game)[0].toJSON().components.find(button=>button.label==='طرد عشوائي');
  const actor=e.game.actor;
  const target=e.game.alive().find(player=>player.id!==actor).id;
  assert.equal(randomButton().disabled,false);
  await assert.rejects(()=>click(e,target,'random-kick'),/هذا ليس دورك/);
  const replyCount=replies.length;
  await click(e,actor,'random-kick');
  assert.ok(e.game.player(actor).alive);
  assert.equal(e.game.player(target).alive,false);
  assert.equal(replies.length,replyCount);
  assert.equal(sent.at(-1).payload.content,`تم طرد <@${target}> عشوائيًا، سوف تبدأ الجولة القادمة قريباً ⏰`);
  await expire(e);
  assert.equal(e.game.alive().length,9);
  assert.equal(randomButton().disabled,true);
  await assert.rejects(()=>click(e,e.game.actor,'random-kick'),/9 لاعبين/);
  const manualTarget=e.game.alive().find(player=>player.id!==e.game.actor).id;
  await click(e,e.game.actor,'kick',manualTarget);
  assert.equal(e.game.player(manualTarget).alive,false);
  assert.equal(replies.length,replyCount);
});

test('random kick uses the same reflection as a chosen target',async t=>{
  const {manager,channel,click,store,expire,sent}=setup(t);
  const e=await manager.start(channel,'roulette','host');
  for(let n=1;n<=10;n++)await click(e,String(n),'join');
  e.game.rng=()=>0;
  await expire(e);
  const actor=e.game.actor;
  const target=e.game.alive().find(player=>player.id!==actor).id;
  store.adjust('g',target,2,'admin');store.buy('g',target,'reflect');
  await click(e,actor,'random-kick');
  assert.equal(e.game.player(actor).alive,false);
  assert.equal(e.game.player(target).alive,true);
  assert.equal(store.get('g',target).reflect,0);
  const announcement=sent.find(message=>message.payload.content?.startsWith('**هجمة مرتدة!!**'));
  assert.equal(announcement.payload.content,`**هجمة مرتدة!!** محاولة لطرد <@${target}>، تم تفعيل الخاصية وطرد <@${actor}> 💥.`);
  assert.deepEqual(announcement.payload.allowedMentions.users,[actor,target]);
});

test('all five registration messages show the actual start time until registration closes',async t=>{
  for(const type of ['roulette','reverse','hide','chairs','mines']){
    const {manager,channel,click,expire,time,advance}=setup(t,{payload:gamePayload});
    const e=await manager.start(channel,type,'host');
    const lobby=e.main;
    const deadline=time()+20_000;
    const countdown=`> ⏰ يبدأ القيم <t:${Math.ceil(deadline/1000)}:R>`;
    assert.equal(lobby.payload.content,`المشتركين: **0**\n${countdown}`);
    assert.deepEqual(lobby.payload.embeds,[]);
    assert.equal(lobby.payload.files[0].name,'lobby.png');
    assert.ok(lobby.payload.components[0].toJSON().components.every(button=>button.style===ButtonStyle.Secondary));
    advance(4000);
    await click(e,'1','join');
    await manager.sync(e);
    assert.equal(lobby.payload.content,`المشتركين: **1**\n${countdown}`);
    assert.equal(e.game.deadline,deadline);
    assert.deepEqual(lobby.payload.embeds,[]);
    await click(e,'2','join');
    await expire(e);
    assert.equal(lobby.payload.content,'المشتركين: **2**');
  }
});

test('regular roulette announces registration completion once before the first turn',async t=>{
  const {manager,channel,click,expire,sent}=setup(t,{payload:gamePayload});
  const e=await manager.start(channel,'roulette','host');
  const lobby=e.main;
  await click(e,'1','join');
  await click(e,'2','join');
  await expire(e);
  assert.equal(lobby.payload.content,'المشتركين: **2**');
  assert.deepEqual(lobby.payload.components,[]);
  assert.equal(sent[1].payload.content,'تم الانتهاء من تسجيل جميع اللاعبين');
  assert.equal(sent[2].id,e.main.id);
  assert.equal(sent[2].payload.components[0].toJSON().content,`> • <@${e.game.actor}>`);
  await manager.sync(e);
  assert.equal(sent.filter(message=>message.payload.content==='تم الانتهاء من تسجيل جميع اللاعبين').length,1);
});

test('the roulette turn posts a wheel, 25 numbered targets, and one control row without an embed',async t=>{
  const {manager,channel,click,store,expire}=setup(t,{payload:gamePayload});
  const e=await manager.start(channel,'roulette','host');
  for(let id=1;id<=26;id++)await click(e,String(id),'join');
  e.game.rng=()=>0;
  store.adjust('g','1',10,'admin');store.buy('g','1','nuke');
  await expire(e);
  const payload=e.main.payload;
  const serialized=await MessagePayload.create({client:{options:{}}},payload).resolveBody().resolveFiles();
  assert.equal(serialized.body.flags,MessageFlags.IsComponentsV2);
  assert.equal(serialized.body.embeds,undefined);
  assert.equal(serialized.body.content,undefined);
  assert.equal(serialized.body.components[0].content,'> • <@1>');
  assert.equal(serialized.body.components[1].items[0].media.url,'attachment://roulette.png');
  assert.equal(serialized.files[0].name,'roulette.png');
  const rows=serialized.body.components.slice(2);
  assert.deepEqual(rows.map(row=>row.components.length),[5,5,5,5,5,4]);
  assert.ok(rows.slice(0,-1).flatMap(row=>row.components).every(button=>button.style===2&&/^\d+ {2}/.test(button.label)));
  assert.deepEqual(rows.at(-1).components.map(button=>button.label),['طرد عشوائي','انسحاب','كشف','قنبلة نووية']);
  assert.equal(e.controls,null);
});

test('nuke publicly mentions its user once before the winner message, without messaging the eliminated players',async t=>{
  const {manager,channel,click,expire,store,sent,replies}=setup(t,{payload:gamePayload});
  const e=await manager.start(channel,'roulette','host');
  for(const id of ['1','2','3','4'])await click(e,id,'join');
  e.game.rng=()=>0;
  store.adjust('g','1',10,'admin');store.buy('g','1','nuke');
  await expire(e);
  const privateReplies=replies.length;
  await click(e,'1','nuke');
  assert.equal(replies.length,privateReplies);
  const announcement=sent.at(-2).payload;
  assert.equal(announcement.content,'**قنبلة نووية!!** تم تفعيل الخاصية من قبل <@1> وطرد جميع اللاعبين ☢️.');
  assert.deepEqual(announcement.allowedMentions.users,['1']);
  assert.equal(sent.at(-1).payload.content,'winner:1:1');
});
