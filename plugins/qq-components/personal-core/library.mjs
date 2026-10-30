import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
export const hashBytes=value=>createHash('sha256').update(value).digest('hex');
const text=(value,name,max=10000)=>{if(typeof value!=='string'||!value.trim()||value.length>max)throw Error(name+' 必须为非空文本');return value;};
const strings=(value,name)=>{if(!Array.isArray(value)||value.some(x=>typeof x!=='string'||x.length>1000))throw Error(name+' 必须为文本数组');return value;};
const readJson=file=>{const bytes=fs.readFileSync(file);if(bytes.length>16*1024*1024)throw Error('目录索引过大');return JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,''));};
export function packageFile(root,relative){
 if(typeof relative!=='string'||!relative||relative.includes('\\')||path.isAbsolute(relative)||relative.split('/').some(s=>!s||s==='.'||s==='..'))throw Error('非法资料路径');
 const target=path.resolve(root,relative),real=fs.realpathSync(target);
 if(!target.startsWith(root+path.sep)||!real.startsWith(root+path.sep)||!fs.statSync(real).isFile())throw Error('资料路径越出资料包');
 return real;
}
export function loadLibrary(directory){
 text(directory,'资料包目录',4096);const root=fs.realpathSync(path.resolve(directory));if(!fs.statSync(root).isDirectory())throw Error('资料包目录不存在');
 // Memoize only inside this validation pass: shared originals are read/hash-checked
 // once per call, without retaining stale data between tool requests.
 const files=new Map();
 const checked=(relative,expected)=>{
  let item=files.get(relative);
  if(!item){const bytes=fs.readFileSync(packageFile(root,relative));if(bytes.length>32*1024*1024)throw Error('资料文件过大');item={bytes,hash:hashBytes(bytes)};files.set(relative,item);}
  if(typeof expected!=='string'||!/^[a-f0-9]{64}$/.test(expected)||item.hash!==expected)throw Error('资料内容hash校验不一致：'+relative);
  return item.bytes;
 };
 const manifest=readJson(packageFile(root,'manifest.json'));
 const allowed=new Set(['schema_version','id','title','author','version','description','catalog','guide','sources','behavior']);if(Object.keys(manifest).some(k=>!allowed.has(k)))throw Error('资料包声明包含未知字段');
 if(manifest.schema_version!==1)throw Error('不支持的资料包版本 schema_version');
 if(typeof manifest.id!=='string'||!/^[a-z][a-z0-9._-]{0,63}$/.test(manifest.id))throw Error('资料包ID无效');
 for(const key of ['title','author','version'])text(manifest[key],key,200);if(manifest.description!==undefined&&(typeof manifest.description!=='string'||manifest.description.length>10000))throw Error('资料包描述必须为文本');
 if(!Array.isArray(manifest.sources)||!manifest.sources.length)throw Error('资料包缺少原稿来源');
 for(const source of manifest.sources){if(!source||typeof source!=='object'||Array.isArray(source)||Object.keys(source).some(k=>!['title','path','sha256','converted_path','converted_sha256'].includes(k))||(source.converted_path===undefined)!==(source.converted_sha256===undefined))throw Error('原稿来源声明无效');text(source.title,'原稿名称',300);checked(source.path,source.sha256);if(source.converted_path!==undefined)checked(source.converted_path,source.converted_sha256);}
 const behavior=manifest.behavior||{};if(!behavior||typeof behavior!=='object'||Array.isArray(behavior)||Object.keys(behavior).some(k=>!['discussion_commands','discussion_patterns','care_patterns','exit_patterns'].includes(k)))throw Error('资料包使用规则包含未知字段');
 for(const key of ['discussion_commands','discussion_patterns','care_patterns','exit_patterns']){
  const values=strings(behavior[key]||[],key);if(key==='discussion_commands'){if(values.some(x=>!/^\/[a-z][a-z0-9-]{0,24}$/i.test(x)))throw Error('讨论指令无效');}
  else for(const expression of values){if(expression.length>300)throw Error('匹配规则过长');new RegExp(expression,'i');}
 }
 const catalog=readJson(packageFile(root,manifest.catalog));if(catalog.schema_version!==1||!Array.isArray(catalog.topics)||!catalog.topics.length||catalog.topics.length>20000)throw Error('目录索引版本或条目无效');
 const byId=new Map();
 for(const topic of catalog.topics){
  if(typeof topic.id!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/.test(topic.id)||byId.has(topic.id))throw Error('目录ID无效或重复');
  for(const key of ['title','group','core_meaning','when_to_use','how_to_use','epistemic_status','source'])text(topic[key],key);
  for(const key of ['flags','keywords','related'])strings(topic[key],key);
  if(!/^topics\/.+\.md$/.test(topic.path))throw Error('卡片路径必须为topics中的Markdown文件');
  checked(topic.path,topic.sha256);
  if(!Array.isArray(topic.source_lines)||topic.source_lines.length!==2||topic.source_lines.some(x=>!Number.isSafeInteger(x)||x<1)||topic.source_lines[1]<topic.source_lines[0])throw Error('原文行号无效');
  for(const key of ['source_snapshot','source_markdown'])if(topic[key]!==undefined)packageFile(root,topic[key]);
  const provenance=manifest.sources.find(source=>source.path===topic.source_snapshot);
  if(!provenance)throw Error('主题未关联到已声明原稿');
  const reference=topic.source_markdown||topic.source_snapshot;if(topic.source_markdown&&provenance.converted_path!==topic.source_markdown)throw Error('主题转换原稿与来源声明不一致');
  if(!/\.(md|txt)$/i.test(reference))throw Error('原文行号须引用Markdown或文本转换稿');
  const original=files.get(reference)?.bytes||fs.readFileSync(packageFile(root,reference));if(topic.source_sha256!==undefined&&hashBytes(original)!==topic.source_sha256)throw Error('原文出处hash校验失败');
  if(topic.source_lines[1]>original.toString('utf8').split('\n').length)throw Error('原文行号超过转换稿长度');
  byId.set(topic.id,topic);
 }
 for(const topic of catalog.topics)if(topic.related.some(id=>!byId.has(id)))throw Error('目录存在失效的关联 related ID');
 if(manifest.guide&&(!manifest.guide.path||Object.keys(manifest.guide).some(k=>!['path','sha256'].includes(k))))throw Error('阅读说明声明无效');
 const guide=manifest.guide?checked(manifest.guide.path,manifest.guide.sha256).toString('utf8').replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/,'').trim():'';
 return {root,manifest,catalog,topics:catalog.topics,byId,guide};
}
export function inspectLibrary(directory){try{const p=loadLibrary(directory);return {ok:true,id:p.manifest.id,title:p.manifest.title,author:p.manifest.author,version:p.manifest.version,schemaVersion:1,topicCount:p.topics.length,sourceCount:p.manifest.sources.length,validatedAt:Date.now()};}catch(error){return {ok:false,error:error.message,validatedAt:Date.now()};}}
