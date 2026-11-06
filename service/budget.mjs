import * as fs from 'node:fs/promises';
import path from 'node:path';

export async function serviceBudget(directory,files,{dailyIssues=20,monthlyBytes=4000000000}={}){
  const target=path.join(directory,'.budget.json');let state={version:1,day:0,month:0,issues:0,bytes:0};
  try{state=JSON.parse(await fs.readFile(target,'utf8'));}catch{throw Error('Budget unavailable');}
  if(state.version!==1||!['day','month','issues','bytes'].every(k=>Number.isSafeInteger(state[k])&&state[k]>=0))throw Error('Budget unavailable');
  async function reserve(now,{issue=false,bytes=0}={}){
    const date=new Date(now),day=Math.floor(now/86400000),month=date.getUTCFullYear()*12+date.getUTCMonth();
    if(day<state.day||month<state.month)throw Error('Clock precedes persisted budget');
    const next={...state,day,month,issues:day===state.day?state.issues:0,bytes:month===state.month?state.bytes:0};
    if(issue&&next.issues>=dailyIssues||next.bytes+bytes>monthlyBytes)return false;
    next.issues+=issue?1:0;next.bytes+=bytes;
    await files.save(target,next);state=next;return true;
  }
  return {reserve};
}

export function sourceLimiter({maxSources=1024}={}){
  const pools=new Map();
  return (source,kind,now)=>{
    if(!['issue','upload','read','revoke','png'].includes(kind))return false;
    if(!pools.has(kind))pools.set(kind,new Map());
    const sources=pools.get(kind);
    for(const [key,value] of sources)if(value.until<=now)sources.delete(key);
    const key=`${kind}:${source}`,window=kind==='issue'?3600000:60000,limit=kind==='issue'?10:kind==='revoke'?30:kind==='upload'||kind==='png'?6:60;
    let value=sources.get(key);
    if(!value){if(sources.size>=maxSources)return false;value={count:0,until:now+window};sources.set(key,value);}
    return ++value.count<=limit;
  };
}
