'use client';

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import html2canvas from 'html2canvas';
import { scaleLog, scaleLinear } from 'd3-scale';
import {
  BarChart,
  Bar,
  ResponsiveContainer,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ScatterChart,
  Scatter,
  Cell,
  Line,
  LineChart,
  ComposedChart,
  Area,
  AreaChart
} from 'recharts';
import { formatNumberWithCommas } from '@/lib/numberFormatter';

// 开发环境调试日志开关（生产环境设置为 false）
const DEBUG_MODE = true; // 临时启用调试模式，方便排查图片未显示问题

// 安全的 console.log wrapper
const debugLog = (...args: any[]) => {
  if (DEBUG_MODE) {
    console.log(...args);
  }
};

// 全局图表导出器注册表（与AnalysisCharts一致）
const distributionChartExporters: { [key: string]: () => Promise<any> } = {};

export async function exportDistributionChartsInstance(): Promise<any> {
  console.log('=== exportDistributionChartsInstance 开始 ===');

  // 检查是否在浏览器环境中
  if (typeof window === 'undefined') {
    console.warn('⚠️ exportDistributionChartsInstance 在非浏览器环境中调用，返回空数据');
    return {
      type: 'distribution',
      config: null,
      images: {}
    };
  }

  // 优先使用持久化的数据（组件可能已卸载，但数据已保存）
  const persistentCharts = (window as any).distributionChartsPersistent;
  console.log('检查持久化数据:', {
    hasPersistent: !!persistentCharts,
    hasImages: !!persistentCharts?.images,
    imageKeys: persistentCharts?.images ? Object.keys(persistentCharts.images) : [],
    imageCount: persistentCharts?.images ? Object.keys(persistentCharts.images).length : 0
  });

  if (persistentCharts && persistentCharts.images && Object.keys(persistentCharts.images).length > 0) {
    console.log('✅ 使用持久化的图表数据');
    debugLog('持久化数据:', {
      hasConfig: !!persistentCharts.config,
      imageCount: Object.keys(persistentCharts.images).length,
      imageKeys: Object.keys(persistentCharts.images)
    });

    // 验证持久化的图片数据是否有效
    for (const [key, value] of Object.entries(persistentCharts.images)) {
      const imgValue = value as string;
      if (imgValue && imgValue.startsWith('data:image/')) {
        console.log(`✅ 持久化图片 ${key} 格式正确 (base64), 长度: ${imgValue.length}`);
      } else {
        console.warn(`⚠️ 持久化图片 ${key} 格式异常:`, imgValue?.substring(0, 100));
      }
    }

    console.log('=== 返回持久化图表数据 ===');
    return persistentCharts;
  }

  console.log('⚠️ 未找到持久化数据或图片为空，尝试使用注册表导出器');

  const charts: any = {
    type: 'distribution',
    config: null,
    images: {}
  };

  // 遍历所有注册的导出器
  const exporterKeys = Object.keys(distributionChartExporters);
  console.log('找到的导出器:', exporterKeys);

  if (exporterKeys.length === 0) {
    console.warn('⚠️ 没有注册的图表导出器，可能组件未加载或已卸载');
    console.log('=== 返回空图表数据 ===');
    return charts;
  }

  for (const exporterKey of exporterKeys) {
    try {
      const exporter = distributionChartExporters[exporterKey];
      console.log(`调用导出器: ${exporterKey}`);

      const exportedCharts = await exporter();
      console.log(`导出结果 "${exporterKey}":`, {
        hasConfig: !!exportedCharts?.config,
        hasImages: !!exportedCharts?.images,
        imageKeys: Object.keys(exportedCharts?.images || {}),
        imageCount: Object.keys(exportedCharts?.images || {}).length
      });

      // 检查导出的图片数据是否有效（应该是base64格式）
      if (exportedCharts?.images) {
        for (const [key, value] of Object.entries(exportedCharts.images)) {
          const imgValue = value as string;
          if (imgValue && imgValue.startsWith('data:image/')) {
            console.log(`✅ 图片 ${key} 格式正确 (base64), 长度: ${imgValue.length}`);
          } else if (imgValue) {
            console.warn(`⚠️ 图片 ${key} 格式异常:`, imgValue.substring(0, 100));
          }
        }
      }

      // 合并所有图表
      if (exportedCharts) {
        charts.config = exportedCharts.config;
        Object.assign(charts.images, exportedCharts.images);
      }
    } catch (error) {
      console.error(`❌ 导出失败 "${exporterKey}":`, error);
    }
  }

  console.log('=== 数据分布图表导出完成 ===');
  console.log('最终结果:', {
    hasConfig: !!charts.config,
    imageCount: Object.keys(charts.images).length,
    imageKeys: Object.keys(charts.images)
  });

  return charts;
}

interface DistributionChartsProps {
  filteredData: any[];
  aggregatedData: any[];
  aggregatedColumns: string[];
  aggregationConfig: any;
  onComplete?: () => void;
  onSkip?: () => void;
  onConfigChange?: (config: DistributionConfig) => void;
}

interface DistributionConfig {
  selectedFields: string[];
  chartType: 'histogram' | 'boxplot';
  binCount: number;
  binMethod: 'equal'; // 分箱方法：等宽
  seriesField?: string; // 系列字段，用于分组显示不同颜色
  showCumulative?: boolean; // 是否显示累积分布曲线
  showCumulativeLegend?: boolean; // 是否在图例中显示累积分布曲线
  useLogScale?: boolean; // 是否使用对数刻度Y轴（直方图）
  useCumulativeMultiplicativeScale?: boolean; // 累积曲线是否使用倍数刻度（10×1, 10×2...）
  scatterUseLogScale?: boolean; // 是否使用对数刻度Y轴（散点图）
}

interface ChartDataPoint {
  range: string;
  rangeStart: number;
  rangeEnd: number;
  rangeCenter?: number;
  count: number; // 总数（兼容无系列的情况）
  cumulativePercent?: number; // 累积百分比（无系列时）
  [key: string]: any; // 动态添加系列的count，如 { range: "100-200", seriesA: 15, seriesB: 20 }
}

export function DistributionCharts({
  filteredData,
  aggregatedData,
  aggregatedColumns,
  aggregationConfig,
  onComplete,
  onSkip,
  onConfigChange
}: DistributionChartsProps) {
  const [config, setConfig] = useState<DistributionConfig>({
    selectedFields: [],
    chartType: 'histogram',
    binCount: 30,
    binMethod: 'equal', // 默认使用等宽分箱
    showCumulative: true, // 默认显示累积分布曲线
    showCumulativeLegend: false, // 默认不在图例中显示累积分布曲线
    useLogScale: false, // 默认不使用对数刻度
    useCumulativeMultiplicativeScale: false, // 默认不使用累积曲线倍数刻度
    scatterUseLogScale: false // 默认散点图不使用对数刻度
  });

  const [showCharts, setShowCharts] = useState(false);
  const [isNavigating, setIsNavigating] = useState(false); // 正在执行下一步操作的状态
  const [navigationProgress, setNavigationProgress] = useState(''); // 导出进度提示

  // 当配置变化时，通知父组件
  useEffect(() => {
    if (onConfigChange && config.selectedFields.length > 0) {
      onConfigChange(config);
    }
  }, [config, onConfigChange]);

  // 获取数值类型的聚合字段（使用 useMemo 缓存）
  const numericFields = useMemo(() => {
    if (!aggregatedData || aggregatedData.length === 0) return [];
    if (!aggregatedData[0]) return [];

    return aggregatedColumns.filter(col => {
      const value = aggregatedData[0][col];
      return typeof value === 'number' && !isNaN(value);
    });
  }, [aggregatedData, aggregatedColumns]);

  // 计算统一的图表高度（确保直方图和Box图高度一致）
  const calculateChartHeight = useMemo(() => {
    // 检查数据有效性
    if (!aggregatedData || aggregatedData.length === 0) {
      return {
        histogramHeight: 350,
        boxPlotHeight: 350
      };
    }

    const hasSeries = !!config.seriesField;
    let seriesCount = 0;

    if (hasSeries) {
      // 计算所有字段的系列数量，取最大值
      config.selectedFields.forEach(fieldName => {
        const seriesFieldName = config.seriesField!;
        const allSeriesValues = Array.from(
          new Set(aggregatedData.map(row => (row[seriesFieldName] as string) || '其他'))
        );
        seriesCount = Math.max(seriesCount, allSeriesValues.length);
      });
    }

    // ============================================================
    // 第一部分：确定表格高度（不使用滚动条，完整显示所有行）
    // ============================================================

    // 表格行高：每行包含py-1(8px) + 边框(1px) + 文本行高(约14px) = 约23px
    // 为了保险起见，使用24px作为单行高度
    const tableRowHeight = 24;

    // 左侧表格：直方图统计信息表
    // 行数：1行表头 + 4行数据 = 5行
    // 外层padding: p-2 = 8px * 2 = 16px
    // 标题h3: text-xs + mb-1 = 约18px
    const leftTableRowCount = 5;
    const leftTableContentHeight = leftTableRowCount * tableRowHeight; // 5 * 24 = 120px
    const leftTableHeight = 16 + 18 + leftTableContentHeight; // 16 + 18 + 120 = 154px

    // 右侧表格：Box图详细统计表
    // 无系列：1行表头 + 9行数据 = 10行
    // 有系列：2行表头 + 9行数据 = 11行
    // 外层padding: p-2 = 8px * 2 = 16px
    // 标题h3: text-xs + mb-1 = 约18px
    let rightTableRowCount: number;
    if (hasSeries) {
      rightTableRowCount = 11;
    } else {
      rightTableRowCount = 10;
    }
    const rightTableContentHeight = rightTableRowCount * tableRowHeight;
    const rightTableHeight = 16 + 18 + rightTableContentHeight; // 无系列: 16+18+240=274, 有系列: 16+18+264=298

    // ============================================================
    // 第二部分：设计图表高度，确保左右三元素高度一致
    // ============================================================

    // 图表容器固定部分（不含图表本身）：
    // - 外层容器padding: p-2.5 = 10px * 2 = 20px
    // - 标题h3: text-sm + mb-2.5 = 约30px
    // - 内层容器padding: p-2 = 8px * 2 = 16px
    // - 小计：66px
    const chartContainerFixed = 66;

    // 两个图表之间的间距
    const chartGap = 12;

    // 设定直方图高度（要让柱子更清楚，需要更高）
    // 无系列：350px，有系列：300px
    const histogramHeight = hasSeries ? 300 : 350;

    // 计算左侧三元素总高度
    // = 2 * (直方图高度 + 容器固定部分) + 间距 + 表格高度
    const leftTotalHeight =
      2 * (histogramHeight + chartContainerFixed) +
      chartGap +
      leftTableHeight;

    // 计算需要的Box图高度，使右侧总高度等于左侧
    // 右侧总高度 = 2 * (Box图高度 + 容器固定部分) + 间距 + 表格高度
    // 设左侧 = 右侧，求解Box图高度：
    // Box图高度 = (左侧总高度 - 间距 - 表格高度) / 2 - 容器固定部分
    const boxPlotHeight =
      (leftTotalHeight - chartGap - rightTableHeight) / 2 -
      chartContainerFixed;

    debugLog('图表高度计算（完整重写）:', {
      hasSeries,
      seriesCount,
      leftTableRowCount,
      rightTableRowCount,
      leftTableHeight,
      rightTableHeight,
      histogramHeight,
      boxPlotHeight: Math.round(boxPlotHeight),
      leftTotalHeight: Math.round(leftTotalHeight),
      rightTotalHeight: Math.round(2 * (Math.round(boxPlotHeight) + chartContainerFixed) + chartGap + rightTableHeight)
    });

    return {
      histogramHeight,
      boxPlotHeight: Math.round(boxPlotHeight)
    };
  }, [config.seriesField, config.selectedFields, aggregatedData]);

  // 注册导出函数到 window 对象

  // 使用 useCallback 创建稳定的 ref 赋值函数，避免每次渲染创建新函数导致 ref 丢失
  const setHistogramRef = useCallback((field: string) => (el: HTMLDivElement | null) => {
    if (el) {
      histogramChartsRef.current[field] = el;
    }
  }, []);

  const setBoxplotRef = useCallback((field: string) => (el: HTMLDivElement | null) => {
    if (el) {
      boxplotChartsRef.current[field] = el;
    }
  }, []);

  // 获取可用的系列字段（分组字段）- 使用 useMemo 缓存
  // 与正态分布检验保持一致，显示所有字段，包括数值型字段（如年份、月份等）
  const seriesFields = useMemo(() => {
    if (!aggregatedData || aggregatedData.length === 0) return [];
    return aggregatedColumns;
  }, [aggregatedData, aggregatedColumns]);

  // 图表容器引用
  const histogramChartsRef = useRef<{ [key: string]: HTMLDivElement }>({});
  const boxplotChartsRef = useRef<{ [key: string]: HTMLDivElement }>({});
  const scatterChartRef = useRef<HTMLDivElement | null>(null);

  // 使用ref保存最新配置，确保exportDistributionCharts使用最新值
  const configRef = useRef(config);
  const showChartsRef = useRef(showCharts);

  // 每次config或showCharts变化时，更新ref
  useEffect(() => {
    configRef.current = config;
    showChartsRef.current = showCharts;
  }, [config, showCharts]);

  // 添加调试日志，验证数据源
  debugLog('DistributionCharts 数据源验证:', {
    filteredDataLength: filteredData.length,
    aggregatedDataLength: aggregatedData.length,
    aggregatedColumns: aggregatedColumns,
    numericFields: numericFields,
    hasAggregation: aggregationConfig && aggregationConfig.groupBy && aggregationConfig.groupBy.length > 0
  });

  // 导出数据分布图表
  const exportDistributionCharts = async () => {
    // 使用ref获取最新配置和状态
    const currentConfig = configRef.current;
    const currentShowCharts = showChartsRef.current;

    debugLog('=== 开始导出数据分布图表 ===');
    debugLog('当前状态:', {
      chartType: currentConfig.chartType,
      selectedFields: currentConfig.selectedFields,
      showCharts: currentShowCharts,
      histogramRefs: Object.keys(histogramChartsRef.current),
      boxplotRefs: Object.keys(boxplotChartsRef.current),
      hasScatterRef: !!scatterChartRef.current
    });

    const charts: any = {
      type: 'distribution',
      config: currentConfig,
      images: {}
    };

    // 辅助函数：等待DOM元素渲染完成
    const waitForElement = async (element: HTMLElement, timeout: number = 3000): Promise<boolean> => {
      const startTime = Date.now();
      while (Date.now() - startTime < timeout) {
        // 检查元素是否有尺寸和子元素
        if (element.offsetWidth > 0 && element.offsetHeight > 0 && element.children.length > 0) {
          // 额外检查SVG元素是否已渲染（Recharts使用SVG渲染图表）
          const svgElement = element.querySelector('svg');
          if (svgElement) {
            // 检查SVG是否有内容（有rect、path、circle等子元素）
            const hasChartElements = svgElement.querySelector('rect, path, circle, line, g');
            if (hasChartElements) {
              return true;
            }
          } else {
            // 如果没有SVG，返回true（可能是其他类型的图表）
            return true;
          }
        }
        // 等待100ms后重试
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      return false;
    };

    // 同时导出直方图和Box图
    debugLog('尝试导出直方图...');
    for (const field of currentConfig.selectedFields) {
      const chartEl = histogramChartsRef.current[field];
      if (chartEl) {
        try {
          debugLog(`直方图元素 [${field}] 信息:`, {
            exists: !!chartEl,
            offsetWidth: chartEl.offsetWidth,
            offsetHeight: chartEl.offsetHeight,
            childrenCount: chartEl.children.length,
            innerHTML: chartEl.innerHTML.substring(0, 200)
          });

          // 等待元素渲染完成
          const isReady = await waitForElement(chartEl);
          if (!isReady) {
            console.warn(`⚠️ 直方图元素未完全渲染: ${field}`);
            continue;
          }

          debugLog(`捕获直方图元素: ${field}`);
          const canvas = await html2canvas(chartEl, {
            backgroundColor: '#ffffff',
            scale: 2,
            logging: false,
            useCORS: true,
            allowTaint: true
          });
          const imageDataUrl = canvas.toDataURL('image/png');

          // 验证base64格式
          if (imageDataUrl && imageDataUrl.startsWith('data:image/')) {
            charts.images[`histogram_${field}`] = imageDataUrl;
            debugLog(`✅ 直方图导出成功: ${field}, 数据长度: ${imageDataUrl.length}`);
          } else {
            console.error(`❌ 直方图数据格式错误: ${field}`);
          }
        } catch (error) {
          console.error(`❌ 直方图导出失败: ${field}`, error);
        }
      } else {
        console.warn(`⚠️ 直方图元素不存在: ${field}`);
      }
    }

    debugLog('尝试导出箱线图...');
    for (const field of currentConfig.selectedFields) {
      const chartEl = boxplotChartsRef.current[field];
      if (chartEl) {
        try {
          debugLog(`箱线图元素 [${field}] 信息:`, {
            exists: !!chartEl,
            offsetWidth: chartEl.offsetWidth,
            offsetHeight: chartEl.offsetHeight,
            childrenCount: chartEl.children.length
          });

          // 等待元素渲染完成
          const isReady = await waitForElement(chartEl);
          if (!isReady) {
            console.warn(`⚠️ 箱线图元素未完全渲染: ${field}`);
            continue;
          }

          debugLog(`捕获箱线图元素: ${field}`);
          const canvas = await html2canvas(chartEl, {
            backgroundColor: '#ffffff',
            scale: 2,
            logging: false,
            useCORS: true,
            allowTaint: true
          });
          const imageDataUrl = canvas.toDataURL('image/png');

          // 验证base64格式
          if (imageDataUrl && imageDataUrl.startsWith('data:image/')) {
            charts.images[`boxplot_${field}`] = imageDataUrl;
            debugLog(`✅ 箱线图导出成功: ${field}, 数据长度: ${imageDataUrl.length}`);
          } else {
            console.error(`❌ 箱线图数据格式错误: ${field}`);
          }
        } catch (error) {
          console.error(`❌ 箱线图导出失败: ${field}`, error);
        }
      } else {
        console.warn(`⚠️ 箱线图元素不存在: ${field}`);
      }
    }

    // 导出散点图
    if (currentConfig.selectedFields.length >= 2) {
      console.log('=== 开始导出散点图 ===');
      console.log('selectedFields:', currentConfig.selectedFields);
      console.log('scatterChartRef.current:', scatterChartRef.current);

      if (scatterChartRef.current) {
        try {
          console.log('散点图元素详细信息:', {
            exists: !!scatterChartRef.current,
            offsetWidth: scatterChartRef.current.offsetWidth,
            offsetHeight: scatterChartRef.current.offsetHeight,
            childrenCount: scatterChartRef.current.children.length,
            className: scatterChartRef.current.className,
            innerHTML: scatterChartRef.current.innerHTML.substring(0, 300)
          });

          // 等待元素渲染完成
          const isReady = await waitForElement(scatterChartRef.current);
          console.log('散点图元素渲染状态:', isReady);

          if (!isReady) {
            console.warn('⚠️ 散点图元素未完全渲染');
          } else {
            console.log('开始捕获散点图...');
            const canvas = await html2canvas(scatterChartRef.current, {
              backgroundColor: '#ffffff',
              scale: 2,
              logging: true, // 启用日志查看详细过程
              useCORS: true,
              allowTaint: true
            });
            console.log('散点图canvas生成完成，尺寸:', canvas.width, 'x', canvas.height);

            const imageDataUrl = canvas.toDataURL('image/png');
            console.log('散点图imageDataUrl生成完成，长度:', imageDataUrl.length);
            console.log('散点图前缀:', imageDataUrl.substring(0, 50));

            // 验证base64格式
            if (imageDataUrl && imageDataUrl.startsWith('data:image/')) {
              charts.images['scatter'] = imageDataUrl;
              console.log('✅ 散点图导出成功，已保存到 images.scatter');
            } else {
              console.error('❌ 散点图数据格式错误:', imageDataUrl.substring(0, 100));
            }
          }
        } catch (error) {
          console.error('❌ 散点图导出失败:', error);
          console.error('错误堆栈:', error instanceof Error ? error.stack : '无堆栈');
        }
      } else {
        console.warn('⚠️ 散点图元素不存在 (scatterChartRef.current 为 null)');
      }

      console.log('=== 散点图导出流程结束 ===');
    } else {
      console.log('⚠️ selectedFields长度不足2，跳过散点图导出');
    }

    debugLog('=== 数据分布图表导出完成 ===');
    debugLog('导出结果:', {
      imageCount: Object.keys(charts.images).length,
      imageKeys: Object.keys(charts.images)
    });

    return charts;
  };

  // 将导出函数注册到全局注册表（与AnalysisCharts一致）
  useEffect(() => {
    // 注册当前实例的导出函数
    distributionChartExporters['default'] = exportDistributionCharts;

    debugLog('DistributionCharts instance registered');

    return () => {
      // 清理：组件卸载时删除注册
      delete distributionChartExporters['default'];
      debugLog('DistributionCharts instance unregistered');
    };
  }, [config, showCharts]); // 依赖config和showCharts，确保导出函数使用最新状态

  // 处理完成操作（下一步或跳过）
  const handleCompleteOrSkip = async (action: () => void) => {
    // 防止重复点击
    if (isNavigating) {
      console.log('⚠️ 正在执行导航操作，请勿重复点击');
      return;
    }

    // 使用ref获取最新配置
    const currentConfig = configRef.current;
    const currentShowCharts = showChartsRef.current;

    setIsNavigating(true);
    setNavigationProgress('正在准备导出图表...');

    console.log('=== handleCompleteOrSkip 开始 ===');
    console.log('当前状态:', { showCharts: currentShowCharts, selectedFields: currentConfig.selectedFields, chartType: currentConfig.chartType });

    // 只要有选中的字段，就尝试导出图表（即使图表未显示）
    if (currentConfig.selectedFields.length > 0) {
      console.log('准备离开步骤5，尝试导出图表...');

      try {
        let charts: any = null;

        // 如果图表已显示，直接导出
        if (currentShowCharts) {
          console.log('✅ 图表已显示，直接导出...');
          setNavigationProgress('正在导出图表...');
          charts = await exportDistributionCharts();
        } else {
          // 图表未显示，检查是否已经有持久化数据
          const existingCharts = (window as any).distributionChartsPersistent;
          console.log('检查持久化数据:', {
            hasExisting: !!existingCharts,
            hasImages: !!existingCharts?.images,
            imageKeys: existingCharts?.images ? Object.keys(existingCharts.images) : [],
            hasScatter: !!existingCharts?.images?.['scatter']
          });

          if (existingCharts && existingCharts.images && Object.keys(existingCharts.images).length > 0) {
            console.log('✅ 发现持久化的图表数据，直接使用');
            charts = existingCharts;
            setNavigationProgress('✓ 使用已缓存的图表数据');
          } else {
            console.log('⚠️ 图表未显示且无持久化数据，尝试临时显示并导出...');

            // 临时显示图表
            setShowCharts(true);
            setNavigationProgress('正在渲染图表...');

            // 等待React重新渲染并分配refs（减少到500ms，React渲染通常很快）
            console.log('等待React重新渲染并分配refs...');
            await new Promise(resolve => setTimeout(resolve, 500));

            // 等待refs被赋值（最多等待20次，每次100ms，总等待时间2秒）
            let refWaitCount = 0;
            const maxRefWait = 20;
            setNavigationProgress('正在等待图表元素加载...');
            while (refWaitCount < maxRefWait) {
              // 始终等待直方图和box图的refs
              const histogramFields = currentConfig.selectedFields;
              const boxplotFields = currentConfig.selectedFields;
              const hasHistogramRefs = histogramFields.every(f => !!histogramChartsRef.current[f]);
              const hasBoxplotRefs = boxplotFields.every(f => !!boxplotChartsRef.current[f]);
              const hasScatterRef = currentConfig.selectedFields.length >= 2 && !!scatterChartRef.current;

              if (hasHistogramRefs && hasBoxplotRefs && hasScatterRef) {
                console.log(`✅ Refs已全部赋值 (尝试${refWaitCount + 1}次)`);
                break;
              }

              // 每5次更新一次进度提示
              if (refWaitCount % 5 === 0) {
                setNavigationProgress(`正在等待图表元素加载... (${Math.round((refWaitCount / maxRefWait) * 100)}%)`);
              }

              await new Promise(resolve => setTimeout(resolve, 100));
              refWaitCount++;
            }

            // 等待DOM渲染完成和图表完全加载（优化为2500ms，减少等待时间）
            console.log('等待DOM渲染和图表加载...');
            setNavigationProgress('正在生成图表图片...');
            await new Promise(resolve => setTimeout(resolve, 2500));

            // 再次检查图表元素是否存在
            console.log('图表元素检查:', {
              histogramRefs: Object.keys(histogramChartsRef.current),
              boxplotRefs: Object.keys(boxplotChartsRef.current),
              hasScatterRef: !!scatterChartRef.current,
              scatterRefDetails: scatterChartRef.current ? {
                offsetWidth: scatterChartRef.current.offsetWidth,
                offsetHeight: scatterChartRef.current.offsetHeight,
                childrenCount: scatterChartRef.current.children.length
              } : null
            });

            // 尝试导出
            console.log('开始导出图表...');
            charts = await exportDistributionCharts();

            console.log('导出完成，恢复图表显示状态...');
            // 恢复状态（不显示图表）
            setShowCharts(false);

            // 等待状态更新
            await new Promise(resolve => setTimeout(resolve, 50));
          }
        }

        console.log('✅ 离开前导出图表完成');
        console.log('导出的图表数据:', {
          hasCharts: !!charts,
          hasImages: !!charts?.images,
          imageCount: charts?.images ? Object.keys(charts.images).length : 0,
          imageKeys: charts?.images ? Object.keys(charts.images) : [],
          hasScatter: !!charts?.images?.['scatter']
        });

        // 验证导出的图片数据
        if (charts?.images && Object.keys(charts.images).length > 0) {
          console.log('✅ 导出的图片验证通过:', Object.keys(charts.images));
          setNavigationProgress('✓ 图表导出成功');
          // 持久化保存到全局对象
          (window as any).distributionChartsPersistent = charts;
          console.log('✅ 图表已持久化到全局对象');
        } else {
          console.warn('⚠️ 导出的图片为空，可能是图表还未完全渲染');
          setNavigationProgress('⚠️ 图表导出部分完成');
        }
      } catch (error) {
        console.error('❌ 离开前导出图表失败:', error);
        console.error('错误堆栈:', error instanceof Error ? error.stack : '无堆栈');
        setNavigationProgress('⚠️ 图表导出失败，但将继续跳转');
        // 即使导出失败，也保存一个配置信息，以便HTML报告可以显示配置说明
        const fallbackData = {
          type: 'distribution',
          config: currentConfig,
          images: {},
          warning: '图表可能未完全渲染'
        };
        (window as any).distributionChartsPersistent = fallbackData;
        console.log('⚠️ 已保存配置信息作为回退数据');
      }
    } else {
      console.log('⚠️ 没有选中的字段，跳过图表导出');
      setNavigationProgress('跳过图表导出');
    }

    console.log('=== handleCompleteOrSkip 结束，执行操作 ===');
    setNavigationProgress('正在跳转...');
    // 等待UI更新进度提示
    await new Promise(resolve => setTimeout(resolve, 200));

    // 执行传入的操作
    action();

    // 延迟重置状态，让父组件有时间处理跳转
    setTimeout(() => {
      setIsNavigating(false);
      setNavigationProgress('');
    }, 1000);
  };
  useEffect(() => {
    (window as any).exportDistributionCharts = exportDistributionCharts;
    debugLog('exportDistributionCharts 函数已注册到 window');
  }, [config, showCharts]);

  // 当图表显示时，自动导出并保存图表到window对象
  useEffect(() => {
    const currentShowCharts = showChartsRef.current;
    const currentConfig = configRef.current;

    if (currentShowCharts && currentConfig.selectedFields.length > 0) {
      console.log('=== 图表显示，开始自动导出 ===');
      console.log('当前配置:', {
        showCharts: currentShowCharts,
        selectedFields: currentConfig.selectedFields,
        chartType: currentConfig.chartType,
        hasScatterChart: currentConfig.selectedFields.length >= 2
      });

      // 延迟一段时间确保DOM完全渲染
      const timer = setTimeout(async () => {
        try {
          // 再次确认showCharts为true（可能已被关闭）
          if (!showChartsRef.current) {
            console.log('⚠️ 图表已关闭，跳过自动导出');
            return;
          }

          // 等待refs被赋值（最多等待10次，每次100ms）
          let refWaitCount = 0;
          const maxRefWait = 10;
          while (refWaitCount < maxRefWait) {
            const latestConfig = configRef.current;
            // 始终等待直方图和box图的refs（不再根据chartType判断）
            const histogramFields = latestConfig.selectedFields;
            const boxplotFields = latestConfig.selectedFields;
            const hasHistogramRefs = histogramFields.every(f => !!histogramChartsRef.current[f]);
            const hasBoxplotRefs = boxplotFields.every(f => !!boxplotChartsRef.current[f]);
            const hasScatterRef = latestConfig.selectedFields.length >= 2 && !!scatterChartRef.current;

            if (hasHistogramRefs && hasBoxplotRefs && hasScatterRef) {
              console.log(`✅ 自动导出：Refs已全部赋值 (尝试${refWaitCount + 1}次)`);
              break;
            }

            if (refWaitCount === 0) {
              console.log('⚠️ 自动导出：等待refs赋值...');
            }

            await new Promise(resolve => setTimeout(resolve, 100));
            refWaitCount++;
          }

          if (refWaitCount >= maxRefWait) {
            console.warn('⚠️ 自动导出：Refs赋值超时，仍尝试导出图表');
          }

          console.log('开始调用 exportDistributionCharts...');
          const charts = await exportDistributionCharts();
          console.log('✅ 数据分布图表自动导出成功:', charts);

          // 持久化保存到全局对象，防止组件卸载后丢失
          (window as any).distributionChartsPersistent = charts;
          console.log('✅ 数据分布图表已持久化到全局对象');
          console.log('持久化数据包含的图片:', Object.keys(charts.images || {}));
        } catch (error) {
          console.error('❌ 数据分布图表自动导出失败:', error);
          console.error('错误详情:', error instanceof Error ? error.stack : '无堆栈');
        }
      }, 3500); // 减少到3500ms，因为会额外等待refs赋值

      return () => clearTimeout(timer);
    }
  }, [showCharts, config.selectedFields, config.seriesField, config.binCount, config.showCumulative, config.useLogScale, config.scatterUseLogScale]);

  // 在组件卸载时，确保图表数据被保存
  useEffect(() => {
    return () => {
      const currentConfig = configRef.current;
      debugLog('DistributionCharts 组件即将卸载，检查图表数据...');

      // 检查是否已保存图表数据
      const existingCharts = (window as any).distributionChartsPersistent;

      if (!existingCharts || !existingCharts.images || Object.keys(existingCharts.images).length === 0) {
        debugLog('⚠️ 组件卸载时，图表数据为空，保存配置信息...');

        // 保存配置信息，即使没有图片，HTML报告也能显示配置说明
        const fallbackData = {
          type: 'distribution',
          config: currentConfig,
          images: {},
          warning: currentConfig.selectedFields.length > 0
            ? '用户可能跳过了图表生成步骤，或图表未完全渲染'
            : '未选择分析字段'
        };

        (window as any).distributionChartsPersistent = fallbackData;
        debugLog('✅ 已保存配置信息作为回退数据');
      } else {
        debugLog('✅ 图表数据已存在于持久化对象中');
      }
    };
  }, [config]);

  // 初始化默认选中前两个字段（sum和count字段优先）
  useEffect(() => {
    const sumFields = numericFields.filter(f => f.includes('_sum'));
    const countFields = numericFields.filter(f => f.includes('_count'));

    const defaultFields: string[] = [];
    if (sumFields.length > 0) defaultFields.push(sumFields[0]);
    if (countFields.length > 0) defaultFields.push(countFields[0]);

    // 如果没有找到sum/count字段，使用前两个数值字段
    if (defaultFields.length === 0) {
      defaultFields.push(...numericFields.slice(0, 2));
    }

    setConfig(prev => ({
      ...prev,
      selectedFields: defaultFields
    }));
  }, [aggregatedData]);

  // 从聚合后的数据中获取指定字段的值
  const getAggregatedFieldValues = (fieldName: string): number[] => {
    if (!aggregatedData || aggregatedData.length === 0) return [];

    const values = aggregatedData
      .map(row => row[fieldName])
      .filter((value): value is number => typeof value === 'number' && !isNaN(value));

    debugLog(`getAggregatedFieldValues [${fieldName}]:`, {
      aggregatedDataLength: aggregatedData.length,
      valuesCount: values.length,
      sampleValues: values.slice(0, 5)
    });

    return values;
  };

  // 计算直方图数据 - 基于聚合后的结果，支持自适应分箱和系列分组
  const calculateHistogramData = (fieldName: string): ChartDataPoint[] => {
    // 检查数据有效性
    if (!aggregatedData || aggregatedData.length === 0) {
      return [];
    }

    // 准备数据：如果有系列字段，则包含系列信息
    let dataWithSeries: Array<{ value: number; series?: string }> = [];

    if (!config.seriesField) {
      // 没有系列字段，直接获取数值
      dataWithSeries = getAggregatedFieldValues(fieldName).map(value => ({ value }));
    } else {
      // 有系列字段，按系列分组获取数值
      const seriesFieldName = config.seriesField!;
      dataWithSeries = aggregatedData
        .map(row => ({
          value: row[fieldName],
          series: (row[seriesFieldName] as string) || '其他'
        }))
        .filter(item => typeof item.value === 'number' && !isNaN(item.value));
    }

    if (dataWithSeries.length === 0) return [];

    // 获取所有值的范围（用于计算bins边界）
    const allValues = dataWithSeries.map(d => d.value);

    // 使用循环计算min和max，避免大数据量时的栈溢出
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < allValues.length; i++) {
      const value = allValues[i];
      if (value < min) min = value;
      if (value > max) max = value;
    }

    // 如果所有值相同，返回单个bin
    if (min === max) {
      if (!config.seriesField) {
        return [{
          range: `${min}`,
          count: allValues.length,
          rangeStart: min,
          rangeEnd: max,
          rangeCenter: min
        }];
      } else {
        // 有系列字段，计算每个系列的count
        const bin: ChartDataPoint = {
          range: `${min}`,
          rangeStart: min,
          rangeEnd: max,
          rangeCenter: min,
          count: 0
        };
        dataWithSeries.forEach(d => {
          const seriesName = d.series || '其他';
          bin[seriesName] = (bin[seriesName] || 0) + 1;
          bin.count = (bin.count || 0) + 1;
        });
        return [bin];
      }
    }

    const bins: ChartDataPoint[] = [];
    const allUniqueSeries = config.seriesField
      ? [...new Set(dataWithSeries.map(d => d.series).filter(s => s))]
      : [];

    // 计算bins边界
    type BinBoundary = { start: number; end: number };
    let binBoundaries: BinBoundary[] = [];

    // 等宽分箱
    const epsilon = (max - min) * 0.0001;
    const adjustedMax = max + epsilon;
    const binWidth = (adjustedMax - min) / config.binCount;

    for (let i = 0; i < config.binCount; i++) {
      const binStart = min + i * binWidth;
      const binEnd = binStart + binWidth;
      binBoundaries.push({ start: binStart, end: binEnd });
    }

    // 填充bins数据
    binBoundaries.forEach((boundary, i) => {
      let binValues: Array<{ value: number; series?: string }> = [];

      // 使用数值过滤
      const { start, end } = boundary;
      binValues = dataWithSeries.filter(d =>
        d.value >= start && (i === binBoundaries.length - 1 ? d.value <= end : d.value < end)
      );

      // 生成区间标签 - 使用 ~ 符号，确保区间边界不重叠
      let label = '';
      if (end - start >= 1) {
        // 使用 floor 向下取整，确保前一个区间的结束值 < 后一个区间的起始值
        // 例如：16.5-34.0 显示为 "16~33"，34.1-51.6 显示为 "34~51"
        const displayStart = Math.floor(start);
        const displayEnd = Math.floor(end - 0.0001); // 减去一个微小值确保不与下一个区间的起始重叠
        label = `${displayStart}~${displayEnd}`;
      } else {
        const precision = Math.max(0, -Math.floor(Math.log10(end - start || 0.001)) + 1);
        const startFixed = start.toFixed(precision);
        const endFixed = (end - Math.pow(10, -precision) * 0.1).toFixed(precision); // 确保结束值不重叠
        label = `${startFixed}~${endFixed}`;
      }

      const bin: ChartDataPoint = {
        range: label,
        rangeStart: start,
        rangeEnd: end,
        rangeCenter: (start + end) / 2,
        count: 0
      };

      if (!config.seriesField) {
        // 没有系列字段，只记录总数
        bin.count = binValues.length;
      } else {
        // 有系列字段，记录每个系列的count
        binValues.forEach(d => {
          const seriesName = d.series || '其他';
          bin[seriesName] = (bin[seriesName] || 0) + 1;
          bin.count = (bin.count || 0) + 1;
        });
      }

      bins.push(bin);
    });

    // 按rangeStart升序排序
    bins.sort((a, b) => a.rangeStart - b.rangeStart);

    debugLog(`[${fieldName}] 计算直方图bins完成:`, {
      binCount: bins.length,
      totalDataPoints: dataWithSeries.length,
      binsWithCount: bins.filter(b => b.count > 0).length,
      sampleBins: bins.slice(0, 5)
    });

    // 计算累积百分比
    if (!config.seriesField) {
      // 没有系列字段，计算总的累积百分比
      let cumulativeCount = 0;
      const totalCount = bins.reduce((sum, bin) => sum + (bin.count || 0), 0);

      debugLog(`[${fieldName}] 计算累积百分比 (无系列):`, {
        totalCount,
        binCount: bins.length
      });

      bins.forEach(bin => {
        cumulativeCount += (bin.count || 0);
        (bin as any).cumulativePercent = totalCount > 0 ? (cumulativeCount / totalCount) * 100 : 0;
      });

      debugLog(`[${fieldName}] 累积百分比示例:`, bins.map(b => ({
        range: b.range,
        count: b.count,
        cumulativePercent: (b as any).cumulativePercent
      })));
    } else {
      // 有系列字段，为每个系列分别计算累积百分比
      const allSeriesValues = [...new Set(dataWithSeries.map(d => d.series || '其他'))];

      debugLog(`[${fieldName}] 计算累积百分比 (有系列):`, {
        allSeriesValues,
        binCount: bins.length
      });

      // 为每个系列计算总数
      const seriesTotals: { [key: string]: number } = {};
      allSeriesValues.forEach(seriesName => {
        seriesTotals[seriesName] = dataWithSeries.filter(d => (d.series || '其他') === seriesName).length;
      });

      debugLog(`[${fieldName}] 系列总数:`, seriesTotals);

      // 为每个系列计算累积百分比
      const seriesCumulativeCounts: { [key: string]: number } = {};
      allSeriesValues.forEach(seriesName => {
        seriesCumulativeCounts[seriesName] = 0;
      });

      bins.forEach(bin => {
        allSeriesValues.forEach(seriesName => {
          const seriesCount = (bin as any)[seriesName] || 0;
          seriesCumulativeCounts[seriesName] += seriesCount;
          (bin as any)[`${seriesName}_cumulative`] = seriesTotals[seriesName] > 0
            ? (seriesCumulativeCounts[seriesName] / seriesTotals[seriesName]) * 100
            : 0;
        });
      });

      debugLog(`[${fieldName}] 累积百分比示例:`, bins.slice(0, 3).map(b => ({
        range: b.range,
        seriesCounts: allSeriesValues.map(s => ({ [s]: (b as any)[s] || 0 })),
        cumulative: allSeriesValues.map(s => ({ [s]: (b as any)[`${s}_cumulative`]?.toFixed(2) || 0 }))
      })));
    }

    return bins;
  };

  // 统计指标接口
  interface Statistics {
    count: number;
    min: number;
    max: number;
    mean: number;
    median: number;
    q1: number;
    q3: number;
    range: number;
    iqr: number;
  }

  // 计算统计指标
  const calculateStatistics = (values: number[]): Statistics | null => {
    if (values.length === 0) return null;

    const sorted = [...values].sort((a, b) => a - b);
    const min = sorted[0];
    const max = sorted[sorted.length - 1];
    const sum = sorted.reduce((a, b) => a + b, 0);
    const mean = sum / sorted.length;
    const median = sorted[Math.floor(sorted.length / 2)];
    const q1 = sorted[Math.floor(sorted.length / 4)];
    const q3 = sorted[Math.floor((sorted.length * 3) / 4)];

    return {
      count: sorted.length,
      min,
      max,
      mean,
      median,
      q1,
      q3,
      range: max - min,
      iqr: q3 - q1
    };
  };

  // 渲染直方图
  const renderHistogram = (fieldName: string, baseColor: string) => {
    // 格式化倍数刻度标签
    const formatMultiplicativeScaleLabel = (logValue: number) => {
      // log10转换后的值
      // log10(10) = 1 -> 10×1
      // log10(20) ≈ 1.301 -> 10×2
      // ...
      // log10(100) = 2 -> 10×10
      if (logValue < 1) {
        // 小于10%的不显示倍数刻度标签
        return '';
      }
      const originalValue = Math.pow(10, logValue);
      const multiplier = originalValue / 10;
      return ` (10×${Math.round(multiplier)})`;
    };

    const data = calculateHistogramData(fieldName);

    if (data.length === 0) {
      return <div className="text-gray-500 text-center py-4">暂无数据</div>;
    }

    // 检测是否有系列字段
    const hasSeries = !!config.seriesField;

    // 获取所有唯一的系列值
    const allSeriesValues = hasSeries
      ? [...new Set(data.flatMap(d =>
          Object.keys(d).filter(k =>
            !['range', 'rangeStart', 'rangeEnd', 'rangeCenter', 'count'].includes(k) &&
            !k.endsWith('_cumulative') // 排除累积百分比字段
          )
        ))]
      : [];

    // 系列颜色映射
    const seriesColors = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#06B6D4'];

    // 累积分布曲线颜色（使用系列对应的颜色但更浅，便于区分）
    const getCumulativeColor = (index: number) => {
      const baseColor = seriesColors[index % seriesColors.length];
      return baseColor;
    };

    // 计算对数刻度
    const calculateLogScaleTicks = () => {
      // 获取所有count值的最大值（包括系列字段）
      let maxCount = 0;
      data.forEach(bin => {
        if (hasSeries) {
          allSeriesValues.forEach(series => {
            const count = (bin as any)[series] || 0;
            maxCount = Math.max(maxCount, count);
          });
        } else {
          maxCount = Math.max(maxCount, bin.count || 0);
        }
      });

      // 如果没有数据，返回默认刻度
      if (maxCount <= 0) {
        return [0, 1, 10, 100];
      }

      // 计算对数范围（从10^0到10的幂次）
      const minPower = 0; // 从10^0开始
      const maxPower = Math.ceil(Math.log10(maxCount)); // 最大幂次

      // 生成刻度值：1, 10, 100, 1000...（从10^0开始）
      const ticks: number[] = [];
      ticks.push(0); // 包含0刻度
      for (let power = minPower; power <= maxPower; power++) {
        ticks.push(Math.pow(10, power));
      }

      debugLog(`[${fieldName}] 对数刻度计算:`, {
        maxCount,
        minPower,
        maxPower,
        ticks
      });

      return ticks;
    };

    // 格式化对数刻度标签
    const formatLogTickLabel = (value: number) => {
      if (value === 0) return '0';
      if (value === 1) return '10⁰';
      const power = Math.round(Math.log10(value));
      return `10${String.fromCharCode(0x2070 + power)}`; // 使用上标字符
    };

    const logScaleTicks = calculateLogScaleTicks();

    // 创建对数转换后的数据（仅用于对数刻度显示）
    const logScaleData = config.useLogScale
      ? data.map(bin => {
          const logBin: any = { ...bin };
          if (hasSeries) {
            allSeriesValues.forEach(series => {
              const count = (bin as any)[series] || 0;
              // 对数转换：log10(count) + 1，这样count=1对应刻度1（显示为10^0），count=10对应刻度2（显示为10^1），以此类推
              logBin[series] = count > 0 ? Math.log10(count) + 1 : null;
            });
          } else {
            const count = bin.count || 0;
            logBin.count = count > 0 ? Math.log10(count) + 1 : null;
          }
          // 计算对数值的rangeCenter（保持区间中心不变）
          logBin.logRangeCenter = bin.rangeCenter !== undefined && bin.rangeCenter > 0 ? Math.log10(bin.rangeCenter) : 0;
          return logBin;
        })
      : data;

    // 过滤掉count为0的区间，让柱子更紧凑美观
    const renderData = config.useLogScale ? logScaleData : data;
    const filteredData = renderData.filter(bin => {
      if (hasSeries) {
        // 有系列字段：检查是否所有系列的count都为0
        const allZero = allSeriesValues.every(series => {
          const count = (bin as any)[series] || 0;
          return count === 0;
        });
        return !allZero; // 保留至少有一个系列有数据的区间
      } else {
        // 无系列字段：过滤掉count为0的区间
        return (bin.count || 0) > 0;
      }
    });

    // 注意：累积百分比使用原始data中计算的值，不要基于filteredData重新计算
    // 因为累积百分比应该反映在整个数据分布中的累积比例，而不是只基于可见区间中的数据比例

    // 重新调整过滤后数据的rangeStart和rangeEnd，让它们紧凑连续且宽度一致
    // 每个柱子占据相同的宽度
    const binCount = filteredData.length;
    const binWidth = binCount > 0 ? 1 / binCount : 1;

    const compactData = filteredData.map((bin, index) => {
      const newRangeStart = index * binWidth;
      const newRangeEnd = newRangeStart + binWidth;
      return {
        ...bin,
        rangeStart: newRangeStart,
        rangeEnd: newRangeEnd,
        rangeCenter: (newRangeStart + newRangeEnd) / 2
      };
    });

    // 使用紧凑排列的数据
    let chartData = compactData;

    // 如果累积曲线使用倍数刻度，需要对累积百分比进行对数转换
    if (config.showCumulative && config.useCumulativeMultiplicativeScale) {
      chartData = chartData.map(bin => {
        const transformedBin: any = { ...bin };
        if (hasSeries) {
          allSeriesValues.forEach(series => {
            const cumulative = (bin as any)[`${series}_cumulative`] || 0;
            // 对数转换：log10(cumulative)，这样cumulative=100对应2，cumulative=10对应1，cumulative=1对应0
            // 避免log10(0)的问题，使用一个小值替代
            transformedBin[`${series}_cumulative_log`] = cumulative > 0 ? Math.log10(cumulative) : -10;
          });
        } else {
          const cumulative = (bin as any).cumulativePercent || 0;
          transformedBin.cumulativePercent_log = cumulative > 0 ? Math.log10(cumulative) : -10;
        }
        return transformedBin;
      });
    }

    debugLog(`[${fieldName}] 数据过滤:`, {
      originalDataLength: renderData.length,
      filteredDataLength: filteredData.length,
      removedBins: renderData.length - filteredData.length,
      chartDataLength: chartData.length,
      // 验证累积百分比是否正确
      cumulativePercentCheck: config.showCumulative && !hasSeries ? {
        originalDataCumulative: data.slice(0, 5).map(d => ({ range: d.range, cumulative: (d as any).cumulativePercent?.toFixed(2) })),
        filteredDataCumulative: filteredData.slice(0, 5).map(d => ({ range: d.range, cumulative: (d as any).cumulativePercent?.toFixed(2) })),
        originalTotal: data.reduce((sum, d) => sum + (d.count || 0), 0),
        filteredTotal: filteredData.reduce((sum, d) => sum + (d.count || 0), 0)
      } : null
    });

    // 计算对数刻度范围（用于Y轴）- 基于原始数据，确保Y轴范围完整
    let maxLogPower = 0;
    data.forEach(bin => {
      if (hasSeries) {
        allSeriesValues.forEach(series => {
          const count = (bin as any)[series] || 0;
          if (count > 0) {
            // 对数转换后加1，所以最大幂次也需要加1
            maxLogPower = Math.max(maxLogPower, Math.ceil(Math.log10(count)) + 1);
          }
        });
      } else {
        const count = bin.count || 0;
        if (count > 0) {
          // 对数转换后加1，所以最大幂次也需要加1
          maxLogPower = Math.max(maxLogPower, Math.ceil(Math.log10(count)) + 1);
        }
      }
    });

    // 确保至少有刻度0和刻度1（10^0）
    if (maxLogPower === 0) {
      maxLogPower = 1;
    }

    // 对数刻度的刻度值（0, 1, 2, 3...），其中1对应10^0，2对应10^1，以此类推
    const logPowerTicks = config.useLogScale
      ? [0, ...Array.from({ length: maxLogPower }, (_, i) => i + 1)]
      : undefined;

    debugLog(`[${fieldName}] Y轴配置:`, {
      useLogScale: config.useLogScale,
      maxLogPower,
      logScaleTicks,
      logPowerTicks,
      dataLength: data.length,
      filteredDataLength: filteredData.length,
      sampleFilteredData: filteredData.slice(0, 3),
      binMethod: config.binMethod,
      dataSample: data.slice(0, 5).map(d => ({
        range: d.range,
        count: d.count,
        hasSeries: hasSeries
      }))
    });

    // 计算线性刻度的最大值（用于设置 Y 轴范围，让柱子显示更高）
    let linearYMax = 0;
    if (!config.useLogScale) {
      renderData.forEach(bin => {
        if (hasSeries) {
          allSeriesValues.forEach(series => {
            const count = (bin as any)[series] || 0;
            linearYMax = Math.max(linearYMax, count);
          });
        } else {
          linearYMax = Math.max(linearYMax, bin.count || 0);
        }
      });
      // 添加 10% 的顶部 padding，避免柱子顶到图表边缘
      linearYMax = Math.ceil(linearYMax * 1.1);
    }

    // 添加调试日志
    debugLog(`直方图数据 [${fieldName}]:`, {
      fieldName,
      binMethod: config.binMethod,
      hasSeries,
      seriesField: config.seriesField,
      seriesCount: allSeriesValues.length,
      seriesValues: allSeriesValues,
      binCount: data.length,
      data: data.map(d => ({ range: d.range, rangeStart: d.rangeStart, rangeEnd: d.rangeEnd, count: d.count })),
      showCumulative: config.showCumulative,
      showCumulativeLegend: config.showCumulativeLegend,
      useLogScale: config.useLogScale,
      logScaleTicks: logScaleTicks
    });

    // 检查数据中是否有 count 或系列字段
    if (data.length > 0) {
      debugLog(`[调试] [${fieldName}] 第一个bin的数据结构:`, data[0]);
      debugLog(`[调试] [${fieldName}] 第一个bin的所有键:`, Object.keys(data[0]));

      if (config.showCumulative) {
        if (hasSeries) {
          allSeriesValues.forEach(series => {
            const cumData = data.map(d => d[`${series}_cumulative`]);
            debugLog(`[调试] [${fieldName}] 系列 "${series}" 的累积百分比:`, cumData);
            debugLog(`[调试] [${fieldName}] 系列 "${series}" 的累积百分比数据完整性:`, cumData.every(v => v !== undefined && v !== null && !isNaN(v)));
          });
        } else {
          const cumData = data.map(d => (d as any).cumulativePercent);
          debugLog(`[调试] [${fieldName}] 无系列的累积百分比:`, cumData);
          debugLog(`[调试] [${fieldName}] 无系列的累积百分比数据完整性:`, cumData.every(v => v !== undefined && v !== null && !isNaN(v)));
        }
      }
    }

    // 如果过滤后没有数据，显示提示信息
    if (chartData.length === 0) {
      return (
        <div key={fieldName} className="mb-6">
          <h4 className="text-sm font-semibold text-gray-800 mb-3">
            {fieldName} 分布图（{config.binCount}个区间）
            {hasSeries && ` - 按${config.seriesField}分组`}
          </h4>
          <div className="text-gray-500 text-center py-8 bg-gray-50 rounded-lg">
            <p>所有区间的对象数量均为0，暂无数据可显示</p>
          </div>
        </div>
      );
    }

    // 打印过滤后的数据详情，便于调试
    debugLog(`[${fieldName}] 渲染数据:`, {
      chartDataLength: chartData.length,
      chartData: chartData.map(d => ({
        range: d.range,
        rangeStart: d.rangeStart,
        rangeEnd: d.rangeEnd,
        rangeCenter: d.rangeCenter,
        count: d.count
      })),
      hasSeries,
      seriesCount: allSeriesValues.length
    });

    return (
      <ResponsiveContainer width="100%" height={calculateChartHeight.histogramHeight}>
          <ComposedChart data={chartData} margin={{ top: 15, right: 15, left: 45, bottom: 45 }}>
            <XAxis
              dataKey="range"
              type="category"
              tickFormatter={(value) => value as string}
              tick={{ fontSize: 8 }}
              interval="preserveStartEnd"
              angle={-45}
              textAnchor="end"
              height={50}
              label={{ value: '数据区间', position: 'insideBottom', offset: -3, fontSize: 8 }}
            />
            <YAxis
              yAxisId="left"
              tick={{ fontSize: 8 }}
              label={{ value: config.useLogScale ? '对象数量（对数）' : '对象数量', angle: -90, position: 'insideLeft', fontSize: 8 }}
              scale="linear"
              ticks={config.useLogScale ? logPowerTicks : undefined}
              tickFormatter={config.useLogScale ? (value: any) => {
                if (value === 0) return '0';
                const power = Math.round(value) - 1;
                return `10^${power}`;
              } : undefined}
              domain={config.useLogScale ? [0, maxLogPower] : [0, linearYMax]}
            />
            {config.showCumulative && (
              <YAxis
                yAxisId="right"
                orientation="right"
                tick={{ fontSize: 8 }}
                label={{ value: config.useCumulativeMultiplicativeScale ? '累积(×)' : '累积%', angle: 90, position: 'insideRight', fontSize: 8 }}
                domain={config.useCumulativeMultiplicativeScale ? [1, 2] : [0, 100]}
                ticks={config.useCumulativeMultiplicativeScale ? [1, 1.301, 1.477, 1.602, 1.699, 1.778, 1.845, 1.903, 1.954, 2] : undefined}
                tickFormatter={config.useCumulativeMultiplicativeScale ? (value: any) => {
                  // 将对数刻度值转换为百分比标签
                  // log10(10) = 1 -> 10×1
                  // log10(20) ≈ 1.301 -> 10×2
                  // log10(30) ≈ 1.477 -> 10×3
                  // ...
                  // log10(100) = 2 -> 10×10
                  const power = value;
                  const originalValue = Math.pow(10, power);
                  const multiplier = originalValue / 10;
                  return `10×${Math.round(multiplier)}`;
                } : undefined}
              />
            )}
            <Tooltip
              content={({ active, payload }) => {
                if (active && payload && payload.length) {
                  const data = payload[0].payload as any;
                  return (
                    <div className="bg-white p-3 border rounded shadow-lg">
                      <p className="font-semibold text-sm mb-2">
                        区间: [{data.rangeStart ? formatNumberWithCommas(data.rangeStart) : '-'}, {data.rangeEnd ? formatNumberWithCommas(data.rangeEnd) : '-'}]
                      </p>
                      {hasSeries ? (
                        <div className="space-y-1">
                          <p className="text-sm">总计: {data.count}</p>
                          {allSeriesValues.map(series => (
                            <div key={series} className="text-sm text-gray-600">
                              <div>{series}: {data[series] || 0}</div>
                              {config.showCumulative && (
                                <div className="text-xs" style={{ color: getCumulativeColor(allSeriesValues.indexOf(series)) }}>
                                  累积: {data[`${series}_cumulative`] ? formatNumberWithCommas(data[`${series}_cumulative`]) : 0}%
                                  {config.useCumulativeMultiplicativeScale && data[`${series}_cumulative_log`] !== undefined && data[`${series}_cumulative_log`] !== null && data[`${series}_cumulative_log`] >= 1 && formatMultiplicativeScaleLabel(data[`${series}_cumulative_log`])}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-sm">数量: {data.count}</p>
                      )}
                      {!hasSeries && config.showCumulative && (
                        <p className="text-sm font-medium text-blue-600 mt-2">
                          累积百分比: {data.cumulativePercent ? formatNumberWithCommas(data.cumulativePercent) : '-'}%
                          {config.useCumulativeMultiplicativeScale && data.cumulativePercent_log !== undefined && data.cumulativePercent_log !== null && data.cumulativePercent_log >= 1 && formatMultiplicativeScaleLabel(data.cumulativePercent_log)}
                        </p>
                      )}
                    </div>
                  );
                }
                return null;
              }}
            />
            {hasSeries ? (
              <>
                {/* 有系列字段，渲染多个系列 */}
                {allSeriesValues.map((series, index) => (
                  <Bar
                    key={series}
                    yAxisId="left"
                    dataKey={series}
                    name={series}
                    fill={seriesColors[index % seriesColors.length]}
                  />
                ))}
                <Legend verticalAlign="top" align="center" wrapperStyle={{ paddingBottom: 2, fontSize: '9px' }} />
              </>
            ) : (
              <>
                {/* 无系列字段，渲染单个柱子 */}
                <Bar yAxisId="left" dataKey="count" name="数量" fill={baseColor} />
                {/* 无系列字段时，如果显示累积分布曲线且配置了显示图例，则显示图例 */}
                {config.showCumulative && config.showCumulativeLegend && <Legend verticalAlign="top" align="center" wrapperStyle={{ paddingBottom: 2, fontSize: '9px' }} />}
              </>
            )}
            {config.showCumulative && hasSeries ? (
              /* 有系列字段，为每个系列渲染累积分布曲线 */
              allSeriesValues.map((series, index) => (
                <Line
                  key={`cumulative-${series}`}
                  yAxisId="right"
                  type="monotone"
                  dataKey={config.useCumulativeMultiplicativeScale ? `${series}_cumulative_log` : `${series}_cumulative`}
                  name={`${series}累积`}
                  stroke={getCumulativeColor(index)}
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4 }}
                  strokeDasharray={index === 0 ? '' : '5 3'} // 第一条曲线实线，其他虚线区分
                  legendType="line"
                  hide={!config.showCumulativeLegend} // 根据配置决定是否在图例中显示
                  connectNulls={false}
                />
              ))
            ) : config.showCumulative ? (
              /* 无系列字段，渲染单条累积分布曲线 */
              <Line
                yAxisId="right"
                type="monotone"
                dataKey={config.useCumulativeMultiplicativeScale ? 'cumulativePercent_log' : 'cumulativePercent'}
                name="累积分布"
                stroke="#EF4444"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 6 }}
                legendType="line"
                hide={!config.showCumulativeLegend}
                connectNulls={false}
              />
            ) : null}
          </ComposedChart>
        </ResponsiveContainer>
      );
  };

  // 渲染双维度直方图统计信息表格
  const renderTwoFieldsHistogramStatsTable = (field1: string, field2: string) => {
    const data1 = calculateHistogramData(field1);
    const data2 = calculateHistogramData(field2);

    if (data1.length === 0 && data2.length === 0) {
      return null;
    }

    // 计算统计信息的辅助函数
    const calculateHistogramStats = (data: ChartDataPoint[]) => {
      if (data.length === 0) return null;

      const totalCount = data.reduce((sum, d) => sum + (d.count || 0), 0);
      const maxBin = data.reduce((max, d) => (d.count || 0) > (max.count || 0) ? d : max, data[0]);
      const dataRange = `${data[0]?.rangeStart?.toFixed(2)} - ${data[data.length - 1]?.rangeEnd?.toFixed(2)}`;

      return {
        totalCount,
        binCount: data.length,
        maxBin: maxBin.range,
        maxCount: maxBin.count,
        dataRange
      };
    };

    const stats1 = calculateHistogramStats(data1);
    const stats2 = calculateHistogramStats(data2);

    return (
      <div className="bg-white border border-gray-200 rounded-lg p-2 shadow-sm">
        <h3 className="text-xs font-semibold text-gray-900 mb-1">直方图统计信息</h3>
        <div className="overflow-x-auto" style={{ maxHeight: `${5 * 24}px`, overflowY: 'auto' }}>
          <table className="w-full text-[11px]">
          <thead>
            <tr className="border-b border-gray-200">
              <th className="py-1 px-1.5 text-left font-semibold text-gray-700">指标</th>
              <th className="py-1 px-1.5 text-center font-semibold text-blue-700">{field1}</th>
              <th className="py-1 px-1.5 text-center font-semibold text-emerald-700">{field2}</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-gray-100">
              <td className="py-1 px-1.5 text-gray-600">总对象数</td>
              <td className="py-1 px-1.5 text-center">{stats1?.totalCount ?? '-'}</td>
              <td className="py-1 px-1.5 text-center">{stats2?.totalCount ?? '-'}</td>
            </tr>
            <tr className="border-b border-gray-100">
              <td className="py-1 px-1.5 text-gray-600">有效区间数</td>
              <td className="py-1 px-1.5 text-center">{stats1?.binCount ?? '-'}</td>
              <td className="py-1 px-1.5 text-center">{stats2?.binCount ?? '-'}</td>
            </tr>
            <tr className="border-b border-gray-100">
              <td className="py-1 px-1.5 text-gray-600">最大区间</td>
              <td className="py-1 px-1.5 text-center">
                {stats1 ? (
                  <span className="text-[10px]">
                    {stats1.maxBin}
                    <span className="text-gray-500 ml-1">({stats1.maxCount})</span>
                  </span>
                ) : '-'}
              </td>
              <td className="py-1 px-1.5 text-center">
                {stats2 ? (
                  <span className="text-[10px]">
                    {stats2.maxBin}
                    <span className="text-gray-500 ml-1">({stats2.maxCount})</span>
                  </span>
                ) : '-'}
              </td>
            </tr>
            <tr>
              <td className="py-1 px-1.5 text-gray-600">数据范围</td>
              <td className="py-1 px-1.5 text-center text-[10px]">{stats1?.dataRange ?? '-'}</td>
              <td className="py-1 px-1.5 text-center text-[10px]">{stats2?.dataRange ?? '-'}</td>
            </tr>
          </tbody>
        </table>
        </div>
      </div>
    );
  };

  // 渲染箱线图（标准Box Plot，支持分组字段）
  const renderBoxPlot = (fieldName: string, color: string) => {
    const seriesColors = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#06B6D4'];

    // 检查是否配置了系列字段
    const hasSeries = !!config.seriesField;

    // 系列统计数据
    interface SeriesStats {
      seriesName: string;
      stats: ReturnType<typeof calculateStatistics>;
      color: string;
    }

    let seriesStatsList: SeriesStats[] = [];

    if (hasSeries) {
      // 有系列字段，按系列分组计算统计指标
      const seriesFieldName = config.seriesField!;
      const allSeriesValues = Array.from(
        new Set(aggregatedData.map(row => (row[seriesFieldName] as string) || '其他'))
      );

      seriesStatsList = allSeriesValues.map((seriesName, index) => {
        const values = aggregatedData
          .filter(row => (row[seriesFieldName] as string) === seriesName)
          .map(row => row[fieldName])
          .filter((value): value is number => typeof value === 'number' && !isNaN(value));

        return {
          seriesName,
          stats: calculateStatistics(values),
          color: seriesColors[index % seriesColors.length]
        };
      }).filter(s => s.stats !== null) as SeriesStats[];
    } else {
      // 没有系列字段，计算整体统计指标
      const values = getAggregatedFieldValues(fieldName);
      const stats = calculateStatistics(values);

      if (stats) {
        seriesStatsList = [{
          seriesName: '全部',
          stats,
          color
        }];
      }
    }

    if (seriesStatsList.length === 0) {
      return <div className="text-gray-500 text-center py-4">暂无数据</div>;
    }

    // 计算所有系列的X轴范围（统一范围）
    const allMin = Math.min(...seriesStatsList.map(s => s.stats!.min));
    const allMax = Math.max(...seriesStatsList.map(s => s.stats!.max));
    const padding = (allMax - allMin) * 0.1;
    const xDomain = [allMin - padding, allMax + padding];

    // 如果只有一个系列且无系列字段，使用简化的单系列布局
    const singleSeriesMode = !hasSeries && seriesStatsList.length === 1;

    // Box图使用与直方图相同的固定高度，并确保SVG内容填充整个容器
    const singleBoxHeight = calculateChartHeight.boxPlotHeight;

    return (
      <div style={{ height: `${singleBoxHeight}px`, width: '100%' }}>
        <svg width="100%" height="100%" viewBox={`0 0 800 ${singleBoxHeight}`} preserveAspectRatio="xMidYMid meet">
          {/* 标题（仅在有多系列时显示） */}
          {hasSeries && (
            <text x="400" y="25" textAnchor="middle" fontSize="14" fontWeight="bold" fill="#374151">
              {fieldName} Box Plot
              {hasSeries && ` (按${config.seriesField}分组)`}
            </text>
          )}

          {/* 坐标轴 - 使用与直方图一致的margin: top=40, left=60, bottom=60, right=30 */}
          <g transform="translate(60, 40)">
            {/* X轴线 */}
            {(() => {
              const contentHeight = 220; // 总高度320 - top=40 - bottom=60
              const scaleX = (value: number) =>
                ((value - xDomain[0]) / (xDomain[1] - xDomain[0])) * 740;

              const seriesBoxHeight = 50; // 每个系列盒子的高度
              const seriesGap = 25; // 系列之间的间隙

              // 计算X轴位置（在底部，距离top偏移220px）
              const xAxisY = contentHeight;

              return (
                <line x1="0" y1={xAxisY} x2="740" y2={xAxisY} stroke="#9CA3AF" strokeWidth="1" />
              );
            })()}

            {/* 计算X坐标函数和渲染Box Plot */}
            {(() => {
              const contentHeight = 220; // 总高度320 - top=40 - bottom=60
              const scaleX = (value: number) =>
                ((value - xDomain[0]) / (xDomain[1] - xDomain[0])) * 740;

              const seriesBoxHeight = 50; // 每个系列盒子的高度
              const seriesGap = 25; // 系列之间的间隙

              return (
                <>
                  {/* 渲染每个系列的Box Plot */}
                  {seriesStatsList.map((seriesStats, index) => {
                    const stats = seriesStats.stats!;
                    // 垂直居中布局：所有系列居中显示在内容区域内
                    const totalSeriesHeight = seriesStatsList.length * seriesBoxHeight + (seriesStatsList.length - 1) * seriesGap;
                    const startY = hasSeries ? (contentHeight - totalSeriesHeight) / 2 : (contentHeight - seriesBoxHeight) / 2;
                    const boxY = startY + index * (seriesBoxHeight + seriesGap);

                    const xMin = scaleX(stats.min);
                    const xQ1 = scaleX(stats.q1);
                    const xMedian = scaleX(stats.median);
                    const xQ3 = scaleX(stats.q3);
                    const xMax = scaleX(stats.max);
                    const boxHeight = seriesBoxHeight;

                    return (
                      <g key={seriesStats.seriesName}>
                        {/* 系列标签 */}
                        {hasSeries && (
                          <text
                            x="-10"
                            y={boxY + boxHeight / 2}
                            textAnchor="end"
                            fontSize="11"
                            fill={seriesStats.color}
                            fontWeight="500"
                          >
                            {seriesStats.seriesName}
                          </text>
                        )}

                        {/* 下须（从最小值到Q1） */}
                        <line
                          x1={xMin}
                          y1={boxY + boxHeight / 2}
                          x2={xQ1}
                          y2={boxY + boxHeight / 2}
                          stroke={seriesStats.color}
                          strokeWidth={2}
                        />

                        {/* 下须端点（最小值处） */}
                        <line
                          x1={xMin}
                          y1={boxY + boxHeight / 2 - (hasSeries ? 5 : 10)}
                          x2={xMin}
                          y2={boxY + boxHeight / 2 + (hasSeries ? 5 : 10)}
                          stroke={seriesStats.color}
                          strokeWidth={2}
                        />

                        {/* 盒子（从Q1到Q3） */}
                        <rect
                          x={xQ1}
                          y={boxY}
                          width={xQ3 - xQ1}
                          height={boxHeight}
                          fill={seriesStats.color}
                          fillOpacity="0.3"
                          stroke={seriesStats.color}
                          strokeWidth={2}
                        />

                        {/* 中位数线 */}
                        <line
                          x1={xMedian}
                          y1={boxY}
                          x2={xMedian}
                          y2={boxY + boxHeight}
                          stroke="#000000"
                          strokeWidth={2}
                        />

                        {/* 上须（从Q3到最大值） */}
                        <line
                          x1={xQ3}
                          y1={boxY + boxHeight / 2}
                          x2={xMax}
                          y2={boxY + boxHeight / 2}
                          stroke={seriesStats.color}
                          strokeWidth={2}
                        />

                        {/* 上须端点（最大值处） */}
                        <line
                          x1={xMax}
                          y1={boxY + boxHeight / 2 - (hasSeries ? 5 : 10)}
                          x2={xMax}
                          y2={boxY + boxHeight / 2 + (hasSeries ? 5 : 10)}
                          stroke={seriesStats.color}
                          strokeWidth={2}
                        />

                        {/* 标注（只在单系列模式下显示详细数值） */}
                        {!hasSeries && (
                          <g fontSize="10" fill="#6B7280">
                            <text x={xMin} y={boxY + boxHeight / 2 - 15} textAnchor="middle">
                              {formatNumberWithCommas(stats.min, 1)}
                            </text>
                            <text x={xQ1} y={boxY - 5} textAnchor="middle">
                              Q1: {formatNumberWithCommas(stats.q1, 1)}
                            </text>
                            <text x={xMedian} y={boxY - 5} textAnchor="middle">
                              中位数: {formatNumberWithCommas(stats.median, 1)}
                            </text>
                            <text x={xQ3} y={boxY - 5} textAnchor="middle">
                              Q3: {formatNumberWithCommas(stats.q3, 1)}
                            </text>
                            <text x={xMax} y={boxY + boxHeight / 2 - 15} textAnchor="middle">
                              {formatNumberWithCommas(stats.max, 1)}
                            </text>
                          </g>
                        )}
                      </g>
                    );
                  })}

                  {/* X轴刻度 */}
                  {(() => {
                    const xAxisY = 220; // 内容区域底部
                    const xTicks = [
                      { value: xDomain[0], label: formatNumberWithCommas(xDomain[0], 0) },
                      { value: (xDomain[0] + xDomain[1]) / 4, label: formatNumberWithCommas((xDomain[0] + xDomain[1]) / 4, 0) },
                      { value: (xDomain[0] + xDomain[1]) / 2, label: formatNumberWithCommas((xDomain[0] + xDomain[1]) / 2, 0) },
                      { value: (xDomain[0] + xDomain[1]) * 3 / 4, label: formatNumberWithCommas((xDomain[0] + xDomain[1]) * 3 / 4, 0) },
                      { value: xDomain[1], label: formatNumberWithCommas(xDomain[1], 0) }
                    ];

                    return (
                      <>
                        {xTicks.map((tick, index) => {
                          return (
                            <g key={index}>
                              <line
                                x1={scaleX(tick.value)}
                                y1={xAxisY}
                                x2={scaleX(tick.value)}
                                y2={xAxisY + 6}
                                stroke="#9CA3AF"
                                strokeWidth={1}
                              />
                              <text
                                x={scaleX(tick.value)}
                                y={xAxisY + 20}
                                textAnchor="middle"
                                fontSize="11"
                                fill="#6B7280"
                              >
                                {tick.label}
                              </text>
                            </g>
                          );
                        })}
                      </>
                    );
                  })()}
                </>
              );
            })()}
          </g>
        </svg>
      </div>
    );
  };

  // 渲染双维度统计对比表格
  const renderTwoFieldsStatsTable = (field1: string, field2: string) => {
    const hasSeries = !!config.seriesField;
    const seriesColors = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#06B6D4'];

    if (hasSeries) {
      // 有系列字段：系列在列呈现
      const seriesFieldName = config.seriesField!;
      const allSeriesValues = Array.from(
        new Set(aggregatedData.map(row => (row[seriesFieldName] as string) || '其他'))
      );

      // 为每个系列计算两个维度的统计信息
      const seriesStatsList = allSeriesValues.map((seriesName, index) => {
        const seriesData = aggregatedData.filter(row => (row[seriesFieldName] as string) === seriesName);
        const values1 = seriesData.map(row => row[field1]).filter((v): v is number => typeof v === 'number' && !isNaN(v));
        const values2 = seriesData.map(row => row[field2]).filter((v): v is number => typeof v === 'number' && !isNaN(v));

        return {
          seriesName,
          stats1: calculateStatistics(values1),
          stats2: calculateStatistics(values2),
          color: seriesColors[index % seriesColors.length]
        };
      }).filter(s => s.stats1 !== null && s.stats2 !== null);

      if (seriesStatsList.length === 0) {
        return null;
      }

      const metrics = [
        { key: 'count', label: '对象数' },
        { key: 'min', label: '最小值' },
        { key: 'q1', label: 'Q1' },
        { key: 'median', label: '中位数' },
        { key: 'mean', label: '平均值' },
        { key: 'q3', label: 'Q3' },
        { key: 'max', label: '最大值' },
        { key: 'range', label: '范围' },
        { key: 'iqr', label: 'IQR' }
      ];

      return (
        <div className="bg-white border border-gray-200 rounded-lg p-2 shadow-sm">
          <h3 className="text-xs font-semibold text-gray-900 mb-1 flex items-center">
            <span className="mr-1">📊</span> 详细统计（按系列分组）
          </h3>
          <div className="overflow-x-auto" style={{ maxHeight: `${(2 + 9) * 24}px`, overflowY: 'auto' }}>
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="sticky top-0 z-10">
                  {/* 第一行：系列名称和字段名 */}
                  <th className="border border-gray-300 py-1 px-1.5 text-left font-semibold text-gray-700 w-20 sticky left-0 z-20">
                    指标
                  </th>
                  {seriesStatsList.map((seriesData) => (
                    <React.Fragment key={`header-${seriesData.seriesName}`}>
                      <th
                        className="border border-gray-300 py-1 px-1.5 text-center font-semibold"
                        colSpan={2}
                        style={{ backgroundColor: `${seriesData.color}20`, color: seriesData.color }}
                      >
                        {seriesData.seriesName}
                      </th>
                    </React.Fragment>
                  ))}
                </tr>
                <tr className="sticky top-8 z-10">
                  {/* 第二行：字段1和字段2 */}
                  <th className="border border-gray-300 py-1.5 px-2 text-left font-semibold text-gray-700 sticky left-0 z-20">
                  </th>
                  {seriesStatsList.map((seriesData) => (
                    <React.Fragment key={`subheader-${seriesData.seriesName}`}>
                      <th
                        className="border border-gray-300 py-1 px-1.5 text-center font-semibold"
                        style={{ color: '#2563EB', backgroundColor: '#EFF6FF' }}
                      >
                        {field1}
                      </th>
                      <th
                        className="border border-gray-300 py-1 px-1.5 text-center font-semibold"
                        style={{ color: '#059669', backgroundColor: '#ECFDF5' }}
                      >
                        {field2}
                      </th>
                    </React.Fragment>
                  ))}
                </tr>
              </thead>
              <tbody>
                {metrics.map((metric, metricIndex) => (
                  <tr
                    key={metric.key}
                    className={metricIndex % 2 === 0 ? 'bg-white' : 'bg-gray-50'}
                  >
                    {/* 指标名称 */}
                    <td className="border border-gray-200 py-1 px-1.5 text-gray-700 font-medium sticky left-0 z-10" style={{ backgroundColor: metricIndex % 2 === 0 ? '#FFFFFF' : '#F9FAFB' }}>
                      {metric.label}
                    </td>
                    {/* 每个系列的两个字段 */}
                    {seriesStatsList.map((seriesData) => {
                      const value1 = seriesData.stats1![metric.key as keyof Statistics] as number;
                      const value2 = seriesData.stats2![metric.key as keyof Statistics] as number;

                      return (
                        <React.Fragment key={`${metric.key}-${seriesData.seriesName}`}>
                          {/* field1 列 */}
                          <td className="border border-gray-200 py-1 px-1.5 text-center">
                            <span className="inline-block px-1 py-0.5 rounded text-[10px]" style={{ backgroundColor: '#DBEAFE', color: '#1E40AF', fontWeight: 500 }}>
                              {formatNumberWithCommas(value1)}
                            </span>
                          </td>
                          {/* field2 列 */}
                          <td className="border border-gray-200 py-1 px-1.5 text-center">
                            <span className="inline-block px-1 py-0.5 rounded text-[10px]" style={{ backgroundColor: '#D1FAE5', color: '#065F46', fontWeight: 500 }}>
                              {formatNumberWithCommas(value2)}
                            </span>
                          </td>
                        </React.Fragment>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      );
    }

    // 无系列字段：显示整体统计信息
    const stats1 = calculateStatistics(getAggregatedFieldValues(field1));
    const stats2 = calculateStatistics(getAggregatedFieldValues(field2));

    if (!stats1 || !stats2) {
      return null;
    }

    return (
      <div className="bg-white border border-gray-200 rounded-lg p-2 shadow-sm">
        <h3 className="text-xs font-semibold text-gray-900 mb-1 flex items-center">
          <span className="mr-1">📊</span> 详细统计
        </h3>
        <div className="overflow-x-auto" style={{ maxHeight: `${(1 + 9) * 24}px`, overflowY: 'auto' }}>
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="bg-gradient-to-r from-blue-50 to-green-50">
                <th className="border border-gray-300 py-1 px-1.5 text-left font-semibold text-gray-700 w-16">
                  指标
                </th>
                <th className="border border-gray-300 py-1 px-1.5 text-center font-semibold" style={{ color: '#2563EB', backgroundColor: '#EFF6FF' }}>
                  {field1} <span className="text-[10px] font-normal text-gray-500 ml-1">(n={stats1.count})</span>
                </th>
                <th className="border border-gray-300 py-1 px-1.5 text-center font-semibold" style={{ color: '#059669', backgroundColor: '#ECFDF5' }}>
                  {field2} <span className="text-[10px] font-normal text-gray-500 ml-1">(n={stats2.count})</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {[
                { key: 'count', label: '对象数' },
                { key: 'min', label: '最小值' },
                { key: 'q1', label: 'Q1' },
                { key: 'median', label: '中位数' },
                { key: 'mean', label: '平均值' },
                { key: 'q3', label: 'Q3' },
                { key: 'max', label: '最大值' },
                { key: 'range', label: '范围' },
                { key: 'iqr', label: 'IQR' }
              ].map((row, rowIndex) => {
                const value1 = stats1[row.key as keyof Statistics] as number;
                const value2 = stats2[row.key as keyof Statistics] as number;

                return (
                  <tr
                    key={row.key}
                    className={rowIndex % 2 === 0 ? 'bg-white' : 'bg-gray-50'}
                  >
                    <td className="border border-gray-200 py-1 px-1.5 text-gray-700 font-medium">
                      {row.label}
                    </td>
                    <td className="border border-gray-200 py-1 px-1.5 text-center">
                      <span className="inline-block px-1 py-0.5 rounded text-[10px]" style={{ backgroundColor: '#DBEAFE', color: '#1E40AF', fontWeight: 500 }}>
                        {formatNumberWithCommas(value1)}
                      </span>
                    </td>
                    <td className="border border-gray-200 py-1 px-1.5 text-center">
                      <span className="inline-block px-1 py-0.5 rounded text-[10px]" style={{ backgroundColor: '#D1FAE5', color: '#065F46', fontWeight: 500 }}>
                        {formatNumberWithCommas(value2)}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  // 数据采样函数：基于密度的智能采样，保留极端值
  // 最多保留maxSampleSize个点，使用密度自适应采样确保极端值和稀有值不被丢失
  const sampleScatterData = <T extends { series?: string; x: number; y: number }>(
    data: T[],
    maxSampleSize: number = 10000
  ): { sampledData: T[]; wasSampled: boolean } => {
    if (data.length <= maxSampleSize) {
      return { sampledData: data, wasSampled: false };
    }

    console.log(`[数据采样] 原始数据量: ${data.length}, 最大采样数: ${maxSampleSize}`);

    // 第一步：识别并保留极端值（全局的极大值和极小值）
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    let minXPoint: T | null = null, maxXPoint: T | null = null;
    let minYPoint: T | null = null, maxYPoint: T | null = null;

    data.forEach(point => {
      if (point.x < minX) { minX = point.x; minXPoint = point; }
      if (point.x > maxX) { maxX = point.x; maxXPoint = point; }
      if (point.y < minY) { minY = point.y; minYPoint = point; }
      if (point.y > maxY) { maxY = point.y; maxYPoint = point; }
    });

    const extremePoints = new Set<T>();
    if (minXPoint) extremePoints.add(minXPoint);
    if (maxXPoint) extremePoints.add(maxXPoint);
    if (minYPoint) extremePoints.add(minYPoint);
    if (maxYPoint) extremePoints.add(maxYPoint);

    console.log(`[数据采样] 保留的极端值:`, {
      minX, maxX, minY, maxY,
      extremeCount: extremePoints.size
    });

    // 第二步：检查是否有系列分组
    const hasSeries = data.some(d => d.series !== undefined);

    if (!hasSeries) {
      // 无系列：基于密度的网格采样
      return densityBasedSampling(data, maxSampleSize, extremePoints, 'all');
    }

    // 有系列：按系列分组，每个系列独立进行密度采样
    const seriesGroups = new Map<string, T[]>();
    data.forEach(d => {
      const series = d.series || '其他';
      if (!seriesGroups.has(series)) {
        seriesGroups.set(series, []);
      }
      seriesGroups.get(series)!.push(d);
    });

    const sampled: T[] = [];
    const seriesCount = seriesGroups.size;
    const samplesPerSeries = Math.ceil(maxSampleSize / seriesCount);

    seriesGroups.forEach((seriesData, seriesName) => {
      // 每个系列的极端值
      let seriesMinX = Infinity, seriesMaxX = -Infinity;
      let seriesMinY = Infinity, seriesMaxY = -Infinity;
      let seriesMinXPoint: T | null = null, seriesMaxXPoint: T | null = null;
      let seriesMinYPoint: T | null = null, seriesMaxYPoint: T | null = null;

      seriesData.forEach(point => {
        if (point.x < seriesMinX) { seriesMinX = point.x; seriesMinXPoint = point; }
        if (point.x > seriesMaxX) { seriesMaxX = point.x; seriesMaxXPoint = point; }
        if (point.y < seriesMinY) { seriesMinY = point.y; seriesMinYPoint = point; }
        if (point.y > seriesMaxY) { seriesMaxY = point.y; seriesMaxYPoint = point; }
      });

      const seriesExtremePoints = new Set<T>();
      if (seriesMinXPoint) seriesExtremePoints.add(seriesMinXPoint);
      if (seriesMaxXPoint) seriesExtremePoints.add(seriesMaxXPoint);
      if (seriesMinYPoint) seriesExtremePoints.add(seriesMinYPoint);
      if (seriesMaxYPoint) seriesExtremePoints.add(seriesMaxYPoint);

      console.log(`[数据采样] 系列 "${seriesName}" 极端值:`, {
        minX: seriesMinX, maxX: seriesMaxX, minY: seriesMinY, maxY: seriesMaxY
      });

      // 对该系列进行密度采样
      const { sampledData: seriesSampled } = densityBasedSampling(
        seriesData,
        samplesPerSeries,
        seriesExtremePoints,
        seriesName
      );

      sampled.push(...seriesSampled);
      console.log(`[数据采样] 系列 "${seriesName}": 原始${seriesData.length}个 -> 采样${seriesSampled.length}个`);
    });

    console.log(`[数据采样] 分层密度采样完成，采样后数据量: ${sampled.length}`);
    return { sampledData: sampled, wasSampled: true };
  };

  // 基于网格密度的采样函数（辅助函数）
  const densityBasedSampling = <T extends { series?: string; x: number; y: number }>(
    data: T[],
    maxSampleSize: number,
    extremePoints: Set<T>,
    seriesId: string | 'all'
  ): { sampledData: T[]; wasSampled: boolean } => {
    if (data.length <= maxSampleSize) {
      return { sampledData: data, wasSampled: false };
    }

    // 计算X和Y的范围
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    data.forEach(p => {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    });

    const xRange = maxX - minX || 1;
    const yRange = maxY - minY || 1;

    // 动态计算网格大小：目标是让每个网格平均包含约 maxSampleSize / (rows * cols) 个点
    // 但要确保网格不会太小或太大
    const desiredPointsPerGrid = Math.ceil(data.length / maxSampleSize);

    // 计算网格行列数（基于点密度，但限制在合理范围内）
    let gridCols = Math.ceil(Math.sqrt(maxSampleSize));
    let gridRows = gridCols;

    // 如果数据分布极不均匀，调整网格大小以反映密度差异
    // 这里使用固定的网格数量，后续会根据每个网格的点数动态调整采样率
    const gridCellWidth = xRange / gridCols;
    const gridCellHeight = yRange / gridRows;

    console.log(`[密度采样] 网格配置:`, {
      seriesId,
      dataLength: data.length,
      maxSampleSize,
      gridCols,
      gridRows,
      gridCellWidth: gridCellWidth.toFixed(2),
      gridCellHeight: gridCellHeight.toFixed(2),
      desiredPointsPerGrid
    });

    // 将点分配到网格中
    const grid = new Map<string, T[]>();

    data.forEach(point => {
      const col = Math.min(Math.floor((point.x - minX) / gridCellWidth), gridCols - 1);
      const row = Math.min(Math.floor((point.y - minY) / gridCellHeight), gridRows - 1);
      const key = `${row}-${col}`;

      if (!grid.has(key)) {
        grid.set(key, []);
      }
      grid.get(key)!.push(point);
    });

    // 对每个网格进行采样
    const sampled: T[] = [];
    let totalGridPoints = 0;
    let denseGrids = 0;
    let sparseGrids = 0;
    let sparseTotalPoints = 0; // 稀疏网格的总点数

    // 计算所有网格的平均点数
    const gridPointCounts = Array.from(grid.values()).map(points => points.length);
    const averageGridPoints = gridPointCounts.reduce((a, b) => a + b, 0) / gridPointCounts.length;

    // 定义分层密集阈值
    const moderateThreshold = averageGridPoints * 2;   // 中密集：2倍平均
    const highThreshold = averageGridPoints * 3;        // 高密集：3倍平均
    const veryHighThreshold = averageGridPoints * 5;     // 超密集：5倍平均
    const extremeThreshold = averageGridPoints * 10;    // 极度密集：10倍平均

    console.log(`[密度采样] 网格密度分析:`, {
      seriesId,
      totalGrids: grid.size,
      averagePointsPerGrid: averageGridPoints.toFixed(2),
      thresholds: {
        moderate: moderateThreshold.toFixed(2),
        high: highThreshold.toFixed(2),
        veryHigh: veryHighThreshold.toFixed(2),
        extreme: extremeThreshold.toFixed(2)
      }
    });

    // 第一步：统计稀疏网格的总点数
    const sparseGridsData: Array<{ key: string; points: T[]; count: number }> = [];
    const denseGridsData: Array<{ key: string; points: T[]; count: number; densityLevel: string }> = [];

    grid.forEach((gridPoints, key) => {
      const pointCount = gridPoints.length;
      totalGridPoints += pointCount;

      if (pointCount <= moderateThreshold) {
        // 稀疏网格
        sparseGridsData.push({ key, points: gridPoints, count: pointCount });
        sparseTotalPoints += pointCount;
      } else {
        // 密集网格
        let densityLevel = '';
        if (pointCount >= extremeThreshold) densityLevel = '极度密集';
        else if (pointCount >= veryHighThreshold) densityLevel = '超密集';
        else if (pointCount >= highThreshold) densityLevel = '高密集';
        else densityLevel = '中密集';

        denseGridsData.push({ key, points: gridPoints, count: pointCount, densityLevel });
      }
    });

    console.log(`[密度采样] 网格分类统计:`, {
      seriesId,
      sparseGridsCount: sparseGridsData.length,
      sparseTotalPoints,
      denseGridsCount: denseGridsData.length,
      denseTotalPoints: totalGridPoints - sparseTotalPoints
    });

    // 第二步：决定采样策略
    const remainingQuota = maxSampleSize - Math.min(sparseTotalPoints, maxSampleSize); // 剩余可用配额

    // 如果稀疏网格点数已经超过目标，需要对稀疏网格也进行均匀采样
    if (sparseTotalPoints > maxSampleSize) {
      console.log(`[密度采样] 稀疏网格点数(${sparseTotalPoints})超过目标(${maxSampleSize})，对稀疏网格进行均匀降采样`);
      const sparseSamplingRate = maxSampleSize / sparseTotalPoints;
      sparseGridsData.forEach(sparseGrid => {
        const targetSamples = Math.ceil(sparseGrid.points.length * sparseSamplingRate);
        const indices = new Set<number>();
        while (indices.size < targetSamples && indices.size < sparseGrid.points.length) {
          const idx = Math.floor(Math.random() * sparseGrid.points.length);
          indices.add(idx);
        }
        const sortedIndices = Array.from(indices).sort((a, b) => a - b);
        for (const idx of sortedIndices) {
          sampled.push(sparseGrid.points[idx]);
        }
      });
      sparseGrids = sparseGridsData.length;
    } else {
      // 稀疏网格全部保留
      sparseGridsData.forEach(({ points }) => {
        sampled.push(...points);
      });
      sparseGrids = sparseGridsData.length;

      // 计算稠密网格的可用配额
      const denseQuota = maxSampleSize - sampled.length;

      if (denseQuota > 0 && denseGridsData.length > 0) {
        // 计算稠密网格的总点数
        const denseTotalPoints = denseGridsData.reduce((sum, g) => sum + g.count, 0);

        if (denseTotalPoints > denseQuota) {
          // 需要对稠密网格进行采样，计算全局采样率
          const globalDenseSamplingRate = denseQuota / denseTotalPoints;
          console.log(`[密度采样] 稠密网格全局采样率: ${(globalDenseSamplingRate * 100).toFixed(2)}% (${denseQuota}/${denseTotalPoints})`);

          // 对每个稠密网格进行采样
          denseGridsData.forEach(({ points, densityLevel }) => {
            const pointCount = points.length;

            // 根据密度等级调整采样率，越密集采样率越低
            let adjustedSamplingRate = globalDenseSamplingRate;
            if (densityLevel === '极度密集') {
              adjustedSamplingRate = globalDenseSamplingRate * 0.5; // 极度密集：采样率减半
            } else if (densityLevel === '超密集') {
              adjustedSamplingRate = globalDenseSamplingRate * 0.7; // 超密集：采样率7折
            } else if (densityLevel === '高密集') {
              adjustedSamplingRate = globalDenseSamplingRate * 0.9; // 高密集：采样率9折
            }
            // 中密集：使用全局采样率

            const targetSamples = Math.max(
              Math.ceil(pointCount * adjustedSamplingRate),
              2 // 最低保留2个点
            );

            // 随机采样
            const indices = new Set<number>();
            while (indices.size < targetSamples && indices.size < pointCount) {
              const idx = Math.floor(Math.random() * pointCount);
              indices.add(idx);
            }

            const sortedIndices = Array.from(indices).sort((a, b) => a - b);
            for (const idx of sortedIndices) {
              sampled.push(points[idx]);
            }

            denseGrids++;
          });
        } else {
          // 稠密网格点数不多，可以全部保留
          denseGridsData.forEach(({ points }) => {
            sampled.push(...points);
          });
          denseGrids += denseGridsData.length;
        }
      }
    }

    // 确保极端值被包含（可能在密集网格中被采样掉了）
    let addedExtremeCount = 0;
    extremePoints.forEach(extremePoint => {
      if (!sampled.includes(extremePoint)) {
        sampled.push(extremePoint);
        addedExtremeCount++;
      }
    });

    // 如果添加极端值后超过maxSampleSize，移除一些非极端点
    if (sampled.length > maxSampleSize) {
      console.log(`[密度采样] 添加极端值后超出(${sampled.length} > ${maxSampleSize})，移除部分非极端点`);
      const keptExtremePoints = new Set<T>();
      extremePoints.forEach(ep => {
        const idx = sampled.findIndex(p => p.x === ep.x && p.y === ep.y);
        if (idx !== -1) {
          keptExtremePoints.add(sampled[idx]);
        }
      });
      const nonExtremePoints = sampled.filter(p => !keptExtremePoints.has(p));
      const needed = maxSampleSize - keptExtremePoints.size;
      if (needed > 0 && nonExtremePoints.length > needed) {
        const step = Math.ceil(nonExtremePoints.length / needed);
        const sampledNonExtreme = nonExtremePoints.filter((_, index) =>
          index % step === 0
        ).slice(0, needed);
        const finalSampled = [...keptExtremePoints, ...sampledNonExtreme];
        sampled.length = 0;
        sampled.push(...finalSampled);
      } else {
        sampled.length = 0;
        sampled.push(...Array.from(keptExtremePoints).slice(0, maxSampleSize));
      }
    }

    // 统计各密度等级的网格数量
    let extremeDenseGrids = 0;
    let veryHighDenseGrids = 0;
    let highDenseGrids = 0;
    let moderateDenseGrids = 0;

    grid.forEach(gridPoints => {
      const pointCount = gridPoints.length;
      if (pointCount >= extremeThreshold) extremeDenseGrids++;
      else if (pointCount >= veryHighThreshold) veryHighDenseGrids++;
      else if (pointCount >= highThreshold) highDenseGrids++;
      else if (pointCount > moderateThreshold) moderateDenseGrids++;
    });

    console.log(`[密度采样] 完成:`, {
      seriesId,
      originalCount: data.length,
      sampledCount: sampled.length,
      sparseGrids,
      denseGrids,
      addedExtremeCount,
      gridStats: {
        sparse: sparseGrids,
        moderateDense: moderateDenseGrids,
        highDense: highDenseGrids,
        veryHighDense: veryHighDenseGrids,
        extremeDense: extremeDenseGrids,
        totalDense: denseGrids
      },
      reductionRate: ((data.length - sampled.length) / data.length * 100).toFixed(1) + '%'
    });

    return { sampledData: sampled, wasSampled: true };
  };

  // 渲染散点图（双变量散点图：X轴为第二个字段，Y轴为第一个字段，Y轴强制使用对数刻度）
  const renderScatterPlot = (xFieldName: string, yFieldName: string, color: string) => {
    // 检查数据有效性
    if (!aggregatedData || aggregatedData.length === 0) {
      return null;
    }

    // 注意：参数xFieldName是第一个字段，yFieldName是第二个字段
    // 但实际上：横轴显示第二个字段(yFieldName)，纵轴显示第一个字段(xFieldName)

    const seriesColors = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#06B6D4'];

    // 从aggregatedData中提取数据，支持系列字段
    let rawScatterData: Array<{
      id: number;
      x: number; // 横轴：第二个字段的值
      y: number; // 纵轴：第一个字段的值
      logY?: number; // 纵轴对数转换后的值（可选）
      series?: string;
    }> = [];

    const seriesField = config.seriesField;

    aggregatedData.forEach((row, idx) => {
      const xValue = row[yFieldName]; // 横轴：第二个字段
      const yValue = row[xFieldName]; // 纵轴：第一个字段

      // 只保留两个字段都是有效数值的数据
      if (typeof xValue === 'number' && !isNaN(xValue) &&
          typeof yValue === 'number' && !isNaN(yValue)) {
        // 如果使用对数刻度，纵轴值必须大于0
        if (config.scatterUseLogScale && yValue <= 0) {
          return;
        }

        const point: any = {
          id: idx,
          x: xValue,
          y: yValue,
          series: seriesField ? (row[seriesField] as string) || '其他' : undefined
        };

        // 如果使用对数刻度，计算对数值
        if (config.scatterUseLogScale) {
          point.logY = Math.log10(yValue);
        }

        rawScatterData.push(point);
      }
    });

    // 对数据进行采样，避免大数据量导致性能问题
    const { sampledData: scatterData, wasSampled } = sampleScatterData(rawScatterData, 10000);

    if (scatterData.length === 0) return null;

    // 如果有系列字段，按系列分组
    const hasSeries = !!seriesField;
    const allSeries = hasSeries
      ? Array.from(new Set(scatterData.map(d => d.series!)))
      : [];

    // 计算对数刻度的ticks（如果启用对数刻度）
    const logTicks = config.scatterUseLogScale ? (() => {
      const maxYValue = Math.max(...scatterData.map(d => d.y));

      // 如果maxYValue <= 0，无法使用对数刻度，返回undefined
      if (maxYValue <= 0) {
        console.warn(`[散点图 ${yFieldName} vs ${xFieldName}] 对数刻度不可用：最大Y值 ${maxYValue} <= 0`);
        return undefined;
      }

      const positiveYValues = scatterData.filter(d => d.y > 0).map(d => d.y);
      // 使用循环计算minPositiveYValue，避免大数据量时的栈溢出
      let minPositiveYValue: number | undefined = undefined;
      if (positiveYValues.length > 0) {
        minPositiveYValue = positiveYValues[0];
        for (let i = 1; i < positiveYValues.length; i++) {
          if (positiveYValues[i] < minPositiveYValue) {
            minPositiveYValue = positiveYValues[i];
          }
        }
      }
      const maxPower = Math.ceil(Math.log10(maxYValue));

      // 刻度为：0, 1, 2, 3, ..., maxPower
      // 对应的显示标签为：0, 10×0, 10×1, 10×2, ...
      const ticks: number[] = [0];
      for (let power = 0; power <= maxPower; power++) {
        ticks.push(power);
      }

      debugLog(`[散点图 ${yFieldName} vs ${xFieldName}] 对数刻度计算:`, {
        maxYValue,
        minPositiveYValue,
        maxPower,
        ticks,
        hasSeries,
        seriesCount: allSeries.length
      });

      return ticks;
    })() : undefined;

    return (
      <div key={`scatter-${xFieldName}-${yFieldName}`} className="mb-6">
        <h4 className="text-sm font-semibold text-gray-800 mb-3">
          {yFieldName}（横轴） vs {xFieldName}（纵轴{config.scatterUseLogScale ? '，对数刻度' : ''}）（共{scatterData.length}个对象）
          {hasSeries && ` - 按${seriesField}分组`}
        </h4>
        <ResponsiveContainer width="100%" height={400}>
          <ScatterChart margin={{ top: 20, right: 30, left: 60, bottom: 60 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis
              type="number"
              dataKey="x"
              name={yFieldName} // 横轴：第二个字段
              label={{
                value: yFieldName,
                position: 'insideBottom',
                offset: -5,
                fontSize: 11
              }}
            />
            <YAxis
              type="number"
              dataKey={config.scatterUseLogScale ? 'logY' : 'y'} // 根据配置决定使用对数刻度还是原始值
              name={xFieldName}
              label={{
                value: config.scatterUseLogScale ? `${xFieldName}（对数刻度）` : xFieldName,
                angle: -90,
                position: 'insideLeft',
                fontSize: 11
              }}
              ticks={config.scatterUseLogScale ? logTicks : undefined}
              domain={config.scatterUseLogScale ? [0, 'auto'] : undefined}
              tickFormatter={config.scatterUseLogScale ? (value: any) => {
                const tickValue = Number(value);
                if (tickValue === 0) return '0';
                // 刻度值1对应10^0，显示为10×0
                // 刻度值2对应10^1，显示为10×1
                // 以此类推
                const multiplier = tickValue - 1;
                return `10×${multiplier}`;
              } : undefined}
            />
            <Tooltip
              cursor={{ strokeDasharray: '3 3' }}
              content={({ active, payload }) => {
                if (active && payload && payload.length) {
                  const data = payload[0].payload as any;
                  return (
                    <div className="bg-white p-3 border rounded shadow-lg">
                      <p className="font-semibold mb-2">对象 #{data.id}</p>
                      <p>{yFieldName}（横轴）: {data.x ? formatNumberWithCommas(data.x) : '-'}</p>
                      {config.scatterUseLogScale ? (
                        <>
                          <p>{xFieldName}（对数）: {data.logY ? formatNumberWithCommas(data.logY) : '-'}</p>
                          <p>{xFieldName}（原始）: {data.y ? formatNumberWithCommas(data.y) : '-'}</p>
                        </>
                      ) : (
                        <p>{xFieldName}: {data.y ? formatNumberWithCommas(data.y) : '-'}</p>
                      )}
                      {hasSeries && <p>系列: {data.series}</p>}
                    </div>
                  );
                }
                return null;
              }}
            />
            {hasSeries ? (
              /* 有系列字段，渲染多个系列 */
              allSeries.map((series, index) => (
                <Scatter
                  key={series}
                  name={series}
                  data={scatterData.filter(d => d.series === series)}
                  fill={seriesColors[index % seriesColors.length]}
                />
              ))
            ) : (
              /* 无系列字段，渲染单个散点图 */
              <Scatter name={`${yFieldName} vs ${xFieldName}`} data={scatterData} fill={color}>
                {scatterData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={color} />
                ))}
              </Scatter>
            )}
            {hasSeries && <Legend />}
          </ScatterChart>
        </ResponsiveContainer>
        {/* 统计信息 */}
        <div className="mt-3 p-3 bg-gray-50 rounded text-sm">
          {wasSampled && (
            <div className="mb-3 p-2 bg-amber-50 border border-amber-200 rounded">
              <p className="text-amber-800 text-xs">
                ⚠️ <strong>数据已采样</strong>：原始数据量 {rawScatterData.length} 个点，为优化性能已采样为 {scatterData.length} 个点显示。
              </p>
              <p className="text-amber-700 text-xs mt-1">
                散点图使用分层采样确保各系列都能被均匀展示，统计信息基于原始完整数据计算。
              </p>
            </div>
          )}
          <p className="font-medium text-gray-700 mb-1">统计信息:</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <div>
              <p className="text-gray-500">对象数量</p>
              <p className="font-semibold">
                {scatterData.length}
                {wasSampled && <span className="text-xs text-amber-600 ml-1">(采样后)</span>}
              </p>
            </div>
            <div>
              <p className="text-gray-500">{yFieldName}（横轴）范围</p>
              <p className="font-semibold text-xs">
                {formatNumberWithCommas(Math.min(...scatterData.map(d => d.x)))} - {formatNumberWithCommas(Math.max(...scatterData.map(d => d.x)))}
              </p>
            </div>
            <div>
              <p className="text-gray-500">{xFieldName}（纵轴）范围</p>
              <p className="font-semibold text-xs">
                {formatNumberWithCommas(Math.min(...scatterData.map(d => d.y)))} - {formatNumberWithCommas(Math.max(...scatterData.map(d => d.y)))}
              </p>
            </div>
            {hasSeries && (
              <div>
                <p className="text-gray-500">系列数量</p>
                <p className="font-semibold">{allSeries.length}</p>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* 配置区域 */}
      {!showCharts ? (
        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">数据分布可视化配置</h3>

          {/* 数据量警告 */}
          {aggregatedData.length > 10000 && (
            <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded">
              <p className="text-sm text-amber-800 font-medium">
                ⚠️ <strong>大数据量提示</strong>：当前数据量 {formatNumberWithCommas(aggregatedData.length)} 行，已超过 10,000 行
              </p>
              <p className="text-xs text-amber-700 mt-1">
                散点图将自动进行数据采样（最多显示 10,000 个点）以优化性能，不影响统计准确性。
              </p>
            </div>
          )}

          {/* 可用数值字段 */}
          <div className="mb-6">
            <h4 className="text-sm font-medium text-gray-700 mb-3">
              聚合后的数值字段（{numericFields.length}个） - 共{formatNumberWithCommas(aggregatedData.length)}行数据
            </h4>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {numericFields.map(field => (
                <label key={field} className="flex items-center p-3 border rounded hover:bg-blue-50 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={config.selectedFields.includes(field)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setConfig(prev => ({
                          ...prev,
                          selectedFields: [...prev.selectedFields, field]
                        }));
                      } else {
                        setConfig(prev => ({
                          ...prev,
                          selectedFields: prev.selectedFields.filter(f => f !== field)
                        }));
                      }
                    }}
                    className="mr-2"
                  />
                  <span className="text-sm">{field}</span>
                </label>
              ))}
            </div>
          </div>

          {/* 系列字段选择（直方图和Box Plot都显示） */}
          <div className="mb-6">
            <h4 className="text-sm font-medium text-gray-700 mb-3">系列字段（可选）</h4>
            <select
              value={config.seriesField || ''}
              onChange={(e) => setConfig(prev => ({ ...prev, seriesField: e.target.value || undefined }))}
              className="w-64 p-2 border border-gray-300 rounded"
            >
              <option value="">不分组（单一颜色）</option>
              {seriesFields.map(field => (
                <option key={field} value={field}>{field}</option>
              ))}
            </select>
            <p className="text-xs text-gray-500 mt-1">
              选择系列字段后，不同系列将以不同颜色显示，便于对比分析
            </p>
          </div>

          {/* 累积分布曲线选项（直方图专用） */}
          <div className="mb-6">
            <h4 className="text-sm font-medium text-gray-700 mb-3">直方图高级选项</h4>
              <div className="space-y-3">
                <label className="flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={config.showCumulative}
                    onChange={(e) => setConfig(prev => ({ ...prev, showCumulative: e.target.checked }))}
                    className="mr-2"
                  />
                  <div>
                    <span className="text-sm font-medium">显示累积分布曲线</span>
                    <p className="text-xs text-gray-500 mt-1">使用曲线展示数据累计分布情况，帮助识别长尾分布特征</p>
                  </div>
                </label>
                {config.showCumulative && (
                  <label className="flex items-center cursor-pointer ml-6">
                    <input
                      type="checkbox"
                      checked={config.showCumulativeLegend}
                      onChange={(e) => setConfig(prev => ({ ...prev, showCumulativeLegend: e.target.checked }))}
                      className="mr-2"
                    />
                    <div>
                      <span className="text-sm font-medium">在图例中显示累积曲线</span>
                      <p className="text-xs text-gray-500 mt-1">勾选后在图例中显示累积分布曲线的图例项</p>
                    </div>
                  </label>
                )}
                <label className="flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={config.useLogScale}
                    onChange={(e) => setConfig(prev => ({ ...prev, useLogScale: e.target.checked }))}
                    className="mr-2"
                  />
                  <div>
                    <span className="text-sm font-medium">使用对数刻度Y轴</span>
                    <p className="text-xs text-gray-500 mt-1">
                      Y轴使用对数刻度（0, 10¹, 10², 10³...），适合展示跨多个数量级的长尾分布数据
                    </p>
                    <p className="text-xs text-gray-400 mt-1">
                      💡 建议使用场景：数据呈长尾分布（如大部分对象数量很小，少数对象数量很大）
                    </p>
                  </div>
                </label>
                {config.showCumulative && (
                  <label className="flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={config.useCumulativeMultiplicativeScale}
                      onChange={(e) => setConfig(prev => ({ ...prev, useCumulativeMultiplicativeScale: e.target.checked }))}
                      className="mr-2"
                    />
                    <div>
                      <span className="text-sm font-medium">累积曲线使用倍数刻度</span>
                      <p className="text-xs text-gray-500 mt-1">
                        累积分布曲线使用倍数刻度（10×1, 10×2, ..., 10×10），突出小数值部分的变化
                      </p>
                      <p className="text-xs text-gray-400 mt-1">
                        💡 建议使用场景：数据过于集中在小数值部分，累积分布曲线呈直线状
                      </p>
                    </div>
                  </label>
                )}
                {/* 散点图说明（所有图表类型都显示） */}
                <div className="mt-4 pt-4 border-t border-gray-200">
                  <h5 className="text-sm font-medium text-gray-700 mb-3">双变量散点图</h5>
                  <p className="text-xs text-gray-500 mb-2">
                    散点图将展示前两个字段的关系，每个点代表一个对象：
                  </p>
                  <ul className="text-xs text-gray-500 list-disc list-inside space-y-1 mb-3">
                    <li><strong>横轴</strong>：第二个字段的值（线性刻度）</li>
                    <li><strong>纵轴</strong>：第一个字段的值（可选择对数刻度）</li>
                    <li><strong>系列分组</strong>：如果配置了系列字段，不同系列将以不同颜色显示</li>
                  </ul>
                  <label className="flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={config.scatterUseLogScale}
                      onChange={(e) => setConfig(prev => ({ ...prev, scatterUseLogScale: e.target.checked }))}
                      className="mr-2"
                    />
                    <div>
                      <span className="text-sm font-medium">纵轴使用对数刻度</span>
                      <p className="text-xs text-gray-500 mt-1">
                        散点图纵轴使用对数刻度（0, 10×0, 10×1, 10×2...），适合展示跨多个数量级的数据点分布
                      </p>
                      <p className="text-xs text-gray-400 mt-1">
                        💡 建议使用场景：纵轴字段数值差异巨大，部分点数值很小，部分点数值很大
                      </p>
                    </div>
                  </label>
                </div>
              </div>
            </div>

          {/* 直方图分组数 */}
          <div className="mb-6">
            <h4 className="text-sm font-medium text-gray-700 mb-3">直方图分组数量</h4>
            <input
              type="number"
              min={5}
              max={100}
              value={config.binCount}
              onChange={(e) => setConfig(prev => ({ ...prev, binCount: Math.max(5, Math.min(100, parseInt(e.target.value) || 20)) }))}
              className="w-32 p-2 border border-gray-300 rounded"
            />
            <p className="text-xs text-gray-500 mt-1">
              建议：20-50个分组可获得最佳分布效果
            </p>
          </div>

          {/* 导航加载提示（配置界面） */}
          {isNavigating && (
            <div className="w-full mb-3 p-4 bg-blue-50 border border-blue-200 rounded-lg">
              <div className="flex items-center">
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600 mr-3"></div>
                <p className="text-sm text-blue-700 font-medium">{navigationProgress}</p>
              </div>
            </div>
          )}

          {/* 按钮组 */}
          <div className="flex space-x-4">
            <button
              onClick={() => setShowCharts(true)}
              disabled={config.selectedFields.length === 0 || isNavigating}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              生成分布图
            </button>
            {onSkip && (
              <button
                onClick={() => handleCompleteOrSkip(() => onSkip && onSkip())}
                disabled={isNavigating}
                className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
              >
                {isNavigating ? '正在处理...' : '跳过'}
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          {/* 已选字段信息 */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-sm font-semibold text-blue-900 mb-1">当前配置</h4>
                <p className="text-sm text-blue-700">
                  已选字段: {config.selectedFields.join(', ')}
                  {' | '}
                  直方图分组数: {config.binCount}
                  {' | '}
                  累积曲线: {config.showCumulative ? '显示' : '隐藏'}
                  {config.showCumulative && ` | 图例: ${config.showCumulativeLegend ? '显示' : '隐藏'}`}
                  {' | '}
                  Y轴刻度: {config.useLogScale ? '对数刻度' : '线性刻度'}
                  {config.seriesField && ` | 系列字段: ${config.seriesField}`}
                  {config.selectedFields.length >= 2 && (
                    <>
                      {' | 散点图: 横轴='}{config.selectedFields[1]}{' | 纵轴='}{config.selectedFields[0]}{'（'}{config.scatterUseLogScale ? '对数刻度' : '线性刻度'}{'）'}
                      {config.seriesField && ` | 按${config.seriesField}分组`}
                    </>
                  )}
                </p>
              </div>
              <button
                onClick={() => setShowCharts(false)}
                className="px-3 py-1 text-sm bg-white border border-blue-300 text-blue-700 rounded hover:bg-blue-100"
              >
                修改配置
              </button>
            </div>
          </div>

          {/* 图表展示区域 */}
          {config.selectedFields.length === 0 ? (
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
              <p className="text-sm text-yellow-700">请先选择要可视化的字段</p>
            </div>
          ) : (
            <div className="space-y-6">
              {/* 使用2列3行的网格布局 */}
              {config.selectedFields.length >= 2 ? (
                <>
                  {/* 两个字段时的布局 */}
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    {/* 左列：直方图 */}
                    <div className="space-y-3">
                      {/* 左上：第一个维度直方图 */}
                      <div className="bg-white border border-gray-200 rounded-lg p-2.5">
                        <h3 className="text-sm font-semibold text-gray-900 mb-2.5">{config.selectedFields[0]} - 直方图</h3>
                        <div ref={setHistogramRef(config.selectedFields[0])} className="border border-gray-100 rounded-lg p-2 bg-gray-50">
                          {renderHistogram(config.selectedFields[0], '#3B82F6')}
                        </div>
                      </div>
                      {/* 左中：第二个维度直方图 */}
                      <div className="bg-white border border-gray-200 rounded-lg p-2.5">
                        <h3 className="text-sm font-semibold text-gray-900 mb-2.5">{config.selectedFields[1]} - 直方图</h3>
                        <div ref={setHistogramRef(config.selectedFields[1])} className="border border-gray-100 rounded-lg p-2 bg-gray-50">
                          {renderHistogram(config.selectedFields[1], '#10B981')}
                        </div>
                      </div>
                      {/* 左下：双维度直方图统计信息表格 */}
                      {renderTwoFieldsHistogramStatsTable(config.selectedFields[0], config.selectedFields[1])}
                    </div>

                    {/* 右列：Box图和统计表格 */}
                    <div className="space-y-3">
                      {/* 右上：第一个维度Box图 */}
                      <div className="bg-white border border-gray-200 rounded-lg p-2.5">
                        <h3 className="text-sm font-semibold text-gray-900 mb-2.5">{config.selectedFields[0]} - Box Plot</h3>
                        <div ref={setBoxplotRef(config.selectedFields[0])} className="border border-gray-100 rounded-lg p-2 bg-gray-50">
                          {renderBoxPlot(config.selectedFields[0], '#3B82F6')}
                        </div>
                      </div>
                      {/* 右中：第二个维度Box图 */}
                      <div className="bg-white border border-gray-200 rounded-lg p-2.5">
                        <h3 className="text-sm font-semibold text-gray-900 mb-2.5">{config.selectedFields[1]} - Box Plot</h3>
                        <div ref={setBoxplotRef(config.selectedFields[1])} className="border border-gray-100 rounded-lg p-2 bg-gray-50">
                          {renderBoxPlot(config.selectedFields[1], '#10B981')}
                        </div>
                      </div>
                      {/* 右下：双维度详细统计表格 */}
                      {renderTwoFieldsStatsTable(config.selectedFields[0], config.selectedFields[1])}
                    </div>
                  </div>

                  {/* 双变量散点图 */}
                  <div className="mt-8">
                    <h3 className="text-base font-semibold text-gray-900 mb-4">双变量散点图</h3>
                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4">
                      <p className="text-sm text-blue-700">
                        💡 <strong>横轴</strong>：{config.selectedFields[1]} | <strong>纵轴</strong>：{config.selectedFields[0]}（{config.scatterUseLogScale ? '对数刻度' : '线性刻度'}）
                        {config.seriesField && ` | <strong>系列</strong>：按${config.seriesField}分组`}
                      </p>
                      <p className="text-xs text-blue-600 mt-1">
                        每个点代表一个对象
                      </p>
                    </div>
                    <div ref={scatterChartRef} className="border border-gray-200 rounded-lg p-4">
                      {renderScatterPlot(config.selectedFields[0], config.selectedFields[1], '#3B82F6')}
                    </div>
                  </div>
                </>
              ) : (
                /* 单个字段时的布局：保持原有的并列布局 */
                <div className="bg-white border border-gray-200 rounded-lg p-4">
                  <h3 className="text-base font-semibold text-gray-900 mb-4">{config.selectedFields[0]} 数据分布分析</h3>
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    {/* 直方图 */}
                    <div ref={setHistogramRef(config.selectedFields[0])} className="border border-gray-100 rounded-lg p-3 bg-gray-50">
                      {renderHistogram(config.selectedFields[0], '#3B82F6')}
                    </div>
                    {/* Box Plot */}
                    <div ref={setBoxplotRef(config.selectedFields[0])} className="border border-gray-100 rounded-lg p-3 bg-gray-50">
                      {renderBoxPlot(config.selectedFields[0], '#3B82F6')}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 按钮组 */}
          <div className="flex flex-col sm:flex-row gap-3 mt-6">
            {/* 导航加载提示 */}
            {isNavigating && (
              <div className="w-full mb-3 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                <div className="flex items-center">
                  <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600 mr-3"></div>
                  <p className="text-sm text-blue-700 font-medium">{navigationProgress}</p>
                </div>
              </div>
            )}

            <button
              onClick={() => handleCompleteOrSkip(() => onComplete && onComplete())}
              disabled={isNavigating}
              className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-blue-300 disabled:cursor-not-allowed font-medium"
            >
              {isNavigating ? '正在处理...' : '下一步：正态分布检验'}
            </button>
            {onSkip && (
              <button
                onClick={() => handleCompleteOrSkip(() => onSkip && onSkip())}
                disabled={isNavigating}
                className="px-6 py-3 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 disabled:bg-gray-100 disabled:cursor-not-allowed font-medium"
              >
                {isNavigating ? '正在处理...' : '跳过此步骤，直接进入画像分析配置'}
              </button>
            )}
            <button
              onClick={() => setShowCharts(false)}
              disabled={isNavigating}
              className="px-6 py-3 border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50 disabled:border-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed"
            >
              返回配置
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
