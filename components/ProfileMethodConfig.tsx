'use client';

import { useState } from 'react';

export type AnalysisMethod = 'iqr' | 'stddev';

export interface MethodConfig {
  method: AnalysisMethod;
  iqr: {
    upperMultiplier: number;  // 上阈值使用的IQR倍数
    lowerMultiplier: number;  // 下阈值使用的IQR倍数
  };
  stddev: {
    upperMultiplier: number;  // 上阈值使用的标准差倍数
    lowerMultiplier: number;  // 下阈值使用的标准差倍数
  };
}

interface ProfileMethodConfigProps {
  config: MethodConfig;
  onConfigChange: (config: MethodConfig) => void;
}

export default function ProfileMethodConfig({ config, onConfigChange }: ProfileMethodConfigProps) {
  const handleMethodChange = (method: AnalysisMethod) => {
    onConfigChange({
      ...config,
      method
    });
  };

  const handleIqrMultiplierChange = (field: 'upperMultiplier' | 'lowerMultiplier', value: string) => {
    const numValue = parseFloat(value);
    if (!isNaN(numValue) && numValue >= 0) {
      onConfigChange({
        ...config,
        iqr: {
          ...config.iqr,
          [field]: numValue
        }
      });
    }
  };

  const handleStddevMultiplierChange = (field: 'upperMultiplier' | 'lowerMultiplier', value: string) => {
    const numValue = parseFloat(value);
    if (!isNaN(numValue) && numValue >= 0) {
      onConfigChange({
        ...config,
        stddev: {
          ...config.stddev,
          [field]: numValue
        }
      });
    }
  };

  return (
    <div className="space-y-6">
      <div className="border-b border-gray-200 pb-4">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">画像分析方法配置</h3>
        <p className="text-sm text-gray-600">
          选择画像分析的方法，并配置对应的参数。系统将使用您选择的方法和参数进行分类分析。
        </p>
      </div>

      {/* 方法选择 */}
      <div className="space-y-3">
        <label className="block text-sm font-medium text-gray-700">分析方法</label>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* 四分位法选项 */}
          <button
            type="button"
            onClick={() => handleMethodChange('iqr')}
            className={`p-4 rounded-lg border-2 text-left transition-all ${
              config.method === 'iqr'
                ? 'border-blue-500 bg-blue-50'
                : 'border-gray-200 hover:border-gray-300'
            }`}
          >
            <div className="flex items-start">
              <input
                type="radio"
                name="method"
                value="iqr"
                checked={config.method === 'iqr'}
                onChange={() => handleMethodChange('iqr')}
                className="mt-1 mr-3"
              />
              <div>
                <div className="font-medium text-gray-900">四分位法 (IQR)</div>
                <div className="mt-1 text-sm text-gray-600">
                  基于四分位数和四分位距进行分类，适合识别异常值
                </div>
              </div>
            </div>
          </button>

          {/* 均值标准差法选项 */}
          <button
            type="button"
            onClick={() => handleMethodChange('stddev')}
            className={`p-4 rounded-lg border-2 text-left transition-all ${
              config.method === 'stddev'
                ? 'border-blue-500 bg-blue-50'
                : 'border-gray-200 hover:border-gray-300'
            }`}
          >
            <div className="flex items-start">
              <input
                type="radio"
                name="method"
                value="stddev"
                checked={config.method === 'stddev'}
                onChange={() => handleMethodChange('stddev')}
                className="mt-1 mr-3"
              />
              <div>
                <div className="font-medium text-gray-900">均值标准差法</div>
                <div className="mt-1 text-sm text-gray-600">
                  基于均值和标准差进行分类，适合正态分布数据
                </div>
              </div>
            </div>
          </button>
        </div>
      </div>

      {/* 参数配置区域 */}
      <div className="space-y-4">
        {config.method === 'iqr' && (
          <div className="bg-gray-50 rounded-lg p-4">
            <h4 className="text-sm font-medium text-gray-900 mb-4">四分位法参数</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* 上阈值倍数 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  上阈值倍数 (Q3 + N × IQR)
                </label>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  value={config.iqr.upperMultiplier}
                  onChange={(e) => handleIqrMultiplierChange('upperMultiplier', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="例如：1.5"
                />
                <p className="mt-1 text-xs text-gray-500">
                  高于 Q3 + N × IQR 的值被识别为高异常值
                </p>
              </div>

              {/* 下阈值倍数 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  下阈值倍数 (Q1 - N × IQR)
                </label>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  value={config.iqr.lowerMultiplier}
                  onChange={(e) => handleIqrMultiplierChange('lowerMultiplier', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="例如：0（表示使用Q1作为下阈值）"
                />
                <p className="mt-1 text-xs text-gray-500">
                  低于 Q1 - N × IQR 的值被识别为低异常值
                </p>
              </div>
            </div>
          </div>
        )}

        {config.method === 'stddev' && (
          <div className="bg-gray-50 rounded-lg p-4">
            <h4 className="text-sm font-medium text-gray-900 mb-4">均值标准差法参数</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* 上阈值倍数 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  上阈值倍数 (Mean + N × StdDev)
                </label>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  value={config.stddev.upperMultiplier}
                  onChange={(e) => handleStddevMultiplierChange('upperMultiplier', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="例如：2"
                />
                <p className="mt-1 text-xs text-gray-500">
                  高于 Mean + N × StdDev 的值被识别为高异常值
                </p>
              </div>

              {/* 下阈值倍数 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  下阈值倍数 (Mean - N × StdDev)
                </label>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  value={config.stddev.lowerMultiplier}
                  onChange={(e) => handleStddevMultiplierChange('lowerMultiplier', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="例如：2"
                />
                <p className="mt-1 text-xs text-gray-500">
                  低于 Mean - N × StdDev 的值被识别为低异常值
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 方法说明 */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <h5 className="text-sm font-medium text-blue-900 mb-2">方法说明</h5>
        {config.method === 'iqr' && (
          <div className="text-sm text-blue-800 space-y-1">
            <p><strong>四分位法（IQR）</strong>：使用四分位数和四分位距来识别异常值。</p>
            <p><strong>计算公式</strong>：</p>
            <ul className="list-disc list-inside ml-2 space-y-1">
              <li>上阈值 = Q3 + {config.iqr.upperMultiplier} × IQR</li>
              <li>下阈值 = Q1 - {config.iqr.lowerMultiplier} × IQR</li>
            </ul>
            <p className="mt-2"><strong>适用场景</strong>：数据分布不对称或存在较多异常值时效果较好。</p>
          </div>
        )}
        {config.method === 'stddev' && (
          <div className="text-sm text-blue-800 space-y-1">
            <p><strong>均值标准差法</strong>：使用均值和标准差来识别异常值。</p>
            <p><strong>计算公式</strong>：</p>
            <ul className="list-disc list-inside ml-2 space-y-1">
              <li>上阈值 = Mean + {config.stddev.upperMultiplier} × StdDev</li>
              <li>下阈值 = Mean - {config.stddev.lowerMultiplier} × StdDev</li>
            </ul>
            <p className="mt-2"><strong>适用场景</strong>：数据呈正态分布或近似正态分布时效果较好。</p>
          </div>
        )}
      </div>
    </div>
  );
}
