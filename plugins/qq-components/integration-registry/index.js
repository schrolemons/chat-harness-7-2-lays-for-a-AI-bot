// 集成注册中心（横切层，非第九层）
//
// 定位：八层之上的「注册中心」。第三方插件/项目（自助逛哔站、自助刷网课等）只要：
//   1. 放到 plugins/qq-components-user/<id>/（user 目录，宿主自动扫描，标记 builtin=false）；
//   2. plugin.json 里声明 `layer`（C/T/E/L/O/V/G/S 之一）+ `config`（参数与默认值）；
// 就会被八层模型统一管理：参数、配置、开关都能在管理页/接口里改。
//
// 本插件只做「视图与说明」，真正的启停/排序/配置走宿主既有接口（/api/plugins/toggle 等）。

export function createPlugin(ctx) {
  ctx.registerTool('integration_howto', {
    description: '第三方插件如何注册进八层模型（步骤 + 目录 + 清单字段）',
    handler: () => ({
      ok: true,
      steps: [
        '1. 在 plugins/qq-components-user/<id>/ 放 plugin.json + index.js + skill.md',
        '2. plugin.json 声明 layer（C/T/E/L/O/V/G/S 之一）与 config（参数和默认值）',
        '3. 重启或热重载后，它就会出现在管理页对应层下，builtin=false',
        '4. 参数/开关统一走 /api/plugins（list/detail/toggle/order）管理'
      ],
      layer: '八层之上的注册中心（不属于第九层）'
    })
  });
  return { hooks: {} };
}
