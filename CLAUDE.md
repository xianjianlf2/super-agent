# super-agent — Claude Code 项目规则

## Commit 规范

格式遵循 `.gitmessage` 模板：`<type>(<scope>): <subject>`

可用 scope：`core` / `tools` / `agent-loop`

## README 维护

每次 commit 前，如果改动涉及以下任一情况，必须同步更新 `README.md` 和 `README.en.md`：

- 新增或删除章节对应的功能（更新章节表的 commit hash）
- 新增或删除 `src/` 下的文件（更新项目结构）
- 新增或修改 `pnpm` 脚本（更新快速开始部分）

`README.md` 为中文主版本（GitHub 默认展示），`README.en.md` 为英文版，内容保持同步。
