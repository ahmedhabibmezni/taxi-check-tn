import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {serviceConfig} from './config.mjs';
import {prepareEmpty,approveCurrent} from './store.mjs';

export async function operate(command,confirm,env=process.env){
  const config=serviceConfig(env);
  if(!config.production)throw Error('Production operations require explicit configuration');
  if(command==='init-empty'||command==='recover-empty'){
    const id=await prepareEmpty(config,{confirm});
    console.log(`Empty store prepared. Set CARD_STORE_ID to ${id}. Old stores were not imported or deleted.`);
  }else if(command==='approve-current'){
    await approveCurrent(config,{confirm});console.log('Current store approved for this boot only.');
  }else throw Error('Unknown operation');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{await operate(process.argv[2],process.argv[3]);}
  catch{console.error('Operation refused. Check explicit confirmation, configured paths, empty destination and store identity.');process.exitCode=1;}
}
