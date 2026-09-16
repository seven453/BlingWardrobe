# 👗 Bling布灵电子衣橱 — AI 驱动的智能穿搭助手

![GitHub repo size](https://img.shields.io/github/repo-size/seven453/BlingWardrobe)
![GitHub last commit](https://img.shields.io/github/last-commit/seven453/BlingWardrobe)
![GitHub license](https://img.shields.io/badge/license-MIT-blue.svg)

Bling布灵电子衣橱是一款面向时尚爱好者的 AI 穿搭助手应用，集成了电子衣橱管理、智能搭配推荐、虚拟试穿、DIY 穿搭创作等功能。前端基于 React Native（Expo）构建，后端使用 FastAPI 提供 API 服务，并集成了 DeepSeek、阿里百炼、高德地图等多种 AI 能力。
> [!IMPORTANT]
> **版本说明：** 本仓库早期公开版本为基于 React Native + Expo 的移动端原型。目前项目已迭代并重构为微信小程序“Bling电子衣橱”，采用微信原生框架 + TypeScript 开发前端，并继续使用 FastAPI 提供后端服务。早期 React Native 代码仅用于展示项目演进过程，不代表当前线上版本。
---

## ✨ 功能特性

- **📱 电子衣橱** – 拍照/相册添加衣物，自动按「上装 / 下装 / 鞋子」分区展示，支持删除与备注。
- **🧠 AI 智能推荐** – 结合天气、用户偏好与风格知识库（RAG），生成“上衣 + 下装 + 鞋子”的搭配建议，支持一键应用。
- **🎨 风格 & 场景切换** – 在搭配页面可临时选择风格（简约 / 通勤 / 法式等）与场景（日常 / 约会 / 运动等），推荐实时调整。
- **👗 虚拟试穿** – 上传全身照与衣物图，调用阿里百炼 `aitryon` 模型生成试穿效果图，支持从衣橱多件选衣。
- **📝 DIY 穿搭工坊** – 从衣橱选衣自动抠图，在无限画布上自由拖拽组合，添加文字，创作穿搭灵感图并保存。
- **📊 穿搭记录 & 压箱底提醒** – 自动统计每件衣物的穿着频率，提醒长期未穿的“压箱底”衣物，帮你盘活衣橱。
- **☁️ 云端部署** – 后端可部署至阿里云 ECS，前端可构建独立 APK，无需依赖 Expo Go。

---

## 🛠️ 技术栈

| 类别 | 技术 |
|------|------|
| 前端框架 | React Native + Expo (TypeScript) |
| 导航 | React Navigation |
| 状态/存储 | React Hooks + AsyncStorage |
| 网络请求 | Axios |
| 画布 & 交互 | react-native-skia-board, react-native-gesture-handler |
| 图像处理 | expo-image-picker, expo-media-library, rn-remove-image-bg |
| 后端框架 | FastAPI (Python 3.10+) |
| 服务器 | Uvicorn |
| AI 集成 | DeepSeek (推荐), 阿里百炼 aitryon (试穿), 高德地图 (天气) |
| 向量数据库 | ChromaDB + sentence-transformers (RAG) |
| 部署 | 阿里云 ECS (Ubuntu 22.04) |

---

## 🚀 快速开始

### 1️⃣ 克隆项目

```bash
git clone https://github.com/seven453/BlingWardrobe.git
cd BlingWardrobe
```

项目包含两个主要目录：
- `BlingMirror/` – 前端（React Native + Expo）
- `BlingMirror-backend/` – 后端（FastAPI）

---

### 2️⃣ 启动后端

#### 安装依赖
```bash
cd BlingMirror-backend
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt
```

#### 配置环境变量
在项目根目录创建 `.env` 文件（或直接设置系统环境变量），填入以下内容：

```bash
DEEPSEEK_API_KEY=你的DeepSeek密钥
DASHSCOPE_API_KEY=你的阿里百炼密钥
AMAP_API_KEY=你的高德地图Web服务密钥
```

#### 运行服务
```bash
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```
后端默认监听 `http://localhost:8000`，可通过 `http://你的公网IP:8000/weather?lat=30.67&lon=104.06` 测试。

---

### 3️⃣ 启动前端

#### 安装依赖
```bash
cd ../BlingMirror
npm install
# 或使用 yarn
```

#### 启动 Expo 开发服务器
```bash
npx expo start --lan
```
用手机扫描二维码（需安装 Expo Go App），或在模拟器中运行。

#### 构建独立 APK（可选）
```bash
npx eas build --platform android --profile preview
```
构建完成后会获得可安装的 APK 文件。

---

## 🧩 主要 API 接口

| 接口 | 方法 | 功能 |
|------|------|------|
| `/weather` | GET | 根据经纬度获取实时天气与穿搭建议 |
| `/ai-recommend` | POST | 获取 AI 搭配推荐（支持用户偏好与 RAG） |
| `/tryon/` | POST | 虚拟试穿（上传全身照 + 衣物图） |
| `/ping` | GET | 健康检查 |

详细的请求/响应格式请参考代码注释或 Postman 文档（待补充）。

---

## 📁 项目结构（核心）

```
BlingWardrobe/
├── BlingMirror/               # 前端
│   ├── App.tsx                # 主应用
│   ├── components/            # 可复用组件（含 DIYCanvas）
│   ├── utils/                 # 工具函数（含抠图）
│   ├── package.json
│   └── eas.json               # EAS 构建配置
├── BlingMirror-backend/       # 后端
│   ├── main.py                # FastAPI 入口
│   ├── ai_service.py          # AI 推荐（DeepSeek + RAG）
│   ├── virtual_tryon.py       # 虚拟试穿接口
│   ├── knowledge/             # RAG 知识库源文件（风格/场景 txt）
│   ├── knowledge_db/          # ChromaDB 向量数据库
│   └── requirements.txt
└── README.md
```

---

## 🧪 测试与调试

- **前端调试**：使用 Expo Dev Tools，支持 Chrome 远程 JS 调试。
- **后端调试**：使用 `uvicorn --reload`，代码改动自动重启。
- **API 测试**：推荐使用 Postman 或 `curl` 直接测试接口。

---

## 🤝 贡献

欢迎提交 Issue 和 Pull Request。在提交前请确保：
- 代码风格与项目一致
- 新增功能有完善的错误处理
- 不引入新的安全风险

---

## 📄 许可证

本项目采用 MIT 许可证，详情参见 [LICENSE](LICENSE) 文件。

---

## 📬 联系

- 作者：seven453
- 项目主页：https://github.com/seven453/BlingWardrobe
- 如有问题，请提交 Issue 或通过 GitHub 联系。

---

**Star ⭐️ 这个项目，让它帮助更多人打理自己的衣橱！**
```
