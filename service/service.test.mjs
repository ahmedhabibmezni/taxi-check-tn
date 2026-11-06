import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {createCardServer} from './server.mjs';
import {digest,validateCard} from './contract.mjs';

import {fixture,crc,chunk} from './test-fixture.mjs';
async function issued(post,b=fixture()){
 const response=await post('/v1/cards/issue',{version:2,digest:digest(JSON.stringify({snapshot:b.snapshot,png:b.png}))});
 assert.equal(response.status,200);const grant=await response.json();
 const body={...b,viewToken:grant.viewToken,creationToken:grant.creationToken};
 Object.defineProperty(body,'revokeToken',{value:grant.revokeToken});return body;
}
async function setup(t,options={}){
  const directory=await mkdtemp(join(tmpdir(),'taxi-card-service-'));let clock=1000000;
  const server=await createCardServer({directory,now:()=>clock,...options});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
  t.after(async()=>{await new Promise(r=>server.close(r));await rm(directory,{recursive:true,force:true});});
  const post=(route,body,headers={})=>fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:typeof body==='string'?body:JSON.stringify(body)});
  return {post,base,directory,advance:n=>clock+=n};
}
test('actual HTTP exact PNG/presentation preservation in four languages and no-store/CSP/first-party viewer',async t=>{
  const {post,base}=await setup(t);
  for(const lang of ['aeb','ar','fr','en']){
    const b=await issued(post,fixture(lang)),created=await post('/v1/cards',b);assert.equal(created.status,200);
    const read=await post('/v1/cards/read',{viewToken:b.viewToken});const value=await read.json();
    assert.equal(value.png,b.png);assert.deepEqual(value.snapshot,b.snapshot);assert.equal(value.width,1200);
    assert.match(read.headers.get('cache-control'),/no-store/);assert.equal(read.headers.get('referrer-policy'),'no-referrer');
    assert.ok(!JSON.stringify(value).includes(b.revokeToken));
  }
  const viewer=await fetch(base+'/view');assert.match(viewer.headers.get('content-security-policy'),/frame-ancestors 'none'/);
  assert.match(await viewer.text(),/viewer.mjs/);assert.equal((await fetch(base+'/qr.mjs')).status,200);
});
test('distinct capabilities, unauthorized revocation and idempotent proper revocation remove PNG and text',async t=>{
  const {post,directory}=await setup(t),b=await issued(post);await post('/v1/cards',b);
  assert.equal((await post('/v1/cards/revoke',{viewToken:b.viewToken,revokeToken:b.viewToken})).status,404);
  assert.equal((await post('/v1/cards/revoke',{viewToken:b.revokeToken,revokeToken:b.viewToken})).status,200);
  assert.equal((await post('/v1/cards/read',{viewToken:b.viewToken})).status,200);
  for(let i=0;i<2;i++)assert.deepEqual(await(await post('/v1/cards/revoke',{viewToken:b.viewToken,revokeToken:b.revokeToken})).json(),{revoked:true});
  assert.equal((await post('/v1/cards/read',{viewToken:b.viewToken})).status,410);
  const disk=await readFile(join(directory,`${digest(b.viewToken)}.json`),'utf8');assert.ok(!disk.includes(b.png));assert.ok(!disk.includes('Estimated fare'));assert.ok(!disk.includes(b.revokeToken));
});
test('expiry exact boundary denies immediately and removes stored content, then tombstone is deleted',async t=>{
  const {post,directory,advance}=await setup(t,{ttlMs:100});const b=await issued(post);await post('/v1/cards',b);advance(99);
  assert.equal((await post('/v1/cards/read',{viewToken:b.viewToken})).status,200);advance(1);
  const expired=await post('/v1/cards/read',{viewToken:b.viewToken});assert.equal(expired.status,410);assert.equal((await expired.json()).error,'expired');
  assert.equal(JSON.parse(await readFile(join(directory,`${digest(b.viewToken)}.json`),'utf8')).card,null);
  advance(86400000);assert.equal((await post('/v1/cards/read',{viewToken:b.viewToken})).status,404);assert.equal((await readdir(directory)).length,0);
});
test('concurrent same-attempt retry creates once; distinct requests isolated; altered retry conflicts',async t=>{
  const {post,directory}=await setup(t),b=await issued(post),other=await issued(post);
  const results=await Promise.all([post('/v1/cards',b),post('/v1/cards',b),post('/v1/cards',other)]);assert.deepEqual(results.map(x=>x.status),[200,200,200]);
  assert.equal((await readdir(directory)).length,2);
  assert.equal((await post('/v1/cards',{...b,snapshot:{...b.snapshot,blocks:b.snapshot.blocks.map((v,i)=>i===1?{...v,text:'9.000 TND'}:v)}})).status,409);
  assert.equal((await(await post('/v1/cards/read',{viewToken:b.viewToken})).json()).snapshot.blocks[1].text,'4.074 TND');
});
test('strict allowed fields/tokens/languages/blocks and malformed PNG dimensions, metadata or bytes rejected',async t=>{
  const {post}=await setup(t),b=await issued(post);
  const wrongDimensions=Buffer.from(b.png,'base64');wrongDimensions.writeUInt32BE(1199,16);wrongDimensions.writeUInt32BE(crc(wrongDimensions.subarray(12,29)),29);
  const image=Buffer.from(b.png,'base64'), metadata=Buffer.concat([image.subarray(0,-12),chunk('tEXt',Buffer.from('location\0private')),image.subarray(-12)]);
  const invalid=[{...b,coords:[1,2]},{...b,viewToken:'x'},{...b,viewToken:[b.viewToken]},{...b,revokeToken:b.viewToken},{...b,snapshot:{...b.snapshot,tripId:'secret'}},
    {...b,snapshot:{...b.snapshot,direction:'rtl'}},{...b,snapshot:{...b.snapshot,blocks:[null]}},{...b,png:'not-png'},
    {...b,snapshot:{...b.snapshot,blocks:b.snapshot.blocks.map((v,i)=>i===0?{...v,text:'<script>bad</script>'}:v)}},
    {...b,png:Buffer.from(Buffer.from(b.png,'base64').subarray(0,40)).toString('base64')},{...b,png:wrongDimensions.toString('base64')},{...b,png:metadata.toString('base64')}];
  for(const bad of invalid)assert.equal((await post('/v1/cards',bad)).status,400);
  assert.throws(()=>validateCard({...b,png:b.png.slice(0,-4)}));
});
test('oversize, bad JSON/content type, cross-origin and unknown routes are bounded',async t=>{
  const {post,base}=await setup(t);
  assert.equal((await post('/v1/cards','x'.repeat(3000001))).status,413);
  assert.equal((await post('/v1/cards','{')).status,400);
  assert.equal((await post('/v1/cards',fixture(),{'Content-Type':'text/plain'})).status,415);
  assert.equal((await post('/v1/cards',fixture(),{Origin:'https://unapproved.invalid'})).status,403);
  assert.equal((await fetch(base+'/unknown')).status,404);
  assert.equal((await post('/v1/cards/read',{viewToken:randomBytes(32).toString('base64url')})).status,404);
});
test('creation capacity/rate controls reject rather than evict valid snapshots',async t=>{
  const {post}=await setup(t,{maxCards:1});const b=await issued(post);assert.equal((await post('/v1/cards',b)).status,200);assert.equal((await post('/v1/cards/issue',{version:2,digest:'a'.repeat(64)})).status,429);assert.equal((await post('/v1/cards/read',{viewToken:b.viewToken})).status,200);
});
test('source rate bucket has finite window',async t=>{
  const {post,advance}=await setup(t,{rateLimit:1});assert.equal((await post('/v1/cards/issue',{version:2,digest:'a'.repeat(64)})).status,200);assert.equal((await post('/v1/cards/issue',{version:2,digest:'a'.repeat(64)})).status,429);advance(60000);assert.equal((await post('/v1/cards/issue',{version:2,digest:'a'.repeat(64)})).status,200);
});
test('pending capabilities can be retired before arrival; delayed create cannot resurrect them',async t=>{
  const {post}=await setup(t),b=await issued(post);
  assert.equal((await post('/v1/cards/revoke',{viewToken:b.viewToken,revokeToken:b.revokeToken})).status,200);
  assert.equal((await post('/v1/cards',b)).status,410);
  assert.equal((await post('/v1/cards/read',{viewToken:b.viewToken})).status,410);
});
test('restart preserves exact immutable bytes, and startup sweep removes expired content',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'taxi-card-restart-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  let clock=100000;const options={directory,ttlMs:100,now:()=>clock};
  let server=await createCardServer(options);await new Promise(r=>server.listen(0,'127.0.0.1',r));
  let base=`http://127.0.0.1:${server.address().port}`;
  const post=(route,body)=>fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const b=await issued(post);
  await fetch(base+'/v1/cards',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});
  await new Promise(r=>server.close(r));server=await createCardServer(options);await new Promise(r=>server.listen(0,'127.0.0.1',r));base=`http://127.0.0.1:${server.address().port}`;
  const value=await(await fetch(base+'/v1/cards/read',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({viewToken:b.viewToken})})).json();assert.equal(value.png,b.png);
  await new Promise(r=>server.close(r));clock+=100;server=await createCardServer(options);await new Promise(r=>server.close(r));
  assert.equal(JSON.parse(await readFile(join(directory,`${digest(b.viewToken)}.json`),'utf8')).card,null);
});
test('request paths do not emit content or capability logs',async t=>{
  const {post}=await setup(t),output=[];const log=console.log,error=console.error;console.log=(...v)=>output.push(v);console.error=(...v)=>output.push(v);
  try{const b=await issued(post);await post('/v1/cards',b);await post('/v1/cards/read',{viewToken:b.viewToken});await post('/v1/cards/revoke',{viewToken:b.viewToken,revokeToken:b.revokeToken});assert.deepEqual(output,[]);}finally{console.log=log;console.error=error;}
});
test('periodic sweep removes expired content without a recipient read',async t=>{
  const {post,directory,advance}=await setup(t,{ttlMs:100,sweepMs:5}),b=await issued(post);await post('/v1/cards',b);advance(100);
  let removed=false;
  const deadline=Date.now()+5000;
  while(Date.now()<deadline&&!removed){await new Promise(r=>setTimeout(r,5));removed=JSON.parse(await readFile(join(directory,`${digest(b.viewToken)}.json`),'utf8')).card===null;}
  assert.equal(removed,true);
});
test('malformed local storage fails startup without disclosing stored content in the error',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'taxi-card-malformed-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  await writeFile(join(directory,'a'.repeat(64)+'.json'),'{private synthetic card content');
  await assert.rejects(createCardServer({directory}),error=>error.message==='Local card storage could not be read');
});

