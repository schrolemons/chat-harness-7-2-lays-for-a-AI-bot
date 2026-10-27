export function checkImageSession({key,mode,token,sameSessionToken,modeAllowed,paused,silent,enabled}){
 const match=/^(private|group):([1-9]\d*)$/.exec(String(key||''));
 if(!match)return {ok:false,error:'INVALID_SESSION'};
 if(mode!=='reserved2'&&mode!=='closed-agent')return {ok:false,error:'MODE_NOT_ALLOWED'};
 if(mode==='reserved2'&&(!token||!sameSessionToken(key,token)))return {ok:false,error:'TOKEN_INVALID'};
 if(mode==='closed-agent'&&token)return {ok:false,error:'TOKEN_NOT_EXPECTED'};
 if(!modeAllowed(key,match[1],Number(match[2])))return {ok:false,error:'SESSION_NOT_ALLOWED'};
 if(paused||silent||!enabled)return {ok:false,error:'TOOL_UNAVAILABLE'};
 return {ok:true,kind:match[1],id:Number(match[2])};
}
export function oneBotImageParams(key,image){
 const match=/^(private|group):([1-9]\d*)$/.exec(String(key||''));
 if(!match||!image||!['image/png','image/jpeg','image/gif','image/webp'].includes(image.mimeType)||typeof image.data!=='string'||!/^[A-Za-z0-9+/]+={0,2}$/.test(image.data)||image.data.length>40000000)throw Error('INVALID_MANAGED_IMAGE');
 const segment={type:'image',data:{file:'base64://'+image.data}};
 return match[1]==='private'?{action:'send_private_msg',params:{user_id:Number(match[2]),message:[segment]}}:{action:'send_group_msg',params:{group_id:Number(match[2]),message:[segment]}};
}

export function validateImageImportSource({key,ownerQQ,filePath,url}={}){
 const local=String(filePath||'').trim(),remote=String(url||'').trim();
 if(!!local===!!remote)return{ok:false,error:'IMAGE_SOURCE_REQUIRED'};
 if(local)return String(key||'')===`private:${String(ownerQQ||'')}`?{ok:true,kind:'local-file'}:{ok:false,error:'LOCAL_IMAGE_ADMIN_PRIVATE_ONLY'};
 let parsed;try{parsed=new URL(remote)}catch{return{ok:false,error:'IMAGE_URL_INVALID'}}
 if(parsed.protocol!=='https:'||parsed.username||parsed.password)return{ok:false,error:'IMAGE_URL_MUST_BE_HTTPS'};
 return{ok:true,kind:'https-url',url:parsed.href};
}
