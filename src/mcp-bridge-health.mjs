import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {z} from 'zod';
import {readBridgeHealth} from '../plugins/qq-components/obs-bridge-health/health.mjs';
const server=new McpServer({name:'bridge-health',version:'0.1.0'});
server.registerTool('bridge_health',{description:'只读检查当前桥接整条链路：控制台、DSH、QQ连接/账号与上游心跳。自动从本地配置取端口和鉴权，不泄露凭据。ready就停止修连接；auth_required不是掉线，旧日志/无新消息不是掉线证据。不会启动、重启或修改任何配置。',inputSchema:z.object({}).strict(),annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false}},async()=>({content:[{type:'text',text:JSON.stringify(await readBridgeHealth())}]}));
await server.connect(new StdioServerTransport());
