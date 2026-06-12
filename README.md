# AI Voice Drawing Tool

纯语音控制的绘图工具。用户不能使用鼠标或键盘，仅通过语音指令完成图形绘制创作。

系统通过 Web Speech API 识别语音，经过同音字纠错后，由 LLM（DeepSeek / 通义千问 / 智谱 GLM）以 Function Calling 方式输出结构化绘图指令，最终在 Fabric.js 画布上执行绘制。

## 功能特性

- **语音驱动绘图**：说出指令即可创建、修改、删除图形，支持圆、矩形、三角形、椭圆、线段、五角星等
- **复合对象绘制**：说"画一个房子"、"画一朵花"、"画一个太阳"，LLM 自动分解为多个基本图形组合
- **多模型故障转移**：DeepSeek（优先）→ 通义千问 → 智谱 GLM，自动降级，保证可用性
- **双层 ASR 纠错**：pinyin-pro 客户端词典 + LLM 上下文理解，解决语音识别同音字问题
- **智能目标定位**：通过画布状态注入，LLM 可精确定位"红色的圆"、"最大的矩形"等目标
- **指令历史面板**：实时展示每条指令的识别结果、系统理解和执行状态

## 技术栈

| 层级 | 选型 |
|------|------|
| 前端框架 | Vite 6 + React 18 + TypeScript |
| 绘图引擎 | Fabric.js v6 |
| 语音识别 | Web Speech API（浏览器原生） |
| 指令解析 | OpenAI 兼容 API + Function Calling |
| 文本纠错 | pinyin-pro（拼音匹配） |
| LLM 提供商 | DeepSeek / 通义千问 / 智谱 GLM |

## 快速开始

### 环境要求

- Node.js >= 18
- Chrome / Edge（Web Speech API 支持）

### 安装与运行

```bash
# 克隆项目
git clone git@github.com:Somehow007/ai-draw.git
cd ai-draw

# 安装依赖
npm install

# 配置 API Key（至少配置一个）
cp .env.example .env
# 编辑 .env 文件，填入你的 API Key

# 启动开发服务器
npm run dev
```

浏览器访问 `http://localhost:5173`，点击麦克风按钮开始语音绘图。

### API Key 配置

在项目根目录创建 `.env` 文件：

```env
VITE_DEEPSEEK_API_KEY=your-deepseek-key
VITE_QWEN_API_KEY=your-qwen-key
VITE_ZHIPU_API_KEY=your-zhipu-key
```

至少配置一个即可使用。系统按 DeepSeek → 千问 → 智谱 的优先级自动故障转移。

## 语音指令示例

### 基础指令

| 指令 | 效果 |
|------|------|
| "画一个红色的圆" | 在画布中心创建红色圆形 |
| "画两个绿色的梯形" | 创建两个绿色梯形 |
| "在右上角画一个蓝色矩形" | 定位到右上角创建蓝色矩形 |
| "画一个大的黄色五角星" | 创建大号黄色星形 |

### 修改指令

| 指令 | 效果 |
|------|------|
| "把圆形改成绿色" | 修改圆形颜色 |
| "把矩形放大两倍" | 缩放矩形 |
| "删掉三角形" | 删除三角形 |

### 复合指令

| 指令 | 效果 |
|------|------|
| "画一个房子" | 矩形墙体 + 三角形屋顶 + 门窗 |
| "画一朵花" | 花蕊 + 花瓣 + 花茎 + 叶子 |
| "画一个太阳" | 黄色圆形 + 放射状线段 |
| "画一棵树" | 矩形树干 + 多个椭圆/圆形树冠 |

### 控制指令

| 指令 | 效果 |
|------|------|
| "清空画布" | 清除所有图形 |
| "撤销" | 回退上一步操作 |
| "画布上有几个图形" | 查询图形数量 |

## 项目结构

```
ai-draw/
├── src/
│   ├── App.tsx                    # 主组件：语音流程 + LLM 集成 + 日志
│   ├── App.css                    # 全局样式 + 布局
│   ├── main.tsx                   # 入口
│   ├── types/
│   │   └── drawing.ts             # 类型定义（ShapeType, CanvasObject 等）
│   ├── components/
│   │   ├── CanvasPanel.tsx        # Fabric.js 画布封装（响应式 + 命令式 API）
│   │   ├── VoiceButton.tsx        # 语音按钮（状态可视化）
│   │   └── CommandHistory.tsx     # 指令历史面板
│   └── services/
│       ├── speech.ts              # Web Speech API 封装
│       ├── llm.ts                 # 多模型故障转移 + 工具定义
│       └── textCorrection.ts      # 双层 ASR 同音字纠错
├── DESIGN.md                      # 设计开发方案（完整技术文档）
├── vite.config.ts                 # Vite 配置 + LLM 代理转发
└── .env                           # API Key（不纳入版本控制）
```

## 架构概览

```
用户语音 → Web Speech API → 双层 ASR 纠错 → L0 快判（清空/撤销）
                                               ↓ 未命中
                                        LLM Function Calling
                                        (DeepSeek → 千问 → 智谱)
                                               ↓
                                     结构化绘图指令（tool calls）
                                               ↓
                                   Fabric.js 画布执行 + 坐标修正
```

## 开发阶段

| 阶段 | 状态 | 内容 |
|------|------|------|
| Phase 0 | ✅ 完成 | 项目骨架 + Fabric.js 画布 + Web Speech API + 关键词绘图 |
| Phase 1 | ✅ 完成 | LLM Function Calling + ASR 纠错 + 复合对象 + 调试日志 |
| Phase 2 | 待开发 | 复合指令 + 空间关系推理 + 查询指令 + 目标确认 |
| Phase 3 | 待开发 | 演示优化 + Whisper 备选 + 流式输出 + UI 美化 |
| Phase 4 | 可选 | 场景化绘图 / 智能纠错引导 |

## 调试

浏览器 DevTools Console 中过滤 `[AI-Draw]` 可查看所有结构化日志：

- `[语音识别]` — ASR 原始文本
- `[文本纠错]` — 纠错前后对比
- `[LLM请求]` — 画布状态
- `[LLM响应]` — 模型提供商、消息内容、工具调用详情
- `[执行结果]` — 工具执行汇总
- `[LLM调用]` — 完整错误信息

## License

MIT
