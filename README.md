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

`pi-web-verbs` 是可选的 Web 自动化扩展，不属于 Coding Agent 核心；它可以通过免费的自托管 SearXNG 检索网页，再调用站点 Verb 执行操作。

## 安装方法

需要 Node.js 22.19 或更高版本。

```bash
git clone https://github.com/A6y55/coding-agent.git
cd coding-agent
npm ci --ignore-scripts --no-audit
npm_config_cache="/tmp/pi-coding-agent-ctx7-$UID" npx -y ctx7@latest login
```

Context7 匿名访问可用，但登录后具有更高额度；非交互环境也可以设置 `CONTEXT7_API_KEY`。本项目只调用 Context7 CLI，不安装 MCP server。

`agent:isolated` 使用本仓库的 `.pi` 配置目录，不读取或修改 `~/.pi/agent`，因此不会与其他 Pi Agent 的系统提示词、Preset、Subagent 和扩展配置混合。

可选安装 Web Verbs：

```bash
PI_CODING_AGENT_DIR="$PWD/.pi" ./node_modules/.bin/pi install "$PWD/packages/pi-web-verbs" --no-approve
export PI_WEB_VERBS_SEARXNG_URL="http://127.0.0.1:8080"
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
