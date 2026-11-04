export default {saveLabel:"保存内容拆分与发送节奏",title:'唯一发送计划',fields:[
{key:'maxMessagesNormal',label:'普通聊天每份内容最多拆分（条）',type:'number',group:'完整内容拆分',help:'一份内容按完整语义判断，可合并多条碎片来信；不按QQ消息数、等待批次或模型请求数计份。只是上限，不要求发满。'},
{key:'maxMessagesCasual',label:'轻松闲聊每份内容最多拆分（条）',type:'number',help:'各份独立含义分别累计；同一份内容跨请求、换发送工具或重读都不刷新额度。'},
{key:'maxMessagesSerious',label:'严肃话题每份内容最多拆分（条）',type:'number',help:'心情和聊天意愿不缩减每份内容的拆分上限。'},
{key:'longIncomingChars',label:'长来信判定（字符）',type:'number'},
{key:'intervalMinMs',label:'普通间隔下限（毫秒）',type:'number',group:'逐条间隔'},
{key:'intervalMaxMs',label:'普通间隔上限（毫秒）',type:'number'},
{key:'longGapProbability',label:'长间隔概率（0–1）',type:'number'},
{key:'longGapMinMs',label:'长间隔下限（毫秒）',type:'number'},
{key:'longGapMaxMs',label:'长间隔上限（毫秒）',type:'number'},
{key:'maxSendPerMinute',label:'每分钟基础额度（点）',type:'number',group:'动态发送与任务接手额度',help:'有效额度 = 向上取整（基础额度 × 心情与聊天意愿系数F）。基础值大于0时最低1点，0表示此窗口不限。每份普通聊天语义组共1点，同一任务的接手及完成汇报共1点。'},
{key:'maxSendPerHour',label:'每小时基础额度（点）',type:'number',help:'与分钟窗口分别计算；文字和媒体共用计数。任务无点时保留已读未处理，额度恢复后复查条件自动接手；同组不重复扣点，组内不限拆分条数。开始仍检查费用与弱限频，已准入原任务可跨费用阈值继续并及时汇报，实际花费仍记账。权限、免打扰、防重与真实回执仍有效。'},
{key:'maxMessageChars',label:'单条最大长度（字符）',type:'number'}
]};
