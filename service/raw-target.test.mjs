import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import http from 'node:http';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

test('non-origin request targets cannot reach inherited asset properties or stop the service',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'taxi-card-target-'));
  const child=spawn(process.execPath,['--input-type=module','-e',`import {createCardServer} from './service/server.mjs';const s=await createCardServer({directory:process.env.TEST_CARD_DIRECTORY});s.listen(0,'127.0.0.1',()=>process.stdout.write(String(s.address().port)));`],
    {env:{...process.env,TEST_CARD_DIRECTORY:directory},stdio:['ignore','pipe','pipe']});
  child.stderr.resume();t.after(async()=>{if(child.exitCode===null)child.kill();await new Promise(r=>setTimeout(r,30));await rm(directory,{recursive:true,force:true});});
  const port=Number(await new Promise((resolve,reject)=>{child.stdout.once('data',v=>resolve(v.toString()));child.once('error',reject);}));
  for(const target of ['constructor','__proto__','/../server.mjs','/%2e%2e/server.mjs']) {
    const status=await new Promise((resolve,reject)=>{const req=http.request({hostname:'127.0.0.1',port,path:target,method:'GET'},res=>{res.resume();resolve(res.statusCode);});req.on('error',reject);req.end();});
    assert.ok([400,404].includes(status));
  }
  assert.equal(child.exitCode,null);
});
