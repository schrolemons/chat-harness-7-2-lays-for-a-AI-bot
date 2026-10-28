# skill：失败转回归用例（eval-regression）

## 它解决什么
故障发生了、修了，但没有证据说明「真的修好、也没引入新问题」。
这个插件先把**用例**沉淀下来：一次真实失败 = 一条可重复的检查项。

## 工具
- `eval_record_case({ title, input, expected, actual, note })`：记一条（title 去重，最多 50 条）。
- `eval_list_cases()`：列出来。
- `eval_clear_cases()`：清空（谨慎）。

状态文件：`state/plugins/eval-regression.json`。

## 使用姿势
1. 发现漏回复 / 重复 / 语气不对 / 工具误用，先把「输入、期望、实际」记下来。
2. 修完之后用同一输入复跑一次，把结果补进 note。
3. 下一迭代：把这些用例导出成离线测试输入，接进 `npm run test:audit`。

## 边界
只记用例，不做评分、不自动改代码；评估的「基准/评分器/归因」属于后续同层迭代。
