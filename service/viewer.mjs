import {qrcodegen} from '/qr.mjs';
import {hostedCopy} from '/copy.mjs';
const $=id=>document.getElementById(id), token=location.hash.slice(1);
let language='aeb', data=null, back=false, image=null, qr=null, qrBlob=null, timer, message='loading';
const copy=()=>hostedCopy[language];
const url=`${location.origin}/view#${token}`;
window.addEventListener('hashchange',()=>location.reload());
function status(key){message=key;$('status').textContent=key?copy()[key]:'';}
function text(tag,value){const el=document.createElement(tag);el.textContent=value;return el;}
function draw(){
  const c=copy();$('policy').textContent=location.protocol==='https:'?c.retention:c.local;document.documentElement.lang=language==='aeb'?'aeb-TN':language;document.documentElement.dir=['aeb','ar'].includes(language)?'rtl':'ltr';
  $('title').textContent=c.title;$('retry').textContent=c.retryRead;$('flip').textContent=back?c.front:c.back;$('flip').setAttribute('aria-pressed',String(back));
  $('copy').textContent=c.copy;$('share-card').textContent=c.shareImage;$('share-qr').textContent=c.shareQr;
  $('status').textContent=message?c[message]:'';
  $('face').replaceChildren();
  if(!data)return;
  if(back){qr.setAttribute('role','img');qr.setAttribute('aria-label',c.qr);$('face').append(qr,text('p',`${c.expiry}: ${new Date(data.expiresAt).toISOString()}`));}
  else {
    const img=document.createElement('img');img.src=image;img.alt=c.image;img.width=data.width;img.height=data.height;$('face').append(img);
    const details=document.createElement('details');details.append(text('summary',c.text));const body=document.createElement('div');body.lang=data.snapshot.language;body.dir=data.snapshot.direction;
    for(const b of data.snapshot.blocks){const p=text('p',b.text);p.dir=['fare','range','difference'].includes(b.kind)?'ltr':data.snapshot.direction;body.append(p);}details.append(body);$('face').append(details);
  }
}
function clear(){clearTimeout(timer);data=null;back=false;qrBlob=null;if(image)URL.revokeObjectURL(image);image=null;$('face').replaceChildren();$('actions').hidden=true;$('flip').hidden=true;}
async function load(){
  clear();$('retry').hidden=true;status('loading');
  if(!/^[A-Za-z0-9_-]{43}$/.test(token)){status('invalid');return;}
  try{
    const response=await fetch('/v1/cards/read',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({viewToken:token}),cache:'no-store',credentials:'omit',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(15000)});
    const value=await response.json();
    if(!response.ok){if(response.status>=500){status('network');$('retry').hidden=false;}else status(value.error==='expired'?'expired':value.error==='revoked'?'revoked':'missing');return;}
    data=value;language=data.snapshot.language;$('language').value=language;
    const bytes=Uint8Array.from(atob(data.png),x=>x.charCodeAt(0));image=URL.createObjectURL(new Blob([bytes],{type:'image/png'}));
    const code=qrcodegen.QrCode.encodeText(url,qrcodegen.QrCode.Ecc.MEDIUM);qr=document.createElement('canvas');qr.width=qr.height=(code.size+8)*10;
    const ctx=qr.getContext('2d');if(!ctx)throw Error('render');ctx.fillStyle='#fff';ctx.fillRect(0,0,qr.width,qr.height);ctx.fillStyle='#000';
    for(let y=0;y<code.size;y++)for(let x=0;x<code.size;x++)if(code.getModule(x,y))ctx.fillRect((x+4)*10,(y+4)*10,10,10);
    qrBlob=await new Promise(resolve=>qr.toBlob(resolve,'image/png'));
    $('share-qr').disabled=!qrBlob;$('retry').hidden=!!qrBlob;
    status(qrBlob?'':'shareError');$('flip').hidden=false;$('actions').hidden=false;$('link').href=url;$('link').textContent=url;draw();
    timer=setTimeout(()=>{clear();status('expired');},Math.min(2147483647,Math.max(0,data.expiresAt-Date.now())));
  }catch{clear();status('network');$('retry').hidden=false;}
}
$('flip').onclick=()=>{back=!back;draw();};$('retry').onclick=load;
$('language').onchange=()=>{language=$('language').value;draw();};
$('copy').onclick=async()=>{try{await navigator.clipboard.writeText(url);status('copied');}catch{status('copyFailed');}};
async function share(blob,name){
  try{const file=new File([blob],name,{type:'image/png'});
    if(navigator.canShare?.({files:[file]})){await navigator.share({files:[file]});status('returned');}
    else{const href=URL.createObjectURL(blob),a=document.createElement('a');a.href=href;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(href),1000);status('download');}
  }catch(e){status(e?.name==='AbortError'?'cancelled':'shareError');}
}
$('share-card').onclick=()=>{if(data){const bytes=Uint8Array.from(atob(data.png),x=>x.charCodeAt(0));void share(new Blob([bytes],{type:'image/png'}),'taxi-check-trip-card.png');}};
$('share-qr').onclick=()=>{if(qrBlob)void share(qrBlob,'taxi-check-trip-qr.png');};
draw();void load();
