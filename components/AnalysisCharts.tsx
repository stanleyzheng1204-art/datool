'use client';

import { useRef, useEffect, useState } from 'react';
import {
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend
} from 'recharts';
import { ProfileAnalysisConfig } from '@/types/data';
import { formatNumberWithCommas, getConfiguredFieldLabel } from '@/lib/numberFormatter';

interface AnalysisChartsProps {
  categories: any[];
  instanceId?: string; // 用于区分多个图表实例
  profileAnalysisConfig?: ProfileAnalysisConfig; // 用户配置的画像分析字段
}

interface ChartImages {
  barChart?: string;
  pieChart?: string;
  donutChart?: string;
}

// 全局图表导出器注册表
const chartExporters: { [key: string]: () => Promise<ChartImages> } = {};

export function AnalysisCharts({ categories, instanceId = 'default', profileAnalysisConfig }: AnalysisChartsProps) {
  const [chartImages, setChartImages] = useState<ChartImages>({});
  const barChartRef = useRef<HTMLDivElement>(null);
  const pieChartRef = useRef<HTMLDivElement>(null);
  const donutChartRef = useRef<HTMLDivElement>(null);

  // 动态识别可用于图表的数据字段
  const getNumericFields = () => {
    if (!categories || categories.length === 0) return {};
    
    const firstCat = categories[0];
    const indicators = firstCat.indicators || {};
    
    // 查找所有数值字段
    const numericFields: { [key: string]: number } = {};
    Object.entries(indicators).forEach(([key, value]) => {
      if (typeof value === 'number' && !isNaN(value)) {
        numericFields[key] = value;
      }
    });
    
    return numericFields;
  };

  // 智能选择图表字段
  const selectChartFields = () => {
    const numericFields = getNumericFields();
    const fieldNames = Object.keys(numericFields);

    console.log('Available numeric fields:', fieldNames);
    console.log('Sample values:', numericFields);

    // 默认字段选择策略
    let countField = '';
    let amountField = '';
    let avgField = '';

    // 优先级0：如果用户配置了分析字段，优先使用用户配置的字段
    if (profileAnalysisConfig && profileAnalysisConfig.analysisFields && profileAnalysisConfig.analysisFields.length > 0) {
      console.log('User configured analysis fields:', profileAnalysisConfig.analysisFields.map(f => f.fieldName));

      // 查找用户配置的数值字段
      const configuredFields = profileAnalysisConfig.analysisFields
        .map(f => f.fieldName)
        .filter(f => fieldNames.includes(f));

      console.log('Configured fields found in data:', configuredFields);

      if (configuredFields.length > 0) {
        // 如果只有一个配置字段，同时作为计数字段和金额字段
        if (configuredFields.length === 1) {
          countField = configuredFields[0];
          amountField = configuredFields[0];
        } else if (configuredFields.length >= 2) {
          // 有多个配置字段，前两个分别用作计数字段和金额字段
          countField = configuredFields[0];
          amountField = configuredFields[1];
        }
        console.log('Using configured fields:', { countField, amountField });
      }
    }

    // 查找金额字段（排除包含count的字段）
    const amountKeywords = ['amount', '金额', 'total', '总计', 'sum', 'money'];
    const amountCandidates = fieldNames.filter(f =>
      amountKeywords.some(k => f.toLowerCase().includes(k)) &&
      !f.toLowerCase().includes('count')
    );

    // 优先级1：查找objectCount字段（专门用于柱状图显示对象数量）
    if (!countField && fieldNames.includes('objectCount')) {
      countField = 'objectCount';
      console.log('Found objectCount field for bar chart');
    }

    // 如果没有objectCount，查找计数字段（包含count关键词）
    if (!countField) {
      const countKeywords = ['count', '计数', '数量', '笔数'];
      const countCandidates = fieldNames.filter(f =>
        countKeywords.some(k => f.toLowerCase().includes(k))
      );

      if (countCandidates.length > 0) {
        // 优先选择最匹配的字段（优先包含'count'的）
        countField = countCandidates.find(f => f.toLowerCase() === 'count') ||
                     countCandidates.find(f => f.includes('_count')) ||
                     countCandidates[0];
      }
    }

    // 如果用户没有配置amountField，使用识别出的金额字段
    if (!amountField && amountCandidates.length > 0) {
      amountField = amountCandidates[0];
    }

    // 查找平均字段
    const avgKeywords = ['avg', 'average', '平均'];
    const avgCandidates = fieldNames.filter(f =>
      avgKeywords.some(k => f.toLowerCase().includes(k))
    );

    if (avgCandidates.length > 0) {
      avgField = avgCandidates[0];
    }

    // 如果没找到count字段，使用第一个非金额的数值字段
    if (!countField && fieldNames.length > 0) {
      const nonAmountFields = fieldNames.filter(f =>
        !amountCandidates.includes(f)
      );
      countField = nonAmountFields[0] || fieldNames[0];
    }

    // 如果没找到amount字段，使用第二个数值字段
    if (!amountField && fieldNames.length > 1) {
      const remainingFields = fieldNames.filter(f => f !== countField);
      amountField = remainingFields[0];
    }

    console.log('Selected fields:', { countField, amountField, avgField });

    return { countField, amountField, avgField };
  };

  // 准备图表数据
  const getChartData = () => {
    const { countField, amountField } = selectChartFields();

    return categories.map((cat, idx) => {
      const indicators = cat.indicators || {};
      // 优先使用objectCount显示对象数量，如果没有则使用countField
      const objectCount = indicators.objectCount !== undefined
        ? indicators.objectCount
        : (countField ? indicators[countField] || 0 : 0);
      return {
        name: cat.category || `分类${idx + 1}`,
        value: objectCount,
        totalAmount: amountField ? (indicators[amountField] || 0) : 0,
        avgAmount: indicators.avgAmount || indicators.averageAmount || 0
      };
    });
  };

  const getPieData = () => {
    // 饼图显示第二个分析字段的数据
    console.log(`[getPieData] Starting pie data generation...`);
    console.log(`[getPieData] User configured analysis fields:`, profileAnalysisConfig?.analysisFields?.map(f => ({ fieldName: f.fieldName, description: f.description })));

    // 直接从用户配置获取第二个分析字段，不依赖 selectChartFields
    let pieField = '';

    if (profileAnalysisConfig && profileAnalysisConfig.analysisFields && profileAnalysisConfig.analysisFields.length >= 2) {
      pieField = profileAnalysisConfig.analysisFields[1].fieldName;
      console.log(`[getPieData] User configured ${profileAnalysisConfig.analysisFields.length} analysis fields, using 2nd field for pie chart: ${pieField}`);
    } else {
      // 如果用户没有配置第二个分析字段，降级到 selectChartFields 中的 countField
      const { countField } = selectChartFields();
      pieField = countField;
      console.log(`[getPieData] User has ${profileAnalysisConfig?.analysisFields?.length || 0} analysis fields (< 2), using countField: ${pieField}`);
    }

    console.log(`[getPieData] Final pieField: "${pieField}"`);

    return categories.map((cat, idx) => {
      const indicators = cat.indicators || {};
      console.log(`[getPieData] Category ${idx}: ${cat.category}, all indicators:`, indicators);

      // 使用确定的字段获取值
      let pieValue = 0;
      if (pieField && indicators.hasOwnProperty(pieField) && indicators[pieField] !== undefined) {
        pieValue = indicators[pieField];
        console.log(`[getPieData] Category ${idx}: Found pieField "${pieField}" with value: ${pieValue}`);
      } else if (countField && indicators.hasOwnProperty(countField) && indicators[countField] !== undefined) {
        // 降级：使用计数字段
        pieValue = indicators[countField];
        console.warn(`[getPieData] Category ${idx}: Pie field "${pieField}" not found in indicators, fallback to countField "${countField}" with value: ${pieValue}`);
      } else {
        // 最后降级：查找第一个数值字段
        const numericFields = Object.entries(indicators)
          .filter(([key, val]) => typeof val === 'number' && !isNaN(val));
        if (numericFields.length > 0) {
          pieValue = numericFields[0][1] as number;
          console.warn(`[getPieData] Category ${idx}: Neither pieField nor countField found, using first numeric field "${numericFields[0][0]}" with value: ${pieValue}`);
        } else {
          console.warn(`[getPieData] Category ${idx}: No numeric fields found, using value 0`);
        }
      }

      return {
        name: cat.category || `分类${idx + 1}`,
        value: pieValue
      };
    });
  };

  const getDonutData = () => {
    // 环形图显示第一个分析字段的数据
    console.log(`[getDonutData] Starting donut data generation...`);
    console.log(`[getDonutData] User configured analysis fields:`, profileAnalysisConfig?.analysisFields?.map(f => ({ fieldName: f.fieldName, description: f.description })));

    // 直接从用户配置获取第一个分析字段，不依赖 selectChartFields
    let donutField = '';

    if (profileAnalysisConfig && profileAnalysisConfig.analysisFields && profileAnalysisConfig.analysisFields.length >= 1) {
      donutField = profileAnalysisConfig.analysisFields[0].fieldName;
      console.log(`[getDonutData] User configured ${profileAnalysisConfig.analysisFields.length} analysis fields, using 1st field for donut chart: ${donutField}`);
    } else {
      // 如果用户没有配置第一个分析字段，降级到 selectChartFields 中的 amountField
      const { amountField } = selectChartFields();
      donutField = amountField;
      console.log(`[getDonutData] User has ${profileAnalysisConfig?.analysisFields?.length || 0} analysis fields (< 1), using amountField: ${donutField}`);
    }

    console.log(`[getDonutData] Final donutField: "${donutField}"`);

    return categories.map((cat, idx) => {
      const indicators = cat.indicators || {};
      console.log(`[getDonutData] Category ${idx}: ${cat.category}, all indicators:`, indicators);

      // 使用确定的字段获取值
      let donutValue = 0;
      if (donutField && indicators.hasOwnProperty(donutField) && indicators[donutField] !== undefined) {
        donutValue = indicators[donutField];
        console.log(`[getDonutData] Category ${idx}: Found donutField "${donutField}" with value: ${donutValue}`);
      } else if (amountField && indicators.hasOwnProperty(amountField) && indicators[amountField] !== undefined) {
        // 降级：使用金额字段
        donutValue = indicators[amountField];
        console.warn(`[getDonutData] Category ${idx}: Donut field "${donutField}" not found in indicators, fallback to amountField "${amountField}" with value: ${donutValue}`);
      } else {
        // 最后降级：查找最大的数值字段（排除 count 相关字段）
        const numericFields = Object.entries(indicators)
          .filter(([key, val]) => typeof val === 'number' && !isNaN(val) && !key.toLowerCase().includes('count'))
          .sort((a, b) => (b[1] as number) - (a[1] as number));

        if (numericFields.length > 0) {
          donutValue = numericFields[0][1] as number;
          console.warn(`[getDonutData] Category ${idx}: Neither donutField nor amountField found, using max numeric field "${numericFields[0][0]}" with value: ${donutValue}`);
        } else {
          console.warn(`[getDonutData] Category ${idx}: No numeric fields found, using value 0`);
        }
      }

      return {
        name: cat.category || `分类${idx + 1}`,
        value: donutValue
      };
    });
  };

  // 根据风险等级返回对应颜色
  // 高风险：鲜艳的暖色系（红色、橙红色、橙色）
  // 低风险：冷色系（蓝色、绿色、紫色、青色）
  const getColorByCategory = (categoryName: string): string => {
    if (!categoryName) return '#3B82F6'; // 默认蓝色

    // 高风险类别 - 使用鲜艳的暖色系，且有区分度
    if (categoryName.includes('双高') || categoryName.includes('High-High')) {
      return '#DC2626'; // 鲜艳红色 (RGB: 220, 38, 38) - 最高风险
    } else if (categoryName.includes('偏高型（第一字段）') || categoryName.includes('High for First Field')) {
      return '#EA580C'; // 深橙红色 (RGB: 234, 88, 12) - 第一字段偏高
    } else if (categoryName.includes('偏高型（第二字段）') || categoryName.includes('High for Second Field')) {
      return '#FB923C'; // 亮橙色 (RGB: 251, 146, 60) - 第二字段偏高
    } else if (categoryName.includes('偏高') || categoryName.includes('High')) {
      return '#F97316'; // 通用橙色 (RGB: 249, 115, 22)
    }
    // 低风险类别 - 使用冷色系
    else if (categoryName.includes('低值') || categoryName.includes('Low')) {
      return '#06B6D4'; // 冷色青色 (RGB: 6, 182, 212)
    } else if (categoryName.includes('中间') || categoryName.includes('Middle')) {
      return '#3B82F6'; // 冷色蓝色 (RGB: 59, 130, 246)
    }

    // 默认颜色
    return '#3B82F6';
  };

  // 兼容旧代码，保留 COLORS 数组（但不使用）
  const COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#06B6D4', '#84CC16'];

  // 导出图表为图片
  const exportCharts = async (): Promise<ChartImages> => {
    const html2canvas = (await import('html2canvas')).default;
    const images: ChartImages = {};

    // 导出柱状图
    if (barChartRef.current) {
      const canvas = await html2canvas(barChartRef.current, {
        backgroundColor: '#ffffff',
        scale: 2
      });
      images.barChart = canvas.toDataURL('image/png');
    }

    // 导出饼图
    if (pieChartRef.current) {
      const canvas = await html2canvas(pieChartRef.current, {
        backgroundColor: '#ffffff',
        scale: 2
      });
      images.pieChart = canvas.toDataURL('image/png');
    }

    // 导出环形图
    if (donutChartRef.current) {
      const canvas = await html2canvas(donutChartRef.current, {
        backgroundColor: '#ffffff',
        scale: 2
      });
      images.donutChart = canvas.toDataURL('image/png');
    }

    setChartImages(images);
    return images;
  };

  // 将图表导出函数注册到全局注册表
  useEffect(() => {
    // 注册当前实例的导出函数
    chartExporters[instanceId] = exportCharts;
    
    console.log(`Chart instance "${instanceId}" registered. Total instances:`, Object.keys(chartExporters));
    
    return () => {
      // 清理：组件卸载时删除注册
      delete chartExporters[instanceId];
      console.log(`Chart instance "${instanceId}" unregistered`);
    };
  }, [categories, instanceId]);

  const chartData = getChartData();
  const pieData = getPieData();
  const donutData = getDonutData();

  // 获取柱状图的数值字段名称用于显示
  const { countField, amountField } = selectChartFields();

  // 动态生成图表标签（基于实际字段名）
  const countLabel = countField ? countField.replace(/_count$/, '') : '计数';
  const amountLabel = amountField ? amountField.replace(/_sum$/, '') : '数值';
  const barChartLabel = countLabel;

  // 根据用户配置的分析字段顺序获取图表标签
  // 第一个分析字段用于环形图（通常是金额/合计类字段）
  // 第二个分析字段用于饼图（通常是笔数/计数类字段）
  let donutChartLabel = amountLabel;  // 默认使用识别出的金额字段
  let pieChartLabel = countLabel;    // 默认使用识别出的计数字段

  if (profileAnalysisConfig && profileAnalysisConfig.analysisFields && profileAnalysisConfig.analysisFields.length > 0) {
    // 环形图使用第一个分析字段的描述
    if (profileAnalysisConfig.analysisFields[0]) {
      const firstField = profileAnalysisConfig.analysisFields[0];
      if (firstField.description && firstField.description.trim()) {
        donutChartLabel = firstField.description.trim();
      } else if (firstField.fieldName && firstField.fieldName.trim()) {
        // 如果没有description，使用fieldName
        donutChartLabel = firstField.fieldName.trim();
      }
      console.log(`[Chart Labels] Donut chart (1st field): ${donutChartLabel}`);
    }

    // 饼图使用第二个分析字段的描述（如果存在）
    if (profileAnalysisConfig.analysisFields[1]) {
      const secondField = profileAnalysisConfig.analysisFields[1];
      if (secondField.description && secondField.description.trim()) {
        pieChartLabel = secondField.description.trim();
      } else if (secondField.fieldName && secondField.fieldName.trim()) {
        // 如果没有description，使用fieldName
        pieChartLabel = secondField.fieldName.trim();
      }
      console.log(`[Chart Labels] Pie chart (2nd field): ${pieChartLabel}`);
    }
  }

  // 柱状图Y轴标签：使用对象字段名称 + "数量"
  let barChartYAxisLabel = '对象数量';
  if (profileAnalysisConfig && profileAnalysisConfig.subjectFieldName && profileAnalysisConfig.subjectFieldName.trim()) {
    barChartYAxisLabel = `${profileAnalysisConfig.subjectFieldName.trim()}数量`;
    console.log(`[Chart Labels] Bar chart Y-axis: ${barChartYAxisLabel}`);
  }
  
  console.log('Chart labels:', {
    countField,
    countLabel,
    amountField,
    amountLabel,
    donutChartLabel,
    pieChartLabel,
    barChartYAxisLabel
  });

  return (
    <div className="space-y-8">
      {/* 柱状图 - 各类对象数量分布 */}
      <div className="bg-white p-6 rounded-lg border border-gray-200 shadow-sm">
        <h3 className="text-lg font-bold mb-4 text-gray-800">{barChartYAxisLabel}分布</h3>
        <div ref={barChartRef} style={{ width: '100%', height: '320px' }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={categories.map((cat, idx) => ({
              name: cat.category || `分类${idx + 1}`,
              value: cat.indicators?.objectCount || 0
            }))}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="name" tick={{ fill: '#374151', fontSize: 12 }} />
              <YAxis label={{ value: barChartYAxisLabel, angle: -90, position: 'insideLeft', fill: '#374151', fontSize: 12 }} tick={{ fill: '#374151', fontSize: 12 }} />
              <Tooltip
                formatter={(value: number | undefined) => [`${value || 0}`, barChartYAxisLabel]}
                contentStyle={{ backgroundColor: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px' }}
              />
              <Legend wrapperStyle={{ paddingTop: '16px' }} />
              <Bar dataKey="value" name={barChartYAxisLabel} radius={[4, 4, 0, 0]}>
                {categories.map((cat, idx) => (
                  <Cell
                    key={`cell-${idx}`}
                    fill={getColorByCategory(cat.category)}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* 饼图和环形图 - 数据分布（并排显示） */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 饼图 - 第二个分析字段数据分布 */}
        <div className="bg-white p-6 rounded-lg border border-gray-200 shadow-sm">
          <h3 className="text-lg font-bold mb-4 text-gray-800">{pieChartLabel}占比分布</h3>
          <div ref={pieChartRef} style={{ width: '100%', height: '320px' }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={pieData}
                  cx="50%"
                  cy="50%"
                  label={({ name, percent }) => {
                    const percentage = ((percent || 0) * 100).toFixed(1);
                    const displayName = name || '';
                    return displayName.length > 6 ? `${displayName.slice(0, 6)}... ${percentage}%` : `${displayName} ${percentage}%`;
                  }}
                  outerRadius={90}
                  fill="#8884d8"
                  dataKey="value"
                  name={pieChartLabel}
                  labelLine={{ stroke: '#e5e7eb', strokeWidth: 1 }}
                >
                  {pieData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={getColorByCategory(entry.name)} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value: number | undefined, name?: string) => [
                    `${value || 0}`,
                    name || ''
                  ]}
                  contentStyle={{ backgroundColor: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px' }}
                />
                <Legend wrapperStyle={{ paddingTop: '8px', fontSize: '12px' }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* 环形图 - 第一个分析字段比重 */}
        <div className="bg-white p-6 rounded-lg border border-gray-200 shadow-sm">
          <h3 className="text-lg font-bold mb-4 text-gray-800">{donutChartLabel}占比分布</h3>
          <div ref={donutChartRef} style={{ width: '100%', height: '320px' }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={donutData}
                  cx="50%"
                  cy="50%"
                  label={({ name, percent }) => {
                    const percentage = ((percent || 0) * 100).toFixed(1);
                    const displayName = name || '';
                    return displayName.length > 6 ? `${displayName.slice(0, 6)}... ${percentage}%` : `${displayName} ${percentage}%`;
                  }}
                  outerRadius={90}
                  innerRadius={55}
                  fill="#8884d8"
                  dataKey="value"
                  name={donutChartLabel}
                  labelLine={{ stroke: '#e5e7eb', strokeWidth: 1 }}
                >
                  {donutData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={getColorByCategory(entry.name)} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value: number | undefined) => [`${(value || 0).toFixed(2)}`, donutChartLabel]}
                  contentStyle={{ backgroundColor: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px' }}
                />
                <Legend wrapperStyle={{ paddingTop: '8px', fontSize: '12px' }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * 导出所有图表实例的图片
 * @returns 包含所有实例图表的对象，key为instanceId，value为ChartImages
 */
export async function exportAllChartInstances(): Promise<{ [instanceId: string]: ChartImages }> {
  console.log('Exporting all chart instances:', Object.keys(chartExporters));
  
  const allCharts: { [instanceId: string]: ChartImages } = {};
  
  for (const [instanceId, exporter] of Object.entries(chartExporters)) {
    try {
      const images = await exporter();
      allCharts[instanceId] = images;
      console.log(`Exported charts for instance "${instanceId}":`, Object.keys(images));
    } catch (error) {
      console.error(`Failed to export charts for instance "${instanceId}":`, error);
      allCharts[instanceId] = {};
    }
  }
  
  return allCharts;
}
