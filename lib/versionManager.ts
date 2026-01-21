/**
 * 版本管理工具
 * 用于加载和管理不同功能版本的配置
 */

import versionsJson from '@/config/versions.json';

const versionsConfig = versionsJson as Record<string, VersionConfig>;

export interface VersionConfig {
  version: string;
  name: string;
  description: string;
  domain: string;
  apiBase: string;
  features: {
    enableAdvancedAnalysis: boolean;
    enableRealTimeSync: boolean;
    enableAIAnalysis?: boolean;
    enableDistributedProcessing?: boolean;
    maxFileSize: number;
    supportedFormats: string[];
  };
  theme: {
    primaryColor: string;
    logo: string;
  };
  deploy: {
    buildCommand: string;
    startCommand: string;
    env: string;
  };
}

/**
 * 获取当前版本配置
 * @param versionId 版本ID（如 'v1', 'v2', 'v3'），默认从环境变量读取
 * @returns 版本配置对象
 */
export function getVersionConfig(versionId?: string): VersionConfig {
  // 优先使用传入的版本ID
  const targetVersion = versionId || process.env.NEXT_PUBLIC_APP_VERSION || 'v1';

  const config = versionsConfig[targetVersion as keyof typeof versionsConfig];

  if (!config) {
    console.warn(`未找到版本 ${targetVersion} 的配置，使用默认配置 v1`);
    return versionsConfig.v1;
  }

  return config;
}

/**
 * 获取所有可用版本列表
 */
export function getAllVersions(): Array<{ id: string; config: VersionConfig }> {
  const versions = versionsConfig as Record<string, VersionConfig>;
  return Object.entries(versions).map(([id, config]) => ({
    id,
    config: config as VersionConfig
  }));
}

/**
 * 检查功能是否启用
 * @param feature 功能名称
 * @param versionId 版本ID
 */
export function isFeatureEnabled(
  feature: keyof VersionConfig['features'],
  versionId?: string
): boolean {
  const config = getVersionConfig(versionId);
  return config.features[feature] as boolean;
}

/**
 * 获取域名配置
 */
export function getDomainConfig(versionId?: string): string {
  const config = getVersionConfig(versionId);
  return config.domain;
}

/**
 * 获取API基础路径
 */
export function getApiBase(versionId?: string): string {
  const config = getVersionConfig(versionId);
  return config.apiBase;
}

/**
 * 获取主题配置
 */
export function getThemeConfig(versionId?: string) {
  const config = getVersionConfig(versionId);
  return config.theme;
}

/**
 * 根据域名自动识别版本
 * @param hostname 当前访问的域名
 */
export function detectVersionByHostname(hostname: string): string | null {
  const allVersions = getAllVersions();

  for (const { id, config } of allVersions) {
    if (hostname === config.domain || hostname.endsWith(`.${config.domain}`)) {
      return id;
    }
  }

  return null;
}

/**
 * 验证版本配置是否有效
 */
export function validateVersionConfig(versionId: string): boolean {
  try {
    const config = getVersionConfig(versionId);
    return !!(config && config.version && config.domain);
  } catch (error) {
    return false;
  }
}
