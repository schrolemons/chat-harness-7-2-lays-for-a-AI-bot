import assert from 'node:assert/strict';
import fs from 'node:fs';
import yaml from 'js-yaml';
import {createPlugin} from '../plugins/qq-components/life-task-session/index.js';

const source = yaml.load(fs.readFileSync('dsh/agent-presets/qq-task-worker/agent.cordis.yml', 'utf8'));
const prefix = source.find((row) => row.id === 'persona')?.config?.prefix || '';
assert.match(prefix, /independent task executor/);
assert.doesNotMatch(prefix, /AI助手|温柔|科技动态|用户|友好交流/);
assert.match(prefix, /准确|严谨/);
assert.doesNotMatch(prefix, /助手娘|AI助手的工作分身|「AI助手」/);

const patch = yaml.load(fs.readFileSync('plugins/qq-agent-presets/presets/qq-task-worker.patch.yml', 'utf8'));
const loaded = patch[0].insert[0].config.plugins.find((row) => row.id === 'persona')?.config?.prefix || '';
assert.equal(loaded, prefix);
const taskPlugin = fs.readFileSync('plugins/qq-components/life-task-session/index.js', 'utf8');
const blocks=[],plugin=createPlugin({registerTool(){},state:{get:()=>({})},addPromptBlock:value=>blocks.push(value)});
const coordinator=plugin.hooks.beforePrompt({isAdminEnvironment:true});
assert.match(coordinator,/可以直接使用 DSH 工具执行已授权操作/);
assert.match(coordinator,/需要独立后台处理或并行工作时，用 qq_task_spawn/);
assert.doesNotMatch(coordinator,/必须调用 qq_task_spawn/);
assert.equal(plugin.hooks.beforePrompt({isAdminEnvironment:false}),'');
assert.match(taskPlugin, /问进度先 qq_task_list/);
assert.doesNotMatch(taskPlugin, /别在聊天会话里吭哧吭哧|问你好没好就说「没呢，我催一下」/);
console.log('独立任务执行协议与实际预设一致，聊天人格不进入 worker');
