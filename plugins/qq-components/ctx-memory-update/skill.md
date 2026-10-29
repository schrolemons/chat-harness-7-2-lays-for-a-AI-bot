# 记忆更新

memoryWrite 先按照 ctx-memory-profile-facts/extraction-policy.mjs 逐栏检查并补充权限内的人物档案，再输出完整 <MEMORY> 标签块：事实只提交新增/有源更正，画像与日记提交完整最新内容。通过 profile_get 读取、profile_update 合并，确认成功后才记已更新；失败候选留本会话记忆，不发送 QQ。

固定栏目：重要事实 / 用户画像 / 日记。未完成事项由 qq_task_note 的独立当前事务存储统一管理；先 list，再按 id/expectedRevision upsert，不保留第二份清单。画像为当日候选；信息可核对且有长期价值才提炼到权威档案。随口小事先记事务，明确提醒需求才关联日程；保留历史日期，日记窗口仍为前日22:00至命名日22:00。不改代码、配置或会话，不替日程工具声称已登记。maxChars 是本次模型整理的输出目标，自动 capture 合并保留旧事实，不作为文件截断容量。
