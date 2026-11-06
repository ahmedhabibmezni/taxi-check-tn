import * as fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

export async function syncDirectory(directory) {
  const handle=await fs.open(directory,'r');
  try{await handle.sync();}finally{await handle.close();}
}

export function durableFiles({strict=false,io=fs,directorySync=syncDirectory}={}) {
  const flush=async directory=>{if(strict)await directorySync(directory);};
  return {
    async save(target,value){
      const temporary=`${target}.${randomUUID()}.tmp`;let handle;
      try{
        handle=await io.open(temporary,'wx',0o600);
        await handle.writeFile(JSON.stringify(value));await handle.sync();await handle.close();handle=null;
        await io.rename(temporary,target);await flush(path.dirname(target));
      }catch(error){
        if(handle)await handle.close().catch(()=>{});
        await io.unlink(temporary).catch(()=>{});throw error;
      }
    },
    async remove(target){await io.unlink(target);await flush(path.dirname(target));},
    flush
  };
}
