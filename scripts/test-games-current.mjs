import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {createGamesRuntime} from '../plugins/qq-components/tool-games/games-runtime.mjs';
import {listGames,setGameSettings} from '../plugins/qq-components/tool-games/games-store.mjs';

test('current game starts without a consent flag and uses the renamed catalog entry',()=>{
 const runtime=createGamesRuntime();assert.equal(runtime.catalog().games.find(g=>g.id==='spark').name,'轻微电流');const started=runtime.start({gameId:'spark'});assert.equal(started.ok,true);assert.doesNotMatch(started.message,/本人同意|玩具小火花/);
});
test('current parameters change actual narrative and waveform output; invalid moves consume nothing',()=>{
 const runtime=createGamesRuntime(),session=runtime.start({gameId:'spark'});assert.equal(session.ok,true);
 const effect=payload=>runtime.action({sessionId:session.sessionId,action:'spark',payload});
 const result=effect({bodyPart:'前臂',durationSec:4,intensityLevel:3,waveform:'rampUp'});assert.equal(result.ok,true);assert.match(result.message,/前臂/);assert.match(result.message,/4/);assert.equal(result.fictionalEffect.waveform,'rampUp');const samples=result.fictionalEffect.samples;assert(samples[0].level<samples.at(-1).level);assert.equal(samples.at(-1).atSec,4);
 const steady=effect({bodyPart:'手掌',durationSec:2,intensityLevel:1,waveform:'steady'});assert(steady.fictionalEffect.samples.every(s=>s.level===1));assert.notEqual(result.message,steady.message);
 const moves=runtime.status({sessionId:session.sessionId}).moves;for(const payload of [{bodyPart:'未知部位'},{durationSec:999},{intensityLevel:99},{waveform:'hardware'},{voltage:12}])assert.equal(effect(payload).ok,false);assert.equal(runtime.status({sessionId:session.sessionId}).moves,moves);
 runtime.stop({sessionId:session.sessionId});assert.equal(effect({}).ok,false);
});
test('console saves current defaults and runtime uses them without changing other games',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'whale-current-game-')),file=path.join(root,'games.json');try{
 const params={bodyPart:'肩膀',durationSec:5,intensityLevel:2,waveform:'wave'};setGameSettings('spark',{enabled:true,parameters:params},file);assert.deepEqual(listGames(file).find(g=>g.id==='spark').parameters,params);
 const runtime=createGamesRuntime({registryFile:file}),session=runtime.start({gameId:'spark'}),result=runtime.action({sessionId:session.sessionId,action:'spark'});assert.equal(result.fictionalEffect.bodyPart,'肩膀');assert.equal(result.fictionalEffect.waveform,'wave');assert.equal(result.fictionalEffect.durationSec,5);
 assert.throws(()=>setGameSettings('spark',{parameters:{minSparks:1}},file));assert.equal(listGames(file).find(g=>g.id==='dice').parameters.sides,6);
 setGameSettings('spark',{enabled:false},file);assert.equal(runtime.start({gameId:'spark'}).code,'GAME_DISABLED');
 }finally{if(path.dirname(root)!==os.tmpdir()||!path.basename(root).startsWith('whale-current-game-'))throw Error('Unexpected cleanup');fs.rmSync(root,{recursive:true,force:true});}
});
