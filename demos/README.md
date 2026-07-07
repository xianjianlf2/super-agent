# demos

第 7 章的实战示例。旗舰示例「浏览器直跑 TSX」放在仓库根的 `app/`（`start_preview` 默认服务它）；这里归档另外两个网页样例。

用 `start_preview` 指定 `root` 即可单独预览：

```
# 在 pnpm start 的对话里让 Agent 跑，或直接说：
启动预览，root 设为 demos/vibe-todo
```

| 目录 | 说明 | 产生方式 |
|---|---|---|
| `../app/` | 浏览器直跑 TSX（importmap + Babel Standalone + 手写加载器，无 build） | 手写，本章精髓 |
| `vibe-todo/` | 待办事项网页（原生 HTML/CSS/JS） | Vibe Coding demo，Agent 生成 |
| `landing/` | Super Agent 工具列表落地页 | 早期 start_preview 示例 |

> 三个「代码分析 / Research / Vibe Coding」demo 本身不需要单独脚本，都是在 `pnpm start` 的对话里输入不同任务触发的。详见根 README 第 7 章。
