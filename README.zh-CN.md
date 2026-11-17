# cocloud

最新通用功能更新与部署差异见 [同步说明](docs/SYNC-NOTES.zh-CN.md)。

基于 T3 Code 的自托管编程工作台集成与扩展项目，包含网页工作台、Android 客户端、记忆服务、共享浏览器和项目导入服务。

## 鸣谢 T3 Code

**cocloud 是在 [T3 Code（t3code）](https://github.com/pingdotgg/t3code) 基础上进行二次开发的项目。** 核心工作台及 Codex app-server 接入来自 T3 Code；本项目在此基础上做集成、适配与功能扩展。感谢 T3 Code 作者和贡献者的开源工作。

如果你喜欢 cocloud，也请前往 **[T3 Code 上游仓库](https://github.com/pingdotgg/t3code)**，为原项目点亮一颗 **Star ⭐**，支持它继续发展。

## 项目介绍

**Codex 的实力，你的工作方式。自由定制 · 云端常驻 · 手机也能交付。**

cocloud 希望把强大的代理执行能力和可定制的使用体验放进同一个工作台。项目、会话和运行环境集中在自己的服务器上，电脑与手机负责交代需求、接续工作和查看成果。

### 强大，也能按你的习惯来

在已有工作台上改界面、加工具、接工作流，把自己在意的细节放进日常使用中。本仓库维护记忆服务、移动端手势、文件下载、共享浏览器与项目导入等扩展；也可以继续按自己的需求开发。

### 换台电脑，工作不用重来

工作环境和项目留在服务器，换一台完成配对的电脑，仍然访问同一套工作台与会话。任务执行取决于服务器和相应服务的运行状态；长期使用可配置服务管理，让工作环境持续可用。

### 手机交代，云端把事办好

通过移动网页或 Android 客户端发起任务、补充要求、查看文件和成果。配置相应的浏览器与自动化工具后，让代理操作网页、执行检查、运行测试并整理报告，再在手机上查看、提出修改并验收。

文生图是其中一种可扩展的工作方式：接入自己的生图工具后，在手机上说出海报需求，由云端调用工具生成图片，手机查看原图、继续修改并下载成果。生图工具、模型服务及其凭据需要自行配置。

![cocloud 云端工作台宣传海报：自由定制、跨电脑接续、手机发起任务与查看交付](docs/assets/cocloud-poster.png)

[查看海报原图](docs/assets/cocloud-poster.png) · [开始安装](#先运行核心工作台)

海报中的余额卡片用于展示定制思路，开源版不附带原部署的账户和余额服务。图中金额、速度和案例内容不代表真实账户数据或性能承诺。已包含的模块和配置要求见下文。

**工作在云端，主动权在手中。** 如果你也需要这样的工作方式，欢迎给 [cocloud](https://github.com/rickinkaffee/cocloud) 点一个 **Star**，或通过 Issues / Pull Requests 参与改进。

## 项目来源与贡献范围

- 核心网页和服务端框架来自 [T3 Code](https://github.com/pingdotgg/t3code)，基线为 v0.1.8，提交 `bf469bb19669671d0df2efda74ed73867a7137c0`。T3 Code 已经包含 Codex app-server 接入，这部分属于上游实现。
- Codex 是上游代理运行时；本项目不宣称原创 Codex、模型或 T3 Code 框架。
- 本发行版额外维护 Android 客户端、记忆服务集成、共享浏览器网关、项目导入及移动端交互改造。记忆引擎 Hindsight、浏览器库 FloeBrowser 和 Ionic 等组件仍属于各自上游。
- 项目定位是集成、二次开发与扩展。新增代码可以有独立的工程贡献，但整套项目不应描述成“完全从零原创”。

许可证见 [LICENSE](LICENSE)，依赖及署名见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) 和 [DEPENDENCIES.json](DEPENDENCIES.json)。本仓库的 MIT 许可不替代依赖自身的许可与服务条款。受限的 TypeScript Claude Agent SDK、Cursor SDK 集成已从此发行版移除。

## 先运行核心工作台

以下是源码安装流程，当前没有一键安装器。先运行核心，再按需配置扩展。

准备 Linux、Git、Node.js 26（仓库指定 26.12.1）和 pnpm 12.14.0。原生依赖在缺少预编译包时可能需要系统编译工具链。还需按 [上游运行说明](core/README.md) 准备你自己的代理运行时及登录；本仓库不附带任何账号、订阅或模型额度。

```sh
git clone https://github.com/rickinkaffee/cocloud.git
cd cocloud/core
pnpm install --frozen-lockfile
sh ../scripts/build-core.sh
node apps/server/dist/bin.mjs serve \
  --base-dir "$HOME/.local/share/cocloud" \
  --host 127.0.0.1 --port 3773 --no-browser
```

`build-core.sh` 会依次构建网页与服务端，并将网页资源打包进服务端。构建应放在有足够空闲内存的机器或限制资源的独立容器/服务中，避免挤占正在使用的工作台。该脚本关闭网页 source map 并限制部分构建并发，但本身不设置系统内存上限。

`--base-dir` 是新安装自己的私有数据目录，应放在仓库外，确保运行用户可写。首次启动会生成全新的状态和配对信息，不会带入原部署的聊天、项目、密钥或账号。

### 打开与首次使用

1. 本机运行时，在浏览器打开 `http://127.0.0.1:3773`，按终端提示完成配对。配对信息属于你这次安装的私密凭据，不要放进 GitHub。
2. 如果运行在远程服务器，先在本地电脑建立 SSH 隧道：`ssh -N -L 3773:127.0.0.1:3773 your-user@your-server`，再用本地浏览器打开上述地址。将占位用户名、服务器名替换成自己的值。
3. 在工作台的 Settings 中配置并确认代理可用。订阅登录和 API 凭据由你自己提供；服务进程必须能找到代理可执行文件。
4. 创建或选择一个项目，指向服务器上你自己的项目目录，再新建会话开始使用。项目路径是服务器上的路径。
5. 需要长期运行时，为启动命令配置自己的服务管理；需要跨设备访问时，配置自己的 HTTPS 域名及反向代理，再用新设备配对。

停止前台服务用 `Ctrl+C`。以后用相同的 `--base-dir` 启动即可继续使用自己的状态。更新源码后重新安装锁定依赖并构建；更新前备份自己的数据目录。

## 按需启用扩展

扩展源码已包含，但启动核心工作台不会自动启动它们。记忆、共享浏览器入口只有在对应服务和反向代理配置完成后才能使用。详细路径、环境变量和命令见 [英文部署说明](README.md#extensions)。

| 扩展 | 安装与使用入口 |
| --- | --- |
| 记忆 | 创建独立 Python 虚拟环境，安装 `extensions/memory/requirements.lock`；按 `config/memory.env.example` 配置自己的模型和数据目录，加载环境变量后运行 `initialize.py`。部署引擎、API、网关及后台 worker，再代理 `/memory/` 和 `/api/cocloud/memory/`。 |
| 共享浏览器 | 在 `extensions/browser` 运行 `npm ci`，按 FloeBrowser 要求安装浏览器运行环境；创建新的私有 profile/run 目录，配置自己的 `WORKBENCH_ORIGIN`，启动 `source.mjs`、`gateway.mjs`，代理 `/floe/` 和 `/session/`（支持 WebSocket）。 |
| 项目导入 | 设置自己的空工作目录 `WORKBENCH_PROJECTS`、工作台地址及来源域名，运行 `extensions/project-import/project-import-server.mjs`，代理 `/api/cocloud/imports*`。这是需要认证的服务接口。 |
| Android | 准备 Android SDK 35、JDK 17 和说明中要求的工具链目录，用自己的 HTTPS 域名设置 `WORKBENCH_ORIGIN`，运行 `extensions/android/build.py`。构建生成自己的签名身份，签名材料必须保存在仓库外；安装前自行完成真机验收。 |

记忆默认从新数据目录下的空导入目录读取。只有显式设置 `MEMORY_WORKBENCH_DB`、`MEMORY_CODEX_SESSIONS` 等来源路径，才会索引相应历史。是否接入个人记忆和哪些项目，由新安装的使用者自行选择。

`/opt/open-workbench*`、`/var/lib/open-workbench*` 是当前扩展代码与服务模板使用的通用部署路径，保留这些路径可以直接对应英文说明。仓库改名为 cocloud 不会自动改变这些路径；如需更改，应同步调整配置和服务模板。

## 验证范围

公开源码已完成前后端构建与类型检查、空目录服务启动、Android 源码构建与签名检查、手势、记忆、网关和项目导入相关回归。复现命令见 [Validation](README.md#validation)。Android 真机体验及使用你自己的真实模型账号，需要在自己的部署环境验证。

## 服务器代理开关与连接测速

新增[代理设置扩展](extensions/proxy/README.md)：侧栏左右滑动开关，仅检测
Google／GitHub 的连接延迟，不做下载测速。使用 `config/proxy.env.example` 配置
自己的本地代理、systemd 服务及工作台地址。仓库不附订阅、节点、凭据或代理程序。
前端需重新构建；认证控制服务独立部署。


## 文件上传与连接中心

本轮已同步上传位置选择、同名文件跳过／覆盖／保留、断点续传、超时重试、
覆盖冲突范围修复、文件下载／属性、项目图标移除及 MCP 退出清理。
侧栏“上传文件夹”选择当前服务器的已注册项目；使用
`config/project-import.env.example` 配置独立上传服务，见
[文件传输部署说明](extensions/project-import/README.md)。
连接中心整合代理、授权数量和微信状态；设备管理使用原有授权设置页面。
[微信网关](extensions/wechat/README.md)为可选接入，需要自行提供兼容 API、
noVNC 桌面及账号，仓库不附带运行实例。细节和边界见
[同步说明](docs/SYNC-NOTES.zh-CN.md)与[附件下载说明](docs/DOWNLOADS.md)。


连接中心现支持 GitHub 网页登录、登录配置及连接状态展示。登录、检测和
[受管 Git/gh 命令](extensions/proxy/README.md#github-login-and-temporary-connectivity)
会临时使用代理并自动恢复；原先开启的代理保持开启，开机设置不变。
