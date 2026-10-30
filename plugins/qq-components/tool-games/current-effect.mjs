// Narrative effect only. No device, current/voltage unit or external action is produced.
export function validateCurrentParameters(input={}, {defaults,schema}) {
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.getPrototypeOf(input)!==Object.prototype)throw Error('轻微电流参数必须是对象。');
  if(Object.keys(input).some(key=>!Object.hasOwn(schema,key)))throw Error('轻微电流参数含未知字段。');
  const result={...defaults,...input};
  for(const [key,definition]of Object.entries(schema)){
    const value=result[key];
    if(definition.enum){if(!definition.enum.includes(value))throw Error(`${definition.title}不在可选范围内。`);}
    else if(!Number.isInteger(value)||value<definition.minimum||value>definition.maximum)throw Error(`${definition.title}须为${definition.minimum}至${definition.maximum}的整数。`);
  }
  return result;
}
const SHAPES={steady:[1,1,1,1,1],pulse:[0.25,1,0.25,1,0.25],rampUp:[0.2,0.4,0.6,0.8,1],rampDown:[1,0.8,0.6,0.4,0.2],wave:[0.2,0.7,1,0.7,0.2]};
const DESCRIPTIONS={steady:'强度保持均匀',pulse:'按脉冲一下一下跳动',rampUp:'强度逐步攀升',rampDown:'强度逐步回落',wave:'强度往复起伏'};
export function renderCurrentEffect(input,game){
  const parameters=validateCurrentParameters(input,{defaults:game.parameters,schema:game.parameterSchema});
  const {bodyPart,durationSec,intensityLevel,waveform}=parameters;
  const samples=SHAPES[waveform].map((level,index)=>({atSec:durationSec*index/4,level:Math.round(level*intensityLevel*100)/100}));
  const texture=['细碎的节拍轻轻跳过','一阵酥麻倏地掠过','酥麻的节奏连着跳了几下'][intensityLevel-1];
  return {fictionalEffect:{...parameters,samples},message:`一道电流沿着${bodyPart}游过，${DESCRIPTIONS[waveform]}；${texture}，约${durationSec}秒后收住。`};
}
