// The stdio reader owns exactly three model-visible tools. Mounting stays in the administrator console.
import {fileURLToPath} from 'node:url';import path from 'node:path';import {Server} from '@modelcontextprotocol/sdk/server/index.js';import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';import {ListToolsRequestSchema,CallToolRequestSchema} from '@modelcontextprotocol/sdk/types.js';
import {createPlugin} from './index.js';import {loadLocalConfig,projectRoot} from './config.mjs';
const dir=fileURLToPath(new URL('./',import.meta.url)),args=process.argv.slice(2),i=args.indexOf('--root');if(i>=0&&!args[i+1])throw Error('--root requires a project directory');const root=i>=0?path.resolve(args[i+1]):projectRoot(dir);
function tools(){const data=loadLocalConfig(dir,root),specs=new Map();createPlugin({dir,root,config:data.config,registerTool:(name,spec)=>specs.set(name,spec),addPromptBlock:()=>{}});return{...data,specs};}
const server=new Server({name:'personal-core',version:'1.0.0'},{capabilities:{tools:{}}});
server.setRequestHandler(ListToolsRequestSchema,async()=>{const {disabled,specs}=tools();return{tools:disabled?[]:[...specs].map(([name,s])=>({name,description:s.description,inputSchema:s.schema}))};});
server.setRequestHandler(CallToolRequestSchema,async req=>{const {disabled,specs}=tools(),spec=specs.get(req.params.name);if(disabled)return{isError:true,content:[{type:'text',text:'私人资料组件已停用'}]};if(!spec)throw Error('Unknown personal-core tool');const result=spec.handler(req.params.arguments||{});return{isError:result.ok===false,content:[{type:'text',text:JSON.stringify(result)}]};});
await server.connect(new StdioServerTransport());
