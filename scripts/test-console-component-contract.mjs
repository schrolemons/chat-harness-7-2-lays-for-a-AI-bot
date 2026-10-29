import assert from 'node:assert/strict';
import test from 'node:test';
test('configuration saves distinguish bot-wide rules from machine settings and scoped data',async()=>{
 const {componentScope}=await import('../console/shared/components/scope.js');
 assert.equal(componentScope('ctx-user-mood','保存心情与双形态').saveLabel,'保存全局心情与双形态');
 assert.match(componentScope('ctx-user-mood').description,/按会话分别/);
 assert.equal(componentScope('life-schedule-reminder','保存全局日程规则').saveLabel,'保存全局日程规则');
 assert.equal(componentScope('exec-image-generation','保存生图服务与额度').saveLabel,'保存本机生图服务与额度');
 assert.match(componentScope('ctx-memory-profile-store').description,/按 QQ 号单独保存/);
});
test('current manifest fields replace retired forms and expose newly added settings', async () => {
  const { resolveComponentFields } = await import('../console/shared/components/field-contract.js');
  const plugin = { id:'fixture', configKeys:['enabled','newLimit','rules','apiKey'], config:{enabled:true,newLimit:4,rules:{scope:'current'},apiKey:'must-stay-hidden'} };
  const fields = resolveComponentFields(plugin, {fields:[{key:'retired',label:'old'}, {key:'enabled',label:'启用',type:'boolean'}]});
  assert.deepEqual(fields.map(x=>x.key), ['enabled','newLimit','rules']);
  assert.equal(fields.find(x=>x.key==='newLimit').type,'number');
  assert.equal(fields.find(x=>x.key==='rules').type,'json');
  assert.equal(fields[0].label,'启用');
  assert.deepEqual(resolveComponentFields(plugin,null,['newLimit']).map(x=>x.key),['newLimit']);
});

test('field order follows the owning form while internal and readonly migration keys stay hidden',async()=>{
 const {resolveComponentFields}=await import('../console/shared/components/field-contract.js');
 const fields=resolveComponentFields({configKeys:['later','first','bbCourses','disabledReasons','readonly'],config:{later:1,first:2,bbCourses:[],disabledReasons:[]},configSchema:{readonly:{readOnly:true}}},{fields:[{key:'first',label:'先显示'},{key:'later',label:'后显示'}]});
 assert.deepEqual(fields.map(x=>x.key),['first','later']);
});
test('every actual tool flag has one human-readable description and behavior example',async()=>{
 const {TOOL_CONFIG_FLAGS}=await import('../src/tools/flags.js');const {TOOL_PRESENTATION}=await import('../console/layers/T/tool-presentation.js');
 for(const flag of new Set(Object.values(TOOL_CONFIG_FLAGS))){assert(TOOL_PRESENTATION[flag]?.label,flag);assert(TOOL_PRESENTATION[flag]?.example.startsWith('例：'),flag);}
});
