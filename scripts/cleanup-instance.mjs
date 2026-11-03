import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readManifest} from '../src/instance-manifest.mjs';
import {planInstanceCleanup} from '../src/instance-uninstall-plan.mjs';
// CLI deliberately cannot mint offline writer authority from flags or a PID.
export async function cleanupInstance(root){return planInstanceCleanup(await readManifest(root));}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{const root=process.argv[2];if(!path.isAbsolute(root||''))throw Error('Explicit absolute installation root required');const plan=await cleanupInstance(root);console.log(JSON.stringify(plan,null,2));process.exitCode=plan.conflicts.length?1:0;}
 catch(error){console.error(error.code||error.message);process.exitCode=1;}
}
