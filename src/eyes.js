import { createCanvas } from '@napi-rs/canvas';

function eyeImage(closed) {
  const canvas=createCanvas(96,96);
  const ctx=canvas.getContext('2d');
  ctx.fillStyle='#d5d5db';
  ctx.beginPath();
  ctx.moveTo(6,48);
  ctx.bezierCurveTo(27,14,69,14,90,48);
  ctx.bezierCurveTo(69,82,27,82,6,48);
  ctx.fill();
  ctx.globalCompositeOperation='destination-out';
  ctx.beginPath();ctx.arc(48,48,13,0,Math.PI*2);ctx.fill();
  if(closed){
    ctx.lineWidth=16;
    ctx.beginPath();ctx.moveTo(14,14);ctx.lineTo(82,82);ctx.stroke();
    ctx.globalCompositeOperation='source-over';
    ctx.strokeStyle='#d5d5db';ctx.lineWidth=7;ctx.lineCap='round';
    ctx.beginPath();ctx.moveTo(14,14);ctx.lineTo(82,82);ctx.stroke();
  }
  return canvas.toBuffer('image/png');
}

export async function prepareEyes(application) {
  const eyes={open:process.env.REVEALED_EMOJI_ID,closed:process.env.HIDDEN_EMOJI_ID};
  const missing=Object.entries(eyes).filter(([,id])=>!id);
  if(!missing.length)return eyes;
  try{
    const emojis=await application.emojis.fetch();
    for(const [kind] of missing){
      const name=`arena_eye_${kind}`;
      const emoji=emojis.find(item=>item.name===name)||await application.emojis.create({name,attachment:eyeImage(kind==='closed')});
      eyes[kind]=emoji.id;
    }
  }catch(error){console.warn('[EYE_EMOJI]',error.code||error.name);}
  return eyes;
}
