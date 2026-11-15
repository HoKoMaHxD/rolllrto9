import assert from 'node:assert/strict';
import test from 'node:test';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { brandAvatar, lobbyCard, rouletteCard, winnerCard } from '../src/art.js';
import { GAME_NAMES } from '../src/config.js';

test('all game artwork contains transparent background and visible foreground',async()=>{
  const players=[
    {id:'1',name:'محمد',number:1,avatar:null},
    {id:'2',name:'Snow',number:2,avatar:null},
  ];
  const game={actor:'1',alive:()=>players,player:id=>players.find(player=>player.id===id)};
  const artwork=[
    ...Object.keys(GAME_NAMES).map(type=>[`${type} lobby`,lobbyCard(type)]),
    ['winner',winnerCard(players[0],{points:10,wins:6})],
    ['regular roulette round',rouletteCard({...game,type:'roulette'})],
    ['reverse roulette round',rouletteCard({...game,type:'reverse'})],
    ['logo avatar',brandAvatar()],
  ];

  for(const [name,png] of artwork){
    const image=await loadImage(await png);
    const ctx=createCanvas(image.width,image.height).getContext('2d');
    ctx.drawImage(image,0,0);
    const pixels=ctx.getImageData(0,0,image.width,image.height).data;
    let clear=0,solid=0;
    for(let alpha=3;alpha<pixels.length;alpha+=4){
      if(pixels[alpha]===0)clear++;
      else if(pixels[alpha]===255)solid++;
    }
    const area=image.width*image.height;
    assert.ok(clear>area*.10,`${name} must have a transparent background`);
    assert.ok(solid>area*.015,`${name} must retain its artwork`);
  }
});
