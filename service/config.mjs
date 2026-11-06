import path from 'node:path';
import {isIP} from 'node:net';
import {uuidPattern} from './postgres.mjs';
export const WEEK=604800000;
const number=(value,fallback,min,max)=>{
  const n=value===undefined?fallback:Number(value);
  if(!Number.isSafeInteger(n)||n<min||n>max)throw Error('Invalid service numeric setting');return n;
};
export function publicOrigin(raw){
  let u;try{u=new URL(raw);}catch{throw Error('Invalid public service origin');}
  if(u.origin!==raw||u.protocol!=='https:'||u.username||u.password||u.hostname==='localhost'||isIP(u.hostname)||!u.hostname.includes('.'))throw Error('Invalid public service origin');
  return u.origin;
}
export function serviceConfig(env=process.env){
  if(env.CARD_MODE!==undefined&&!['local','production'].includes(env.CARD_MODE))throw Error('Invalid service mode');
  const production=env.CARD_MODE==='production';
  if(env.CARD_STORAGE!==undefined&&!['filesystem','postgres'].includes(env.CARD_STORAGE))throw Error('Invalid storage mode');
  if(env.CARD_STORAGE==='postgres'){
    let url;try{url=new URL(env.CARD_DATABASE_URL);}catch{throw Error('Explicit database connection required');}
    if(!['postgres:','postgresql:'].includes(url.protocol)||!url.username||url.pathname.length<2||url.search||url.hash)throw Error('Unsafe database connection configuration');
    const local=['localhost','127.0.0.1','[::1]'].includes(url.hostname);
    const tls=env.CARD_DATABASE_TLS??'verify';
    if(tls!=='verify'&&(production||tls!=='local'||!local))throw Error('Verified database TLS required');
    if(!uuidPattern.test(env.CARD_NAMESPACE??'')||!uuidPattern.test(env.CARD_DATABASE_ID??''))throw Error('Explicit database authority identity required');
    if(env.CARD_TTL_MS!==String(WEEK))throw Error('Seven-day production policy required');
    const origin=production?publicOrigin(env.CARD_SERVICE_ORIGIN):undefined;
    const origins=(env.CARD_ALLOWED_ORIGINS??'').split(',');
    if(!origins[0]||production&&(!origins.includes(origin)||!origins.every(v=>v==='capacitor://localhost'||v==='https://localhost'||publicOrigin(v)===v)))throw Error('Explicit service origins required');
    if(production&&(env.CARD_TRUST_PROXY!=='render'||env.CARD_PROXY_VERIFIED!=='yes'))throw Error('Verified proxy boundary required');
    return {storage:'postgres',production,host:production?'0.0.0.0':'127.0.0.1',port:number(production?env.PORT:env.CARD_PORT,production?undefined:5190,1,65535),origin,origins,ttlMs:WEEK,
      databaseUrl:env.CARD_DATABASE_URL,databaseTls:tls,namespace:env.CARD_NAMESPACE,authorityId:env.CARD_DATABASE_ID,
      proxyHops:production?number(env.CARD_PROXY_HOPS,undefined,1,3):1,
      maxCards:number(env.CARD_MAX_CARDS,100,1,100),maxStoreBytes:number(env.CARD_MAX_STORE_BYTES,64000000,3000000,64000000),
      dailyIssues:number(env.CARD_DAILY_ISSUES,20,1,20),monthlyBytes:number(env.CARD_MONTHLY_BYTES,4000000000,3000000,4000000000),issuanceEnabled:env.CARD_ISSUANCE_ENABLED==='yes'};
  }
  if(!production)return {production:false,host:'127.0.0.1',port:number(env.CARD_PORT,5190,1,65535),directory:path.resolve(env.CARD_DATA_DIR??'.local-card-service'),ttlMs:number(env.CARD_TTL_MS,WEEK,1,Number.MAX_SAFE_INTEGER),origins:(env.CARD_ALLOWED_ORIGINS??'http://localhost:5173').split(',')};
  const origin=publicOrigin(env.CARD_SERVICE_ORIGIN);
  if(env.CARD_TTL_MS!==String(WEEK)||env.CARD_TRUST_PROXY!=='render'||env.CARD_PROXY_VERIFIED!=='yes')throw Error('Production policy/proxy settings required');
  const mount=env.CARD_MOUNT_PATH,directory=env.CARD_DATA_DIR,control=env.CARD_CONTROL_DIR;
  if(![mount,directory,control].every(v=>typeof v==='string'&&path.isAbsolute(v))||path.dirname(directory)!==mount||directory===control||control.startsWith(mount+path.sep))throw Error('Explicit isolated production paths required');
  if(!/^[a-f0-9-]{36}$/.test(env.CARD_STORE_ID??''))throw Error('Explicit store identity required');
  const origins=(env.CARD_ALLOWED_ORIGINS??'').split(',');
  if(!origins.includes(origin)||new Set(origins).size!==origins.length||!origins.every(v=>v==='capacitor://localhost'||v==='https://localhost'||publicOrigin(v)===v))throw Error('Explicit production origins required');
  if(env.CARD_HOST&&env.CARD_HOST!=='0.0.0.0')throw Error('Invalid production binding');
  return {production:true,host:'0.0.0.0',port:number(env.PORT,undefined,1,65535),directory,mount,control,storeId:env.CARD_STORE_ID,origin,origins,ttlMs:WEEK,
    maxCards:number(env.CARD_MAX_CARDS,100,1,100),maxStoreBytes:number(env.CARD_MAX_STORE_BYTES,64000000,3000000,64000000),
    dailyIssues:number(env.CARD_DAILY_ISSUES,20,1,20),monthlyBytes:number(env.CARD_MONTHLY_BYTES,4000000000,3000000,4000000000),proxyHops:number(env.CARD_PROXY_HOPS,undefined,1,3),issuanceEnabled:env.CARD_ISSUANCE_ENABLED==='yes'};
}

export function proxyAddress(req,hops=1){
  // Render must append the actual peer at the trusted end of XFF. Verify at deployment.
  const forwarded=req.headers['x-forwarded-for'];
  if(typeof forwarded!=='string'||forwarded.length>512)return null;
  const chain=forwarded.split(',').map(v=>v.trim());
  if(chain.length>8||chain.length<hops||chain.some(v=>!isIP(v)))return null;
  return chain.at(-hops);
}
