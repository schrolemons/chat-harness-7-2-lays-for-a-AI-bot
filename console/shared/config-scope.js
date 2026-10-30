// One page owns each persisted global configuration group.
const PAGE_KEYS={
 'setting-c-0':['sticker'],'setting-c-1':['persistentMemory','context'],
 'v2-t':['tools'],'environment-admin':['adminDev'],
 'setting-l-0':['wake','doubleStamp'],'setting-l-1':['wait','autoReplyCheckMs'],'setting-l-2':['dailyNews'],
 'setting-o-1':['dailyDiary','feedback'],'setting-o-2':['selfReview']
};
export function selectPageConfig(config,page){if(!PAGE_KEYS[page])throw Error('该页面没有全局参数保存入口：'+page);return Object.fromEntries(PAGE_KEYS[page].filter(key=>Object.hasOwn(config,key)).map(key=>[key,config[key]]));}
