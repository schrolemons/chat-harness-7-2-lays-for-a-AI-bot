export default {
 title:'群聊会话自动恢复',saveLabel:'保存会话自动恢复设置',
 fields:[
  {key:'consecutiveFailures',label:'连续失败回合数',type:'number',min:3,max:10,group:'高级判定参数',collapsed:true,help:'按独立模型回合计数；同一次请求的内部重试不重复计数。'},
  {key:'minFailureSeconds',label:'最短失败跨度（秒）',type:'number',min:120,max:1800,help:'第一次与最后一次失败之间的最短时长；单纯长时间没人回复不触发。'},
  {key:'cooldownMinutes',label:'同群恢复冷却（分钟）',type:'number',min:30,max:1440,help:'一次恢复后，该群再次自动恢复至少需要等待的时间。'},
  {key:'maxRecoveriesPerDay',label:'同群24小时恢复上限',type:'number',min:1,max:2,help:'按滚动24小时计算，最多2次；恢复后的新会话仍请求失败时，会提前停手告警。'}
 ]
};
