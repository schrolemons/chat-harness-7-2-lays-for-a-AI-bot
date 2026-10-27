export const ACTIVE_TASK_STATUSES = new Set(['running', 'waiting_input']);
const TERMINAL = new Set(['done', 'failed', 'cancelled']);

export function buildTaskPrompt({title, task} = {}) {
  return '独立任务输入（仅用于当前工作会话）：\n' + JSON.stringify({
    title: String(title || '未命名任务').slice(0, 80), task: String(task || '').trim(),
  }) + '\n按任务执行协议完成工作；缺少必要输入时返回所需信息清单。';
}

export function taskTransition({record, ended, now = Date.now()} = {}) {
  if (!record || TERMINAL.has(record.status)) return null;
  const inputs = (record.inputs || []).map(x => x.consumedTurn === ended?.turn ? {...x,settled:true} : x);
  const outstanding = inputs.some(x => x.kind !== 'control' && !x.settled);
  const pendingRequests = (record.pendingRequests || []).filter(x=>x.turn !== ended?.turn);
  const kind = ended?.reason?.kind;
  if (kind === 'error' || kind === 'aborted') {
    const outcome={status:'failed',error:String(ended.reason?.error?.message || (kind === 'aborted' ? '任务回合被中止' : '任务执行失败')).slice(0,1000),pendingInput:'',turn:ended.turn};
    return {...outcome,status:outstanding?'running':'failed',updatedAt:now,inputs,pendingRequests,lastEndSeq:ended.seq??record.lastEndSeq,deferredOutcome:outstanding?outcome:null};
  }
  if (kind !== 'completed') return null;
  const text = String(ended.text || '').trim();
  const match = /(?:^|\n)\[(任务完成|任务需补充|任务失败)\]\s*$/.exec(text);
  const result = (match ? text.slice(0, match.index) : text).trim().slice(0, 12000);
  const desired = match?.[1] === '任务完成' ? 'done' : match?.[1] === '任务失败' || !result ? 'failed' : 'waiting_input';
  const outcome={status:desired,result,error:desired==='failed'?result||'任务未返回结果':'',pendingInput:desired==='waiting_input'?result.slice(0,3000):'',turn:ended.turn};
  return {...outcome,status:outstanding?'running':desired,pendingInput:outstanding?'':outcome.pendingInput,updatedAt:now,inputs,pendingRequests,lastEndSeq:ended.seq??record.lastEndSeq,deferredOutcome:outstanding?outcome:null};
}

export function settleDeferred({record,now=Date.now()}={}) {
  if(!record?.deferredOutcome || TERMINAL.has(record.status) || (record.inputs||[]).some(x=>x.kind!=='control'&&!x.settled))return null;
  if(record.activeTurn>record.deferredOutcome.turn)return null;
  return {...record.deferredOutcome,updatedAt:now,deferredOutcome:null};
}

export function taskEvent({record, event} = {}) {
  if (!record || TERMINAL.has(record.status)) return null;
  if (event?.type === 'turn/start') return {activeTurn:event.data?.turn,status:'running',pendingInput:'',deferredOutcome:null};
  if (event?.type !== 'user/message') return null;
  const id = event.data?.source?.rpcId;
  if (!id || !(record.inputs || []).some(x=>x.wireId===id)) return null;
  return {inputs:record.inputs.map(x=>x.wireId===id ? {...x,consumedTurn:record.activeTurn} : x)};
}

export function recoverTask({record,records,now=Date.now(),pendingInbox=false}={}) {
  if(!record || TERMINAL.has(record.status) || !Array.isArray(records))return null;
  const events=records.map(x=>x?.type==='event'?x.event:x).filter(x=>x&&typeof x.seq==='number').sort((a,b)=>a.seq-b.seq);
  const texts=new Map(),closed=new Set();let lastEnd,lastStart=-1,working={...record,inputs:(record.inputs||[]).map(x=>({...x}))};
  for(const event of events){
    const patch=event.type==='user/message' && lastStart<0 ? null : taskEvent({record:working,event});if(patch)Object.assign(working,patch);
    const turn=event.data?.turn;
    if(event.type==='turn/start'){texts.set(turn,'');lastStart=event.seq;}
    if(event.type==='assistant/message'&&texts.has(turn))texts.set(turn,texts.get(turn)+(event.data.message?.content||[]).filter(x=>x.type==='text').map(x=>x.text).join(''));
    if(event.type==='turn/end'){closed.add(turn);lastEnd=event;}
  }
  working.inputs=working.inputs.map(x=>closed.has(x.consumedTurn)?{...x,settled:true}:x);
  const metadata=()=>{
    if(lastStart<0 || record.activeTurn>working.activeTurn)return null;
    const patch={activeTurn:working.activeTurn,inputs:working.inputs};
    return patch.activeTurn!==record.activeTurn || JSON.stringify(patch.inputs)!==JSON.stringify(record.inputs||[]) ? {...patch,recoveredFromHistory:true,metadataOnly:true} : null;
  };
  if(!lastEnd || lastStart>lastEnd.seq || !texts.has(lastEnd.data?.turn))return metadata();
  if(record.activeTurn>lastEnd.data?.turn)return null;
  if(lastEnd.seq<=(record.lastEndSeq??-1) && JSON.stringify(working.inputs)===JSON.stringify(record.inputs||[]))return null;
  const patch=taskTransition({record:working,ended:{turn:lastEnd.data.turn,seq:lastEnd.seq,reason:lastEnd.data.reason,text:texts.get(lastEnd.data.turn)},now});
  if(patch && pendingInbox && TERMINAL.has(patch.status)){patch.deferredOutcome={status:patch.status,result:patch.result,error:patch.error,pendingInput:patch.pendingInput,turn:lastEnd.data.turn};patch.status='running';}
  return patch?{...patch,activeTurn:working.activeTurn,recoveredFromHistory:true}:metadata();
}

export function taskRequest({record, frame, now = Date.now()} = {}) {
  if (!record || TERMINAL.has(record.status)) return null;
  const request = {id:frame.eventId,clientId:frame.clientId,kind:frame.type === 'approval/requested' ? 'approval' : 'question',
    toolName:String(frame.toolName || ''),reason:String(frame.reason || '').slice(0,1500),questions:frame.questions || [],turn:record.activeTurn};
  const pendingRequests = [...(record.pendingRequests || []).filter(x=>x.id!==request.id),request];
  return {pendingRequests,status:'waiting_input',pendingInput:request.kind==='approval' ? '任务需要对 '+request.toolName+' 作权限决定：'+request.reason : request.questions.map(x=>x.question).join('\n').slice(0,3000),updatedAt:now};
}
