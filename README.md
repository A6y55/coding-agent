# Pi Coding Agent

## 功能介绍

基于 Pi Extension API 构建的 Coding Agent，不修改 Pi 核心。主要能力包括：

- Plan Mode：只读探索、计划确认和步骤跟踪；
- Subagent：使用独立上下文执行规划、检索、开发和审查任务；
- 本地或 SSH 开发：远程切换 `read`、`write`、`edit` 和 `bash`；
- Sandbox 与 Permission Gate：隔离命令并确认删除、提权、远程写入等高风险操作；
- Git Checkpoint：在执行和运行时更新前保存快照，支持回滚；
- Runtime Reload：修改扩展后在当前会话重新加载；
- Custom Compaction、Structured Output 和 Preset：保存任务状态并切换规划、开发、测试和审查模式。
- Context7 CLI + Skill：按需检索最新开发文档，不使用 MCP。
- CI/CD：自动执行类型检查、测试和打包，并通过版本 Tag 创建 GitHub Release。

`pi-web-verbs` 是辅助 Web 自动化扩展；它通过 Playwright 浏览器免费检索网页，并以类型化 Verb 执行站点操作。Coding Agent 的独立系统提示词会将代码检索、Context7 文档查询和 Web Verb 网页操作路由到对应工具。

## 安装方法

需要 Node.js 22.19 或更高版本、Git 和 Python 3。Sandbox 的系统依赖因操作系统而异。

### macOS

macOS 使用系统自带的 `sandbox-exec`，额外安装 `ripgrep` 即可。使用 Homebrew 安装前置依赖：

```bash
brew install git node python ripgrep
```

### Linux

Linux Sandbox 需要 `ripgrep`、`bubblewrap` 和 `socat`。Debian/Ubuntu 使用：

```bash
sudo apt update
sudo apt install -y git python3 python3-venv ripgrep bubblewrap socat
```

发行版软件源中的 Node.js 版本可能低于要求，请通过 Node.js 官方发行版或版本管理器安装 Node.js 22.19 或更高版本。其他 Linux 发行版请安装提供 `rg`、`bwrap` 和 `socat` 命令的同名软件包。

安装后可以检查 Sandbox 依赖：

```bash
rg --version
bwrap --version
socat -V
```

### 通用步骤

```bash
git clone https://github.com/A6y55/coding-agent.git
cd coding-agent
npm ci --ignore-scripts --no-audit
npm_config_cache="/tmp/pi-coding-agent-ctx7-$UID" npx -y ctx7@latest login
python3 -m venv .pi/web-verbs/venv
.pi/web-verbs/venv/bin/python -m pip install playwright==1.52.0
```

Context7 匿名访问可用，但登录后具有更高额度；非交互环境也可以设置 `CONTEXT7_API_KEY`。本项目只调用 Context7 CLI，不安装 MCP server。

`agent:isolated` 使用本仓库的 `.pi` 配置目录，不读取或修改 `~/.pi/agent`，因此不会与其他 Pi Agent 的系统提示词、Preset、Subagent 和扩展配置混合。

启动器会优先使用系统安装的 Chrome 或 Chromium。系统没有可用浏览器时安装 Playwright Chromium：

```bash
.pi/web-verbs/venv/bin/python -m playwright install chromium
```

## 使用方法

进入需要开发的任务目录并启动：

```bash
cd /path/to/task
npm --prefix /path/to/coding-agent run agent:isolated
```

`/path/to/coding-agent` 是本 Agent 仓库的安装路径。npm script 会保留发起命令时的任务目录，并默认忽略该目录中的 `.pi/SYSTEM.md`、`.pi/settings.json` 和 `.pi` 扩展。任务目录中的 `AGENTS.md` 与 `CLAUDE.md` 仍作为项目开发约束加载。首次使用独立配置时，在 Agent 内执行 `/login`。

常用命令：

```text
/plan                 进入或退出规划模式
/preset develop       切换到开发模式
/preset test          切换到测试模式
/preset review        切换到审查模式
/reload-runtime       创建 checkpoint 并重新加载运行时
/rollback-runtime     回滚到最近一次运行时更新前的 checkpoint
```

通过 SSH 在远程任务目录工作：

```bash
npm --prefix /path/to/coding-agent run agent:isolated -- --ssh user@host:/remote/task
```
