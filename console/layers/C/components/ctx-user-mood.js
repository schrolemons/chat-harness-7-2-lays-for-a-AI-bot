export default {saveLabel:"保存心情与双形态",title:'心情与双形态',fields:[
 {key:'enabled',label:'启用心情系统',type:'boolean',group:'结算规则'},
 {key:'initial',label:'新会话初始心情（0–100）',type:'number'},
 {key:'noReplyAfterMinutes',label:'主动后等待回应（分钟）',type:'number'},
 {key:'modeThreshold',label:'普通与临界形态阈值（0–100）',type:'number',group:'双形态',help:'达到阈值采用普通形态；低于阈值采用临界形态。'},
 {key:'normalName',label:'普通形态名称',type:'text',maxLength:40},
 {key:'normalStyle',label:'普通形态风格',type:'textarea',maxLength:500},
 {key:'criticalName',label:'临界形态名称',type:'text',maxLength:40},
 {key:'criticalStyle',label:'临界形态风格',type:'textarea',maxLength:500},
 {key:'positiveRules',label:'升分行为规则',type:'moodRules',direction:1,group:'AI判断与加减分'},
 {key:'negativeRules',label:'降分行为规则',type:'moodRules',direction:-1},
 {key:'maxAdjustment',label:'AI单次加减分上限',type:'number'},
 {key:'burstEnabled',label:'启用被叫回后的热情回应',type:'boolean',group:'重新开始聊天时'},
 {key:'recoverMinutes',label:'欢迎冷却（分钟）',type:'number',help:'0 = 无冷却；不自动恢复心情分。'}
]};
