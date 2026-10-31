// Mechanical provenance of component-declared placement. Never classify user text by wording.
export function renderedPromptParts(blocks,placements,rendered){
 const parts=[];let cursor=0;
 for(const[index,block]of blocks.entries()){
  const text=rendered.slice(cursor,Math.min(cursor+block.length,rendered.length));if(text)parts.push({placement:placements[index]==='stable'?'stable':'current',text});cursor+=block.length+2;if(cursor>=rendered.length)break;
 }
 return parts.map(row=>row.text).join('\n\n')===rendered?parts:[{placement:'current',text:rendered}];
}
