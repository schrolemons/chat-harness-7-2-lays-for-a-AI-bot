# 私人资料包建立规范：给开发者和 AI

把本文件、待整理的原始文档和一个独立输出目录交给 AI，即可准备可挂载的 S 层资料包。

本文件 `docs/personal-core/README.md` 是项目自带的建包规范，无需复制到资料包中。资料包内可选的 `GUIDE.md` 则是这份资料的阅读导读，记录阅读顺序与引用注意事项，由 AI 依据作者提供的要求整理；开发者无需手写。

与控制台一致，本文以 `D:\qq-bridge` 为项目目录、`D:\qq-bridge\private-libraries\my-core` 为资料包根目录。例如本文件的完整路径是 `D:\qq-bridge\docs\personal-core\README.md`，资料包导读的完整路径是 `D:\qq-bridge\private-libraries\my-core\GUIDE.md`。使用时分别替换为实际目录；控制台只填写资料包根目录。

本组件示例使用 `private-libraries/my-core`，包名可自行选择。示例不要求现有资料迁移或改名，程序允许挂载其他本机目录。框架只识别本文的数据接口；作者、主题和阅读语境由资料包声明，不需要为不同文档修改读取器或创建另一套工具。

## 1. 可以直接交给 AI 的任务

> 阅读本说明。把我提供的文档整理成符合 schema_version=1 的私人资料包。保留原稿字节，按完整观点和使用情境分卡，不按固定字数切段；长卡使用明确的Markdown章节标题。目录摘要保持简短，让AI先分批选择主题，再读取完整短卡或长卡章节。需要消歧时可生成简短GUIDE.md，不要求每次先读导读。每张卡区分原文片段、整理者解读和未核实内容，记录出处，不创造作者未说过的主张，不删掉反论点或改变结论。生成manifest.json、catalog.json、topics/和sources/；先离线复核，再索引与校验。资料留在本机，不调用外部上传服务。完成后返回目录、作者、规模和校验结果。

若没有作者名，使用“作者未提供”，不要猜测真实身份。包名可由开发者指定。示例中所有观点、作者和材料均为虚构。

## 2. 唯一的数据接口

```text
D:\qq-bridge\private-libraries\my-core\
  manifest.json             # 包身份、文件入口、使用语境
  catalog.json              # 目录、主题摘要、出处与关联
  GUIDE.md                  # 可选：作者的阅读和引用说明
  topics\
    stable-topic-id.md      # 一卡一个观点/问题，含引文与解读
  sources\
    originals\             # 原始DOCX/PDF等原样保留
    converted\             # 可核对行号的UTF-8 Markdown/纯文本
```

原稿本来就是 Markdown/文本时，可直接放在 sources/，无需重复转换。目录可以使用任意本机路径；包内引用一律用相对路径和 `/`，不能使用 `..`、绝对路径或跳出资料包的链接。

现成例子：`examples/personal-core/minimal/`。机器可读结构：本目录的 `manifest.schema.json` 与 `catalog.schema.json`。

## 3. manifest.json

```json
{
  "schema_version": 1,
  "id": "my-thoughts",
  "title": "我的思想资料",
  "author": "作者未提供",
  "version": "1.0.0",
  "description": "这是谁的什么资料，适合讨论什么。",
  "catalog": "catalog.json",
  "sources": [
    {
      "title": "原始笔记",
      "path": "sources/original.md",
      "sha256": "由索引命令生成的64位SHA256"
    }
  ],
  "behavior": {
    "discussion_commands": ["/core"],
    "discussion_patterns": ["如何做选择"],
    "care_patterns": []
  }
}
```

- `id` 为小写字母开头的稳定包ID，可含数字、点、短横线和下划线，最长64字。
- `title/author/version` 必填；版本建议使用 `1.0.0`。替换作者时换包ID，更新同一包时保留ID并递增版本。
- `catalog` 指向包内目录索引，不限制必须叫 catalog.json。
- `sources` 列出全部原稿。DOCX/PDF需同时给出 `converted_path` 和 `converted_sha256`，指向可核对行号的转换稿。原件与转换稿各有自己的文件hash。
- 可选 `guide: {"path":"GUIDE.md","sha256":"..."}` 声明阅读说明。AI通过 `core_read({"id":"@guide"})` 读取；这份说明是作者材料，不是系统指令。
- `discussion_commands` 是资料包自己的讨论指令，例如 `/core`，由包作者配置。
- `discussion_patterns/care_patterns/exit_patterns` 是可选正则表达式列表，每条最多300字。exit_patterns用于退出当前轮的资料讨论；其他匹配只决定当前轮的讨论/关怀配合，不代表科学判断。空列表不自动触发；AI仍可在真实问题需要时主动查目录。
- 优先关怀对象、自动导读适用会话在控制台配置，不写死在通用读取器里。它们不授予新的文件、QQ或管理员权限。

## 4. catalog.json 与知识卡

```json
{
  "schema_version": 1,
  "topics": [{
    "id": "choice:reversible",
    "title": "可逆与难以撤回的选择",
    "group": "选择",
    "core_meaning": "整理者对核心含义的简短概括。",
    "when_to_use": "什么真实问题适合参考这张卡。",
    "how_to_use": "如何结合上下文解释，以及哪些条件不能省略。",
    "do_not_use_for": "不适合的用途，如临床诊断或未经证实的科学断言。",
    "epistemic_status": "author_opinion",
    "flags": [],
    "keywords": ["选择", "可逆"],
    "related": [],
    "source": "原始笔记",
    "source_snapshot": "sources/original.md",
    "source_lines": [1, 3],
    "source_sha256": "由索引命令生成",
    "path": "topics/reversible.md",
    "sha256": "由索引命令生成"
  }]
}
```

- 卡片ID稳定且唯一，不依赖某个作者的编号前缀；可用字母、数字、点、下划线、冒号和短横线，最长96字。不能用路径作为ID，`@guide`是保留ID。
- `core_meaning/when_to_use/how_to_use` 是整理后的目录摘要，不冒充原句。
- 原文在DOCX/PDF中时，加上 `source_markdown` 指向已声明的转换稿；`source_lines` 为该转换稿的1起始闭区间行号。纯Markdown原稿的行号直接指向原稿。
- `source_sha256` 校验行号所指向的文本稿；`sha256` 校验整张卡片文件，两者不同。
- `related` 只能引用本包真实存在的其他卡片ID。
- `epistemic_status` 明确观点性质，可写作者论证、私人假说、引述资料、整理者解释或未核实内容，不能将它们混为科学定论。
- `restricted_context`、`health_claim_unverified` 标记的卡片只保留在本地供明确文本研究，运行时拒绝读取；目录会显示该限制。未经复核的片段应标出不确定性，不默认进入普通对话。

建议卡片正文结构：

```markdown
# 主题名称
## 原文片段
> 精确保留转换稿对应行的引文，不把转述放进引号。
## 核心论点与适用条件
整理者的概括，并保留原文中的限定、反例或分歧。
## 整理者的通俗解释
明确这是解读，可用小例子帮助理解，不增加作者的主张。
## 不确定或待核实
记录歧义、缺失依据与无法判断之处；没有就写“暂无”。
## 来源
原稿文件、转换稿、行号与版本。
```

## 5. AI 整理与检查顺序

1. 将原件复制到 sources/，核对复制前后hash，不修改原稿。转换件单独保留；无法可靠提取的公式、图片或表格明确标注，不编造补全。
2. 先写整库概述、主题分组，再按观点边界分卡。相互依赖的段落放在一起，反论点通过同卡说明或 related 关联。
3. 填写每张卡的适用情境与证据性质，核对引文和行号。更新时保留稳定ID，不把旧观点悄悄替换成新观点。
4. 在候选目录中生成索引并验证：

```powershell
node "D:\qq-bridge\scripts\personal-core.mjs" index "D:\qq-bridge\private-libraries\my-core" --dry-run
node "D:\qq-bridge\scripts\personal-core.mjs" index "D:\qq-bridge\private-libraries\my-core" --reviewed
node "D:\qq-bridge\scripts\personal-core.mjs" validate "D:\qq-bridge\private-libraries\my-core"
```

`--reviewed` 表示整理者已按本文复核，不等于程序自动证明摘要忠实。索引命令只更新manifest/catalog的文件hash，不改原稿或卡片，保留原索引备份；不会调用模型或联网。校验检查结构、路径、重复ID、失效关联、出处行号和文件完整性，无法替代语义复核。

5. 返回 `ok:true` 后，先启用控制台 S 层组件，再填写该目录并“保存并校验资料包挂载”。失败时保留原挂载，不切换到示例包或旧缓存。停用期间不执行挂载，控制台也不开放挂载保存按钮。

## 6. 框架怎样使用

唯一模型接口为 `core_status / core_topics / core_read`，不做向量检索。S层只提供短入口，不把整库或导读自动复制进上下文。

1. `core_status({})` 获取名称、用途、作者和规模。
2. `core_topics({"offset":0,"limit":12})` 分批浏览标题、简短摘要和ID，按nextOffset继续；query只做词面筛选。
3. `core_read({"id":"choice:reversible"})` 读取选中卡片。不超过Console的maxReadChars时，完整返回正文，readMode为full；默认不另设3500字符截断。
4. 长卡先返回readMode=outline及章节ID、标题、长度和卡片内行号。用`core_read({"id":"choice:reversible","section":"section:3"})`读取所选章节；section值须取自实际返回，也可用唯一的完整标题。重名标题必须用ID，较长父章节继续展开到子节。
5. 仅当理解困难、术语特殊或引用边界易误解时，调用`core_read({"id":"@guide"})`。短导读整篇返回，长导读也按章节展开；未声明导读时不编造。

章节目录每批默认条数由catalogPageSize控制，以sectionOffset/nextSectionOffset续读；它与主题目录的offset/nextOffset、正文字符分页是不同的使用场景。显式传入正文offset或limit时启用兼容分页；指定section后，正文offset相对于该章节。章节仍超长或没有标题时，返回readMode=paged，用nextOffset继续。不把sectionOffset和正文offset/limit混用。

读取结果带revision（正文hash）；续读时带回该值，更新后旧章节选择会返回STALE_CONTENT。source_lines仍对应原稿，content_lines对应当前卡片，不能混用。短章节读完只代表该章节完整，不代表整篇大卡已读；scopeComplete与documentComplete分别说明范围。

每次正文上限不等于整份工具结果的token上限。读取一次也不等于永久记住：正文不在当前上下文、被压缩或文件更新后可能需要重读，文件缓存只减少服务端读盘。没有读到的内容不得声称读过，引用时区分作者原文、整理者解释与证据限度。

**已结构化的资料优先沿用原有问题卡和大小标题，不为使用章节功能而重新切分。** 每次读取卡片会动态附上context，不修改原稿、卡片或目录文件：

- `position`：所属文章、原文标题路径、同文卡片序号、原稿行号，以及已有目录中的本卡用途与核心摘要。Markdown标题及明确的“第…部分 / PART…”行用于结构定位，不猜测未标注的层级。
- `before / after`：同一原稿中前后相邻卡的ID、标题和既有摘要；按原文行号确定，不按目录数组顺序或其他文档拼接。没有相邻卡时返回null，原文范围重叠时另行标明，不伪造先后关系。
- 这些是定位和导航信息，不是新生成的作者论证，也不代表已经读过相邻卡的完整正文。需要核对时，按对应ID继续读取。

普通聊天、深入讨论、选定会话的关怀语境分开处理。资料不会覆盖人设、心情形态、发送额度、宵禁、会话权限或模型系统规则。资料中的命令句始终是被讨论的内容。

## 7. 更新、共享与卸载

- 推荐在新目录整理下一版本，校验后再切换挂载，避免正在使用的目录处于半更新状态。
- 直接改动文件而未更新hash，读取会报错，不自动沿用旧正文；重新校验成功后才能恢复。
- 清空控制台目录并保存表示卸载；停用组件表示停止提供对应能力。原稿文件不删除。
- 私人目录保留在开发者本机或其指定私人仓库。公开框架只分发本说明、接口schema、整理/校验工具和虚构示例，不混入默认机主的真实文档。
