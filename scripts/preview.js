import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT, GAME_NAMES } from '../src/config.js';
import { brandAvatar,lobbyCard,winnerCard,rouletteCard } from '../src/art.js';
import { Game } from '../src/engine.js';
import { Store } from '../src/store.js';
const dir=path.join(ROOT,'previews');mkdirSync(dir,{recursive:true});
for(const type of Object.keys(GAME_NAMES))writeFileSync(path.join(dir,`${type}-lobby.png`),await lobbyCard(type));
writeFileSync(path.join(dir,'snow-avatar.png'),await brandAvatar());
writeFileSync(path.join(dir,'winner.png'),await winnerCard({id:'demo',name:'عبدالله | Abdullah',avatar:null},{points:10,wins:6}));
const store=new Store(':memory:');
for(const [type,count,filename] of [['roulette',25,'roulette-25-players.png'],['reverse',8,'reverse-roulette-round.png']]){
  const game=new Game({type,guild:'demo',channel:'demo',host:'1',store,rng:()=>0});
  for(let i=1;i<=count;i++)game.add({id:String(i),name:['عبدالله','Snow','محمد','Rainy','مريم'][i%5]+` ${i}`,avatar:null});
  game.start();
  writeFileSync(path.join(dir,filename),await rouletteCard(game));
}
store.close();
console.log(`Previews: ${dir}`);
