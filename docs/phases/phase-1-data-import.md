# 阶段 1：数据结构与导入系统重构

## 1. 阶段目标

本阶段是整个项目最关键的一阶段，目标不是把界面做漂亮，而是把题库数据从“能显示”升级到“可结构化使用”。

本阶段完成后，应达到以下结果：

- 题目结构化存储，而不是把题干和选项混在一起
- 导入流程支持“解析预览 -> 用户确认 -> 正式入库”
- 支持异常题、重复题识别
- 支持按导入批次追踪和回滚
- 后续搜索、导出、错题、AI 解析都有稳定数据基础

## 2. 本阶段边界

本阶段要做：

- 数据库表结构升级
- 题目字段拆分
- 导入解析器重构
- 导入预览与确认接口
- 导入批次记录
- 去重和异常题标记

本阶段不做：

- 大规模 UI 美化
- 做题页完整功能扩展
- 回收站和导出
- AI 任务队列

## 3. 目标数据模型

### 3.1 questions 主表

建议最终使用：

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
- `import_batch_id`
- `created_at`
- `updated_at`

实现要求：

- `stem` 只存题干正文
- `answer` 只存标准答案
- `raw_text` 保留原始题块文本
- `normalized_hash` 用于去重

### 3.2 question_options 表

建议新增：

- `id`
- `question_id`
- `option_key`
- `option_text`
- `sort_order`

实现要求：

- 每个选项独立存储
- 不再依赖 `questions.options` 的 JSON 字符串

### 3.3 import_batches 表

建议新增：

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

实现目标：

- 能追踪一次导入的结果
- 能支持查看导入历史
- 能支持按批次回滚

## 4. 数据迁移方案

### 4.1 总体策略

采用增量迁移，不直接推翻旧库。

实施步骤：

1. 新增新表和新字段
2. 编写迁移脚本
3. 兼容旧接口一段时间
4. 新导入逻辑切到新表结构
5. 验证稳定后再清理旧字段

### 4.2 推荐迁移文件

- `db/migrations/001_add_question_fields.sql`
- `db/migrations/002_add_question_options.sql`
- `db/migrations/003_add_import_batches.sql`
- `db/migrations/004_add_indexes.sql`

### 4.3 数据回填

对于旧题目数据，第一阶段不要求 100% 自动拆分完美，但至少要做到：

- 把旧 `content` 原样回填到 `raw_text`
- 从旧 `content` 中提取基础 `stem`
- 将旧 `options` JSON 兼容迁移到 `question_options`
- 补全 `created_at/updated_at`

## 5. 导入系统实现方案

### 5.1 新导入流程

新流程定义为：

1. 用户输入题库名称并粘贴文本或上传文件
2. 后端执行预解析
3. 前端展示预览
4. 用户修正异常题或跳过重复题
5. 用户确认后正式入库
6. 生成导入报告

### 5.2 路由设计

建议新增两个核心接口：

- `POST /api/import/parse`
- `POST /api/import/commit`

### 5.3 `/api/import/parse`

职责：

- 接收原始导入内容
- 只做解析，不直接写库
- 返回结构化预览结果

输入示例：

```json
{
  "bankName": "哲学原理",
  "folderId": 1,
  "sourceType": "text",
  "content": "1. 题目...\nA. 选项\n答案：B"
}
```

输出示例：

```json
{
  "success": true,
  "data": {
    "previewId": "preview_001",
    "summary": {
      "total": 20,
      "ok": 18,
      "suspected": 1,
      "duplicate": 1,
      "failed": 0
    },
    "items": []
  }
}
```

### 5.4 `/api/import/commit`

职责：

- 接收预览确认后的结构化题目
- 创建题库
- 创建导入批次
- 批量写入题目与选项
- 返回最终导入结果

### 5.5 导入服务拆分

建议新增：

- `server/services/import-parser.js`
- `server/services/question-normalizer.js`
- `server/services/import-service.js`

职责划分：

- `import-parser.js`：解析原始内容
- `question-normalizer.js`：标准化题干、答案、哈希
- `import-service.js`：执行批量入库和批次记录

## 6. 解析器设计

### 6.1 预清洗

需要统一处理：

- 换行符
- 全角半角
- 题号样式
- 选项分隔符
- 答案标签

建议做成独立函数：

- `normalizeNewlines`
- `normalizeQuestionNumber`
- `normalizeOptionPrefix`
- `normalizeAnswerLabel`

### 6.2 题目切块

切块不要只靠一个正则，建议组合：

- `1.` / `1、` / `（1）`
- `单选题` / `多选题` / `判断题`
- 空行辅助

基本算法：

1. 逐行读取
2. 遇到新题起始则关闭上一题
3. 将当前行加入新题块
4. 最后统一 flush

### 6.3 字段抽取

每题抽取：

- `type`
- `stem`
- `options`
- `answer`
- `analysis`
- `difficulty`
- `raw_text`

### 6.4 题型识别

建议优先级：

1. 明确题型标签
2. 答案格式判断
3. 选项结构判断

### 6.5 异常题判定

满足以下任意条件可标记 `suspected`：

- 缺失答案
- 选项格式异常
- 题干过短
- 多选答案格式不合法
- 题号断裂明显

## 7. 去重方案

### 7.1 标准化规则

生成哈希前先做标准化：

1. 去题号
2. 去题型分数信息
3. 统一空白和标点
4. 转小写
5. 去掉多余元信息

### 7.2 去重策略

- 同题库重复：默认拦截
- 跨题库重复：仅提示

### 7.3 技术实现

建议用：

- Node 内置哈希或轻量哈希函数
- 将标准化文本写入 `normalized_hash`

## 8. 前端最小改造要求

虽然本阶段不做完整 UI 重构，但前端仍需要完成最小闭环。

需要新增：

- 导入步骤弹窗
- 预解析结果列表
- 异常题高亮
- 重复题开关
- 最终导入结果提示

推荐组件：

- `ImportSourceStep`
- `ImportPreviewStep`
- `ImportCommitStep`

## 9. 验收标准

本阶段完成后，应满足：

- 能导入单选和多选题
- 选项可结构化保存
- 至少能识别单选、多选、判断三类题型
- 用户可在入库前看到预览
- 可标记异常题和重复题
- 导入结果可追踪到批次

## 10. 建议拆分任务

1. 增加数据库迁移脚本
2. 新增 `question_options` 和 `import_batches`
3. 抽离导入解析器
4. 实现预解析接口
5. 实现确认入库接口
6. 前端增加导入预览
7. 增加导入结果报告

## 11. 阶段完成标志

当下面条件全部满足时，可认为阶段 1 完成：

- 新导入已不依赖旧的“直接文本入库”逻辑
- 题目和选项已分表存储
- 导入支持预览和确认
- 批次记录可查
- 基础题型识别稳定可用
