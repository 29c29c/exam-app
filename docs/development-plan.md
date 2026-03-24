# 题库应用开发优化方案

## 1. 文档目的

本文档用于指导当前题库项目从“可用原型”升级为“可维护、可扩展、可持续导入题库”的正式版本。

对应的分阶段执行文档已拆分到：

- [阶段文档索引](/Users/29c/Desktop/2333/project/ing/exam-app/docs/phases/README.md)
- [阶段 1：数据结构与导入系统重构](/Users/29c/Desktop/2333/project/ing/exam-app/docs/phases/phase-1-data-import.md)
- [阶段 2：前端模块化与资源管理增强](/Users/29c/Desktop/2333/project/ing/exam-app/docs/phases/phase-2-frontend-management.md)
- [阶段 3：学习流程完善与 AI 能力增强](/Users/29c/Desktop/2333/project/ing/exam-app/docs/phases/phase-3-learning-ai.md)
- [阶段 4：质量保障、导出回收站与运维补齐](/Users/29c/Desktop/2333/project/ing/exam-app/docs/phases/phase-4-quality-ops.md)
- [阶段 5：AI Markdown 题库导入增强](/Users/29c/Desktop/2333/project/ing/exam-app/docs/phases/phase-5-ai-markdown-import.md)

目标包括：

- 提高题库导入准确率，减少脏数据入库
- 改善 UI 与题库管理体验
- 优化数据库结构与文件管理能力
- 降低后续维护成本，支持持续迭代
- 为搜索、错题、统计、导出、批量 AI 解析等功能打基础

本文档基于当前代码现状编写，当前关键文件为：

- 后端入口：`server.js`
- 前端入口：`public/index.html`
- 数据库文件：`db/database.sqlite`

---

## 2. 当前现状与核心问题

### 2.1 项目结构现状

当前项目是典型的轻量原型结构：

- 使用 `Express + SQLite`
- 前端全部写在一个 `public/index.html` 中
- React 通过 CDN 引入，浏览器内直接运行 Babel
- 数据模型较少，接口集中在单个 `server.js`

这种结构的优点是开发快，但缺点也很明显：

- 前后端职责混杂，后续改动容易相互影响
- 前端无法模块化，组件复用和维护困难
- 数据表缺少约束，容易产生脏数据和孤儿数据
- 导入逻辑过于依赖简单正则，复杂题型和格式适配能力弱

### 2.2 题库导入问题

当前导入逻辑的核心问题：

- 仅支持“纯文本整段导入”
- 通过题号和答案正则做基础切分
- `options` 字段没有真正解析，始终写死为 `'[]'`
- `content` 中同时混入了题干、选项、题型、难度等信息
- 无法稳定识别多选、判断、填空、简答等题型
- 没有导入预览，用户不能确认解析结果是否正确
- 没有导入报告、异常题提示、重复题检测和回滚机制

这意味着当前数据虽然能“展示出来”，但难以支持：

- 按选项渲染
- 后续判分
- 条件筛选
- 精准搜索
- 题目导出
- 错题统计
- AI 精准解析

### 2.3 UI 与交互问题

当前 UI 已具备基础移动端体验，但仍是“演示型界面”：

- 文件夹导航只有一层状态，深层目录体验差
- 列表页信息密度低，看不到题库规模和状态
- 导入流程不透明，失败原因不清晰
- 做题页缺少筛选、随机、搜索、标记掌握等功能
- 题目操作集中在局部按钮，没有形成完整的学习工作流

### 2.4 文件管理与资源组织问题

当前“文件管理”本质上还是：

- 文件夹表 `folders`
- 题库表 `banks`
- 题目表 `questions`

但缺少完整的资源管理能力：

- 无题库移动/重命名
- 无文件夹移动/重命名
- 无批量操作
- 无导出
- 无回收站
- 无导入批次记录
- 无原始导入文件存档

### 2.5 数据库与安全问题

当前数据库设计更偏原型：

- 没有显式外键
- 没有级联删除
- 没有索引优化
- 缺少唯一约束和输入校验
- JWT 密钥硬编码
- AI Key 存在前端 `localStorage`
- 缺乏统一错误处理和日志

这些问题在单用户少量数据时可能不明显，但数据量增大后会迅速放大。

---

## 3. 总体改造目标

建议将项目改造成以下方向：

### 3.1 技术层目标

- 前端模块化
- 后端职责分层
- 数据结构标准化
- 导入流程可视化
- 题库管理完整化
- 数据操作可回滚、可审计

### 3.2 业务层目标

- 支持稳定导入常见题库格式
- 支持题型识别与结构化存储
- 支持收藏、错题、筛选、搜索、导出
- 支持批量 AI 解析与进度管理
- 支持按目录组织和维护题库资源

---

## 4. 推荐的目标项目结构

建议先把项目从“单文件应用”调整为如下结构：

```text
exam-app/
  docs/
    development-plan.md
  db/
    database.sqlite
    migrations/
  public/
    index.html
  src/
    app/
      App.jsx
    components/
      Auth/
      Dashboard/
      Quiz/
      Import/
      Common/
    pages/
      DashboardPage.jsx
      QuizPage.jsx
      SettingsPage.jsx
    api/
      client.js
      auth.js
      banks.js
      folders.js
      questions.js
      import.js
      ai.js
    hooks/
    utils/
    styles/
  server/
    app.js
    routes/
      auth.js
      folders.js
      banks.js
      questions.js
      imports.js
      ai.js
    services/
      import-parser.js
      question-normalizer.js
      ai-service.js
      bank-service.js
    db/
      index.js
      migrations.js
    middleware/
      auth.js
      error-handler.js
      validate.js
    utils/
      logger.js
      response.js
  package.json
```

### 实现方法

- 前端先拆组件，再考虑引入构建工具
- 后端先按“路由/服务/数据库”三层拆分
- 保留 SQLite，不必一开始就迁移数据库
- 先做低风险重构，再做功能增强

---

## 5. 数据库重构方案

### 5.1 当前问题

当前表设计不足以支持规范题库管理，特别是：

- 题目字段过于扁平
- 无法区分题干和选项
- 无导入批次记录
- 无题目标签、来源、难度
- 删除动作无法保证强一致

### 5.2 建议的核心表结构

#### 5.2.1 folders

用途：目录树管理。

建议字段：

- `id`
- `user_id`
- `name`
- `parent_id`
- `sort_order`
- `created_at`
- `updated_at`

建议约束：

- `FOREIGN KEY(parent_id) REFERENCES folders(id) ON DELETE CASCADE`
- `UNIQUE(user_id, parent_id, name)`，同级目录不允许重名

#### 5.2.2 banks

用途：题库元信息管理。

建议字段：

- `id`
- `user_id`
- `folder_id`
- `name`
- `description`
- `question_count`
- `source_type`
- `import_batch_id`
- `created_at`
- `updated_at`

建议约束：

- `FOREIGN KEY(folder_id) REFERENCES folders(id) ON DELETE SET NULL`
- `UNIQUE(user_id, folder_id, name)`

#### 5.2.3 questions

用途：题目主表。

建议字段：

- `id`
- `bank_id`
- `type`
- `stem`
- `answer`
- `analysis`
- `difficulty`
- `source`
- `raw_text`
- `normalized_hash`
- `created_at`
- `updated_at`

说明：

- `stem` 存题干正文
- `raw_text` 存导入原始文本，方便回溯
- `normalized_hash` 用于去重

#### 5.2.4 question_options

用途：结构化存储选项，而不是塞进 JSON 字符串。

建议字段：

- `id`
- `question_id`
- `option_key`
- `option_text`
- `sort_order`

建议约束：

- `FOREIGN KEY(question_id) REFERENCES questions(id) ON DELETE CASCADE`
- `UNIQUE(question_id, option_key)`

#### 5.2.5 bookmarks

保留现有功能，但补外键：

- `user_id`
- `question_id`
- `created_at`

#### 5.2.6 import_batches

用途：记录每一次导入任务。

建议字段：

- `id`
- `user_id`
- `bank_id`
- `source_type`
- `original_name`
- `raw_content`
- `status`
- `total_count`
- `success_count`
- `failed_count`
- `duplicate_count`
- `error_summary`
- `created_at`

价值：

- 可追踪一次导入的整体结果
- 可展示导入报告
- 可做按批次回滚

### 5.3 索引建议

建议补以下索引：

- `idx_folders_user_parent ON folders(user_id, parent_id)`
- `idx_banks_user_folder ON banks(user_id, folder_id)`
- `idx_questions_bank ON questions(bank_id)`
- `idx_questions_hash ON questions(normalized_hash)`
- `idx_bookmarks_user ON bookmarks(user_id)`

### 5.4 数据迁移实现方法

建议采用“增量迁移”方案，不直接重建所有表。

实施步骤：

1. 新增新表和新字段
2. 编写一次性迁移脚本
3. 将旧 `questions.options` 中的数据迁移到 `question_options`
4. 将旧 `content` 拆分填充到 `stem/raw_text`
5. 新老接口短期兼容
6. 验证完成后移除旧逻辑

建议新增：

- `db/migrations/001_add_import_batches.sql`
- `db/migrations/002_refactor_questions.sql`
- `db/migrations/003_add_indexes.sql`

---

## 6. 题库导入系统重构方案

### 6.1 目标

把现有“文本直接入库”的方式升级为：

`原始内容输入 -> 解析 -> 预览 -> 用户确认 -> 入库 -> 生成导入报告`

### 6.2 推荐支持的导入来源

第一阶段建议支持：

- 纯文本粘贴
- Markdown 文本
- CSV
- Excel

第二阶段再支持：

- Word 文档
- PDF 文本抽取
- 自定义模板导入

### 6.3 导入流程设计

#### 阶段一：上传或粘贴内容

前端提供两种方式：

- 文本粘贴
- 文件上传

接口设计：

- `POST /api/import/parse`

输入：

```json
{
  "bankName": "马克思原理",
  "folderId": 1,
  "sourceType": "text",
  "content": "题目原文..."
}
```

输出：

```json
{
  "previewId": "temp_xxx",
  "summary": {
    "total": 100,
    "parsed": 92,
    "suspected": 6,
    "duplicates": 2
  },
  "items": [
    {
      "index": 1,
      "type": "single_choice",
      "stem": "题干",
      "options": [
        { "key": "A", "text": "选项A" },
        { "key": "B", "text": "选项B" }
      ],
      "answer": "B",
      "analysis": "",
      "status": "ok"
    }
  ]
}
```

#### 阶段二：预览确认

前端展示：

- 解析成功的题目
- 可疑题目
- 重复题目
- 失败题目

用户可执行：

- 删除异常题
- 手动修改题型、答案、选项
- 选择是否跳过重复题

#### 阶段三：确认入库

接口设计：

- `POST /api/import/commit`

输入：

```json
{
  "previewId": "temp_xxx",
  "bankName": "马克思原理",
  "folderId": 1,
  "items": [...]
}
```

后端执行：

1. 创建导入批次记录
2. 创建题库
3. 批量写入题目
4. 批量写入选项
5. 更新统计
6. 返回导入报告

### 6.4 解析器设计

建议将导入逻辑从路由中抽离到独立服务文件：

- `server/services/import-parser.js`

解析器分 4 层：

1. 文本预清洗
2. 题目切块
3. 题型识别
4. 字段抽取

#### 6.4.1 文本预清洗

处理内容：

- 统一换行符
- 清除多余空白
- 统一题号格式
- 标准化全角/半角标点
- 统一答案分隔符

示例规则：

- `１．` 转 `1.`
- `答案：A B` 转 `答案：A,B`
- `A．` 转 `A.`

#### 6.4.2 题目切块

建议不要只依赖一个简单正则。

应该组合使用：

- 题号规则：`1.` `1、` `（1）`
- 题型标记：`单选题` `多选题` `判断题`
- 空行辅助分段

建议算法：

1. 逐行扫描
2. 发现新题起始时开启新块
3. 对块内容做二次修正
4. 若块内缺失答案，标记为 `suspected`

#### 6.4.3 题型识别

识别优先级：

1. 根据题型关键词
2. 根据答案格式推断
3. 根据选项数量和形式推断

规则示例：

- `答案: A` 多半是单选
- `答案: A,C,D` 多半是多选
- `答案: 对/错` 或 `True/False` 多半是判断
- 无选项但有标准答案，多半是填空或简答

#### 6.4.4 字段抽取

每题抽取以下字段：

- `type`
- `stem`
- `options`
- `answer`
- `analysis`
- `difficulty`
- `source`
- `raw_text`

### 6.5 去重实现方法

题目去重建议不要直接比较原文，而应做标准化。

标准化流程：

1. 移除题号
2. 统一空格和标点
3. 统一大小写
4. 去除“单选题(1.0分)”这类元信息
5. 对结果生成哈希值

重复判定策略：

- 同题库内重复：默认拦截
- 跨题库重复：提示但允许导入

### 6.6 异常题处理

解析器应输出状态：

- `ok`
- `suspected`
- `duplicate`
- `failed`

前端在预览阶段按颜色和标签展示。

### 6.7 回滚实现方法

通过 `import_batches` 记录每次导入产生的题目集合。

建议在 `questions` 中增加：

- `import_batch_id`

这样可支持：

- 撤销最近一次导入
- 删除某批次导入题目
- 查看历史导入记录

---

## 7. API 重构建议

### 7.1 拆分原则

当前后端接口都在 `server.js`，建议拆为：

- `routes/auth.js`
- `routes/folders.js`
- `routes/banks.js`
- `routes/questions.js`
- `routes/imports.js`
- `routes/ai.js`

### 7.2 推荐新增接口

#### 文件夹与题库

- `GET /api/folders/tree`
- `PATCH /api/folders/:id`
- `PATCH /api/folders/:id/move`
- `PATCH /api/banks/:id`
- `PATCH /api/banks/:id/move`
- `GET /api/banks/:id/stats`

#### 题目

- `GET /api/banks/:id/questions`
  支持分页、搜索、筛选、排序
- `PATCH /api/questions/:id`
- `POST /api/questions/batch-delete`
- `POST /api/questions/batch-move`

#### 导入

- `POST /api/import/parse`
- `POST /api/import/commit`
- `GET /api/import/batches`
- `GET /api/import/batches/:id`
- `POST /api/import/batches/:id/rollback`

#### AI

- `POST /api/ai/analyze-question`
- `POST /api/ai/analyze-batch`
- `GET /api/ai/tasks/:id`

### 7.3 实现细节

- 路由只负责参数接收和返回
- 业务逻辑放在 service
- 数据访问统一收敛到 db/service 层
- 统一使用 `sendSuccess/sendError` 响应格式

返回格式建议统一：

```json
{
  "success": true,
  "data": {},
  "message": ""
}
```

错误格式：

```json
{
  "success": false,
  "error": {
    "code": "IMPORT_PARSE_FAILED",
    "message": "题库解析失败"
  }
}
```

---

## 8. 前端重构与 UI 优化方案

### 8.1 重构目标

当前前端全部写在一个 HTML 中，建议逐步拆分为模块化 React 组件。

优先拆分组件：

- `AuthForm`
- `TopNav`
- `FolderList`
- `BankList`
- `ImportModal`
- `ImportPreviewModal`
- `QuizCard`
- `AnswerPanel`
- `QuestionSheet`
- `AiConfigModal`

### 8.2 仪表盘优化

建议新增的信息和交互：

- 面包屑导航
- 当前目录统计
- 题库题目总数
- 最近学习时间
- 未解析题数量
- 收藏题数量

题库卡片建议展示：

- 题库名称
- 题目数
- 收藏数
- 最近更新时间
- 操作菜单

建议卡片操作整合为菜单：

- 做题
- 收藏夹
- 批量 AI 解析
- 重命名
- 移动
- 导出
- 删除

### 8.3 导入页面优化

现有导入弹窗建议升级为三步式：

1. 输入内容或上传文件
2. 查看预解析结果
3. 确认导入

页面需要展示：

- 解析成功数量
- 可疑题数量
- 重复题数量
- 失败题数量
- 每道题的结构化预览

### 8.4 做题页优化

建议新增：

- 随机做题
- 顺序/随机切换
- 只看收藏
- 只看未解析
- 按关键词搜索
- 答题卡筛选状态
- 标记“已掌握”
- 记录答题进度

### 8.5 视觉与交互实现建议

现有 UI 基本风格可以保留，但应增强信息层次。

建议实现：

- 用状态色区分正常/异常/警告题目
- 列表页增加轻量统计栏
- 做题页题目内容与答案区视觉分层
- AI 解析区支持复制、折叠、重新生成
- 删除操作使用二次确认弹窗

---

## 9. 文件管理与资源管理方案

### 9.1 目录树能力

建议补齐：

- 新建文件夹
- 重命名文件夹
- 移动文件夹
- 删除文件夹
- 文件夹树展示

实现方法：

- 后端返回完整树结构或平铺列表
- 前端将目录树缓存到状态中
- 支持面包屑和目录选择器

### 9.2 题库资源操作

建议补齐：

- 重命名题库
- 移动题库到其他文件夹
- 批量删除题库
- 导出题库
- 查看题库统计

### 9.3 导出能力

第一阶段支持导出：

- JSON
- Markdown
- CSV

导出接口：

- `GET /api/banks/:id/export?format=json`
- `GET /api/banks/:id/export?format=markdown`
- `GET /api/banks/:id/export?format=csv`

### 9.4 回收站机制

建议不要直接物理删除。

第一阶段可以使用“软删除”：

- `deleted_at`

适用对象：

- folders
- banks
- questions

这样可以支持：

- 回收站
- 撤销误删
- 安全审计

---

## 10. AI 解析能力优化方案

### 10.1 当前问题

当前 AI 流程虽然可用，但存在以下问题：

- Key 存在前端
- 没有任务队列
- 批量解析逐题串行调用
- 缺乏失败重试
- 缺乏任务记录

### 10.2 建议改造方向

#### 第一阶段

- 保留现有同步请求模式
- 增加参数校验
- 增加 provider 适配层
- 增加失败重试和错误提示

#### 第二阶段

- 引入任务表 `ai_tasks`
- 批量解析改为任务模式
- 前端轮询任务进度

建议表结构：

- `id`
- `user_id`
- `bank_id`
- `provider`
- `status`
- `total_count`
- `success_count`
- `failed_count`
- `created_at`
- `updated_at`

### 10.3 AI 服务封装

建议新增：

- `server/services/ai-service.js`

职责：

- 根据 provider 组装请求
- 统一超时与错误处理
- 返回标准化结果

接口示例：

```js
async function analyzeQuestion({ provider, apiKey, question, answer }) {
  if (provider === 'deepseek') {
    return await analyzeWithDeepseek(...)
  }
  if (provider === 'gemini') {
    return await analyzeWithGemini(...)
  }
  throw new Error('UNSUPPORTED_PROVIDER')
}
```

---

## 11. 安全、配置与运维建议

### 11.1 配置管理

建议新增 `.env`：

```env
PORT=3007
JWT_SECRET=replace_me
DB_PATH=./db/database.sqlite
```

后端通过环境变量读取，不再硬编码：

- `PORT`
- `JWT_SECRET`
- 数据库路径
- AI 服务默认超时

### 11.2 输入校验

建议所有写接口都加校验。

可选方案：

- 轻量方案：手写校验函数
- 推荐方案：引入 `zod` 或 `joi`

重点校验：

- 用户名、密码长度
- 文件夹名称、题库名称
- 题目字段完整性
- 导入数据格式
- provider 合法性

### 11.3 权限校验

当前已具备 JWT 校验，但资源归属校验还应更严格。

例如：

- 删除题库前确认归属用户
- 读取题目时确认题库属于当前用户
- 导入前确认目标文件夹属于当前用户

### 11.4 日志与备份

建议补：

- 请求日志
- AI 调用日志
- 导入批次日志
- 数据库定期备份脚本

SQLite 备份可先采用：

- 启动前备份
- 每次导入前生成副本

---

## 12. 测试方案

### 12.1 优先测试范围

第一优先级：

- 导入解析器
- 去重逻辑
- 删除级联逻辑
- 题库移动逻辑

第二优先级：

- 认证流程
- AI 解析适配层
- 导出逻辑

### 12.2 推荐测试拆分

#### 单元测试

适用于：

- 文本清洗
- 题型识别
- 答案抽取
- 哈希去重

#### 集成测试

适用于：

- 导入并写库
- 删除题库后级联结果
- 文件夹移动
- 收藏切换

### 12.3 测试数据

建议建立测试样例目录：

```text
test-data/
  imports/
    single-choice.txt
    multi-choice.txt
    mixed-format.txt
    malformed.txt
    duplicate.txt
```

这些样例要覆盖：

- 单选
- 多选
- 判断
- 不规范格式
- 缺失答案
- 重复导入

---

## 13. 分阶段实施计划

### 阶段一：数据结构和导入重构

目标：

- 完成数据库迁移
- 完成解析器抽离
- 实现导入预览和确认入库

具体任务：

1. 新增迁移脚本和新表
2. 抽离 `import-parser` 服务
3. 新增 `/api/import/parse` 和 `/api/import/commit`
4. 前端新增导入预览弹窗
5. 完成去重与异常题标记

产出结果：

- 导入准确率显著提升
- 题目数据结构化
- 可回滚导入批次

### 阶段二：前端模块化与资源管理

目标：

- 前端脱离单 HTML 文件
- 增强文件夹/题库管理体验

具体任务：

1. 拆分前端组件
2. 增加面包屑与目录树
3. 支持重命名、移动、批量删除
4. 题库卡片展示统计信息

### 阶段三：学习流程与 AI 提升

目标：

- 做题体验更完整
- AI 解析更稳定

具体任务：

1. 做题页增加搜索和筛选
2. 支持随机模式
3. AI 服务封装
4. 批量 AI 任务化

### 阶段四：导出、回收站、测试补齐

目标：

- 完成资源闭环
- 完成基础质量保障

具体任务：

1. 增加导出
2. 增加软删除和回收站
3. 补单元测试和集成测试
4. 增加日志和备份

---

## 14. 推荐优先级排序

如果希望按“投入最少、收益最大”的顺序推进，建议优先级如下：

1. 先改题库导入和数据库结构
2. 再补导入预览、异常题修正、去重
3. 再做文件夹/题库管理增强
4. 再拆前端结构
5. 最后做导出、回收站、AI 任务化

原因：

- 当前最核心的问题不是 UI 不够漂亮，而是题目数据不够标准
- 如果底层数据结构不先改，后续 UI、搜索、导出、统计都只能建立在脆弱基础上

---

## 15. 开发执行建议

建议实际开发时遵循以下原则：

- 每次只改一个主问题，避免同时重构全部模块
- 先兼容旧数据，再逐步迁移
- 先做可验证的小闭环，再继续扩展
- 所有高风险改动先加迁移脚本和备份
- 导入功能必须先做测试样例，再上线使用

建议的第一批开发任务可以直接拆成以下工单：

1. 设计并迁移新的题目表和导入批次表
2. 编写独立题库解析器
3. 实现导入预览 API
4. 实现导入确认入库 API
5. 前端增加导入预览界面
6. 为题库与文件夹增加重命名和移动

---

## 16. 结论

当前项目已经具备继续演进的基础，但它最需要的不是局部修修补补，而是先完成一次“数据模型 + 导入流程”的小型重构。

只要先把题目结构化、导入流程可视化、删除逻辑标准化，后续不论是 UI 提升、搜索统计、错题本、导出，还是 AI 批量解析，都会变得顺很多。

建议把第一阶段作为本项目的正式重构起点。
