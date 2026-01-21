'use client';

import React, { useState, useEffect } from 'react';
import { getAllVersions, getVersionConfig } from '@/lib/versionManager';

interface VersionSelectorProps {
  showVersionInfo?: boolean;
  className?: string;
}

export default function VersionSelector({ showVersionInfo = true, className = '' }: VersionSelectorProps) {
  const [currentVersion, setCurrentVersion] = useState<string>('v1');
  const [allVersions, setAllVersions] = useState<Array<{ id: string; config: any }>>([]);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isMounted, setIsMounted] = useState(false);

  // 从响应头获取当前版本
  useEffect(() => {
    setIsMounted(true);

    // 从响应头获取版本（如果存在）
    const responseHeaders = document.querySelectorAll('meta[name="x-app-version"]');
    if (responseHeaders.length > 0) {
      const version = responseHeaders[0].getAttribute('content');
      if (version) {
        setCurrentVersion(version);
      }
    }

    // 获取所有版本
    setAllVersions(getAllVersions());
  }, []);

  // 切换版本
  const switchVersion = (versionId: string) => {
    if (typeof window === 'undefined') return;

    const currentHostname = window.location.hostname;
    const versionConfig = getVersionConfig(versionId);

    if (currentHostname !== versionConfig.domain) {
      // 通过子域名切换
      const newUrl = window.location.href.replace(currentHostname, versionConfig.domain);
      window.location.href = newUrl;
    } else {
      // 通过路径切换
      const pathParts = window.location.pathname.split('/').filter(Boolean);
      if (pathParts[0]?.match(/^v\d+$/)) {
        pathParts[0] = versionId;
      } else {
        pathParts.unshift(versionId);
      }
      const newPath = '/' + pathParts.join('/');
      window.location.href = newPath;
    }
    setIsDropdownOpen(false);
  };

  // 服务端渲染时返回简化版本
  if (!isMounted) {
    return (
      <div className="relative">
        <button className="flex items-center space-x-2 px-4 py-2 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors">
          <div className="w-3 h-3 rounded-full bg-blue-500" />
          <span className="font-medium text-gray-700">加载中...</span>
        </button>
      </div>
    );
  }

  const currentConfig = allVersions.find(v => v.id === currentVersion)?.config;

  return (
    <div className={`relative ${className}`}>
      <button
        onClick={() => setIsDropdownOpen(!isDropdownOpen)}
        className="flex items-center space-x-2 px-4 py-2 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
      >
        <div
          className="w-3 h-3 rounded-full"
          style={{ backgroundColor: currentConfig?.theme?.primaryColor || '#3B82F6' }}
        />
        <span className="font-medium text-gray-700">
          {currentConfig?.name || '版本未识别'}
        </span>
        <span className="text-sm text-gray-500">v{currentVersion.substring(1)}</span>
        <svg
          className={`w-4 h-4 text-gray-500 transition-transform ${isDropdownOpen ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isDropdownOpen && (
        <div className="absolute right-0 mt-2 w-80 bg-white border border-gray-200 rounded-lg shadow-lg z-50">
          <div className="p-3 border-b border-gray-200">
            <h3 className="text-sm font-semibold text-gray-900">选择版本</h3>
          </div>

          <div className="max-h-80 overflow-y-auto">
            {allVersions.map(({ id, config }) => (
              <button
                key={id}
                onClick={() => switchVersion(id)}
                className={`w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors border-b border-gray-100 ${
                  currentVersion === id ? 'bg-blue-50' : ''
                }`}
              >
                <div className="flex items-start space-x-3">
                  <div
                    className="w-3 h-3 rounded-full mt-1 flex-shrink-0"
                    style={{ backgroundColor: config.theme.primaryColor }}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <span className={`font-medium ${currentVersion === id ? 'text-blue-700' : 'text-gray-900'}`}>
                        {config.name}
                      </span>
                      <span className={`text-xs px-2 py-0.5 rounded ${
                        currentVersion === id ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'
                      }`}>
                        v{id.substring(1)}
                      </span>
                    </div>
                    <p className="text-sm text-gray-600 mt-1 line-clamp-2">
                      {config.description}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {config.features.maxFileSize && (
                        <span className="text-xs px-2 py-0.5 bg-gray-100 text-gray-600 rounded">
                          最大 {config.features.maxFileSize}MB
                        </span>
                      )}
                      {config.features.supportedFormats && (
                        <span className="text-xs px-2 py-0.5 bg-gray-100 text-gray-600 rounded">
                          {config.features.supportedFormats.join(', ')}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </button>
            ))}
          </div>

          {showVersionInfo && currentConfig && (
            <div className="p-3 bg-gray-50 border-t border-gray-200">
              <div className="text-xs text-gray-600 space-y-1">
                <div className="flex justify-between">
                  <span>域名:</span>
                  <span className="font-mono">{currentConfig.domain}</span>
                </div>
                <div className="flex justify-between">
                  <span>版本:</span>
                  <span className="font-mono">{currentConfig.version}</span>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 点击外部关闭下拉框 */}
      {isDropdownOpen && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => setIsDropdownOpen(false)}
        />
      )}
    </div>
  );
}
