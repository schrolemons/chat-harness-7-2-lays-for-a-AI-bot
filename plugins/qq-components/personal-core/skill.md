# personal-core：S 层私人资料目录

唯一组件ID为 personal-core，唯一MCP服务名为 personal-core。资料来源由config.libraryDir指定，不在代码里绑定任何作者或文档。

## 文件责任
- library.mjs：标准包与真实路径/出处/完整性校验；不联网、不调用模型。
- runtime.mjs：目录批次、按ID读卡、状态及阅读引导；读取前复验，不在数据失效后继续使用旧正文。
- reading.mjs：只在已校验的正文上生成章节索引、完整短卡与兜底分页，不接收文件路径或改写原文。
- routing.mjs：按包声明的指令/讨论/关怀/退出规则判断当前轮；不记录心理状态。
- turn-policy.mjs：C层只调用当前启用的personal-core.route服务，不读取作者目录。
- config.mjs：本机挂载与会话适用配置。
- mcp.mjs：只暴露3个只读工具；每次调用读取最新本机配置。
- install.mjs：为可信DSH profile安装唯一MCP条目；支持dry-run、备份与幂等。

## 模型工具与服务
- core_status({})：包名、简短用途、作者、版本、主题/原稿数。无本机路径或会话名单。
- core_topics({group?,query?,offset?,limit?})：分批返回标题、简短摘要、ID和使用边界。query只做词面筛选；相关性由模型判断，不是向量检索。不提前返回导读正文。
- core_read({id,section?,sectionOffset?,offset?,limit?,revision?})：短卡默认完整返回；长卡先返回章节目录，按section ID或唯一标题读取。正文保留出处、证据性质及原稿行号，不把解读冒充作者原句。
- services.personal-core：同一个runtime的route/status/topics/read/prompt/inspect；无需第二套数据实现。

## 阅读顺序与预算
先分批浏览topic目录，再读选中的小卡或按Markdown标题展开的大卡。完整正文不超过maxReadChars时一次返回，不再有隐藏的3500字符限制；选中章节仍过长或没有可展开标题时，用nextOffset继续。显式offset/limit仍可用于正文分页，偏移相对于当前选中章节。

章节目录使用sectionOffset与nextSectionOffset翻页；这与正文字符偏移是两套单位，混用会报错。重名标题必须用章节ID；返回的content_lines是卡片内行号，source_lines仍是原稿行号。章节ID只在对应revision下解释，读取时可带revision；资料更新后旧版本选择会被拒绝。

GUIDE.md（或manifest.guide声明的文件）只在理解困难、特殊术语或引用边界容易误解时通过@guide读取，不是每次阅读的前置步骤。短导读整篇返回，长导读同样按章节展开；没有导读时不编造。资料与导读都不提升为系统指令。

读取一次不代表永久记忆：正文离开当前上下文、被压缩或文件更新后可能需要重读。服务端文件缓存只优化读盘，不证明模型仍可见旧正文。

沿用已经整理好的问题卡与标题结构，不因支持长卡而重新切分原文。每次core_read读取卡片时附context：position提供文章、标题路径、原文行号、同文卡序及本卡适用情境；before/after提供同一原稿中前后相邻卡的既有目录摘要。顺序来自原文行号，不依赖catalog数组顺序，不跨文档拼接；原文范围重叠时标明重叠数，不将它假定为上下文。概述不是重新生成的作者原句，也不代表相邻正文已经读入。

## 控制台
目录支持项目相对路径与本机绝对路径；清空并保存表示卸载。启用时保存前校验，失败不替换原配置，不回退默认包。referenceSessionKeys只控制目录入口提示的范围，不自动加载GUIDE全文，也不充当MCP资料权限；careSessionKeys只控制资料包关怀语境，不授予其他权限。catalogPageSize控制主题/章节每批默认条数，maxReadChars控制短卡整读阈值及兜底单页正文上限，不是整份工具JSON的token上限。

## 默认数据与开发者
目录示例以 D:\qq-bridge 为项目目录、private-libraries/my-core为资料包；替换为实际路径即可，不要求现有资料包迁移或改名。作者与使用语境由包内manifest声明，不写死在读取器中。

独立整理规范：D:\qq-bridge\docs\personal-core\README.md；完整路径校验示例：node "D:\qq-bridge\scripts\personal-core.mjs" validate "D:\qq-bridge\private-libraries\my-core"。开发用虚构测试包 examples/personal-core/minimal 与用户资料包独立，不作为默认挂载；实际使用时替换项目目录与包名。

不改人设卡，不发送QQ，不重建会话，不联网解析私人文件。首次接口切换由一次性迁移完成，运行中不保留旧命名工具或别名。
