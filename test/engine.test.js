import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Game, MINE_SQUARES } from '../src/engine.js';
import { Store } from '../src/store.js';

function fixture(t,type='roulette',count=4,rng=()=>0){
  const store=new Store(':memory:');t.after(()=>store.close());
  const game=new Game({type,guild:'g',channel:'c',host:'1',store,rng,settings:{roundGapMs:0}});
  for(let i=1;i<=count;i++)game.add({id:String(i),name:`Player ${i}`,avatar:null});
  return {game,store};
}
const buy=(store,game,id,item)=>{store.adjust('g',id,20,'admin');game.buy(id,item);};

test('lobby lasts 20 seconds and assigns contiguous numbers only at start in join order',t=>{
  const {game}=fixture(t);assert.equal(game.duration,20000);assert.ok(game.players.every(p=>p.number===null));
  game.remove('2');game.add({id:'2',name:'Rejoined'});game.start();
  assert.deepEqual(game.players.map(p=>[p.id,p.number]),[['1',1],['3',2],['4',3],['2',4]]);
  assert.throws(()=>game.add({id:'new'}));assert.equal(game.duration,20000);
});
test('one player is cancelled without a free win',t=>{const {game}=fixture(t,'roulette',1);game.start();assert.equal(game.phase,'cancelled');assert.equal(game.winner,null);});
test('duplicate joins and full lobbies are rejected',t=>{const {game}=fixture(t,'roulette',50);assert.throws(()=>game.add({id:'1'}));assert.throws(()=>game.add({id:'51'}));});
test('withdraw cannot create a dead participant in the lobby',t=>{const {game}=fixture(t,'roulette',2);assert.throws(()=>game.withdraw('1'));assert.equal(game.alive().length,2);});
test('numbering follows click timestamps despite network acknowledgment reordering',t=>{
  const {game}=fixture(t,'roulette',0);game.add({id:'later',joinedAt:200});game.add({id:'earlier',joinedAt:100});game.start();
  assert.deepEqual(game.players.map(p=>[p.id,p.number]),[['earlier',1],['later',2]]);
});
test('roulette rejects out of turn/self/dead targets; numbers remain stable',t=>{
  const {game}=fixture(t);game.start();const actor=game.actor,other=game.alive().find(p=>p.id!==actor).id;
  assert.throws(()=>game.kick(other,actor));assert.throws(()=>game.kick(actor,actor));
  game.kick(actor,other);assert.equal(game.player(other).alive,false);assert.equal(game.player('4').number,4);
  assert.throws(()=>game.kick(game.actor,other));
});
test('reflection consumes exactly one shield and kills attacker even if attacker has a shield',t=>{
  const {game,store}=fixture(t);buy(store,game,'1','reflect');buy(store,game,'2','reflect');game.start();assert.equal(game.actor,'1');
  game.kick('1','2');assert.equal(game.player('1').alive,false);assert.equal(game.player('2').alive,true);
  assert.equal(store.get('g','2').reflect,0);assert.equal(store.get('g','1').reflect,1);
});
test('store prices: reflection 2, reveal 1, nuke 10; overspending rolls back',t=>{
  const {game,store}=fixture(t);store.adjust('g','1',13,'admin');
  game.buy('1','reflect');game.buy('1','reveal');game.buy('1','nuke');
  assert.deepEqual(store.get('g','1'),{points:0,wins:0,reflect:1,reveal:1,nuke:1});
  assert.throws(()=>game.buy('1','reveal'));assert.equal(store.get('g','1').points,0);
});
test('reveal is private return data, usable only on turn, consumes once and keeps deadline/version',t=>{
  const {game,store}=fixture(t);buy(store,game,'1','reveal');buy(store,game,'2','reflect');game.start();game.deadline=12345;
  assert.throws(()=>game.reveal('2'));assert.equal(store.get('g','1').reveal,1);
  const version=game.version;assert.deepEqual(game.reveal('1'),['2']);assert.equal(game.version,version);assert.equal(game.deadline,12345);
  assert.equal(store.get('g','1').reveal,0);assert.throws(()=>game.reveal('1'));assert.deepEqual(game.results,[]);
});
test('nuke wins immediately on owner turn, consumes one, cannot be used off turn',t=>{
  const {game,store}=fixture(t);buy(store,game,'1','nuke');buy(store,game,'2','nuke');game.start();
  assert.throws(()=>game.nuke('2'));assert.equal(store.get('g','2').nuke,1);game.nuke('1');
  assert.equal(game.phase,'ended');assert.equal(game.winner,'1');assert.equal(store.get('g','1').nuke,0);assert.equal(game.alive().length,1);
});
test('normal roulette timeout ignores shield and stale timers do not run twice',t=>{
  const {game,store}=fixture(t);buy(store,game,'1','reflect');game.start();const v=game.version;
  game.timeout(v);assert.equal(game.player('1').alive,false);assert.equal(store.get('g','1').reflect,1);
  const count=game.alive().length;assert.equal(game.timeout(v),false);assert.equal(game.alive().length,count);assert.throws(()=>game.check(v));
});
test('purchases cannot occur after start or in another game',t=>{
  const {game,store}=fixture(t);store.adjust('g','1',20,'admin');game.start();assert.throws(()=>game.buy('1','reflect'));
  const hide=new Game({type:'hide',guild:'g',channel:'x',host:'1',store});hide.add({id:'1'});assert.throws(()=>hide.buy('1','reveal'));
});
test('hide shared square ejects everyone on it, including the seeker, leaving no winner',t=>{
  const {game}=fixture(t,'hide');game.start();for(const p of game.players)game.hide(p.id,7);
  game.seek(game.actor,7);assert.equal(game.phase,'ended');assert.equal(game.alive().length,0);assert.equal(game.winner,null);assert.ok(game.opened.has(7));
});
test('hide permits secret changes before the last hider; opened squares cannot be reused',t=>{
  const {game}=fixture(t,'hide');game.start();game.hide('1',7);game.hide('1',6);game.hide('2',9);game.hide('3',9);game.hide('4',10);
  assert.equal(game.player('1').spot,6);game.seek(game.actor,25);assert.throws(()=>game.seek(game.actor,25));
  game.seek(game.actor,9);assert.equal(game.player('2').alive,false);assert.equal(game.player('3').alive,false);
});
test('hide late hiders are removed and all idle players produce no winner',t=>{
  const {game}=fixture(t,'hide');game.start();game.hide('1',5);game.timeout(game.version);assert.equal(game.winner,'1');
  const {game:empty}=fixture(t,'hide');empty.start();empty.timeout(empty.version);assert.equal(empty.winner,null);assert.equal(empty.phase,'ended');
});
test('hide reveal timeout removes current seeker',t=>{
  const {game}=fixture(t,'hide');game.start();game.players.forEach((p,i)=>game.hide(p.id,i+1));
  const id=game.actor;game.timeout(game.version);assert.equal(game.player(id).alive,false);
});
test('green chairs allow exactly one player per chair and remove the player left standing',t=>{
  const {game}=fixture(t,'chairs',4,n=>n-1);game.start();assert.equal(game.red,false);assert.equal(game.seats.length,3);
  game.chair('1',0);assert.throws(()=>game.chair('1',1));assert.throws(()=>game.chair('2',0));game.chair('2',1);game.chair('3',2);
  assert.equal(game.player('4').alive,false);assert.equal(game.seats.length,2);
});
test('green chair timeout ejects unseated players, including everyone if no one clicks',t=>{
  const {game}=fixture(t,'chairs',4,n=>n-1);game.start();game.chair('1',0);game.timeout(game.version);assert.equal(game.winner,'1');
  const {game:empty}=fixture(t,'chairs',4,n=>n-1);empty.start();empty.timeout(empty.version);assert.equal(empty.winner,null);assert.equal(empty.phase,'ended');
});
test('red chairs eliminate clickers, protect abstainers and next round is green',t=>{
  const {game}=fixture(t,'chairs');game.start();assert.equal(game.red,true);game.chair('1',0);assert.equal(game.player('1').alive,false);
  game.timeout(game.version);assert.equal(game.red,false);assert.equal(game.alive().length,3);
});
test('mines has nine choices and one persistent bomb, alternates turns and advances the survivor',t=>{
  const {game}=fixture(t,'mines');game.start();assert.equal(game.bomb,1);const first=game.actor,other=game.duel.find(x=>x!==first);
  assert.throws(()=>game.mine(other,9));assert.throws(()=>game.mine(first,10));game.mine(first,9);assert.equal(game.actor,other);assert.equal(game.bomb,1);
  assert.throws(()=>game.mine(other,9));game.mine(other,1);assert.equal(game.player(other).alive,false);assert.ok(game.duel.includes(first));assert.equal(game.picked.size,0);
});
test('mine timeout advances the survivor and players cannot withdraw from the duel',t=>{
  const {game}=fixture(t,'mines',5);game.start();const actor=game.actor,survivor=game.duel.find(x=>x!==actor);game.timeout(game.version);
  assert.equal(game.player(actor).alive,false);assert.ok(game.duel.includes(survivor));
  const duel=[...game.duel];assert.throws(()=>game.withdraw(duel[1]),/الروليت العادي فقط/);assert.deepEqual(game.duel,duel);
});
test('reverse roulette chooses and automatically eliminates until exactly one remains',t=>{
  const {game}=fixture(t,'reverse');game.start();
  while(game.phase!=='ended'){const picked=game.actor;game.timeout(game.version);assert.equal(game.player(picked).alive,false);}
  assert.equal(game.alive().length,1);assert.equal(game.winner,game.alive()[0].id);
});
test('points, wins and inventory persist through reopen and are isolated by guild',()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'arena-db-'));const file=path.join(dir,'db.sqlite');
  try{
    let store=new Store(file);store.adjust('g','u',10,'admin');store.buy('g','u','reveal');store.reward('match','g','u');store.reward('match','g','u');store.close();
    store=new Store(file);assert.deepEqual(store.get('g','u'),{points:10,wins:1,reflect:0,reveal:1,nuke:0});assert.equal(store.get('other','u').points,0);
    assert.throws(()=>store.adjust('g','u',-11,'admin'));assert.equal(store.get('g','u').points,10);store.close();
  }finally{rmSync(dir,{recursive:true,force:true});}
});
test('admin negative, zero and noninteger adjustments cannot corrupt balance',t=>{
  const {store}=fixture(t);for(const n of [0,0.5,Infinity,1000001,-1])assert.throws(()=>store.adjust('g','u',n,'admin'));assert.equal(store.get('g','u').points,0);
});

function seeded(seed){return n=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%n;};}
for(const type of ['roulette','hide','chairs','mines','reverse'])test(`simulation: 100 complete ${type} games preserve invariants`,t=>{
  const store=new Store(':memory:');t.after(()=>store.close());
  for(let seed=1;seed<=100;seed++){
    const rng=seeded(seed),count=2+rng(49),game=new Game({type,guild:'g',channel:'c',host:'1',store,rng});
    for(let i=1;i<=count;i++)game.add({id:String(i),name:`P${i}`});game.start();
    let steps=0,lastAlive=count;
    while(game.phase!=='ended'&&steps++<1500){
      const v=game.version;
      if(['intermission','chair-ready'].includes(game.phase))game.timeout(v);
      else if(type==='roulette'&&rng(20)===0)game.withdraw(game.alive()[rng(game.alive().length)].id);
      else if(rng(10)===0)game.timeout(v);
      else if(game.phase==='hiding'){
        const p=game.alive().find(p=>p.spot===null);game.hide(p.id,1+rng(25));
      }else if(game.phase==='seeking'){
        const spots=Array.from({length:25},(_,i)=>i+1).filter(n=>!game.opened.has(n));game.seek(game.actor,spots[rng(spots.length)]);
      }else if(game.phase==='turn'){
        const targets=game.alive().filter(p=>p.id!==game.actor);game.kick(game.actor,targets[rng(targets.length)].id);
      }else if(game.phase==='duel'){
        const choices=Array.from({length:MINE_SQUARES},(_,i)=>i+1).filter(n=>!game.picked.has(n));game.mine(game.actor,choices[rng(choices.length)]);
      }else if(game.phase==='chairs'){
        if(game.red)game.timeout(v);
        else{const p=game.alive().find(p=>!game.seats.includes(p.id));game.chair(p.id,game.seats.findIndex(s=>s===null));}
      }else game.timeout(v);
      assert.ok(game.alive().length<=lastAlive);lastAlive=game.alive().length;
      assert.equal(new Set(game.players.map(p=>p.number)).size,count);
      if(['turn','seeking','duel','reverse'].includes(game.phase))assert.ok(game.player(game.actor)?.alive);
      if(game.phase==='duel')assert.ok(game.duel.every(id=>game.player(id).alive));
    }
    assert.equal(game.phase,'ended',`seed ${seed} did not finish`);assert.ok(game.alive().length<=1);
    if(game.winner){const before=store.get('g',game.winner);store.reward(game.id,'g',game.winner);store.reward(game.id,'g',game.winner);assert.equal(store.get('g',game.winner).wins,before.wins+1);}
  }
});
