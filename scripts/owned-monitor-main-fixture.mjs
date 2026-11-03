// Test-only harness: execute production main bodies with synthetic resources, no navigation.
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import {parse} from 'acorn';
import {createSiteSessions} from './campus-site-sessions.mjs';
import {generateWebSummary} from '../plugins/qq-components/life-campus-watch/summarizer.mjs';
import {createOwnedMonitorClient} from './owned-monitor-client.mjs';
export async function executeMonitorMain(kind,mode){
 const root=process.env.QQ_BRIDGE_ROOT;
 const source=await fs.readFile(new URL('./'+kind+'.mjs',import.meta.url),'utf8');
 const ast=parse(source,{ecmaVersion:'latest',sourceType:'module'}),node=ast.body.find(n=>n.type==='FunctionDeclaration'&&n.id.name==='main');
 const page={isClosed:()=>false,evaluate:async()=>null,goto:async()=>{},bringToFront:async()=>{},evaluateOnNewDocument:async()=>({identifier:'fixture'}),on:()=>{}};
 const browser={disconnect:async()=>{},createBrowserContext:async()=>({pages:async()=>[page],newPage:async()=>page,cookies:async()=>{if(mode==='checkpoint')throw Error('fixture checkpoint failed');return [];},close:async()=>{if(mode==='close')throw Error('fixture context close failed');}})};
 const noop=()=>{},state={};let closes=0;
 const context={ROOT:root,path,console,process,setTimeout,clearTimeout,Date,ownedCleanup:async()=>{},siteSessions:null,
  createSiteSessions:(...args)=>{const sessions=createSiteSessions(...args);const close=sessions.close;return {...sessions,close:()=>{closes++;return close();}};},
  acquireLease:()=>noop,leaseActive:()=>false,flushLoginNotices:async()=>{},loginRecovery:{},logLine:noop,
  LECTURES_ONLY:false,FORCE:true,RETRY_URL:'',readUnreachableUntil:()=>0,preflight:async()=>({okAny:true}),writeUnreachableUntil:noop,
  readState:()=>state,saveState:noop,ensureBrowser:async()=>browser,CONFIG:{lectures:{enabled:true,portalUrl:'https://fixture.invalid/'}},MONITOR_SCRIPTS:new Set(['lectures']),WATCH_PLUGIN_CONFIG:{aiWebSummary:mode==='summary'},WATCH_SITES:[],
  checkLectures:async()=>{if(mode==='business')throw Error('fixture website failure');},stageWebChanges:()=>[],reportScriptHeartbeat:noop,
  generateWebSummary,prepareWebNotifications:async(changes,options)=>{if(mode==='summary')await options.generate({changes:[]});return {suppressedIds:[],changes:[]};},dispatchOwnerChanges:async()=>({sent:false,count:0}),GRAB_DIR:root,
  log:noop,read:()=>({at:Date.now()}),selectLoginTargets:()=>[{url:'https://fixture.invalid/'}],recovery:{get:()=>({phase:'waiting',generation:1}),fail:noop},loginOrigin:url=>new URL(url).origin,
  notify:async()=>{},connect:async()=>null,launch:async()=>browser,reuseLoginPage:async()=>{if(mode==='business')throw Error('fixture website failure');return {page,reused:true};},createLoginProbe:async()=>()=>false,waitForLogin:async()=>({ready:false,reason:'fixture finished'}),sleep:async()=>{}
 };
 const monitor=createOwnedMonitorClient({root,kind,onShutdown:()=>context.ownedCleanup()});context.ownedMonitor=monitor;
 if(process.env.TEST_OWNED_MONITOR_BROWSER==='1')context.ensureBrowser=async()=>{
  const connected=await monitor.connect(true);
  return {disconnect:()=>connected.disconnect(),createBrowserContext:async()=>{const ctx=await connected.createBrowserContext();return {pages:()=>ctx.pages(),newPage:()=>ctx.newPage(),cookies:()=>ctx.cookies(),close:async()=>{await ctx.close();throw Error('fixture close uncertainty after actual context close');}};}};
 };
 const main=vm.runInNewContext(source.slice(node.start,node.end)+';main',context);
 try{await main();}finally{await monitor.dispose();}
 return {closes};
}
