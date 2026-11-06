import http from 'node:http';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {serviceConfig} from './config.mjs';
import {newBoot,consumeApproval} from './store.mjs';
import {PostgresCards,databasePool} from './postgres.mjs';
import {createCardServer} from './server.mjs';

export async function startService(config,{files,pollMs=1000}={}){
  let server,boot,timer,repository,stopping=false,bootstrapStatus='operator-approval-required';
  const listen=instance=>new Promise((resolve,reject)=>{instance.once('error',reject);instance.listen(config.port,config.host,resolve);});
  const close=instance=>new Promise(resolve=>{instance.close(resolve);instance.closeIdleConnections();});
  if(config.storage==='postgres'){
    repository=new PostgresCards(databasePool(config),config);
    try{server=await createCardServer({...config,production:config.production?config:null,repository});await listen(server);}
    catch(error){await repository.close();throw error;}
  }else if(config.production){
    boot=await newBoot(config);
    server=http.createServer((req,res)=>{req.setTimeout(10000,()=>req.destroy());req.resume();res.writeHead(req.url==='/livez'?200:503,{'Cache-Control':'no-store','Content-Type':'application/json'});res.end(JSON.stringify({status:req.url==='/livez'?'alive':bootstrapStatus}));});
    server.requestTimeout=10000;server.headersTimeout=10000;server.maxConnections=32;
    await listen(server);
    let checking=false;
    timer=setInterval(async()=>{
      if(checking||stopping)return;checking=true;
      try{
        if(await consumeApproval(config,boot)){
          clearInterval(timer);
          const active=await createCardServer({...config,production:config,files});
          if(stopping){active.close();return;}
          await close(server);server=active;await listen(server);
        }
      }catch{bootstrapStatus='storage-unavailable';clearInterval(timer);}
      finally{checking=false;}
    },pollMs);
  }else{server=await createCardServer(config);await listen(server);}
  return {get server(){return server;},async stop(){stopping=true;clearInterval(timer);await server.drain?.();await close(server);await repository?.close();}};
}

export async function runService(){
  try{
    const service=await startService(serviceConfig());
    console.log('Card service started. Readiness determines availability. No request logging.');
    for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>{void service.stop().then(()=>process.exit(0),()=>process.exit(1));});
  }catch{console.error('Card service cannot start: check configuration, storage and operating instructions.');process.exitCode=1;}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await runService();
