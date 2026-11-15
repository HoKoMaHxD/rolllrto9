import { createCanvas, GlobalFonts, loadImage } from '@napi-rs/canvas';
import path from 'node:path';
import { ROOT, BRAND_NAME, GAME_NAMES } from './config.js';

GlobalFonts.registerFromPath(path.join(ROOT,'assets/fonts/NotoKufiArabic-Bold.ttf'),'ArenaArabic');
GlobalFonts.registerFromPath(path.join(ROOT,'assets/fonts/DejaVuSans.ttf'),'ArenaLatin');
const purple='#ba7be7', white='#f5f0fa';
let bgPromise;
let logoPromise;
const avatarCache=new Map();
const clean=s=>String(s||'Player').replace(/[\u0000-\u001f\u202a-\u202e\u2066-\u2069]/g,'');
function text(ctx,s,x,y,size=34,color=white,maxWidth=900,align='center',outline=0) {
  s=clean(s); ctx.fillStyle=color; ctx.textAlign=align; ctx.textBaseline='middle';
  ctx.direction=/[\u0600-\u06ff]/.test(s)?'rtl':'ltr';
  ctx.font=`bold ${size}px ArenaArabic, ArenaLatin`;
  while(ctx.measureText(s).width>maxWidth&&size>14){size--;ctx.font=`bold ${size}px ArenaArabic, ArenaLatin`;}
  // Keep extreme Unicode names inside their boxes even at the smallest font.
  while(ctx.measureText(s).width>maxWidth&&s.length>2) s=s.slice(0,-2)+'…';
  if(outline){
    ctx.save();
    ctx.strokeStyle='#211832';
    ctx.lineWidth=outline;
    ctx.lineJoin='round';
    ctx.strokeText(s,x,y);
    ctx.restore();
  }
  ctx.fillText(s,x,y); ctx.direction='ltr';
}
function box(ctx,x,y,w,h,r=20,fill='#24222c',stroke='#40334c') {
  ctx.beginPath();ctx.roundRect(x,y,w,h,r);ctx.fillStyle=fill;ctx.fill();
  if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=2;ctx.stroke();}
}

function brandLogo() {
  logoPromise ??= loadImage(path.join(ROOT,'assets/snow-logo.png'));
  return logoPromise;
}

export async function stampBrand(ctx,centerX,y) {
  const logo=await brandLogo();
  const height=43;
  const width=height*logo.width/logo.height;
  const gap=12;

  ctx.save();
  ctx.font='bold 25px ArenaLatin';
  ctx.textAlign='left';
  ctx.textBaseline='middle';
  ctx.direction='ltr';
  const startX=centerX-(width+gap+ctx.measureText(BRAND_NAME).width)/2;
  ctx.drawImage(logo,startX,y-height/2,width,height);
  ctx.strokeStyle='#1c2745';
  ctx.lineWidth=3;
  ctx.lineJoin='round';
  ctx.strokeText(BRAND_NAME,startX+width+gap,y);
  ctx.fillStyle='#e2efff';
  ctx.shadowColor='#488fcd';
  ctx.shadowBlur=9;
  ctx.fillText(BRAND_NAME,startX+width+gap,y);
  ctx.restore();
}

export async function brandAvatar() {
  const size=512;
  const canvas=createCanvas(size,size);
  const ctx=canvas.getContext('2d');

  const logo=await brandLogo();
  const width=350;
  const height=width*logo.height/logo.width;
  ctx.drawImage(logo,(size-width)/2,(size-height)/2,width,height);
  return canvas.toBuffer('image/png');
}

async function base(w,h) {
  const canvas=createCanvas(w,h),ctx=canvas.getContext('2d');
  bgPromise ??= loadImage(path.join(ROOT,'assets/ribbons.png'));
  ctx.drawImage(await bgPromise,0,0,w,h);
  return {canvas,ctx};
}
async function avatar(url) {
  if(!url)return null;
  if(avatarCache.has(url))return avatarCache.get(url);
  const p=(async()=>{
    try{
      const u=new URL(url);if(u.protocol!=='https:'||!['cdn.discordapp.com','media.discordapp.net'].includes(u.hostname))return null;
      const res=await fetch(url,{signal:AbortSignal.timeout(4000),redirect:'error'});
      if(!res.ok || Number(res.headers.get('content-length')||0)>2000000)return null;
      const chunks=[];let size=0;for await(const part of res.body){size+=part.length;if(size>2000000)return null;chunks.push(part);}
      return await loadImage(Buffer.concat(chunks));
    }catch{return null;}
  })();avatarCache.set(url,p);if(avatarCache.size>200)avatarCache.delete(avatarCache.keys().next().value);return p;
}
async function portrait(ctx,p,x,y,r,border=purple) {
  ctx.save();ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.clip();
  const img=await avatar(p.avatar);
  if(img){const s=Math.min(img.width,img.height);ctx.drawImage(img,(img.width-s)/2,(img.height-s)/2,s,s,x-r,y-r,r*2,r*2);}
  else{const g=ctx.createLinearGradient(x-r,y-r,x+r,y+r);g.addColorStop(0,'#73459b');g.addColorStop(1,'#2f1d4b');ctx.fillStyle=g;ctx.fillRect(x-r,y-r,r*2,r*2);text(ctx,Array.from(clean(p.name)).slice(0,2).join(''),x,y,r*.7,white,r*1.6);}
  ctx.restore();
  ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.strokeStyle=border;ctx.lineWidth=5;ctx.stroke();
}

export async function lobbyCard(type) {
  const {canvas,ctx}=await base(1200,700);
  await stampBrand(ctx,600,53);
  text(ctx,GAME_NAMES[type],600,150,70,white,1050,'center',5);
  drawLobbyIcon(ctx,type);
  text(ctx,'ادخل التحدي • آخر لاعب يفوز',600,632,26,'#ddc4ee',950,'center',3.5);
  return canvas.toBuffer('image/png');
}

function drawLobbyIcon(ctx,type) {
  ctx.save();
  ctx.translate(600,390);
  ctx.scale(1.02,1.02);
  ctx.shadowColor='#a568d3';
  ctx.shadowBlur=25;
  const gradient=ctx.createLinearGradient(-150,-140,150,140);
  gradient.addColorStop(0,'#dfb9fa');
  gradient.addColorStop(.35,'#76518c');
  gradient.addColorStop(1,'#251330');
  ctx.fillStyle=gradient;
  ctx.strokeStyle='#e8d4f8';
  ctx.lineWidth=5;

  if(type==='roulette'||type==='reverse'){
    ctx.beginPath();ctx.arc(0,0,145,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.shadowBlur=0;
    for(let i=0;i<10;i++){
      ctx.save();ctx.rotate(i*Math.PI/5);
      ctx.strokeStyle=i%2?'#f4e2fc':'#9362b0';ctx.lineWidth=2;
      ctx.beginPath();ctx.moveTo(0,0);ctx.lineTo(0,-138);ctx.stroke();ctx.restore();
    }
    ctx.beginPath();ctx.arc(0,0,38,0,Math.PI*2);ctx.fillStyle='#23152e';ctx.fill();ctx.stroke();
    text(ctx,type==='reverse'?'↶':'R',0,0,44,purple,70);
    ctx.beginPath();ctx.moveTo(0,-114);ctx.lineTo(-20,-160);ctx.lineTo(20,-160);
    ctx.closePath();ctx.fillStyle=white;ctx.fill();
  } else if(type==='hide'){
    ctx.beginPath();ctx.ellipse(0,-15,162,38,0,0,Math.PI*2);ctx.fill();ctx.stroke();
    ctx.beginPath();ctx.moveTo(-103,-25);ctx.lineTo(-88,-135);
    ctx.quadraticCurveTo(0,-100,88,-135);ctx.lineTo(105,-25);ctx.closePath();ctx.fill();ctx.stroke();
    box(ctx,-100,-47,200,25,8,'#291537',null);
    ctx.shadowBlur=0;
    for(const x of [-60,60]){
      ctx.beginPath();ctx.arc(x,70,49,0,Math.PI*2);ctx.fillStyle='#b286c8';ctx.fill();
      ctx.strokeStyle='#6b457e';ctx.lineWidth=12;ctx.stroke();
    }
    ctx.beginPath();ctx.moveTo(-12,61);ctx.quadraticCurveTo(0,47,12,61);ctx.stroke();
  } else if(type==='chairs'){
    box(ctx,-112,-145,224,240,58,'#ede8f1','#ffffff');
    box(ctx,-120,35,240,84,24,'#bcb5c4','#ffffff');
    box(ctx,-153,-22,55,151,25,'#f8f4fa','#d6cbdc');
    box(ctx,98,-22,55,151,25,'#f8f4fa','#d6cbdc');
    box(ctx,-64,-35,128,105,25,'#b271df','#d6a1fa');
    ctx.shadowBlur=0;ctx.fillStyle='#797080';ctx.fillRect(-108,126,22,49);ctx.fillRect(87,126,22,49);
  } else if(type==='mines'){
    const tiers=[[63,159,65,'#4f3a60'],[24,153,65,'#bdb4cc'],[-5,142,63,'#634b78'],[-37,111,52,'#e5d9ef']];
    for(const [y,rx,ry,color] of tiers){
      ctx.beginPath();ctx.ellipse(0,y,rx,ry,0,0,Math.PI*2);ctx.fillStyle=color;ctx.fill();ctx.stroke();
    }
    ctx.beginPath();ctx.ellipse(0,-56,64,29,0,0,Math.PI*2);ctx.fillStyle='#c788ef';ctx.fill();ctx.stroke();
    for(let i=0;i<5;i++){
      ctx.beginPath();ctx.arc(-105+i*53,68,8,0,Math.PI*2);ctx.fillStyle='#cb82fa';ctx.fill();
    }
  }
  ctx.restore();
}

export async function rouletteCard(game) {
  if(game.type==='roulette')return regularRouletteWheel(game);
  const players=game.alive(),n=players.length,height=Math.max(1080,380+Math.ceil(n/2)*56);
  const {canvas,ctx}=await base(1600,height);
  text(ctx,GAME_NAMES[game.type],800,80,57,white,1450,'center',5);
  const actor=game.player(game.actor);text(ctx,game.type==='reverse'?'اختارت الروليت:':'الدور على:',440,182,30,'#c6abcF',700,'center',3.5);
  text(ctx,actor?.name||'—',440,240,39,white,740,'center',4);
  const cx=440,cy=665,r=320,step=Math.PI*2/n,idx=players.findIndex(p=>p.id===game.actor);
  const offset=-Math.PI/2-(idx+.5)*step;
  for(let i=0;i<n;i++){
    ctx.beginPath();ctx.moveTo(cx,cy);ctx.arc(cx,cy,r,offset+i*step,offset+(i+1)*step);ctx.closePath();
    ctx.fillStyle=i===idx?'#ad6bd4':i%2?'#422650':'#2f1d40';ctx.fill();ctx.strokeStyle='#9e72b3';ctx.lineWidth=2;ctx.stroke();
    ctx.save();ctx.translate(cx,cy);ctx.rotate(offset+(i+.5)*step);
    text(ctx,n>30?String(players[i].number):`${players[i].number} • ${Array.from(clean(players[i].name)).slice(0,11).join('')}`,r*.64,0,Math.min(25,160/n+16),white,r*.55);ctx.restore();
  }
  ctx.beginPath();ctx.arc(cx,cy,72,0,Math.PI*2);ctx.fillStyle='#1a1521';ctx.fill();ctx.strokeStyle=purple;ctx.lineWidth=5;ctx.stroke();
  text(ctx,String(n),cx,cy-12,45,white,110);text(ctx,'لاعب',cx,cy+35,20,purple,110);
  ctx.beginPath();ctx.moveTo(cx,cy-r+22);ctx.lineTo(cx-23,cy-r-28);ctx.lineTo(cx+23,cy-r-28);ctx.closePath();ctx.fillStyle=white;ctx.fill();
  const rowH=56,rows=Math.ceil(n/2);
  for(let i=0;i<n;i++){
    const p=players[i],col=Math.floor(i/rows),row=i%rows,x=825+col*365,y=300+row*rowH;
    box(ctx,x,y,345,47,12,p.id===game.actor?'#673e80':'#25212f',p.id===game.actor?'#d9a5fa':'#40314e');
    text(ctx,String(p.number),x+30,y+24,22,purple,45);
    text(ctx,p.name,x+195,y+24,23,white,260);
  }
  text(ctx,'الأرقام حسب ترتيب الدخول',1185,height-32,23,'#dcc8eb',690,'center',3.5);
  return canvas.toBuffer('image/png');
}

async function regularRouletteWheel(game) {
  const size=600;
  const canvas=createCanvas(size,size);
  const ctx=canvas.getContext('2d');
  const center=size/2;
  const radius=262;
  const players=game.alive();
  const slice=2*Math.PI/players.length;
  const selected=players.findIndex(player=>player.id===game.actor);
  const offset=-(selected+.5)*slice;
  const labelSize=Math.max(15,Math.min(23,Math.round(slice*103)));

  ctx.save();
  ctx.translate(center,center);
  const metal=ctx.createLinearGradient(-225,-240,235,245);
  metal.addColorStop(0,'#5c437c');
  metal.addColorStop(.18,'#ddc6f1');
  metal.addColorStop(.39,'#7f55a6');
  metal.addColorStop(.61,'#2b1647');
  metal.addColorStop(.82,'#a779c9');
  metal.addColorStop(1,'#35204d');
  wheelDisc(ctx,289,'#120d1b');
  wheelDisc(ctx,284,metal);
  wheelDisc(ctx,279,'#1c102a');
  wheelDisc(ctx,269,'#0b0713');

  const palettes=[
    {stops:['#9d7bbd','#c6ace0','#e7daf3'],ink:'#29163c'},
    {stops:['#2c194b','#483070','#59357f'],ink:'#fbf3ff'},
  ];
  const active={stops:['#532b78','#71339c','#984ec2'],ink:'#ffffff'};
  for(const palette of [...palettes,active]){
    const fill=ctx.createRadialGradient(0,0,70,0,0,radius);
    palette.stops.forEach((color,i)=>fill.addColorStop(i/2,color));
    palette.fill=fill;
  }
  for(const [index,player] of players.entries()){
    const start=offset+index*slice;
    const angle=start+slice/2;
    const palette=index===selected?active:palettes[index%2];
    ctx.beginPath();
    ctx.moveTo(0,0);
    ctx.arc(0,0,radius,start,start+slice);
    ctx.closePath();
    ctx.fillStyle=palette.fill;
    ctx.fill();
    ctx.lineWidth=players.length>32?1.5:2.7;
    ctx.strokeStyle='#1b0e29';
    ctx.stroke();

    ctx.save();
    ctx.clip();
    const radialDistance=175;
    ctx.translate(Math.cos(angle)*radialDistance,Math.sin(angle)*radialDistance);
    ctx.rotate(angle+(Math.cos(angle)<0?Math.PI:0));
    ctx.scale(1,Math.min(1,slice*7));
    text(ctx,player.name,0,0,labelSize,palette.ink,146);
    ctx.restore();
  }

  // An inset outline and regular highlights give the rim a metal edge.
  ctx.beginPath();
  ctx.arc(0,0,radius,0,Math.PI*2);
  ctx.strokeStyle='#b08acb';
  ctx.lineWidth=2;
  ctx.stroke();
  for(let i=0;i<12;i++){
    const angle=i*Math.PI/6;
    ctx.beginPath();
    ctx.arc(274*Math.cos(angle),274*Math.sin(angle),2.35,0,Math.PI*2);
    ctx.fillStyle=i%3===0?'#f8ebff':'#c397eb';
    ctx.fill();
  }
  wheelDisc(ctx,84,'#190d25');
  wheelDisc(ctx,80,metal);
  wheelDisc(ctx,72,'#170e20');
  ctx.beginPath();
  ctx.moveTo(73,-14);
  ctx.lineTo(93,-2);
  ctx.quadraticCurveTo(96,0,93,2);
  ctx.lineTo(73,14);
  ctx.closePath();
  ctx.fillStyle='#f0d9ff';
  ctx.fill();
  ctx.restore();

  await portrait(ctx,players[selected],center,center,69,'#e9ccff');
  return canvas.toBuffer('image/png');
}

function wheelDisc(ctx,radius,fill) {
  ctx.beginPath();
  ctx.arc(0,0,radius,0,Math.PI*2);
  ctx.fillStyle=fill;
  ctx.fill();
}

export async function winnerCard(player,stats) {
  const {canvas,ctx}=await base(1200,960);
  await stampBrand(ctx,525,51);

  ctx.save();
  ctx.translate(750,133);
  ctx.rotate(.27);
  const crown=ctx.createLinearGradient(-80,-90,80,30);
  crown.addColorStop(0,'#6d388b');
  crown.addColorStop(1,'#ecc5ff');
  ctx.fillStyle=crown;
  ctx.beginPath();
  ctx.moveTo(-77,24);
  for(const [x,y] of [[-95,-66],[-43,-36],[0,-100],[43,-36],[95,-66],[77,24]])ctx.lineTo(x,y);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  await portrait(ctx,player,600,330,177);
  text(ctx,'فوز مستحق !!',600,575,42,'#d3a2ef',1000,'center',4);
  box(ctx,300,629,600,73,21,'#100c15','#a46cc7');
  text(ctx,player.name,600,668,39,white,555);
  box(ctx,40,782,1120,126,32,'rgba(36,35,41,.88)','#3c3645');
  text(ctx,`نقاط الألعاب: ${stats.points}  |  الفوزات: ${stats.wins}`,600,846,36,white,1040);
  return canvas.toBuffer('image/png');
}
