import path from 'node:path';
import {hardenDir} from '../src/state-acl.mjs';
const target=process.argv[2];
if(!target){console.error('需要指定要修复权限的目录');process.exitCode=1;}
else{const result=hardenDir(path.resolve(target),{force:true});console.log(JSON.stringify(result));process.exitCode=result.ok?0:1;}
