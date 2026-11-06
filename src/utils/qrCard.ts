import { qrcodegen } from '../vendor/qrcodegen';

export function qrCanvas(url: string): HTMLCanvasElement {
  const parsed = new URL(url);
  if (!['http:','https:'].includes(parsed.protocol) || parsed.pathname !== '/view' || !/^#[A-Za-z0-9_-]{43}$/.test(parsed.hash)
    || parsed.search || parsed.username || parsed.password) throw Error('Invalid card link');
  const qr=qrcodegen.QrCode.encodeText(url,qrcodegen.QrCode.Ecc.MEDIUM), scale=10, border=4;
  const canvas=document.createElement('canvas');canvas.width=canvas.height=(qr.size+border*2)*scale;
  const ctx=canvas.getContext('2d');if(!ctx)throw Error('QR unavailable');
  ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.fillStyle='#000';
  for(let y=0;y<qr.size;y++)for(let x=0;x<qr.size;x++)if(qr.getModule(x,y))ctx.fillRect((x+border)*scale,(y+border)*scale,scale,scale);
  return canvas;
}
export async function renderQr(url: string): Promise<Blob> {
  return new Promise((resolve,reject)=>qrCanvas(url).toBlob(blob=>blob?.size?resolve(blob):reject(Error('QR encoding failed')),'image/png'));
}
