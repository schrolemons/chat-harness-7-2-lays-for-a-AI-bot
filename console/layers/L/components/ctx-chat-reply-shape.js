export default {saveLabel:"保存发送数量与间隔",title:'唯一发送计划',fields:[
{key:'maxMessagesNormal',label:'普通聊天每轮上限（条）',type:'number',group:'单轮数量',help:'只表示上限，不要求发满。'},
{key:'maxMessagesCasual',label:'轻松闲聊每轮上限（条）',type:'number'},
{key:'maxMessagesSerious',label:'严肃话题每轮上限（条）',type:'number'},
{key:'longIncomingChars',label:'长来信判定（字符）',type:'number'},
{key:'intervalMinMs',label:'普通间隔下限（毫秒）',type:'number',group:'逐条间隔'},
{key:'intervalMaxMs',label:'普通间隔上限（毫秒）',type:'number'},
{key:'longGapProbability',label:'长间隔概率（0–1）',type:'number'},
{key:'longGapMinMs',label:'长间隔下限（毫秒）',type:'number'},
{key:'longGapMaxMs',label:'长间隔上限（毫秒）',type:'number'},
{key:'maxSendPerMinute',label:'每分钟上限（条）',type:'number',group:'统一出站上限',help:'0 = 此时间窗口不限制。'},
{key:'maxSendPerHour',label:'每小时上限（条）',type:'number',help:'0 = 此时间窗口不限制。'},
{key:'maxMessageChars',label:'单条最大长度（字符）',type:'number'}
]};
