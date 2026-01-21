'use client';

import { useState, useEffect } from 'react';
import { useVersionConfig } from '@/hooks/useVersionConfig';
import VersionSelector from '@/components/VersionSelector';
import {
  getAllVersions,
  isFeatureEnabled,
  getThemeConfig
} from '@/lib/versionManager';

export default function VersionDemo() {
  const [selectedVersion, setSelectedVersion] = useState('v1');
  const [isMounted, setIsMounted] = useState(false);
  const versionConfig = useVersionConfig(selectedVersion);
  const allVersions = getAllVersions();

  useEffect(() => {
    setIsMounted(true);
  }, []);

  // 获取当前域名（只在客户端）
  const getCurrentHostname = () => {
    if (typeof window !== 'undefined') {
      return window.location.hostname;
    }
    return 'example.com';
  };

  const getCurrentOrigin = () => {
    if (typeof window !== 'undefined') {
      return window.location.origin;
    }
    return 'https://example.com';
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* 顶部导航 */}
      <nav className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex items-center">
              <h1 className="text-2xl font-bold text-gray-900">
                多版本部署演示
              </h1>
            </div>
            <div className="flex items-center">
              <VersionSelector />
            </div>
          </div>
        </div>
      </nav>

      {/* 主要内容 */}
      <main className="max-w-7xl mx-auto py-10 px-4 sm:px-6 lg:px-8">
        {/* 当前版本信息 */}
        <div className="bg-white rounded-lg shadow p-6 mb-8">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            当前版本信息
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium text-gray-500">版本</label>
              <p className="text-xl font-bold" style={{ color: versionConfig.primaryColor }}>
                {versionConfig.name}
              </p>
            </div>
            <div>
              <label className="text-sm font-medium text-gray-500">版本号</label>
              <p className="text-xl font-bold text-gray-900">
                v{versionConfig.version.split('.')[0]}
              </p>
            </div>
            <div>
              <label className="text-sm font-medium text-gray-500">域名</label>
              <p className="text-gray-900 font-mono">{versionConfig.domain}</p>
            </div>
            <div>
              <label className="text-sm font-medium text-gray-500">API路径</label>
              <p className="text-gray-900 font-mono">{versionConfig.apiBase}</p>
            </div>
          </div>
          <p className="mt-4 text-gray-600">{versionConfig.description}</p>
        </div>

        {/* 功能特性 */}
        <div className="bg-white rounded-lg shadow p-6 mb-8">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            功能特性
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <FeatureCard
              name="高级分析"
              enabled={versionConfig.isAdvancedAnalysisEnabled}
            />
            <FeatureCard
              name="实时同步"
              enabled={versionConfig.isRealTimeSyncEnabled}
            />
            <FeatureCard
              name="AI智能分析"
              enabled={versionConfig.isAIAnalysisEnabled}
            />
            <FeatureCard
              name="分布式处理"
              enabled={versionConfig.isDistributedProcessingEnabled}
            />
          </div>

          <div className="mt-6 grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium text-gray-500">
                最大文件大小
              </label>
              <p className="text-2xl font-bold text-gray-900">
                {versionConfig.maxFileSize}MB
              </p>
            </div>
            <div>
              <label className="text-sm font-medium text-gray-500">
                支持格式
              </label>
              <div className="flex flex-wrap gap-2 mt-2">
                {versionConfig.supportedFormats.map(format => (
                  <span
                    key={format}
                    className="px-2 py-1 bg-gray-100 text-gray-700 rounded text-sm"
                  >
                    {format.toUpperCase()}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* 所有版本对比 */}
        <div className="bg-white rounded-lg shadow p-6 mb-8">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            所有版本对比
          </h2>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    版本
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    高级分析
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    实时同步
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    AI分析
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    文件大小
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    操作
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {allVersions.map(({ id, config }) => (
                  <tr key={id}>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        <div
                          className="w-3 h-3 rounded-full mr-2"
                          style={{ backgroundColor: config.theme.primaryColor }}
                        />
                        <span className="text-sm font-medium text-gray-900">
                          {config.name}
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <FeatureIcon
                        enabled={config.features.enableAdvancedAnalysis}
                      />
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <FeatureIcon
                        enabled={config.features.enableRealTimeSync}
                      />
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <FeatureIcon
                        enabled={config.features.enableAIAnalysis || false}
                      />
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {config.features.maxFileSize}MB
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <button
                        onClick={() => setSelectedVersion(id)}
                        className="text-blue-600 hover:text-blue-900 text-sm font-medium"
                      >
                        切换
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* 版本切换方式 */}
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            版本切换方式
          </h2>
          <div className="space-y-4">
            <SwitchMethodCard
              title="方式1：子域名"
              description="通过不同的子域名访问不同版本"
              examples={[
                `v1.${getCurrentHostname()} -> v1版本`,
                `v2.${getCurrentHostname()} -> v2版本`
              ]}
              code={`v1.example.com
v2.example.com`}
            />
            <SwitchMethodCard
              title="方式2：路径前缀"
              description="通过URL路径前缀切换版本"
              examples={[
                `${getCurrentOrigin()}/v1 -> v1版本`,
                `${getCurrentOrigin()}/v2 -> v2版本`
              ]}
              code={`${getCurrentOrigin()}/v1
${getCurrentOrigin()}/v2`}
            />
            <SwitchMethodCard
              title="方式3：查询参数"
              description="通过URL查询参数指定版本"
              examples={[
                `${getCurrentOrigin()}?version=v1 -> v1版本`,
                `${getCurrentOrigin()}?version=v2 -> v2版本`
              ]}
              code={`${getCurrentOrigin()}?version=v1
${getCurrentOrigin()}?version=v2`}
            />
          </div>
        </div>
      </main>
    </div>
  );
}

// 子组件：功能卡片
function FeatureCard({ name, enabled }: { name: string; enabled: boolean }) {
  return (
    <div className={`p-4 rounded-lg border-2 ${
      enabled
        ? 'border-green-500 bg-green-50'
        : 'border-gray-200 bg-gray-50'
    }`}>
      <div className="flex items-center justify-between">
        <span className="font-medium text-gray-900">{name}</span>
        {enabled ? (
          <span className="text-green-600 text-sm">✓ 已启用</span>
        ) : (
          <span className="text-gray-400 text-sm">✗ 未启用</span>
        )}
      </div>
    </div>
  );
}

// 子组件：功能图标
function FeatureIcon({ enabled }: { enabled: boolean }) {
  return enabled ? (
    <svg className="w-5 h-5 text-green-500" fill="currentColor" viewBox="0 0 20 20">
      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
    </svg>
  ) : (
    <svg className="w-5 h-5 text-gray-300" fill="currentColor" viewBox="0 0 20 20">
      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
    </svg>
  );
}

// 子组件：切换方式卡片
function SwitchMethodCard({
  title,
  description,
  examples,
  code
}: {
  title: string;
  description: string;
  examples: string[];
  code: string;
}) {
  return (
    <div className="border border-gray-200 rounded-lg p-4">
      <h3 className="font-semibold text-gray-900 mb-2">{title}</h3>
      <p className="text-sm text-gray-600 mb-3">{description}</p>
      <div className="mb-3">
        <p className="text-xs font-medium text-gray-500 mb-1">示例:</p>
        <ul className="list-disc list-inside text-sm text-gray-700">
          {examples.map((example, index) => (
            <li key={index}>{example}</li>
          ))}
        </ul>
      </div>
      <div className="bg-gray-900 rounded p-3">
        <pre className="text-xs text-green-400">{code}</pre>
      </div>
    </div>
  );
}
