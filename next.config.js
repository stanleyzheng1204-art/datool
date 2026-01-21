/** @type {import('next').NextConfig} */
const nextConfig = {
  // 图片优化配置
  images: {
    unoptimized: true, // Cloudflare Pages 需要
    domains: [],
  },

  // 环境变量
  env: {
    NEXT_PUBLIC_APP_NAME: process.env.NEXT_PUBLIC_APP_NAME || '数据分析工具',
    NEXT_PUBLIC_APP_VERSION: process.env.NEXT_PUBLIC_APP_VERSION || '1.0.0',
  },

  // 压缩配置
  compress: true,

  // 页面预加载
  reactStrictMode: true,

  // 禁用构建时的 lint 检查
  eslint: {
    ignoreDuringBuilds: true,
  },

  // 禁用构建时的类型检查
  typescript: {
    ignoreBuildErrors: true,
  },
};

module.exports = nextConfig;
