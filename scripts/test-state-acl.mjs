import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {hardenDir,icacls,inspectDirAcl} from '../src/state-acl.mjs';

test('secure tree startup checks permissions without rewriting and still repairs an unsafe descendant',{skip:process.platform!=='win32'},t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'qq-state-acl-'));
 t.after(()=>{assert.equal(path.dirname(root),os.tmpdir());assert(path.basename(root).startsWith('qq-state-acl-'));fs.rmSync(root,{recursive:true,force:true});});
 const file=path.join(root,'credential.txt');fs.writeFileSync(file,'fixture-only');
 assert.equal(hardenDir(root,{force:true}).ok,true);
 const before=icacls([root]).stdout;
 const clean=hardenDir(root);
 assert.equal(clean.ok,true);assert.equal(clean.unchanged,true,'an already protected tree must skip recursive writes');
 assert.equal(icacls([root]).stdout,before);
 assert.equal(icacls([file,'/grant','*S-1-1-0:R']).status,0);
 const repaired=hardenDir(root);
 assert.equal(repaired.ok,true);assert.notEqual(repaired.unchanged,true,'root protection cannot hide a permissive child');
 const check=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',
  '$a=Get-Acl -LiteralPath $env:QQ_ACL_FIXTURE;@($a.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])|Where-Object {$_.IdentityReference.Value -eq "S-1-1-0"}).Count'],
  {encoding:'utf8',windowsHide:true,env:{...process.env,QQ_ACL_FIXTURE:file}});
 assert.equal(check.status,0,check.stderr);assert.equal(check.stdout.trim(),'0');
 assert.equal(fs.readFileSync(file,'utf8'),'fixture-only');
 assert.equal(hardenDir(root).unchanged,true);
 assert.notEqual(hardenDir(root,{force:true}).unchanged,true,'manual force must retain full repair');
});

test('ACL checking and forced repair do not follow junctions outside state',{skip:process.platform!=='win32'},t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'qq-state-acl-links-'));
 const external=fs.mkdtempSync(path.join(os.tmpdir(),'qq-state-acl-external-'));
 t.after(()=>{for(const dir of [root,external]){assert.equal(path.dirname(dir),os.tmpdir());assert(path.basename(dir).startsWith('qq-state-acl-'));fs.rmSync(dir,{recursive:true,force:true});}});
 assert.equal(hardenDir(root,{force:true}).ok,true);
 const externalFile=path.join(external,'outside.txt');fs.writeFileSync(externalFile,'outside-fixture');
 assert.equal(icacls([externalFile,'/grant','*S-1-1-0:R']).status,0);
 fs.symlinkSync(external,path.join(root,'junction'),'junction');
 const before=icacls([externalFile]).stdout;
 const checked=inspectDirAcl(root);assert.equal(checked.ok,true,checked.detail);assert.equal(checked.links,1);
 assert.equal(hardenDir(root,{force:true}).ok,true);
 assert.equal(icacls([externalFile]).stdout,before,'outside target ACL must remain untouched');
});
