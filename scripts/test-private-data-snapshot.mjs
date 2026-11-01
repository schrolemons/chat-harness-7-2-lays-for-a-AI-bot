import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
test('private bot data is preserved while credentials and login profiles stay local', async () => {
  const { snapshotPrivateData } = await import('./snapshot-private-data.mjs');
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'whale-private-snapshot-'));
  try {
    fs.mkdirSync(path.join(root,'state/memory'),{recursive:true});
    fs.mkdirSync(path.join(root,'state/campus-profile'),{recursive:true});
    fs.writeFileSync(path.join(root,'config.json'),JSON.stringify({ownerQQ:'10001',consoleToken:'sensitive-fixture-token-123',dsh:{authToken:'sensitive-dsh-token-123'},socialV2:{mood:{initial:73}}}));
    fs.writeFileSync(path.join(root,'state/person-profiles.json'),JSON.stringify({10001:{hobbies:'本人保存的私人兴趣'}}));
    fs.writeFileSync(path.join(root,'state/memory/private_10001.md'),'# 私人记忆\n真实事实\nhttp://127.0.0.1/?token=sensitive-fixture-token-123');
    fs.writeFileSync(path.join(root,'state/campus-profile/Cookies'),'browser-secret');
    const manifest=snapshotPrivateData(root);
    const config=JSON.parse(fs.readFileSync(path.join(root,'private-data/config.json'),'utf8'));
    assert.equal(config.ownerQQ,'10001');assert.equal(config.socialV2.mood.initial,73);
    assert.equal(config.consoleToken,'<LOCAL_CREDENTIAL>');
    const memory=fs.readFileSync(path.join(root,'private-data/state/memory/private_10001.md'),'utf8');
    assert.match(memory,/真实事实/);assert.equal(memory.includes('sensitive-fixture-token-123'),false);
    assert.equal(fs.existsSync(path.join(root,'private-data/state/campus-profile')),false);
    assert.ok(manifest.files.some(file=>file.path==='state/person-profiles.json'));
  } finally { fs.rmSync(root,{recursive:true,force:true}); }
});
test('JSONL credential copies and short passwords are scrubbed across memory text', async () => {
  const { snapshotPrivateData }=await import('./snapshot-private-data.mjs');
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'whale-private-snapshot-'));
  try {
    fs.mkdirSync(path.join(root,'state/memory'),{recursive:true});
    fs.writeFileSync(path.join(root,'config.json'),'{}');
    fs.writeFileSync(path.join(root,'state/token-usage.jsonl'),JSON.stringify({apiKey:'jsonl-secret-123',message:'copy jsonl-secret-123',password:'p4ss'})+'\n');
    fs.writeFileSync(path.join(root,'state/memory/private_1.md'),'jsonl-secret-123 and p4ss');
    fs.writeFileSync(path.join(root,'state/memory/headers.md'),'Authorization: Bearer old-header-secret-98765\nCookie: oldsession=value12345; secure=yes');
    fs.writeFileSync(path.join(root,'state/tasks.json'),JSON.stringify({cookies:['array-secret-12345'],text:'copy array-secret-12345'}));
    snapshotPrivateData(root);
    for(const file of ['state/token-usage.jsonl','state/memory/private_1.md']) {
      const text=fs.readFileSync(path.join(root,'private-data',file),'utf8');
      assert.equal(text.includes('jsonl-secret-123'),false);assert.equal(text.includes('p4ss'),false);
    }
    assert.equal(fs.readFileSync(path.join(root,'private-data/state/tasks.json'),'utf8').includes('array-secret-12345'),false);
    const headers=fs.readFileSync(path.join(root,'private-data/state/memory/headers.md'),'utf8');
    assert.equal(headers.includes('old-header-secret-98765'),false);assert.equal(headers.includes('value12345'),false);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('snapshot replacement removes retired files and a failed read leaves the prior snapshot intact', async () => {
  const { snapshotPrivateData }=await import('./snapshot-private-data.mjs');
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'whale-private-snapshot-'));
  try {
    fs.mkdirSync(path.join(root,'state/memory'),{recursive:true});fs.writeFileSync(path.join(root,'config.json'),'{}');
    const old=path.join(root,'state/memory/private_1.md');fs.writeFileSync(old,'original data');snapshotPrivateData(root);
    fs.unlinkSync(old);snapshotPrivateData(root);
    assert.equal(fs.existsSync(path.join(root,'private-data/state/memory/private_1.md')),false);
    const manifest=fs.readFileSync(path.join(root,'private-data/manifest.json'));
    fs.writeFileSync(path.join(root,'config.json'),'{broken');
    assert.throws(()=>snapshotPrivateData(root));
    assert.deepEqual(fs.readFileSync(path.join(root,'private-data/manifest.json')),manifest);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
