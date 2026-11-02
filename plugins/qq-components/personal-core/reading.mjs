// Pure Markdown navigation over the already validated card. Never resolves paths.
const invalid=message=>Object.assign(Error(message),{code:'INVALID_ARGUMENT'});
const failure=(code,message)=>Object.assign(Error(message),{code});
const integer=(value,fallback,min,max)=>{value=value===undefined?fallback:value;if(!Number.isSafeInteger(value)||value<min||value>max)throw invalid('读取参数必须为'+min+'至'+max+'的整数');return value;};

export function readingPlan(text,{sourceHeadings=false}={}){
 const lines=text.split('\n'),starts=[];let position=0;
 for(const line of lines){starts.push(position);position+=line.length+1;}
 const headings=[],stack=[];let fence=null,frontmatter=lines[0]?.replace(/^\uFEFF/,'').trim()==='---';
 for(let i=0;i<lines.length;i++){
  const line=lines[i].replace(/\r$/,'');
  if(frontmatter){if(i>0&&/^(---|\.\.\.)\s*$/.test(line))frontmatter=false;continue;}
  if(fence){if(new RegExp('^ {0,3}'+fence.char+'{'+fence.size+',}\\s*$').test(line))fence=null;continue;}
  const marker=line.match(/^ {0,3}(`{3,}|~{3,})/);if(marker){fence={char:marker[1][0],size:marker[1].length};continue;}
  const atx=line.match(/^ {0,3}(#{1,6})(?:[ \t]+(.*)|[ \t]*)$/);
  const setext=!atx&&line.trim()&&!/^( {4}|\t)/.test(line)&&lines[i+1]?.match(/^ {0,3}(=+|-+)[ \t]*\r?$/);
  const part=sourceHeadings&&!atx&&!setext&&/^(?:第[一二三四五六七八九十百零0-9]+(?:部分|篇|章)|(?:PART|PRAT)\s*[0-9IVX]+)\s*[:：]/i.test(line.trim());
  if(!atx&&!setext&&!part)continue;
  const level=atx?atx[1].length:part?1:setext[1][0]==='='?1:2,title=atx?(atx[2]||'').replace(/[ \t]+#+[ \t]*$/,'').trim():line.trim();
  while(stack.length&&stack.at(-1).level>=level)stack.pop().end=starts[i];
  const h={id:'section:'+(i+1),title:title||'无标题章节',level,start:starts[i],end:text.length,parentId:stack.at(-1)?.id||null};headings.push(h);stack.push(h);if(setext)i++;
 }
 const document={id:'@document',title:'全文',start:0,end:text.length},byId=new Map(headings.map(h=>[h.id,h]));byId.set(document.id,document);
 const children=scope=>{
  let rows=headings.filter(h=>h.parentId===(scope===document?null:scope.id));
  // A single document title is a wrapper, not an extra navigation step.
  if(scope===document&&rows.length===1&&rows[0].end===scope.end)rows=headings.filter(h=>h.parentId===rows[0].id);
  if(!rows.length)return [];
  if(text.slice(scope.start,rows[0].start).trim())rows=[{id:'intro:'+scope.start,title:'开篇',level:0,start:scope.start,end:rows[0].start},...rows];
  return rows;
 };
 for(const scope of [document,...headings])for(const h of children(scope))if(h.id.startsWith('intro:'))byId.set(h.id,h);
 const lineAt=offset=>{let lo=0,hi=starts.length;while(lo<hi){const mid=(lo+hi)>>1;if(starts[mid]<=offset)lo=mid+1;else hi=mid;}return Math.max(1,lo);};
 const describe=h=>({id:h.id,title:h.title,level:h.level,chars:h.end-h.start,content_lines:[lineAt(h.start),lineAt(Math.max(h.start,h.end-1))]});
 return{document,children,describe,lineAt,headingPath(sourceLines){
  const start=starts[sourceLines[0]-1]??text.length,end=starts[sourceLines[1]]??text.length;
  let anchor=headings.find(h=>h.start>=start&&h.start<end)||headings.findLast(h=>h.start<=start&&h.end>start);
  if(!anchor)return [];
  for(;;){const child=headings.find(h=>h.parentId===anchor.id&&h.start<end);if(!child)break;anchor=child;}
  const titles=[];for(let h=anchor;h;h=byId.get(h.parentId))titles.unshift(h.title);return titles;
 },select(section){
  if(section===undefined)return document;
  if(typeof section!=='string'||!section.trim()||section.length>300)throw invalid('section必须是章节ID或完整标题');
  if(byId.has(section))return byId.get(section);
  const matches=headings.filter(h=>h.title===section);if(matches.length>1)throw failure('AMBIGUOUS_SECTION','标题重名，请从章节目录选择明确的section ID');
  if(!matches.length)throw invalid('未知章节，请先读取该卡片的章节目录');return matches[0];
 }};
}

export function cardContext({topics,topic,sourceTitle,sourceText}){
 const brief=(s,n=240)=>{s=String(s||'');return s.length>n?s.slice(0,n).replace(/[\uD800-\uDBFF]$/,'')+'…':s;};
 const rows=topics.filter(t=>t.source_snapshot===topic.source_snapshot&&(t.source_markdown||t.source_snapshot)===(topic.source_markdown||topic.source_snapshot)).sort((a,b)=>a.source_lines[0]-b.source_lines[0]||a.source_lines[1]-b.source_lines[1]||a.id.localeCompare(b.id));
 const before=rows.filter(t=>t.source_lines[1]<topic.source_lines[0]).sort((a,b)=>a.source_lines[1]-b.source_lines[1]||a.id.localeCompare(b.id)).at(-1),after=rows.find(t=>t.source_lines[0]>topic.source_lines[1]);
 const neighbor=t=>t?{id:t.id,title:brief(t.title,200),summary:brief(t.core_meaning),source_lines:t.source_lines,epistemic_status:t.epistemic_status,read_policy:t.flags.some(f=>['restricted_context','health_claim_unverified'].includes(f))?'offline_research_only':'read_by_id'}:null;
 return{position:{sourceTitle,group:topic.group,cardTitle:topic.title,ordinal:rows.findIndex(t=>t.id===topic.id)+1,totalInSource:rows.length,headingPath:readingPlan(sourceText,{sourceHeadings:true}).headingPath(topic.source_lines).map(t=>brief(t,200)),source_lines:topic.source_lines,purpose:brief(topic.when_to_use,160),focus:brief(topic.core_meaning),overlappingCards:rows.filter(t=>t.id!==topic.id&&t.source_lines[0]<=topic.source_lines[1]&&t.source_lines[1]>=topic.source_lines[0]).length},before:neighbor(before),after:neighbor(after),basis:'existing_catalog_summaries_and_source_line_order',note:'定位来自原文标题与行号；用途和上下文概述取自已有目录，不是作者原句，也不代表已读相邻卡全文。'};
}

export function readPreparedText(text,input,{maxReadChars,catalogPageSize,revision}){
 if(input.revision!==undefined){if(typeof input.revision!=='string'||!/^[a-f0-9]{64}$/.test(input.revision))throw invalid('revision必须是读取结果中的SHA-256版本');if(input.revision!==revision)throw failure('STALE_CONTENT','资料已更新，请重新读取目录或卡片后再选择章节');}
 const explicitPage=input.offset!==undefined||input.limit!==undefined;
 if(input.sectionOffset!==undefined&&explicitPage)throw invalid('章节目录分页sectionOffset不能与正文offset/limit混用');
 const plan=readingPlan(text),scope=plan.select(input.section),rows=plan.children(scope),size=scope.end-scope.start;
 const common={revision,readingScope:scope===plan.document?'document':'section',section:plan.describe(scope),sectionChars:size,maxReadChars};
 if(input.sectionOffset!==undefined||!explicitPage&&size>maxReadChars&&rows.length){
  const offset=integer(input.sectionOffset,0,0,rows.length),limit=catalogPageSize;
  return{...common,readMode:'outline',sections:rows.slice(offset,offset+limit).map(plan.describe),sectionCount:rows.length,sectionOffset:offset,nextSectionOffset:offset+limit<rows.length?offset+limit:null,scopeComplete:false,documentComplete:false,hint:rows.length?'按section ID读取所需章节；标题重名时必须使用ID。读取时带上revision。':'没有下级章节；省略sectionOffset读取正文，过长时用offset/limit继续。'};
 }
 const offset=integer(input.offset,0,0,size),limit=integer(input.limit,maxReadChars,1,maxReadChars),start=scope.start+offset;let end=Math.min(scope.end,start+limit);
 if(start>scope.start&&/[\uDC00-\uDFFF]/.test(text[start])&&/[\uD800-\uDBFF]/.test(text[start-1]))throw invalid('offset落在字符中间，请使用上次返回的nextOffset');
 // UTF-16 offsets stay compatible with the old reader, but pages never cut an emoji in half.
 if(end<scope.end&&/[\uD800-\uDBFF]/.test(text[end-1])&&/[\uDC00-\uDFFF]/.test(text[end]))end--;
 if(end===start&&start<scope.end)throw invalid('limit不足以容纳完整字符，请至少设为2');
 const complete=end===scope.end;
 return{...common,readMode:explicitPage||size>maxReadChars?'paged':'full',offset,content:text.slice(start,end),content_lines:[plan.lineAt(start),plan.lineAt(Math.max(start,end-1))],contentRange:{start,end},nextOffset:complete?null:end-scope.start,scopeComplete:offset===0&&complete,documentComplete:start===0&&end===text.length,...(size>maxReadChars?{hint:'本章节仍过长或没有可展开标题，按nextOffset继续，保留相同id、section和revision。'}:{})};
}
