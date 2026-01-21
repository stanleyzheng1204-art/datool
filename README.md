# 数据分析工具

一个功能完整的数据分析与画像应用，支持多格式数据处理和智能分析。

## 功能特性

- ✅ 支持 CSV、Excel、JSON 格式数据上传
- ✅ 数据预览、筛选、聚合功能
- ✅ 智能画像分析（支持豆包大语言模型）
- ✅ 多种格式分析报告导出（Excel、HTML、Word）
- ✅ 正态分布检验
- ✅ 数据可视化图表

## 本地开发

```bash
# 安装依赖
pnpm install

# 启动开发服务器
pnpm run dev

# 访问 http://localhost:5000
```

## 部署到 Cloudflare Pages

### 1. 推送代码到 GitHub

```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/你的用户名/你的仓库名.git
git push -u origin main
```

### 2. 连接 Cloudflare Pages

1. 访问 https://dash.cloudflare.com/
2. 进入 Workers & Pages → Create application
3. 点击 Connect to Git
4. 选择你的 GitHub 仓库
5. 配置构建设置：

**Build command**:
```
pnpm install && pnpm run build && npx @cloudflare/next-on-pages
```

**Deploy command**:
```
echo "Build complete"
```

6. 点击 Save and Deploy

### 3. （可选）添加环境变量

如果需要使用豆包大语言模型的智能分析功能，在 Cloudflare Pages 中添加环境变量：

- 变量名：`COZE_API_KEY`
- 值：你的豆包 API Key

## 技术栈

- Next.js 15.5.2
- React 19.1.0
- TypeScript 5
- Tailwind CSS 4
- Cloudflare Pages
