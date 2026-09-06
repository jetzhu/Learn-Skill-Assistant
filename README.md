# LearnSkillsAssistant

通用技能训练平台——不是知识库，而是「大脑与肌肉反应的健身房」。

基于 Pimsleur 递增间隔回想（Graduated Interval Recall）与主动回想（Active Recall）理论，结合 AI 对话教练，帮助学生把「知道」的知识转化为「随时能调用」的技能：**情境化输入 → 强制主动输出 → 多场景泛化 → 严格间隔循环**。

- 目标市场：首要——美国学中文的学生（首发示例技能包：Chinese for English Speakers）；次要——中国学英文的学生（英语口语句型包）
- 平台策略：先做响应式 Web（PWA），后期支持移动 App
- AI 教练：经 LLM 抽象层接入（初期 Claude CLI，可切换其他模型；支持用户自带 Token 与模型 BYOT）
- 登录：Microsoft / Google 账户
- 数据：存储抽象层，用户数据存于自己的云盘（OneDrive / Google Drive）或本地

📄 文档：[需求 REQUIREMENTS.md](docs/REQUIREMENTS.md)（v0.7，经六轮专家评审 + 四项技术验证）· [设计 DESIGN.md](docs/DESIGN.md) · [示例技能包选材 SKILL_PACKS_V1.md](docs/SKILL_PACKS_V1.md) · 技术验证代码与数据见 [spikes/](spikes/)。

## 运行（MVP，开发者自用）

```bash
pnpm install
pnpm test                      # 全仓测试
pnpm --filter @lsa/server dev  # BFF：http://127.0.0.1:8787（仅 loopback）
pnpm --filter @lsa/web dev     # Web：http://localhost:5173（/api、/auth 代理到 BFF）
```

- **离线训练闭环**（键盘/自评/语音作答、体验会话、streak、掌握度地图）开箱即用，无需任何配置；
- **AI 教练** 需要本机安装 Claude CLI（仅开发者自用，F8.2）；
- **Microsoft 登录 + OneDrive 同步** 需要 Azure 应用注册：复制 `apps/server/.env.example` 为 `.env` 并填 `MS_CLIENT_ID`（个人账户 + 重定向 URI `http://localhost:5173/auth/microsoft/callback`）。

```
packages/core            调度引擎（重放/编排/运行时/streak，31 测试）
packages/content-packs   内置双技能包（中文入门 42 卡 + 英语口语 42 卡）
packages/providers/*     Storage / LLM / Auth / Content 四个抽象层
apps/web                 React PWA（训练、教练、同步、遥测门控）
apps/server              Fastify BFF（OAuth 令牌保管、Graph 代理、Claude CLI 代理、遥测）
```
