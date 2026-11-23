# IdeVcs — 跨平台 Git 桌面客户端需求

## 产品结论

| 项 | 决定 |
|---|---|
| 产品名 | IdeVcs |
| 定位 | 独立 Git 客户端（对标 Fork / SourceTree / GitKraken），交互参考 IDEA / OpenIDEA Git |
| 平台 | Windows / Linux / macOS |
| 技术栈 | Tauri + Rust + Vite/React/TS；读路径用 gitoxide (`gix`)，写路径用系统 `git` CLI |
| 参考源码 | `openidea/crates/ide-vcs`、`openidea/src/features/vcs`（只借鉴，不修改） |

## 非目标（首期）

- 不做完整 IDE（无语言服务、调试、构建）
- 不做 GitHub PR 全流程宿主
- 不做 Local History / Changelist / Shelf 完整复刻
- 不 fork OpenIDEA 整仓

## 功能优先级

### P0 — MVP

- 打开仓库 / Clone / Init / 最近仓库
- 文件状态（staged / unstaged / untracked / conflicted）
- Stage / Unstage / Discard（文件级）
- Diff、Commit / Amend / Sign-off
- Log、分支 Checkout / 新建 / 删除本地分支
- Fetch / Pull / Push
- 冲突高亮与 Continue / Abort（基础）
- 本机 `git` 检测；深色/浅色；中英文骨架

### P1 — IDEA 主流程体验

- Hunk / 行级暂存
- Log 过滤、Reset / Revert / Cherry-pick
- Stash、远程管理、Push 预览
- 内置并排 Diff、基础 Blame、IDEA 风格快捷键子集

### P2 — 深度能力（按需）

- 三方 Merge Editor、Rebase TODO 编辑器
- Patch、Compare Branches、Submodule / Worktree
- Shelve / Changelists / Local History、Forge 集成

## 信息架构

1. 左侧：Commit / Changes（变更树 + 消息 + 操作）
2. 中间/右侧：Diff
3. 底部或可切换：Git Log
4. 顶栏：Branch + Fetch/Pull/Push + 仓库路径
5. 欢迎页：最近仓库、Open、Clone、Init

## 技术架构

```
src/                 React UI
src-tauri/           Tauri 壳与 IPC
crates/git-core/     精简 Git 库（gix 读 + git CLI 写）
docs/requirements.md 本文档
```

- 读：`gix`（status / log / blame / diff）
- 写：`git` 子进程（commit / checkout / push / pull / stash…）
- IPC 结构化类型；`notify` 防抖刷新

## 验收标准（MVP）

- Win/Linux/macOS 可完成：查看变更 → 暂存 → 提交 → 推送 → 拉取 → 切分支 → 看历史 Diff
- Clone / Init 可用；hook 失败有可读错误；中等仓库 status/diff 不假死

## 风险

- 依赖系统 git；大仓库需异步；凭证交给 credential helper / ssh-agent；严格控制范围膨胀
