# LearnSkillsAssistant

通用技能训练平台——不是知识库，而是「大脑与肌肉反应的健身房」。

基于 Pimsleur 递增间隔回想（Graduated Interval Recall）与主动回想（Active Recall）理论，结合 AI 对话教练，帮助学生把「知道」的知识转化为「随时能调用」的技能：**情境化输入 → 强制主动输出 → 多场景泛化 → 严格间隔循环**。

- 平台策略：先做响应式 Web（PWA），后期支持移动 App
- AI 教练：经 LLM 抽象层接入（初期 Claude CLI，可切换其他模型）
- 登录：Microsoft / Google 账户
- 数据：存储抽象层，用户数据存于自己的云盘（OneDrive / Google Drive）或本地

📄 完整需求见 [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md)。
