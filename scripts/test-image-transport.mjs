import test from 'node:test';
import assert from 'node:assert/strict';
import {checkImageSession,oneBotImageParams,validateImageImportSource} from '../src/image-generation-transport.mjs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
test('image tools require a live token in simulation and cannot cross sessions',()=>{
 const base={key:'group:10001',mode:'reserved2',token:'t1',sameSessionToken:(key,token)=>key==='group:10001'&&token==='t1',modeAllowed:()=>true,paused:false,silent:false,enabled:true};
 assert.equal(checkImageSession(base).ok,true);assert.equal(checkImageSession({...base,key:'group:10002'}).ok,false);assert.equal(checkImageSession({...base,token:''}).ok,false);assert.equal(checkImageSession({...base,paused:true}).ok,false);assert.equal(checkImageSession({...base,mode:'chat'}).ok,false);
 assert.equal(checkImageSession({...base,mode:'closed-agent',token:'',key:'group:10001',modeAllowed:()=>false}).ok,false);
});
test('managed image delivery creates a OneBot image segment without accepting a local path',()=>{
 const data=Buffer.from([137,80,78,71,13,10,26,10]).toString('base64');
 assert.deepEqual(oneBotImageParams('group:10001',{mimeType:'image/png',data}),{action:'send_group_msg',params:{group_id:10001,message:[{type:'image',data:{file:'base64://'+data}}]}});
 assert.throws(()=>oneBotImageParams('group:10001',{file:'C:\\secret.png'}));
});
test('local image import is restricted to the owner private session and remote import requires HTTPS',()=>{
 assert.equal(validateImageImportSource({key:'private:123',ownerQQ:123,filePath:'C:\\img.png'}).ok,true);
 assert.equal(validateImageImportSource({key:'group:123',ownerQQ:123,filePath:'C:\\img.png'}).error,'LOCAL_IMAGE_ADMIN_PRIVATE_ONLY');
 assert.equal(validateImageImportSource({key:'private:999',ownerQQ:123,filePath:'C:\\img.png'}).ok,false);
 assert.equal(validateImageImportSource({key:'private:123',ownerQQ:123,url:'http://example.com/a.png'}).error,'IMAGE_URL_MUST_BE_HTTPS');
 assert.equal(validateImageImportSource({key:'private:123',ownerQQ:123,url:'https://example.com/a.png'}).ok,true);
 assert.equal(validateImageImportSource({key:'private:123',ownerQQ:123,url:'https://user:pass@example.com/a.png'}).ok,false);
});
test('QQ MCP advertises the complete image stage, inspect, send and relay tool chain',async()=>{
 const {Client}=await import('@modelcontextprotocol/sdk/client/index.js'),{StdioClientTransport}=await import('@modelcontextprotocol/sdk/client/stdio.js');
 const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),client=new Client({name:'image-feature-test',version:'1.0'}),transport=new StdioClientTransport({command:process.execPath,args:[path.join(root,'src/mcp-snowluma-safe.js')],stderr:'pipe'});
 try{await client.connect(transport);const tools=(await client.listTools()).tools;for(const name of ['qq_make_meme','qq_get_meme_job','qq_list_staged_images','qq_import_image','qq_send_image','qq_relay_image'])assert.ok(tools.some(tool=>tool.name===name),name);}
 finally{await client.close();}
});
