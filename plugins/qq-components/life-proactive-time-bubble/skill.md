# skill：时间冒泡（time-bubble）

## 它解决什么
桥接按分会话时段安排一次「主动开口」。小鲸鱼可在本人私聊明确分享或修改作息/饮食时间后，通过 `time_bubble_manage` 查看并调整该 session 的计划。

## 什么时候被调用
`beforePrompt` 且 `reason === "timeBubble"`：桥接已经把 `pendingTimeBubble = { label, hint }` 准备好。

## 产出
一段【本轮时间冒泡｜午饭点】要求：直接发一句自然的时间梗，不接旧话题、不用接话句式、1 条就够。
每天最多 `config.maxBubblesPerDay` 条（默认 3 条，状态存在 `state/plugins/time-bubble.json`）。主动消息仍受免打扰、会话可用性、刚互动跳过及定时槽位限制。

## 锁定
L 层定时主动消息编辑器允许锁单个时段或整栏。组件工具只可写入未锁时段；锁定内容保持原样并返回冲突信息。控制台也需先解锁，才能编辑或删除锁定内容。

## 边界
- 不自己发消息，也不改唤醒计划（那是桥接的调度）。
- 没有 `pendingTimeBubble`（或当天额度用完）就什么都不产出，这一轮自然收尾。
