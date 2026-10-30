import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {siteStatusMarkup} from '../console/layers/E/monitor-status.js';
import {createPlugin} from '../plugins/qq-components/life-campus-watch/index.js';
test('monitor status separates URL and outcomes, escapes names and does not turn unknown delivery into success',()=>{
 const html=siteStatusMarkup([{name:'课程 <未审核>',url:'https://example.test/a?course=1&content=2',health:{checkedAt:Date.now(),fetch:'green',auth:'red',diff:'changed',delivery:'unknown',hint:'需要重新登录'}},{name:'不可信地址',url:'javascript:alert(1)',health:{}}]);
 assert.ok(html.includes('课程 &lt;未审核&gt;'));assert.ok(html.includes('读取正常'));assert.ok(html.includes('需要登录'));assert.ok(html.includes('发现更新'));assert.ok(html.includes('尚无发送记录'));assert.ok(!html.includes('href="javascript:'));assert.equal((html.match(/class="watch-site"/g)||[]).length,2);
});
test('script descriptions are read-only single-line metadata and paused scripts keep their descriptions',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'whale-script-description-')),tools=new Map();
 try{const cfg={scriptCollabEnabled:true,scriptPaths:[{value:'scripts/first.mjs',enabled:true},{value:'scripts/second.mjs',enabled:false}],scriptDescriptions:{'scripts/first.mjs':'检查页面\n找到更新后按约定通知','scripts/second.mjs':'只整理已取得的结果'}};
  createPlugin({root,config:cfg,state:{get:()=>({}),set(){}},registerTool:(name,definition)=>tools.set(name,definition),capabilities:{spawnCampusWatch(){throw Error('status must not execute scripts');}}});
  const out=tools.get('campus_watch_status').handler();assert.equal(out.scripts.length,2);assert.equal(out.scripts[0].description,'检查页面 找到更新后按约定通知');assert.equal(out.scripts[1].health,'paused');assert.equal(out.scripts[1].description,'只整理已取得的结果');
 }finally{assert.ok(root.startsWith(os.tmpdir()+path.sep));fs.rmSync(root,{recursive:true,force:true});}
});
