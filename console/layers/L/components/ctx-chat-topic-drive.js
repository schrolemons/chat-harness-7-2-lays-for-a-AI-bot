export default {saveLabel:'保存话题发起与跟进', title:'话题发起与跟进', fields:[
  {key:'privateFollowupEnabled',label:'允许群聊转私聊跟进',help:'根据群内话题私聊追问，只联系已有私聊关系的人。',type:'boolean',group:'群聊转私聊'},
  {key:'minIntervalMinutes',label:'全局私聊跟进最小间隔（分钟）',help:'同一人两次跨私聊跟进的冷却；与会话限制取较大值。',type:'number',min:0,max:10080},
  {key:'dailyLimit',label:'全局每日私聊跟进上限',help:'同一人每天的跨私聊跟进次数；与会话限制取较小值。',type:'number',min:0,max:30},
  {key:'followUpCooldownMinutes',label:'同一话题跟进冷却（分钟）',help:'私聊、群聊共用规则；“还在吗”等催回复也算追问。',type:'number',min:0,group:'当前会话的话题（私聊、群聊）'},
  {key:'newTopicCooldownMinutes',label:'新话题冷却（分钟）',help:'两次主动换题至少间隔多久，正常聊天也受限。',type:'number',min:0},
  {key:'newTopicMaxPerHour',label:'每小时最多新话题数',help:'按实际成功发送的话题波次计数，0 表示不主动起新话题。',type:'number',min:0,max:60},
  {key:'followupWeight',label:'旧话题追问权重 a',help:'全局内容选择。例：a=0.5、b=0.2，主动开聊约71%延续今天或上一段话题；等待超时且本轮继续时，50%追问。',type:'number',min:0,max:1,step:.01,group:'主动开聊与等待后的话题选择'},
  {key:'newTopicWeight',label:'新话题权重 b',help:'例：a=0.5、b=0.2，主动开聊约29%换题，不抽终止；等待继续时20%换题、30%继续等。a+b≤1，冷却和上限仍有效；旧话题收束可改换题，最新问题须先答。',type:'number',min:0,max:1,step:.01}
]};
