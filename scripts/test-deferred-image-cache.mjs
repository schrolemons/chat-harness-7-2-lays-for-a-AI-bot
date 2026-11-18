import test from'node:test';import assert from'node:assert/strict';import fs from'node:fs';import os from'node:os';import path from'node:path';
import{createDeferredImageCache}from'../src/deferred-image-cache.mjs';import{createImageAssetStore}from'../src/image-asset-store.mjs';
const raw=Buffer.from('GIF89a'+'raw-animation-kept-verbatim');
test('ingress returns only an image placeholder while a slow raw download stays in the background; analysis reads the scoped cache later',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'lazy-image-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));let resolve,calls=0,now=1000;const store=createImageAssetStore({root,now:()=>now}),cache=createDeferredImageCache({store,fetchRaw:async()=>{calls++;return new Promise(r=>resolve=r);}}),media=[{kind:'image',url:'https://fixture.invalid/image.gif'}];
 const parts=cache.enqueue({key:'private:123',messageId:'m1',media});assert.equal(parts.length,1);assert.match(parts[0].text,/一张图片/);assert(!parts.some(x=>x.type==='image'));await Promise.resolve();assert.equal(calls,1);assert.equal(store.list({key:'private:123'}).length,0);
 resolve({buffer:raw});const image=await cache.read({key:'private:123',media:media[0]});assert.equal(image.ok,true);assert(image.image.data.equals(raw),'no decode, re-encode or animation extraction on ingress');assert.equal(image.mimeType,'image/gif');
 assert.equal(await cache.read({key:'group:123',media:media[0]}),null);assert.equal(calls,1);
 const reopened=createImageAssetStore({root,now:()=>now});
 assert.deepEqual(reopened.sourceMedia({key:'private:123',messageId:'m1'}),[{kind:'image',_imageSourceRef:media[0]._imageSourceRef}]);
 assert.equal(reopened.sourceMedia({key:'group:123',messageId:'m1'}).length,0);
 assert.equal(reopened.sourceMedia({key:'private:123',messageId:'m'}).length,0);
 now+=3600001;assert.equal(store.findSource({key:'private:123',sourceRef:media[0]._imageSourceRef}).ok,false);assert.equal(store.list({key:'private:123'}).length,0);
});
test('background fetch errors preserve the placeholder and never reject ingress',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'lazy-image-fail-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));let errors=0;const cache=createDeferredImageCache({store:createImageAssetStore({root}),fetchRaw:async()=>{throw Error('expired image URL');},onError:()=>errors++}),media=[{kind:'image'}];
 assert.equal(cache.enqueue({key:'group:123',messageId:'1',media})[0].type,'text');const r=await cache.read({key:'group:123',media:media[0]});assert.equal(r.ok,false);assert.equal(r.attempted,true);assert.equal(errors,1);
});
