import http from 'node:http';
import { mkdir, readFile, readdir } from 'node:fs/promises';
import { timingSafeEqual, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { MAX_BODY, validToken, digest, validateCard } from './contract.mjs';
import {durableFiles} from './durable.mjs';
import {serviceBudget,sourceLimiter} from './budget.mjs';
import {proxyAddress,WEEK} from './config.mjs';
import {inspectStore} from './store.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
export async function createCardServer({ directory, ttlMs = 7*86400000, now = Date.now,
  origins = ['http://localhost:5173'], maxCards = 100, rateLimit = 120, sweepMs = 60000, creationMs = 600000, production=null, repository=null, files=durableFiles({strict:!!production}) } = {}) {
  if (!Number.isSafeInteger(creationMs) || creationMs < 1 || (!directory&&!repository) || !Number.isSafeInteger(ttlMs) || ttlMs < 1 || !Number.isSafeInteger(now()+ttlMs)
    || !Number.isSafeInteger(maxCards) || maxCards<1 || !Number.isSafeInteger(rateLimit) || rateLimit<1) throw Error('Invalid local service configuration');
  if(repository){await repository.ready();now=()=>repository.now();}
  else if(production){if(directory!==production.directory)throw Error('Store path mismatch');if(ttlMs!==WEEK)throw Error('Production expiry must be seven days');await inspectStore(production);}
  else await mkdir(directory,{recursive:true,mode:0o700});
  const records = new Map(), buckets = new Map(); let serial = Promise.resolve(), inFlight=0, healthy=true, accepting=true;
  const limiter=sourceLimiter(),budget=repository??(production?await serviceBudget(directory,files,production):null);
  const failStorage=()=>{if(production&&!repository)healthy=false;};
  const enqueue=fn=>{const next=serial.then(fn);serial=next.catch(()=>{});return next;};
  if(!repository){
  for(const name of await readdir(directory))if(/^[a-f0-9]{64}(?:\.json)?\.[a-f0-9-]{36}\.tmp$/.test(name))await files.remove(path.join(directory,name));
  for (const name of await readdir(directory)) if (/^[a-f0-9]{64}\.json$/.test(name)) {
    let record;try{record=JSON.parse(await readFile(path.join(directory,name),'utf8'));}catch{throw Error('Local card storage could not be read');}
    if (!record || !Number.isSafeInteger(record.expiresAt) || !/^[a-f0-9]{64}$/.test(record.revokeHash)
      || !['issued','active','revoked','expired'].includes(record.status)
      || (record.protocol!==undefined && record.protocol!==2)
      || (record.protocol===2 && (!/^[a-f0-9]{64}$/.test(record.creationHash) || !/^[a-f0-9]{64}$/.test(record.contentHash)
        || !Number.isSafeInteger(record.createUntil) || record.createUntil>record.expiresAt))
      || (record.status==='issued' && (record.protocol!==2 || record.card!==null))) throw Error('Invalid stored card');
    records.set(name.slice(0,-5),record);
  }
  }
  const save = async (id,r,insert=false) => {
    if(repository)return repository.save(id,r,insert);
    const encoded=JSON.stringify(r);
    if(production){
      let total=Buffer.byteLength(encoded);
      for(const [key,row] of records)if(key!==id)total+=Buffer.byteLength(JSON.stringify(row));
      if(total+65536>production.maxStoreBytes)throw Object.assign(Error('Store capacity'),{capacity:true});
    }
    try{await files.save(path.join(directory,`${id}.json`),r);}catch(error){failStorage();throw error;}
  };
  const remove = async id=>{try{await files.remove(path.join(directory,`${id}.json`));}catch(error){failStorage();throw error;}};
  const sweep = async () => {
    if(repository)return repository.sweep();
    for (const [id,original] of records) {
      let r=original;
      if(r.status==='issued' && r.createUntil<=now()){await remove(id);records.delete(id);continue;}
      if (r.expiresAt <= now() && r.card) { const dead={...r,card:null,status:'expired'}; await save(id,dead); records.set(id,dead);r=dead; }
      if (!r.card && r.expiresAt + 86400000 <= now()) { await remove(id);records.delete(id); }
    }
  };
  await (repository?repository.transaction(sweep):sweep());
  const timer=setInterval(()=>{ if(healthy&&accepting)void enqueue(()=>repository?repository.transaction(sweep):sweep()).catch(failStorage); },sweepMs); timer.unref();
  const server=http.createServer((req,res)=>{
    const origin=req.headers.origin;
    if(req.url==='/livez'){res.writeHead(200,{'Cache-Control':'no-store','Content-Type':'application/json'});res.end('{"status":"alive"}');return;}
    if(req.url==='/readyz'){
      if(inFlight>=8){res.writeHead(503,{'Cache-Control':'no-store'});res.end();return;}
      inFlight++;
      void enqueue(async()=>{
        let ready=healthy&&accepting;
        if(ready&&repository)try{await repository.transaction(sweep);}catch{ready=false;}
        else if(ready&&production)try{const marker=JSON.parse(await readFile(path.join(directory,'.store.json'),'utf8'));if(marker.id!==production.storeId)throw Error('Store mismatch');await sweep();}catch{ready=false;failStorage();}
        res.writeHead(ready?200:503,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({status:ready?'ready':'unavailable'}));
      }).catch(()=>{res.writeHead(503);res.end();}).finally(()=>inFlight--);return;
    }
    const headers={'Cache-Control':'no-store, max-age=0','Pragma':'no-cache','Referrer-Policy':'no-referrer',
      'X-Content-Type-Options':'nosniff','X-Robots-Tag':'noindex, nofollow','Cross-Origin-Resource-Policy':'same-origin',
      'Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' blob:; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"};
    if (origin && origins.includes(origin)) Object.assign(headers,{'Access-Control-Allow-Origin':origin,'Vary':'Origin',
      'Access-Control-Allow-Headers':'Content-Type','Access-Control-Allow-Methods':'POST, OPTIONS'});
    let insideTransaction=false,pendingResponse=null;
    const deliver=(status,data,type='application/json')=>{
      if(insideTransaction){pendingResponse={status,data,type};return;}
      res.writeHead(status,{...headers,'Content-Type':type});res.end(data);
    };
    const send=(status,body)=>deliver(status,JSON.stringify(body));
    const work=fn=>enqueue(async()=>{
      if(!repository)return fn();
      insideTransaction=true;
      try{await repository.transaction(fn);insideTransaction=false;if(pendingResponse){const response=pendingResponse;pendingResponse=null;deliver(response.status,response.data,response.type);}}
      finally{insideTransaction=false;pendingResponse=null;}
    });
    if (origin && !origins.includes(origin) && origin !== (production?.origin??`http://${req.headers.host}`)) return send(403,{error:'origin'});
    if(!healthy||!accepting)return send(503,{error:'unavailable'});
    const source=production?proxyAddress(req,production.proxyHops):req.socket.remoteAddress??'local';
    if(!source || production&&req.headers['x-forwarded-proto']!=='https')return send(403,{error:'proxy'});
    const kind=req.url.endsWith('/issue')?'issue':req.url.endsWith('/revoke')?'revoke':req.url==='/v1/cards'?'upload':'read';
    if(production&&!limiter(source,kind,now()))return send(429,{error:'limit'});
    if (req.method==='OPTIONS') { res.writeHead(204,headers);res.end();return; }
    // No request logger. Rate buckets contain only transient loopback source addresses.
    const address=production?'shared':req.socket.remoteAddress ?? 'local', minute=Math.floor(now()/60000);
    if (buckets.size>256) buckets.clear();
    let bucket=buckets.get(address);if (!bucket || bucket.minute!==minute) {bucket={minute,count:0};buckets.set(address,bucket);}
    if (!production&&++bucket.count>rateLimit) return send(429,{error:'limit'});
    const assets={'/view':['service/viewer.html','text/html; charset=utf-8'],'/viewer.mjs':['service/viewer.mjs','text/javascript'],
      '/viewer.css':['service/viewer.css','text/css'],'/qr.mjs':['src/vendor/qrcodegen.js','text/javascript'],
      '/qr-LICENSE.txt':['public/licenses/qrcodegen-MIT.txt','text/plain']};
    assets['/copy.mjs']=['src/localization/hostedCopy.js','text/javascript'];
    for(const font of ['bricolagegrotesque-400.woff2','notosansarabic-400.woff2'])assets[`/fonts/${font}`]=[`public/fonts/${font}`,'font/woff2'];
    for(const license of ['bricolagegrotesque-OFL.txt','notosansarabic-OFL.txt'])assets[`/fonts/${license}`]=[`public/fonts/${license}`,'text/plain'];
    if (req.method==='GET' && assets[req.url]) {
      const [file,type]=assets[req.url];
      if(inFlight>=8)return send(429,{error:'busy'});inFlight++;
      void work(async()=>{
        if(!healthy)return send(503,{error:'unavailable'});
        const data=await readFile(path.join(root,file));
        if(budget&&!await budget.reserve(now(),{bytes:data.length}))return send(429,{error:'budget'});
        deliver(200,data,type);
      }).catch(()=>{failStorage();send(503,{error:'unavailable'});}).finally(()=>inFlight--);return;
    }
    if (req.method!=='POST' || !['/v1/cards','/v1/cards/issue','/v1/cards/read','/v1/cards/revoke'].includes(req.url)) return send(404,{error:'unavailable'});
    if (req.headers['content-type']!=='application/json') return send(415,{error:'format'});
    if (Number(req.headers['content-length'])>MAX_BODY) return send(413,{error:'size'});
    if(inFlight>=8)return send(429,{error:'busy'});
    req.setTimeout(10000,()=>req.destroy());
    inFlight++;let released=false;const release=()=>{if(!released){released=true;inFlight--;}};
    let size=0, chunks=[], exceeded=false;
    req.on('data',chunk=>{size+=chunk.length;if(size>MAX_BODY){if(!exceeded)send(413,{error:'size'});exceeded=true;chunks=[];}else if(!exceeded)chunks.push(chunk);});
    req.on('end',()=>{
      if(exceeded){release();return;}
      void work(async()=>{
        if(!healthy||!accepting)return send(503,{error:'unavailable'});
        let body;try {body=JSON.parse(Buffer.concat(chunks).toString('utf8'));} catch{return send(400,{error:'format'});}
        if(production&&!repository){const marker=JSON.parse(await readFile(path.join(directory,'.store.json'),'utf8'));if(marker.id!==production.storeId)throw Error('Store mismatch');}
        await sweep();
        if(req.url==='/v1/cards/issue') {
          if(!body || Object.keys(body).sort().join()!=='digest,version' || body.version!==2
            || typeof body.digest!=='string' || !/^[a-f0-9]{64}$/.test(body.digest))return send(400,{error:'format'});
          if(production&&!production.issuanceEnabled)return send(503,{error:'issuance-disabled'});
          if((repository?await repository.count():records.size)>=maxCards)return send(429,{error:'capacity'});
          if(budget&&!await budget.reserve(now(),{issue:true}))return send(429,{error:'budget'});
          const viewToken=randomBytes(32).toString('base64url'),revokeToken=randomBytes(32).toString('base64url'),creationToken=randomBytes(32).toString('base64url');
          const id=digest(viewToken);
          if(new Set([viewToken,revokeToken,creationToken]).size!==3 || records.has(id))return send(503,{error:'allocation'});
          const record={protocol:2,card:null,status:'issued',revokeHash:digest(revokeToken),creationHash:digest(creationToken),
            contentHash:body.digest,expiresAt:now()+ttlMs,createUntil:now()+Math.min(creationMs,ttlMs)};
          await save(id,record,true);if(!repository)records.set(id,record);
          return send(200,{version:2,viewToken,revokeToken,creationToken,createUntil:record.createUntil,expiresAt:record.expiresAt});
        }
        if(req.url==='/v1/cards') {
          if(body?.version===1)return send(410,{error:'legacy-creation'});
          if(production&&!limiter('all','png',now()))return send(429,{error:'limit'});
          let card;try{card=validateCard(body);}catch{return send(400,{error:'format'});}
          const id=digest(body.viewToken),record=repository?await repository.get(id):records.get(id);
          if(!record || record.protocol!==2 || !record.creationHash
            || !timingSafeEqual(Buffer.from(record.creationHash,'hex'),Buffer.from(digest(body.creationToken),'hex')))return send(404,{error:'issuance-unavailable'});
          if(record.status!=='issued' && record.status!=='active')return send(410,{error:record.status});
          if(record.expiresAt<=now() || record.createUntil<=now())return send(410,{error:'issuance-expired'});
          if(record.contentHash!==digest(JSON.stringify({snapshot:card.snapshot,png:card.png})))return send(409,{error:'immutable'});
          if(record.status==='issued'){
            const active={...record,card,status:'active'};await save(id,active);if(!repository)records.set(id,active);
          }
          return send(200,{expiresAt:record.expiresAt,version:2});
        }
        const keys=req.url.endsWith('/read')?['viewToken']:['viewToken','revokeToken'];
        if(!body || typeof body!=='object' || Object.keys(body).sort().join()!==keys.sort().join()
          || !validToken(body.viewToken) || (keys.length===2 && !validToken(body.revokeToken)))return send(400,{error:'format'});
        const id=digest(body.viewToken), r=repository?await repository.get(id):records.get(id);
        if(!r){
          if(keys.length===1)return send(404,{error:'unavailable'});
          // Absence is terminal: revocation never allocates a caller-selected identity.
          return send(200,{revoked:true});
        }
        if(keys.length===2){
          if(!timingSafeEqual(Buffer.from(r.revokeHash,'hex'),Buffer.from(digest(body.revokeToken),'hex')))return send(404,{error:'unavailable'});
          const dead={...r,card:null,status:'revoked'};await save(id,dead);if(!repository)records.set(id,dead);return send(200,{revoked:true});
        }
        if(!r.card || r.expiresAt<=now())return send(410,{error:r.expiresAt<=now()?'expired':r.status ?? 'expired'});
        const value={...r.card,expiresAt:r.expiresAt};
        if(budget&&!await budget.reserve(now(),{bytes:Buffer.byteLength(JSON.stringify(value))}))return send(429,{error:'budget'});
        return send(200,value);
      }).catch(error=>{if(!error.capacity)failStorage();if(!res.headersSent)send(error.capacity?429:503,{error:error.capacity?'capacity':'unavailable'});}).finally(release);
    });
    req.on('error',release);req.on('aborted',release);
  });
  server.requestTimeout=10000;server.headersTimeout=10000;server.maxRequestsPerSocket=100;server.maxConnections=32;
  server.on('close',()=>clearInterval(timer));
  server.drain=async()=>{accepting=false;await serial;};
  return server;
}
if (process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const {runService}=await import('./run.mjs');
  await runService();
}
