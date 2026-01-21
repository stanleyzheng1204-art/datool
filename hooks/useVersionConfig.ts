/**
 * 版本配置React Hook
 * 提供组件中使用版本配置的便捷方法
 */

import { useMemo } from 'react';
import {
  getVersionConfig,
  isFeatureEnabled,
  getDomainConfig,
  getApiBase,
  getThemeConfig,
  type VersionConfig
} from '@/lib/versionManager';

export function useVersionConfig(versionId?: string) {
  const config = useMemo(() => getVersionConfig(versionId), [versionId]);

  return {
    config,
    version: config.version,
    name: config.name,
    description: config.description,
    domain: config.domain,
    apiBase: config.apiBase,
    features: config.features,
    theme: config.theme,
    // 功能检查方法
    isAdvancedAnalysisEnabled: useMemo(
      () => isFeatureEnabled('enableAdvancedAnalysis', versionId),
      [versionId]
    ),
    isRealTimeSyncEnabled: useMemo(
      () => isFeatureEnabled('enableRealTimeSync', versionId),
      [versionId]
    ),
    isAIAnalysisEnabled: useMemo(
      () => isFeatureEnabled('enableAIAnalysis', versionId),
      [versionId]
    ),
    isDistributedProcessingEnabled: useMemo(
      () => isFeatureEnabled('enableDistributedProcessing', versionId),
      [versionId]
    ),
    maxFileSize: config.features.maxFileSize,
    supportedFormats: config.features.supportedFormats,
    primaryColor: config.theme.primaryColor,
    logo: config.theme.logo
  };
}
