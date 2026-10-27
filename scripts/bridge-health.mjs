import {readBridgeHealth} from '../plugins/qq-components/obs-bridge-health/health.mjs';
const health=await readBridgeHealth();
console.log(process.argv.includes('--json')?JSON.stringify(health,null,2):'['+health.verdict+'] '+health.reason+'\n下一步：'+health.nextAction+'；未经机主同意不重启。');
// Unknown/auth problems are diagnostic failures, never evidence that upstream is down.
process.exitCode=health.healthy?0:health.verdict==='auth_required'||health.verdict==='unknown'?2:1;
