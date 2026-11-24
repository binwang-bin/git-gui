# IdeVcs

[English](README.md) | **简体中文**

跨平台 Git 桌面客户端，交互参考 IntelliJ IDEA / OpenIDEA。  
面向日常单仓工作流：本地更改、提交、日志/拓扑图、同步、冲突解决、Stash、更改列表、搁置（Shelve）、交互式变基。

![License](https://img.shields.io/badge/license-Apache--2.0-blue)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey)
![Stack](https://img.shields.io/badge/Tauri%202-React%20%2B%20Rust-orange)

## 功能

- **仓库**：打开 / 克隆 / 初始化、最近列表、多窗口
- **提交工具窗**：暂存 / 取消暂存 / 丢弃、Amend、Sign-off、勾选提交
- **Diff**：并排 / 统一视图，hunk 与行级暂存
- **日志与图**：虚拟列表、分支图、筛选（用户 / 日期 / 路径 / 关键字 / 分支）
- **分支与远程**：新建 / 重命名 / 删除 / 切换，合并与变基到，远程增删改
- **同步**：Fetch / Pull / Push（含 force）、待推送提交预览
- **历史操作**：Cherry-pick、Revert、Reset（soft / mixed / hard）
- **冲突**：自动打开合并编辑器、多文件切换、Continue 前校验、接受 Ours/Theirs
- **合并编辑器**：CodeMirror 6 + `@codemirror/merge`（OpenIDEA 式三窗格）
- **Stash**：按路径储藏，apply / pop / drop / clear，文件预览
- **更改列表（Changelists）**：多列表、移动文件、活动列表（按仓库持久化）
- **搁置（Shelve）**：基于 patch，保存在 `.git/idevcs/shelf/`
- **交互式变基**：计划界面（pick / reword / edit / squash / fixup / drop / 重排）
- **其它**：Blame、写入 `.gitignore` / exclude、复制 Patch、深色/浅色、中英文

## 下载

Windows 安装包（执行 `tauri build` 后）：

| 类型 | 路径 |
|------|------|
| MSI | `target/release/bundle/msi/IdeVcs_0.1.0_x64_en-US.msi` |
| 安装程序 (.exe) | `target/release/bundle/nsis/IdeVcs_0.1.0_x64-setup.exe` |
| 可执行文件 | `target/release/git-gui.exe` |

> 运行环境需要系统已安装 **`git`**，并加入 `PATH`。

## 环境要求

- [Node.js](https://nodejs.org/) 18+
- [Rust](https://rustup.rs/) 稳定版工具链
- 系统 [Git](https://git-scm.com/)（在 `PATH` 中）
- Windows 打安装包时：Tauri 所需的 WiX（MSI）与 NSIS（setup.exe）

## 开发

```bash
npm install
npm run tauri:dev
```

## 构建

```bash
# 完整发布包（Windows 上含 MSI + NSIS）
npm run tauri:build

# 仅生成应用二进制（不打安装包）
npx tauri build --no-bundle
```

产物位置：

- 二进制：`target/release/git-gui.exe`（Windows）
- MSI：`target/release/bundle/msi/`
- NSIS：`target/release/bundle/nsis/`

## 架构

```
IdeVcs
├── src/                 # React + TypeScript 界面（Zustand）
├── src-tauri/           # Tauri 2 壳与 IPC
└── crates/git-core/     # Git 集成
    ├── gix (gitoxide)   # 仓库发现等读路径
    └── git CLI          # status / log / diff / blame 与全部写操作
```

变更类操作统一走系统 `git` CLI，以便 hooks、凭据与签名行为与命令行一致。

## 后续方向（摘要）

相对 IDEA / OpenIDEA 仍待加强的能力包括：

- Tags、Worktree、Submodule
- 更完整的 Push / Sync 目标选择与检查
- Undo Commit / Reword、GPG 签名配置界面
- Shelve 与交互式变基的深度打磨
- 多根仓库 / 项目级更新计划

## 许可证

[Apache-2.0](LICENSE)（见工作区 `Cargo.toml` 中的 license 字段）。

## 致谢

交互与合并/日志等设计借鉴了 OpenIDEA 风格的 Git 体验。本地若存在 `openidea/` 参考树，仅供对照学习，本项目不会修改该目录。
