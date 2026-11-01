# personal-core：S 层私人资料目录

唯一组件ID为 personal-core，唯一MCP服务名为 personal-core。资料来源由config.libraryDir指定，不在代码里绑定任何作者或文档。

## 文件责任
- library.mjs：标准包与真实路径/出处/完整性校验；不联网、不调用模型。
- runtime.mjs：当前包的目录分页、按ID读卡、状态、短导读；读取前复验，不在数据失效后继续使用旧正文。
- routing.mjs：按包声明的指令/讨论/关怀/退出规则判断当前轮；不记录心理状态。
- turn-policy.mjs：C层只调用当前启用的personal-core.route服务，不读取作者目录。
- config.mjs：本机挂载与会话适用配置。
- mcp.mjs：只暴露3个只读工具；每次调用读取最新本机配置。
- install.mjs：为可信DSH profile安装唯一MCP条目；支持dry-run、备份与幂等。

## 模型工具与服务
- core_status({})：已挂载包名、作者、版本、主题/原稿数。无本机路径或会话名单。
- core_topics({group?,query?,offset?,limit?})：透明词面目录筛选；语义取舍由模型判断，不冒充向量检索。返回引用边界及可选@guide。
- core_read({id,offset?,limit?})：读取准备好的卡片与出处。卡片中的引文、解读和未核实内容应分别标注，不能把整张卡冒充作者原句。
- services.personal-core：同一个runtime的route/status/topics/read/prompt/inspect；无需第二套数据实现。

## 控制台
目录支持项目相对路径与本机绝对路径；清空并保存表示卸载。启用组件时保存前校验，失败不替换原配置。文件变化后重新校验；错误明确展示，不回退默认包。referenceSessionKeys只控制自动导读范围，不充当MCP资料权限；careSessionKeys只控制资料包关怀语境，不授予其他权限。读取预算、默认目录分页均直接作用于实际工具。

## 默认数据与开发者
目录说明统一使用 private-libraries 存放资料包，以 D:\qq-bridge 为项目目录时，通用示例资料包根目录为 D:\qq-bridge\private-libraries\my-core。my-core 是示例包名；机主实际的 REFERENCE_DATA 包使用 private-libraries/reference-data，相对项目目录解析，不因示例变化而移动或改名。本目录不包含作者数据；专属触发规则留在私人包 manifest 中。

独立整理规范：D:\qq-bridge\docs\personal-core\README.md；完整路径校验示例：node "D:\qq-bridge\scripts\personal-core.mjs" validate "D:\qq-bridge\private-libraries\my-core"。开发用虚构测试包 examples/personal-core/minimal 与用户资料包独立，不作为默认挂载；实际使用时替换项目目录与包名。

不改人设卡，不发送QQ，不重建会话，不联网解析私人文件。首次接口切换由一次性迁移完成，运行中不保留旧命名工具或别名。
