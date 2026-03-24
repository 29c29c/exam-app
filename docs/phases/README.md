# 分阶段开发文档

这里是从总方案文档拆分出来的阶段性实施文档。

保留的总文档：

- [development-plan.md](/Users/29c/Desktop/2333/project/ing/exam-app/docs/development-plan.md)

阶段拆分说明：

- 阶段 1 聚焦底层数据结构与导入闭环，这是后续所有能力的基础
- 阶段 2 聚焦前端模块化和资源管理，把“原型界面”升级为“可维护界面”
- 阶段 3 聚焦学习流程和 AI 能力，让做题体验形成完整闭环
- 阶段 4 聚焦导出、回收站、测试和运维，把项目补齐到可持续维护状态
- 阶段 5 聚焦 AI Markdown 题库导入兼容，提升常见大模型输出的可导入性

文档列表：

- [phase-1-data-import.md](/Users/29c/Desktop/2333/project/ing/exam-app/docs/phases/phase-1-data-import.md)
- [phase-2-frontend-management.md](/Users/29c/Desktop/2333/project/ing/exam-app/docs/phases/phase-2-frontend-management.md)
- [phase-3-learning-ai.md](/Users/29c/Desktop/2333/project/ing/exam-app/docs/phases/phase-3-learning-ai.md)
- [phase-4-quality-ops.md](/Users/29c/Desktop/2333/project/ing/exam-app/docs/phases/phase-4-quality-ops.md)
- [phase-5-ai-markdown-import.md](/Users/29c/Desktop/2333/project/ing/exam-app/docs/phases/phase-5-ai-markdown-import.md)

建议执行顺序：

1. 先完成阶段 1
2. 阶段 1 稳定后推进阶段 2
3. 阶段 2 完成后推进阶段 3
4. 阶段 4 可穿插执行，但建议在前 3 个阶段主链路稳定后集中补齐
5. 阶段 5 建议在阶段 1 的导入链路稳定后执行，可与阶段 4 的测试补齐协同推进
