'use client';

import { useState, useEffect } from 'react';
import { Upload, FileText, Filter, BarChart3, Download } from 'lucide-react';
import { DataProcessor } from '@/lib/dataProcessor';
import { ProfileAnalyzer } from '@/lib/profileAnalyzer';
import { downloadExcelFile, downloadCsvFile, downloadHtmlFile, AnalysisExportData } from '@/lib/fileExporter';
import { AnalysisCharts, exportAllChartInstances } from '@/components/AnalysisCharts';
import { DistributionCharts, exportDistributionChartsInstance } from '@/components/DistributionCharts';
import ProfileMethodConfig from '@/components/ProfileMethodConfig';
import { NormalityTest, type NormalityTestResults } from '@/components/NormalityTest';
import { DataRow, FilterConfig, AggregationConfig, AnalysisResult, ProfileAnalysisConfig, AnalysisFieldDefinition, MethodConfig, ColumnType } from '@/types/data';
import SimpleAuth from '@/components/SimpleAuth';
import { formatNumberWithCommas, getConfiguredFieldLabel, formatSmart, formatParamValue, formatAnalysisText } from '@/lib/numberFormatter';

export default function Home() {
  // 将 exportAllChartInstances 注册到 window 对象，以便 Word 报告下载时调用
  useEffect(() => {
    (window as any).exportAnalysisCharts = async () => {
      console.log('exportAnalysisCharts called from window');
      const allCharts = await exportAllChartInstances();
      console.log('All charts exported:', allCharts);

      // 如果只有一个实例，直接返回该实例的图表
      const instances = Object.keys(allCharts);
      if (instances.length === 1) {
        console.log('Returning single instance charts:', allCharts[instances[0]]);
        return allCharts[instances[0]];
      }

      // 如果有多个实例，返回所有图表
      console.log('Returning all instance charts:', allCharts);
      return allCharts;
    };

    console.log('exportAnalysisCharts function registered to window');

    return () => {
      delete (window as any).exportAnalysisCharts;
    };
  }, []);
  const [originalData, setOriginalData] = useState<DataRow[]>([]);
  const [filteredData, setFilteredData] = useState<DataRow[]>([]);
  const [aggregatedData, setAggregatedData] = useState<DataRow[]>([]);
  const [aggregatedColumns, setAggregatedColumns] = useState<string[]>([]); // 聚合后的列名
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [columns, setColumns] = useState<string[]>([]);
  const [columnTypes, setColumnTypes] = useState<Record<string, ColumnType>>({}); // 列类型映射
  const [currentStep, setCurrentStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [maxCompletedStep, setMaxCompletedStep] = useState(1); // 跟踪最大完成步骤

  // 监控步骤变化，确保在进入步骤7时loading状态被重置（修复大数据量情况下按钮无法点击的问题）
  useEffect(() => {
    if (currentStep === 7 && loading) {
      console.log('⚠️ 步骤7检测到loading状态为true，自动重置为false');
      setLoading(false);
    }
    // 更新最大完成步骤
    if (currentStep > maxCompletedStep) {
      setMaxCompletedStep(currentStep);
    }
  }, [currentStep, loading, maxCompletedStep]);

  // 配置状态
  const [filterConfig, setFilterConfig] = useState<FilterConfig>({ type: 'unique' });
  const [filterApplied, setFilterApplied] = useState(false);
  const [aggregationConfig, setAggregationConfig] = useState<AggregationConfig>({
    groupBy: [],
    sumColumns: [],
    countColumns: [],
    maxColumns: [],
    minColumns: [],
    distinctColumns: []
  });
  const [aggregationApplied, setAggregationApplied] = useState(false);

  // 正态分布检验结果状态
  const [normalityTestResults, setNormalityTestResults] = useState<NormalityTestResults | null>(null);

  // 画像分析配置状态
  const [profileAnalysisConfig, setProfileAnalysisConfig] = useState<ProfileAnalysisConfig>({
    subjectFieldName: '',
    groupByFieldName: '',
    analysisFields: []
  });

  // 画像分析方法配置状态
  const [methodConfig, setMethodConfig] = useState<MethodConfig>({
    method: 'iqr',
    iqr: {
      upperMultiplier: 1.5,
      lowerMultiplier: 0
    },
    stddev: {
      upperMultiplier: 1.5,
      lowerMultiplier: 0
    }
  });

  // 数据分布可视化配置状态
  const [distributionChartConfig, setDistributionChartConfig] = useState<any>(null);

  // Excel sheet选择相关状态
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [excelSheetNames, setExcelSheetNames] = useState<string[]>([]);
  const [selectedSheetName, setSelectedSheetName] = useState<string>('');

  // 包装getConfiguredFieldLabel函数，捕获profileAnalysisConfig状态
  const getFieldLabel = (fieldName: string, defaultLabel: string): string => {
    return getConfiguredFieldLabel(fieldName, defaultLabel, profileAnalysisConfig);
  };

  // 格式化单元格值，根据列类型自动选择格式
  const formatCellValue = (value: any, columnName: string): string => {
    if (value === null || value === undefined) {
      return '';
    }

    // 如果是数字类型，根据列类型格式化
    if (typeof value === 'number' && !isNaN(value)) {
      const columnType = columnTypes[columnName] || 'number';
      return formatSmart(value, columnType, 2);
    }

    // 非数字类型直接返回字符串
    return String(value);
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // 检查文件大小（限制为 100MB）
    const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB
    if (file.size > MAX_FILE_SIZE) {
      alert(`文件大小超过限制！\n当前文件: ${formatNumberWithCommas(file.size / 1024 / 1024)}MB\n最大允许: 100MB\n\n建议：\n1. 删除不必要的列\n2. 使用数据抽样\n3. 拆分为多个文件处理`);
      return;
    }

    console.log('=== New file uploaded, resetting all states ===');
    console.log('File name:', file.name);
    console.log('File size:', formatNumberWithCommas(file.size / 1024 / 1024), 'MB');

    // 保存上传的文件
    setUploadedFile(file);

    // 检查是否为Excel文件
    const extension = file.name.split('.').pop()?.toLowerCase();
    if (extension === 'xlsx' || extension === 'xls') {
      setLoading(true);
      try {
        // 获取所有sheet名称
        const sheetNames = await DataProcessor.getExcelSheetNames(file);
        console.log('Excel sheets found:', sheetNames);
        setExcelSheetNames(sheetNames);

        if (sheetNames.length > 1) {
          // 多个sheet，显示选择界面
          setSelectedSheetName(sheetNames[0]); // 默认选择第一个sheet
          setLoading(false);
          return; // 等待用户选择
        } else {
          // 只有一个sheet，直接解析
          const data = await DataProcessor.parseFile(file);
          const types = DataProcessor.detectColumnTypes(data);
          console.log('检测到的列类型:', types);
          setOriginalData(data);
          setFilteredData(data);
          setColumns(Object.keys(data[0] || {}));
          setColumnTypes(types); // 保存列类型
          setFilterApplied(false); // 重置筛选状态
          setAggregationApplied(false); // 重置聚合状态
          setAggregatedData([]); // 重置聚合数据
          setAggregatedColumns([]); // 重置聚合列名
          setAnalysisResult(null); // 重置分析结果
          setProfileAnalysisConfig({
            subjectFieldName: '',
            groupByFieldName: '',
            analysisFields: []
          }); // 重置画像分析配置
          console.log('All states reset, original data rows:', data.length);
          setCurrentStep(2);
        }
      } catch (error) {
        alert(`文件解析失败: ${error}`);
        setLoading(false);
      }
    } else {
      // 非Excel文件，直接解析
      setLoading(true);
      try {
        const data = await DataProcessor.parseFile(file);
        const types = DataProcessor.detectColumnTypes(data);
        console.log('检测到的列类型:', types);
        setOriginalData(data);
        setFilteredData(data);
        setColumns(Object.keys(data[0] || {}));
        setColumnTypes(types); // 保存列类型
        setFilterApplied(false); // 重置筛选状态
        setAggregationApplied(false); // 重置聚合状态
        setAggregatedData([]); // 重置聚合数据
        setAggregatedColumns([]); // 重置聚合列名
        setAnalysisResult(null); // 重置分析结果
        setProfileAnalysisConfig({
          subjectFieldName: '',
          groupByFieldName: '',
          analysisFields: []
        }); // 重置画像分析配置
        console.log('All states reset, original data rows:', data.length);
        setCurrentStep(2);
      } catch (error) {
        alert(`文件解析失败: ${error}`);
      } finally {
        setLoading(false);
      }
    }
  };

  // 处理sheet选择
  const handleSheetSelect = async (sheetName: string) => {
    if (!uploadedFile) return;

    setLoading(true);
    try {
      const data = await DataProcessor.parseFile(uploadedFile, sheetName);
      const types = DataProcessor.detectColumnTypes(data);
      console.log('检测到的列类型:', types);
      setOriginalData(data);
      setFilteredData(data);
      setColumns(Object.keys(data[0] || {}));
      setColumnTypes(types); // 保存列类型
      setFilterApplied(false); // 重置筛选状态
      setAggregationApplied(false); // 重置聚合状态
      setAggregatedData([]); // 重置聚合数据
      setAggregatedColumns([]); // 重置聚合列名
      setAnalysisResult(null); // 重置分析结果
      setProfileAnalysisConfig({
        subjectFieldName: '',
        groupByFieldName: '',
        analysisFields: []
      }); // 重置画像分析配置
      console.log('All states reset, original data rows:', data.length);
      console.log('Selected sheet:', sheetName);
      setCurrentStep(2);
    } catch (error) {
      alert(`文件解析失败: ${error}`);
    } finally {
      setLoading(false);
    }
  };

  const applyFilter = () => {
    console.log('Applying filter with config:', filterConfig);
    console.log('Original data length:', originalData.length);
    
    // 验证筛选配置
    if (filterConfig.type === 'unique') {
      if (!filterConfig.columnA || !filterConfig.columnB) {
        alert('请选择列A和列B');
        return;
      }
    } else if (filterConfig.type === 'equals') {
      if (!filterConfig.targetColumn || filterConfig.targetValue === undefined || filterConfig.targetValue === '') {
        alert('请选择目标列并输入目标值');
        return;
      }
    }
    
    const filtered = DataProcessor.filterData(originalData, filterConfig);
    setFilteredData(filtered);
    setFilterApplied(true);
  };

  const applyAggregation = () => {
    // 验证聚合配置
    if (aggregationConfig.groupBy.length === 0) {
      alert('请至少选择一个分组字段');
      return;
    }

    // 验证至少选择了一种聚合方式
    const hasAnyAggregation =
      aggregationConfig.sumColumns.length > 0 ||
      aggregationConfig.countColumns.length > 0 ||
      aggregationConfig.maxColumns.length > 0 ||
      aggregationConfig.minColumns.length > 0 ||
      aggregationConfig.distinctColumns.length > 0;

    if (!hasAnyAggregation) {
      alert('请至少选择一个聚合字段（求和、计数、最大值、最小值、去重计数）');
      return;
    }

    console.log('=== Applying Aggregation ===');
    console.log('Aggregation config:', JSON.stringify(aggregationConfig, null, 2));
    console.log('Data to aggregate:', filteredData.length, 'rows');

    const aggregated = DataProcessor.aggregateData(filteredData, aggregationConfig);

    console.log('=== Aggregation Result ===');
    console.log('Aggregated rows:', aggregated.length);
    console.log('Aggregated data sample (first 3):', JSON.stringify(aggregated.slice(0, 3), null, 2));
    console.log('Aggregated columns:', aggregated.length > 0 ? Object.keys(aggregated[0]) : []);

    setAggregatedData(aggregated);
    setAggregatedColumns(aggregated.length > 0 ? Object.keys(aggregated[0]) : []); // 保存聚合后的列名
    setAggregationApplied(true);

    // 重置分析结果，因为聚合数据已经改变
    setAnalysisResult(null);

    // 添加聚合后的数据统计
    if (aggregated.length > 0) {
      const sumColumns = Object.keys(aggregated[0]).filter(col => col.includes('_sum'));
      const countColumns = Object.keys(aggregated[0]).filter(col => col.includes('_count'));

      console.log('\n=== Aggregated Data Statistics ===');
      console.log('Sum columns:', sumColumns);
      console.log('Count columns:', countColumns);

      if (sumColumns.length > 0) {
        sumColumns.forEach(col => {
          const values = aggregated.map(row => row[col]).filter(v => typeof v === 'number');
          console.log(`Column ${col}:`, {
            min: formatNumberWithCommas(Math.min(...values)),
            max: formatNumberWithCommas(Math.max(...values)),
            avg: formatNumberWithCommas((values.reduce((a, b) => a + b, 0) / values.length))
          });
        });
      }

      if (countColumns.length > 0) {
        countColumns.forEach(col => {
          const values = aggregated.map(row => row[col]).filter(v => typeof v === 'number');
          console.log(`Column ${col}:`, {
            min: formatNumberWithCommas(Math.min(...values), 0),
            max: formatNumberWithCommas(Math.max(...values), 0),
            avg: formatNumberWithCommas((values.reduce((a, b) => a + b, 0) / values.length), 0)
          });
        });
      }
    }
  };

  const applyAnalysis = async () => {
    console.log('=== Starting Analysis ===');
    console.log('Config:', JSON.stringify(profileAnalysisConfig, null, 2));
    console.log('Aggregated data rows:', aggregatedData.length);
    console.log('Aggregated columns:', aggregatedColumns);
    console.log('Aggregated data sample row (first 3):', JSON.stringify(aggregatedData.slice(0, 3), null, 2));
    console.log('Current aggregatedColumns state:', aggregatedColumns);
    console.log('Current aggregatedData state length:', aggregatedData.length);

    // 关键检查：验证 aggregatedData 是否为最新数据
    if (aggregatedData.length === 0) {
      console.error('❌ Aggregated data is empty!');
      alert('没有聚合数据可供分析，请先完成数据聚合或跳过聚合');
      return;
    }

    // 验证并更新聚合列名
    const currentDataColumns = Object.keys(aggregatedData[0] || {});
    console.log('Current data columns from actual data:', currentDataColumns);
    console.log('Stored aggregatedColumns:', aggregatedColumns);

    if (JSON.stringify(currentDataColumns.sort()) !== JSON.stringify(aggregatedColumns.sort())) {
      console.warn('⚠️ Data columns do not match stored columns, updating state');
      setAggregatedColumns(currentDataColumns);
    }

    // 添加数据统计信息，帮助验证数据是否正确
    console.log('\n=== Data Statistics Before Analysis ===');
    const sumColumns = currentDataColumns.filter(col => col.includes('_sum'));
    const countColumns = currentDataColumns.filter(col => col.includes('_count'));
    console.log('Sum columns found:', sumColumns);
    console.log('Count columns found:', countColumns);

    if (sumColumns.length > 0) {
      sumColumns.forEach(col => {
        const values = aggregatedData.map(row => row[col]).filter(v => typeof v === 'number');
        console.log(`Column ${col}:`, {
          min: Math.min(...values),
          max: Math.max(...values),
          avg: values.reduce((a, b) => a + b, 0) / values.length
        });
      });
    }

    if (countColumns.length > 0) {
      countColumns.forEach(col => {
        const values = aggregatedData.map(row => row[col]).filter(v => typeof v === 'number');
        console.log(`Column ${col}:`, {
          min: Math.min(...values),
          max: Math.max(...values),
          avg: values.reduce((a, b) => a + b, 0) / values.length
        });
      });
    }
    
    // 验证画像分析配置
    if (!profileAnalysisConfig.subjectFieldName) {
      alert('请选择分析对象字段名称');
      setCurrentStep(7); // 跳转到配置步骤
      return;
    }
    
    // 分组字段是可选项，允许为空字符串
    // 移除对分组字段的必填检查
    
    // 分析字段是可选项，允许为空
    // 移除对分析字段数量的必填检查
    
    // 如果有分析字段，检查是否都有描述（移除此检查，允许字段描述为空）
    // 未输入描述时，系统将使用字段名称作为默认标签

    if (aggregatedData.length === 0) {
      alert('没有聚合数据可供分析，请先完成数据聚合或跳过聚合');
      return;
    }

    // 验证配置的字段是否存在于数据中
    const availableColumns = Object.keys(aggregatedData[0] || {});
    const missingFields = [
      profileAnalysisConfig.subjectFieldName,
      profileAnalysisConfig.groupByFieldName,
      ...profileAnalysisConfig.analysisFields.map(f => f.fieldName)
    ].filter(field => field && field !== '' && !availableColumns.includes(field));  // 跳过空字符串

    if (missingFields.length > 0) {
      alert(`以下配置字段在数据中不存在：${missingFields.join(', ')}。请重新选择字段。\n可用字段：${availableColumns.join(', ')}`);
      setCurrentStep(7); // 跳转到配置步骤
      return;
    }

    setLoading(true);
    try {
      console.log('=== Starting Profile Analysis ===');
      console.log('User config:', JSON.stringify(profileAnalysisConfig, null, 2));
      console.log('Method config:', JSON.stringify(methodConfig, null, 2));
      console.log('Aggregated data columns:', availableColumns);
      console.log('Aggregated data sample row:', aggregatedData[0]);

      // 使用用户配置进行画像分析（包括方法配置）
      const analysis = await ProfileAnalyzer.analyzeWithCustomConfig(
        aggregatedData,
        profileAnalysisConfig,
        methodConfig,
        columnTypes
      );
      
      console.log('Custom profile analysis completed successfully');
      console.log('Analysis result keys:', Object.keys(analysis));
      console.log('Intelligent analysis keys:', Object.keys(analysis.intelligentAnalysis || {}));
      
      if (analysis.intelligentAnalysis?.transferTypeAnalysis) {
        console.log('Transfer type analysis groups:', Object.keys(analysis.intelligentAnalysis.transferTypeAnalysis));
      }
      if (analysis.intelligentAnalysis?.allCategories) {
        console.log('All categories count:', analysis.intelligentAnalysis.allCategories.length);
      }
      
      // 验证结果是否使用了用户配置的字段
      if (analysis.intelligentAnalysis?.transferTypeAnalysis) {
        Object.entries(analysis.intelligentAnalysis.transferTypeAnalysis).forEach(([groupKey, groupData]: [string, any]) => {
          console.log(`\nGroup "${groupKey}" analysis:`);
          console.log('  Categories count:', groupData.categories?.length || 0);
          if (groupData.categories && groupData.categories.length > 0) {
            groupData.categories.forEach((cat: any, idx: number) => {
              console.log(`  Category ${idx + 1}:`, cat.category);
              console.log('    Indicators keys:', Object.keys(cat.indicators || {}));
              console.log('    User configured fields:', profileAnalysisConfig.analysisFields.map(f => f.fieldName));
              
              // 检查是否所有用户配置的字段都在indicators中
              const userFields = profileAnalysisConfig.analysisFields.map(f => f.fieldName);
              const indicatorFields = Object.keys(cat.indicators || {});
              const missingInIndicators = userFields.filter(f => !indicatorFields.includes(f));
              const extraInIndicators = indicatorFields.filter(f => !userFields.includes(f));
              
              console.log('    User fields in indicators:', userFields.filter(f => indicatorFields.includes(f)));
              console.log('    Missing in indicators:', missingInIndicators);
              console.log('    Extra fields in indicators:', extraInIndicators);
            });
          }
        });
      }
      
      // 构建分析结果
      setAnalysisResult({
        aggregatedData: analysis.aggregatedData,
        profileAnalysis: analysis.basicAnalysis,
        summary: {
          totalRows: originalData.length,
          filteredRows: filteredData.length,
          groupedRows: aggregatedData.length
        },
        intelligentAnalysis: analysis.intelligentAnalysis,
        columnTypes: columnTypes
      });
      
      setCurrentStep(8); // 跳转到结果展示步骤
    } catch (error) {
      console.error('智能分析失败:', error);
      console.error('Error stack:', error instanceof Error ? error.stack : 'No stack trace');
      
      // 提供更详细的错误信息
      const errorMessage = error instanceof Error ? error.message : '未知错误';
      const fullError = `
分析失败详情：
错误信息：${errorMessage}
${error instanceof Error ? `堆栈信息：${error.stack}` : ''}
        
请检查：
1. 聚合数据是否正确生成
2. 配置字段是否存在于数据中
3. 网络连接是否正常
4. 查看浏览器控制台获取更多信息
`;
      alert(fullError);
    } finally {
      setLoading(false);
    }
  };

  const downloadExcelReport = async () => {
    console.log('=== downloadExcelReport 被调用 ===');
    console.log('当前状态:', {
      hasOriginalData: originalData.length > 0,
      hasFilteredData: filteredData.length > 0,
      hasAggregatedData: aggregatedData.length > 0,
      hasAnalysisResult: !!analysisResult
    });

    if (!analysisResult) {
      console.error('❌ 分析结果为空，无法下载');
      alert('分析结果为空，请先完成数据分析');
      return;
    }

    try {
      console.log('准备构建导出数据...');
      const exportData: AnalysisExportData = {
        originalData,
        filteredData,
        aggregatedData,
        analysisResult,
        filterConfig,
        aggregationConfig,
        intelligentAnalysis: analysisResult.intelligentAnalysis,
        normalityTestResults: normalityTestResults || undefined,
        columnTypes: columnTypes // 传递列类型信息用于百分比格式化
      };

      console.log('导出数据构建完成:', {
        originalDataLength: exportData.originalData.length,
        filteredDataLength: exportData.filteredData.length,
        aggregatedDataLength: exportData.aggregatedData.length,
        hasIntelligentAnalysis: !!exportData.intelligentAnalysis
      });

      // 检查数据量，如果过大则给用户提示
      const aggregatedDataCount = exportData.aggregatedData.length;
      const isLargeDataset = aggregatedDataCount > 50000;
      const isVeryLargeDataset = aggregatedDataCount > 200000;

      if (isVeryLargeDataset) {
        const confirmed = confirm(
          `⚠️ 警告：检测到聚合数据量非常大（共${aggregatedDataCount.toLocaleString()}条记录）！\n\n` +
          `Excel导出可能需要较长时间，建议：\n` +
          `1. 使用CSV格式下载（导出完整数据，性能更好）\n` +
          `2. 或者调整筛选/聚合条件减少数据量\n\n` +
          `Excel将导出以下内容：\n` +
          `- 聚合数据（含画像分类）：仅导出前1000行样本\n` +
          `- 画像分析结果：完整导出\n` +
          `- 画像参数说明：完整导出\n` +
          `- 正态分布检验结果：完整导出\n` +
          `- 分析摘要：完整导出\n\n` +
          `💡 如需完整的聚合数据，请点击"下载CSV"按钮。\n` +
          `是否继续下载Excel报告？`
        );

        if (!confirmed) {
          console.log('用户取消下载');
          return;
        }
      } else if (isLargeDataset) {
        const confirmed = confirm(
          `检测到聚合数据量较大（共${aggregatedDataCount.toLocaleString()}条记录）：\n\n` +
          `Excel将导出以下内容：\n` +
          `- 聚合数据（含画像分类）：仅导出前1000行样本\n` +
          `- 画像分析结果：完整导出\n` +
          `- 画像参数说明：完整导出\n` +
          `- 正态分布检验结果：完整导出\n` +
          `- 分析摘要：完整导出\n\n` +
          `💡 如需完整的聚合数据（共${aggregatedDataCount.toLocaleString()}条），请点击"下载CSV"按钮。\n\n` +
          `是否继续下载Excel报告？`
        );

        if (!confirmed) {
          console.log('用户取消下载');
          return;
        }
      } else {
        // 小数据量也需要提示，因为Excel只导出1000行样本
        if (aggregatedDataCount > 1000) {
          const confirmed = confirm(
            `聚合数据共${aggregatedDataCount.toLocaleString()}条记录。\n\n` +
            `Excel将导出以下内容：\n` +
            `- 聚合数据（含画像分类）：仅导出前1000行样本\n` +
            `- 画像分析结果：完整导出\n` +
            `- 画像参数说明：完整导出\n` +
            `- 正态分布检验结果：完整导出\n` +
            `- 分析摘要：完整导出\n\n` +
            `💡 如需完整的聚合数据，请点击"下载CSV"按钮。\n\n` +
            `是否继续下载Excel报告？`
          );

          if (!confirmed) {
            console.log('用户取消下载');
            return;
          }
        }
      }

      console.log('调用 downloadExcelFile...');
      console.log(`开始生成Excel，数据量：${aggregatedDataCount.toLocaleString()}条`);

      // 显示加载提示
      if (isLargeDataset) {
        alert(`正在生成Excel文件，数据量较大（${aggregatedDataCount.toLocaleString()}条），请稍候...\n\n浏览器可能会短暂无响应，这是正常现象，请耐心等待。`);
      }

      await downloadExcelFile(exportData);

      console.log('✅ Excel 报告下载流程完成');
      const sampleMessage = aggregatedDataCount > 1000
        ? `\n\n注意：聚合数据仅导出了前1000行样本。如需完整数据，请点击"下载CSV"按钮。`
        : '';

      // 使用 setTimeout 延迟显示成功提示，避免阻塞主线程
      setTimeout(() => {
        alert(`Excel 报告下载成功！请检查浏览器下载文件夹。${sampleMessage}`);
      }, 100);

    } catch (error) {
      console.error('❌ 下载 Excel 报告失败:', error);
      const errorMessage = error instanceof Error ? error.message : '未知错误';
      console.error('错误详情:', {
        message: errorMessage,
        stack: error instanceof Error ? error.stack : '无堆栈'
      });

      // 提供更友好的错误提示
      let userMessage = 'Excel 报告下载失败：' + errorMessage;

      if (errorMessage.includes('memory') || errorMessage.includes('内存') || errorMessage.includes('out of memory')) {
        userMessage = '内存不足！\n\n数据量过大导致Excel生成失败。\n建议：\n1. 使用JSON格式下载\n2. 调整筛选/聚合条件减少数据量\n3. 关闭其他浏览器标签页释放内存';
      } else if (errorMessage.includes('timeout') || errorMessage.includes('超时')) {
        userMessage = '生成超时！\n\nExcel生成时间过长导致失败。\n建议：\n1. 调整筛选/聚合条件减少数据量\n2. 使用JSON格式下载';
      }

      alert(userMessage);
    }
  };

  const downloadCsv = async () => {
    console.log('=== downloadCsv 被调用 ===');
    console.log('当前状态:', {
      hasAggregatedData: aggregatedData.length > 0,
      hasAnalysisResult: !!analysisResult
    });

    if (!aggregatedData || aggregatedData.length === 0) {
      console.error('❌ 聚合数据为空，无法下载');
      alert('聚合数据为空，无法下载CSV');
      return;
    }

    try {
      console.log('准备构建CSV导出数据...');
      const exportData: AnalysisExportData = {
        originalData,
        filteredData,
        aggregatedData,
        analysisResult,
        filterConfig,
        aggregationConfig,
        intelligentAnalysis: analysisResult?.intelligentAnalysis,
        columnTypes: columnTypes // 传递列类型信息用于百分比格式化
      };

      console.log('CSV导出数据构建完成:', {
        aggregatedDataLength: exportData.aggregatedData.length,
        hasIntelligentAnalysis: !!exportData.intelligentAnalysis
      });

      // 检查数据量，如果过大则给用户提示
      const aggregatedDataCount = exportData.aggregatedData.length;
      const isLargeDataset = aggregatedDataCount > 100000;

      if (isLargeDataset) {
        const confirmed = confirm(
          `检测到聚合数据量非常大（共${aggregatedDataCount.toLocaleString()}条记录）！\n\n` +
          `CSV导出包含完整的聚合数据（含画像分类），文件可能较大。\n\n` +
          `是否继续下载CSV文件？`
        );

        if (!confirmed) {
          console.log('用户取消下载');
          return;
        }
      }

      console.log('调用 downloadCsvFile...');
      console.log(`开始生成CSV，数据量：${aggregatedDataCount.toLocaleString()}条`);

      // 显示加载提示
      if (isLargeDataset) {
        alert(`正在生成CSV文件，数据量较大（${aggregatedDataCount.toLocaleString()}条），请稍候...`);
      }

      await downloadCsvFile(exportData);

      console.log('✅ CSV 文件下载流程完成');
      // 使用 setTimeout 延迟显示成功提示，避免阻塞主线程
      setTimeout(() => {
        alert('CSV 文件下载成功！请检查浏览器下载文件夹。');
      }, 100);

    } catch (error) {
      console.error('❌ 下载 CSV 文件失败:', error);
      const errorMessage = error instanceof Error ? error.message : '未知错误';
      console.error('错误详情:', {
        message: errorMessage,
        stack: error instanceof Error ? error.stack : '无堆栈'
      });
      alert('CSV 文件下载失败：' + errorMessage);
    }
  };

  const downloadReport = async () => {
    console.log('=== downloadReport 被调用 ===');
    console.log('当前状态:', {
      hasOriginalData: originalData.length > 0,
      hasAnalysisResult: !!analysisResult
    });

    if (!analysisResult) {
      console.error('❌ 分析结果为空，无法下载');
      alert('分析结果为空，请先完成数据分析');
      return;
    }

    try {
      console.log('开始下载报告流程...');
      alert('正在生成报告，请稍候...');

      console.log('尝试导出图表...');
      // 尝试导出图表
      let chartImages: any = {};
      let distributionChartImages: any = null;

      try {
        // 导出画像分析图表
        const allCharts = await exportAllChartInstances();
        console.log('✅ 画像分析图表导出成功, 实例数量:', Object.keys(allCharts).length);

        // 直接传递所有图表实例（保持原有结构）
        // HTML生成函数会自动判断是单实例还是多实例
        chartImages = allCharts;
        const firstInstanceKey = Object.keys(allCharts)[0];
        const firstInstanceKeys = firstInstanceKey ? Object.keys(allCharts[firstInstanceKey] as any) : [];
        console.log('图表数据结构:', {
          instanceCount: Object.keys(allCharts).length,
          instances: Object.keys(allCharts),
          firstInstanceKeys,
          firstInstanceChartCount: firstInstanceKeys.length
        });

        // 详细日志每个实例的图表
        Object.entries(allCharts).forEach(([instanceId, instanceImages]: [string, any]) => {
          console.log(`实例 "${instanceId}" 图表:`, {
            hasBarChart: !!instanceImages.barChart,
            hasPieChart: !!instanceImages.pieChart,
            hasDonutChart: !!instanceImages.donutChart
          });
        });
      } catch (error) {
        console.warn('⚠️ 画像分析图表导出失败，将使用占位符:', error);
      }

      try {
        // 导出数据分布图表（使用全局注册表，与AnalysisCharts一致）
        console.log('尝试导出数据分布图表...');
        distributionChartImages = await exportDistributionChartsInstance();
        console.log('✅ 数据分布图表导出成功:', distributionChartImages);

        // 检查是否成功导出了图片
        if (!distributionChartImages || !distributionChartImages.images || Object.keys(distributionChartImages.images).length === 0) {
          console.warn('⚠️ 数据分布图表未生成图片，可能用户未生成图表或未完成步骤5');
        }
      } catch (error) {
        console.warn('⚠️ 数据分布图表导出失败:', error);
      }

      console.log('准备构建导出数据...');
      const exportData: AnalysisExportData = {
        originalData,
        filteredData,
        aggregatedData,
        analysisResult,
        filterConfig,
        aggregationConfig,
        intelligentAnalysis: analysisResult.intelligentAnalysis,
        chartImages,
        normalityTestResults: normalityTestResults || undefined,
        distributionChartConfig: distributionChartConfig,
        distributionChartImages: distributionChartImages,
        columnTypes: columnTypes // 传递列类型信息用于百分比格式化
      };

      console.log('导出数据构建完成:', {
        hasChartImages: !!chartImages,
        chartInstanceCount: chartImages ? Object.keys(chartImages).length : 0,
        chartInstances: chartImages ? Object.keys(chartImages) : []
      });

      console.log('调用 downloadHtmlFile...');
      await downloadHtmlFile(exportData);

      console.log('✅ HTML 报告下载流程完成');
      // 使用 setTimeout 延迟显示成功提示，避免阻塞主线程
      setTimeout(() => {
        alert('报告下载完成！请检查浏览器下载文件夹。');
      }, 100);

    } catch (error) {
      console.error('❌ 下载 HTML 报告失败:', error);
      const errorMessage = error instanceof Error ? error.message : '未知错误';
      console.error('错误详情:', {
        message: errorMessage,
        stack: error instanceof Error ? error.stack : '无堆栈'
      });
      alert('下载失败：' + errorMessage);
    }
  };

  const downloadAllChartImages = async () => {
    console.log('=== downloadAllChartImages 被调用 ===');
    alert('开始下载所有图表图片...');

    try {
      // 调用新函数导出所有图表实例
      const allChartInstances = await exportAllChartInstances();
      console.log('所有图表实例导出成功:', Object.keys(allChartInstances));

      let downloadedCount = 0;
      const dateStr = new Date().toISOString().split('T')[0];

      // 遍历所有图表实例
      for (const [instanceId, chartImages] of Object.entries(allChartInstances)) {
        console.log(`处理图表实例 "${instanceId}":`, Object.keys(chartImages));

        // 确定实例名称前缀（基于实际分组值）
        let instanceName = '';
        if (instanceId === 'IN') {
          instanceName = `IN`;
        } else if (instanceId === 'OUT') {
          instanceName = `OUT`;
        } else if (instanceId === 'default') {
          instanceName = `整体`;
        } else {
          instanceName = instanceId;
        }

        // 动态获取字段名称（避免硬编码领域术语）
        const chartFieldLabels = getChartFieldLabels();
        const countLabel = chartFieldLabels.countLabel || '计数';
        const valueLabel = chartFieldLabels.valueLabel || '数值';

        // 下载柱状图
        if (chartImages.barChart) {
          const blob = dataURLtoBlob(chartImages.barChart);
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = `柱状图_${instanceName}各类对象${countLabel}分布_${dateStr}.png`;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          URL.revokeObjectURL(url);
          downloadedCount++;
          console.log(`[${instanceName}] 柱状图下载完成`);
        }

        // 下载饼图（计数数据分布）
        if (chartImages.pieChart) {
          const blob = dataURLtoBlob(chartImages.pieChart);
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = `饼图_${instanceName}${countLabel}数据分布_${dateStr}.png`;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          URL.revokeObjectURL(url);
          downloadedCount++;
          console.log(`[${instanceName}] 饼图下载完成`);
        }

        // 下载环形图（数值比重）
        if (chartImages.donutChart) {
          const blob = dataURLtoBlob(chartImages.donutChart);
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = `环形图_${instanceName}${valueLabel}比重_${dateStr}.png`;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          URL.revokeObjectURL(url);
          downloadedCount++;
          console.log(`[${instanceName}] 环形图下载完成`);
        }
      }

      alert(`成功下载 ${downloadedCount} 张图表图片（包括IN流入、OUT流出和整体的所有图表）！`);
    } catch (error) {
      console.error('下载图表图片失败:', error);
      alert('下载失败：' + (error as Error).message);
    }
  };

  // 辅助函数：将 DataURL 转换为 Blob
  const dataURLtoBlob = (dataURL: string) => {
    const arr = dataURL.split(',');
    const mime = arr[0].match(/:(.*?);/)?.[1] || 'image/png';
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while (n--) {
      u8arr[n] = bstr.charCodeAt(n);
    }
    return new Blob([u8arr], { type: mime });
  };

  // 动态获取图表字段标签（基于实际数据，避免硬编码）
  const getChartFieldLabels = () => {
    if (!aggregatedData || aggregatedData.length === 0) {
      return { countLabel: '计数', valueLabel: '数值' };
    }

    const columns = Object.keys(aggregatedData[0]);
    const sumColumns = columns.filter(col => col.includes('_sum'));
    const countColumns = columns.filter(col => col.includes('_count') || col === '_count');

    // 识别计数字段标签
    let countLabel = '计数';
    if (countColumns.length > 0) {
      // 使用字段名去除后缀作为标签
      const baseName = countColumns[0].replace(/_count$/, '');
      countLabel = baseName || countColumns[0];
    }

    // 识别数值字段标签
    let valueLabel = '数值';
    if (sumColumns.length > 0) {
      const baseName = sumColumns[0].replace(/_sum$/, '');
      valueLabel = baseName || sumColumns[0];
    } else if (columns.some(col => typeof aggregatedData[0][col] === 'number')) {
      // 使用第一个数值字段
      const firstNumCol = columns.find(col => typeof aggregatedData[0][col] === 'number');
      if (firstNumCol) {
        valueLabel = firstNumCol;
      }
    }

    return { countLabel, valueLabel };
  };

  return (
    <SimpleAuth>
      <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="bg-white rounded-lg shadow-lg p-6">
          <h1 className="text-3xl font-bold text-gray-900 mb-8">数据分析与画像应用</h1>
          
          {/* 步骤导航 */}
          <div className="mb-8">
            <div className="flex items-center">
              {[
                { num: 1, label: '数据上传' },
                { num: 2, label: '数据预览', hasSkip: true, skipTo: 3 },
                { num: 3, label: '数据筛选', hasSkip: true, skipTo: 4 },
                { num: 4, label: '数据聚合', hasSkip: true, skipTo: 5 },
                { num: 5, label: '分布可视化', hasSkip: true, skipTo: 6 },
                { num: 6, label: '正态检验', hasSkip: true, skipTo: 7 },
                { num: 7, label: '画像配置', hasSkip: false },
                { num: 8, label: '报告导出', hasSkip: false }
              ].map((item, index) => (
                <div key={item.num} className="flex-1 flex items-center">
                  <div className="flex flex-col items-center flex-1">
                    <div
                      className={`w-10 h-10 rounded-full flex items-center justify-center ${
                        currentStep >= item.num ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-600'
                      } ${item.num <= maxCompletedStep && item.num !== currentStep ? 'cursor-pointer hover:ring-2 hover:ring-blue-300 transition-all' : ''}`}
                      onClick={() => {
                        // 只有已完成且非当前步骤的步骤可以点击跳转
                        if (item.num <= maxCompletedStep && item.num !== currentStep) {
                          setCurrentStep(item.num);
                        }
                      }}
                      title={item.num <= maxCompletedStep && item.num !== currentStep ? '点击跳转到此步骤' : ''}
                    >
                      {item.num}
                    </div>
                    <div className={`mt-2 text-xs ${
                      currentStep >= item.num ? 'text-blue-600 font-medium' : 'text-gray-500'
                    }`}>
                      {item.label}
                    </div>
                    {item.hasSkip && currentStep === item.num && (
                      <button
                        onClick={() => {
                          if (item.skipTo) {
                            // 获取所有列名的辅助函数
                            const getAllColumns = (data: DataRow[]): string[] => {
                              if (data.length === 0) return [];
                              const columnSet = new Set<string>();
                              data.forEach(row => {
                                Object.keys(row).forEach(key => columnSet.add(key));
                              });
                              return Array.from(columnSet);
                            };

                            // 执行跳过逻辑
                            if (item.num === 2) {
                              // 跳过数据预览：filteredData = originalData
                              if (!filterApplied && filteredData.length === 0) {
                                setFilteredData(originalData);
                              }
                              setCurrentStep(item.skipTo);
                            } else if (item.num === 3) {
                              // 跳过数据筛选：确保 filteredData 有数据
                              if (!filterApplied && filteredData.length === 0) {
                                setFilteredData(originalData);
                              }
                              setCurrentStep(item.skipTo);
                            } else if (item.num === 4) {
                              // 跳过聚合：确保 filteredData 有数据，然后设置 aggregatedData
                              const dataToAggregate = filteredData.length > 0 ? filteredData : originalData;
                              setAggregatedData(dataToAggregate);
                              const dataColumns = getAllColumns(dataToAggregate);
                              setAggregatedColumns(dataColumns.length > 0 ? dataColumns : columns);
                              setCurrentStep(item.skipTo);
                            } else if (item.num === 5) {
                              // 跳过分布可视化：确保 aggregatedData 有数据
                              if (aggregatedData.length === 0) {
                                const dataToAggregate = filteredData.length > 0 ? filteredData : originalData;
                                setAggregatedData(dataToAggregate);
                                const dataColumns = getAllColumns(dataToAggregate);
                                setAggregatedColumns(dataColumns.length > 0 ? dataColumns : columns);
                              }
                              setCurrentStep(item.skipTo);
                            } else if (item.num === 6) {
                              // 跳过正态检验：确保 aggregatedData 有数据
                              if (aggregatedData.length === 0) {
                                const dataToAggregate = filteredData.length > 0 ? filteredData : originalData;
                                setAggregatedData(dataToAggregate);
                                const dataColumns = getAllColumns(dataToAggregate);
                                setAggregatedColumns(dataColumns.length > 0 ? dataColumns : columns);
                              }
                              setCurrentStep(item.skipTo);
                            }
                          }
                        }}
                        className="mt-1 px-2 py-0.5 text-xs bg-gray-100 hover:bg-gray-200 text-gray-600 rounded transition-colors"
                        title="跳过此步骤"
                      >
                        跳过
                      </button>
                    )}
                  </div>
                  {index < 7 && (
                    <div className={`flex-1 h-1 mx-2 ${
                      currentStep > item.num ? 'bg-blue-600' : 'bg-gray-200'
                    }`} />
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* 步骤1: 数据上传 */}
          {currentStep === 1 && (
            <div className="space-y-6">
              <div className="flex items-center space-x-2 mb-4">
                <Upload className="w-6 h-6 text-blue-600" />
                <h2 className="text-xl font-semibold">数据上传</h2>
              </div>
              
              {/* 显示文件上传界面 */}
              {excelSheetNames.length === 0 && (
                <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center">
                  <input
                    type="file"
                    accept=".csv,.xlsx,.xls,.json"
                    onChange={handleFileUpload}
                    className="hidden"
                    id="file-upload"
                  />
                  <label htmlFor="file-upload" className="cursor-pointer">
                    <FileText className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                    <p className="text-lg font-medium text-gray-900">点击上传文件</p>
                    <p className="text-sm text-gray-500">支持 CSV、Excel、JSON 格式（最大 100MB）</p>
                  </label>

                  <div className="mt-4 text-xs text-gray-400">
                    <p>💡 建议：数据量较大时可以先在 Excel 中进行预处理</p>
                  </div>
                </div>
              )}

              {/* 显示sheet选择界面 */}
              {excelSheetNames.length > 1 && (
                <div className="bg-white border border-gray-200 rounded-lg p-6">
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">
                    检测到多个Sheet，请选择要使用的工作表
                  </h3>
                  <div className="space-y-2">
                    {excelSheetNames.map((sheetName, index) => (
                      <div
                        key={index}
                        onClick={() => setSelectedSheetName(sheetName)}
                        className={`flex items-center p-4 rounded-lg cursor-pointer transition-all ${
                          selectedSheetName === sheetName
                            ? 'bg-blue-50 border-2 border-blue-500'
                            : 'bg-gray-50 border-2 border-transparent hover:bg-gray-100'
                        }`}
                      >
                        <input
                          type="radio"
                          checked={selectedSheetName === sheetName}
                          onChange={() => setSelectedSheetName(sheetName)}
                          className="mr-3"
                        />
                        <FileText className="w-5 h-5 text-gray-500 mr-3" />
                        <div className="flex-1">
                          <p className="font-medium text-gray-900">{sheetName}</p>
                          <p className="text-sm text-gray-500">Sheet {index + 1}</p>
                        </div>
                        {selectedSheetName === sheetName && (
                          <span className="text-blue-600 font-medium">已选择</span>
                        )}
                      </div>
                    ))}
                  </div>
                  <div className="mt-6 flex space-x-4">
                    <button
                      onClick={() => handleSheetSelect(selectedSheetName)}
                      disabled={!selectedSheetName || loading}
                      className={`px-6 py-2 rounded-lg font-medium ${
                        selectedSheetName && !loading
                          ? 'bg-blue-600 text-white hover:bg-blue-700'
                          : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                      }`}
                    >
                      {loading ? '加载中...' : '确认使用此Sheet'}
                    </button>
                    <button
                      onClick={() => {
                        setExcelSheetNames([]);
                        setUploadedFile(null);
                        setSelectedSheetName('');
                      }}
                      className="px-6 py-2 rounded-lg font-medium border border-gray-300 text-gray-700 hover:bg-gray-50"
                    >
                      重新上传
                    </button>
                  </div>
                </div>
              )}
              
              {loading && excelSheetNames.length === 0 && (
                <div className="text-center">
                  <p className="text-blue-600">正在处理文件...</p>
                </div>
              )}
            </div>
          )}

          {/* 步骤2: 数据预览 */}
          {currentStep === 2 && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <FileText className="w-6 h-6 text-blue-600" />
                  <h2 className="text-xl font-semibold">数据预览</h2>
                </div>
                <button
                  onClick={() => setCurrentStep(3)}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                >
                  下一步
                </button>
              </div>
              
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      {columns.map(col => (
                        <th key={col} className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          {col}
                          {columnTypes[col] === 'percentage' && (
                            <span className="ml-1 text-xs text-blue-600">(%)</span>
                          )}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {originalData.slice(0, 10).map((row, idx) => (
                      <tr key={idx}>
                        {columns.map(col => (
                          <td key={col} className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                            {formatCellValue(row[col], col)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-sm text-gray-500">显示前10行，共 {originalData.length} 行数据</p>
            </div>
          )}

          {/* 步骤3: 数据筛选 */}
          {currentStep === 3 && (
            <div className="space-y-6">
              <div className="flex items-center space-x-2 mb-4">
                <Filter className="w-6 h-6 text-blue-600" />
                <h2 className="text-xl font-semibold">数据筛选</h2>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">筛选类型</label>
                  <select
                    value={filterConfig.type}
                    onChange={(e) => setFilterConfig({ ...filterConfig, type: e.target.value as 'unique' | 'equals' })}
                    className="w-full p-2 border border-gray-300 rounded-lg"
                  >
                    <option value="unique">B列值不为A列的不重复值</option>
                    <option value="equals">某列等于特定值</option>
                  </select>
                </div>

                {filterConfig.type === 'unique' && (
                  <>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">列A（不重复值）</label>
                      <select
                        value={filterConfig.columnA || ''}
                        onChange={(e) => setFilterConfig({ ...filterConfig, columnA: e.target.value })}
                        className="w-full p-2 border border-gray-300 rounded-lg"
                      >
                        <option value="">选择列</option>
                        {columns.map(col => (
                          <option key={col} value={col}>{col}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">列B（筛选列）</label>
                      <select
                        value={filterConfig.columnB || ''}
                        onChange={(e) => setFilterConfig({ ...filterConfig, columnB: e.target.value })}
                        className="w-full p-2 border border-gray-300 rounded-lg"
                      >
                        <option value="">选择列</option>
                        {columns.map(col => (
                          <option key={col} value={col}>{col}</option>
                        ))}
                      </select>
                    </div>
                  </>
                )}

                {filterConfig.type === 'equals' && (
                  <>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">目标列</label>
                      <select
                        value={filterConfig.targetColumn || ''}
                        onChange={(e) => setFilterConfig({ ...filterConfig, targetColumn: e.target.value })}
                        className="w-full p-2 border border-gray-300 rounded-lg"
                      >
                        <option value="">选择列</option>
                        {columns.map(col => (
                          <option key={col} value={col}>{col}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">目标值</label>
                      <input
                        type="text"
                        value={filterConfig.targetValue || ''}
                        onChange={(e) => setFilterConfig({ ...filterConfig, targetValue: e.target.value })}
                        className="w-full p-2 border border-gray-300 rounded-lg"
                        placeholder="输入要匹配的值"
                      />
                    </div>
                  </>
                )}
              </div>

              {!filterApplied ? (
                <div className="flex space-x-4">
                  <button
                    onClick={applyFilter}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                  >
                    应用筛选
                  </button>
                  <button
                    onClick={() => setCurrentStep(4)}
                    className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700"
                  >
                    跳过筛选
                  </button>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
                    <h3 className="text-sm font-medium text-green-800">筛选完成</h3>
                    <p className="text-sm text-green-600">
                      原始数据: {originalData.length} 行 → 筛选后: {filteredData.length} 行
                    </p>
                  </div>
                  
                  {/* 显示筛选后的数据预览 */}
                  {filteredData.length > 0 && (
                    <div>
                      <h3 className="text-sm font-medium text-gray-700 mb-2">筛选后数据预览（前5行）</h3>
                      <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-200 text-sm">
                          <thead className="bg-gray-50">
                            <tr>
                              {columns.map(col => (
                                <th key={col} className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                                  {col}
                                  {columnTypes[col] === 'percentage' && (
                                    <span className="ml-1 text-xs text-blue-600">(%)</span>
                                  )}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody className="bg-white divide-y divide-gray-200">
                            {filteredData.slice(0, 5).map((row, idx) => (
                              <tr key={idx}>
                                {columns.map(col => (
                                  <td key={col} className="px-4 py-2 whitespace-nowrap text-xs text-gray-900">
                                    {formatCellValue(row[col], col)}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  <div className="flex space-x-4">
                    <button
                      onClick={() => {
                        setFilterApplied(false);
                        setFilteredData(originalData);
                      }}
                      className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700"
                    >
                      重新筛选
                    </button>
                    <button
                      onClick={() => {
                        setCurrentStep(4);
                        setAggregationApplied(false); // 进入聚合步骤时重置状态
                      }}
                      className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                    >
                      下一步：数据聚合
                    </button>
                  </div>
                </div>
              )}

              {/* 显示原始数据状态（仅在未应用筛选时显示） */}
              {!filterApplied && (
                <div className="mt-6 p-4 bg-gray-50 rounded-lg">
                  <h3 className="text-sm font-medium text-gray-700 mb-2">数据状态</h3>
                  <p className="text-sm text-gray-600">当前数据行数: {originalData.length}</p>
                </div>
              )}

              {/* 显示原始数据预览（仅在未应用筛选时显示） */}
              {!filterApplied && originalData.length > 0 && (
                <div className="mt-6">
                  <h3 className="text-sm font-medium text-gray-700 mb-2">数据预览（前5行）</h3>
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200 text-sm">
                      <thead className="bg-gray-50">
                        <tr>
                          {columns.map(col => (
                            <th key={col} className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                              {col}
                              {columnTypes[col] === 'percentage' && (
                                <span className="ml-1 text-xs text-blue-600">(%)</span>
                              )}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {originalData.slice(0, 5).map((row, idx) => (
                          <tr key={idx}>
                            {columns.map(col => (
                              <td key={col} className="px-4 py-2 whitespace-nowrap text-xs text-gray-900">
                                {formatCellValue(row[col], col)}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 步骤4: 数据聚合 */}
          {currentStep === 4 && (
            <div className="space-y-6">
              <div className="flex items-center space-x-2 mb-4">
                <BarChart3 className="w-6 h-6 text-blue-600" />
                <h2 className="text-xl font-semibold">数据聚合</h2>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-5 gap-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">分组字段</label>
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {columns.map(col => (
                      <label key={col} className="flex items-center">
                        <input
                          type="checkbox"
                          checked={aggregationConfig.groupBy.includes(col)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setAggregationConfig({
                                ...aggregationConfig,
                                groupBy: [...aggregationConfig.groupBy, col]
                              });
                            } else {
                              setAggregationConfig({
                                ...aggregationConfig,
                                groupBy: aggregationConfig.groupBy.filter(c => c !== col)
                              });
                            }
                          }}
                          className="mr-2"
                        />
                        {col}
                      </label>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">求和字段</label>
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {columns.map(col => (
                      <label key={col} className="flex items-center">
                        <input
                          type="checkbox"
                          checked={aggregationConfig.sumColumns.includes(col)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setAggregationConfig({
                                ...aggregationConfig,
                                sumColumns: [...aggregationConfig.sumColumns, col]
                              });
                            } else {
                              setAggregationConfig({
                                ...aggregationConfig,
                                sumColumns: aggregationConfig.sumColumns.filter(c => c !== col)
                              });
                            }
                          }}
                          className="mr-2"
                        />
                        {col}
                      </label>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">计数字段</label>
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {columns.map(col => (
                      <label key={col} className="flex items-center">
                        <input
                          type="checkbox"
                          checked={aggregationConfig.countColumns.includes(col)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setAggregationConfig({
                                ...aggregationConfig,
                                countColumns: [...aggregationConfig.countColumns, col]
                              });
                            } else {
                              setAggregationConfig({
                                ...aggregationConfig,
                                countColumns: aggregationConfig.countColumns.filter(c => c !== col)
                              });
                            }
                          }}
                          className="mr-2"
                        />
                        {col}
                      </label>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">最大值字段</label>
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {columns.map(col => (
                      <label key={col} className="flex items-center">
                        <input
                          type="checkbox"
                          checked={aggregationConfig.maxColumns.includes(col)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setAggregationConfig({
                                ...aggregationConfig,
                                maxColumns: [...aggregationConfig.maxColumns, col]
                              });
                            } else {
                              setAggregationConfig({
                                ...aggregationConfig,
                                maxColumns: aggregationConfig.maxColumns.filter(c => c !== col)
                              });
                            }
                          }}
                          className="mr-2"
                        />
                        {col}
                      </label>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">最小值字段</label>
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {columns.map(col => (
                      <label key={col} className="flex items-center">
                        <input
                          type="checkbox"
                          checked={aggregationConfig.minColumns.includes(col)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setAggregationConfig({
                                ...aggregationConfig,
                                minColumns: [...aggregationConfig.minColumns, col]
                              });
                            } else {
                              setAggregationConfig({
                                ...aggregationConfig,
                                minColumns: aggregationConfig.minColumns.filter(c => c !== col)
                              });
                            }
                          }}
                          className="mr-2"
                        />
                        {col}
                      </label>
                    ))}
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">去重计数字段</label>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  {columns.map(col => (
                    <label key={col} className="flex items-center p-2 border rounded hover:bg-gray-50">
                      <input
                        type="checkbox"
                        checked={aggregationConfig.distinctColumns.includes(col)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setAggregationConfig({
                              ...aggregationConfig,
                              distinctColumns: [...aggregationConfig.distinctColumns, col]
                            });
                          } else {
                            setAggregationConfig({
                              ...aggregationConfig,
                              distinctColumns: aggregationConfig.distinctColumns.filter(c => c !== col)
                            });
                          }
                        }}
                        className="mr-2"
                      />
                      {col}
                    </label>
                  ))}
                </div>
              </div>

              {!aggregationApplied ? (
                <div className="flex space-x-4">
                  <button
                    onClick={applyAggregation}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                  >
                    应用聚合
                  </button>
                  <button
                    onClick={() => {
                      // 跳过聚合时，使用筛选后的数据作为聚合数据
                      setAggregatedData(filteredData);
                      setAggregatedColumns(columns);
                      setCurrentStep(5);
                    }}
                    className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700"
                  >
                    跳过聚合
                  </button>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
                    <h3 className="text-sm font-medium text-green-800">聚合完成</h3>
                    <p className="text-sm text-green-600">
                      筛选后数据: {filteredData.length} 行 → 聚合后: {aggregatedData.length} 行
                    </p>
                  </div>
                  
                  {/* 显示聚合后的数据预览 */}
                  {aggregatedData.length > 0 && (
                    <div>
                      <h3 className="text-sm font-medium text-gray-700 mb-2">聚合后数据预览（前5行）</h3>
                      <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-200 text-sm">
                          <thead className="bg-gray-50">
                            <tr>
                              {Object.keys(aggregatedData[0]).map(col => (
                                <th key={col} className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                                  {col}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody className="bg-white divide-y divide-gray-200">
                            {aggregatedData.slice(0, 5).map((row, idx) => (
                              <tr key={idx}>
                                {Object.values(row).map((val, cellIdx) => (
                                  <td key={cellIdx} className="px-4 py-2 whitespace-nowrap text-xs text-gray-900">
                                    {typeof val === 'number' ? formatNumberWithCommas(val) : val}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  <div className="flex space-x-4">
                    <button
                      onClick={() => {
                        setAggregationApplied(false);
                        setAggregatedData([]);
                      }}
                      className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700"
                    >
                      重新聚合
                    </button>
                    <button
                      onClick={() => setCurrentStep(5)}
                      className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700"
                    >
                      查看分布图
                    </button>
                    <button
                      onClick={() => setCurrentStep(7)}
                      className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                    >
                      下一步：画像分析配置
                    </button>
                  </div>
                </div>
              )}

              {/* 显示筛选后数据状态（仅在未应用聚合时显示） */}
              {!aggregationApplied && (
                <div className="mt-6 p-4 bg-gray-50 rounded-lg">
                  <h3 className="text-sm font-medium text-gray-700 mb-2">数据状态</h3>
                  <p className="text-sm text-gray-600">当前数据行数: {filteredData.length}</p>
                  <p className="text-sm text-gray-600">
                    聚合配置: {aggregationConfig.groupBy.length > 0 ? `分组(${aggregationConfig.groupBy.join(', ')})` : '未设置分组'}
                  </p>
                  <div className="mt-2 text-sm text-gray-600">
                    {aggregationConfig.sumColumns.length > 0 && <p>求和: {aggregationConfig.sumColumns.join(', ')}</p>}
                    {aggregationConfig.countColumns.length > 0 && <p>计数: {aggregationConfig.countColumns.join(', ')}</p>}
                    {aggregationConfig.maxColumns.length > 0 && <p>最大值: {aggregationConfig.maxColumns.join(', ')}</p>}
                    {aggregationConfig.minColumns.length > 0 && <p>最小值: {aggregationConfig.minColumns.join(', ')}</p>}
                    {aggregationConfig.distinctColumns.length > 0 && <p>去重计数: {aggregationConfig.distinctColumns.join(', ')}</p>}
                    {aggregationConfig.sumColumns.length === 0 &&
                     aggregationConfig.countColumns.length === 0 &&
                     aggregationConfig.maxColumns.length === 0 &&
                     aggregationConfig.minColumns.length === 0 &&
                     aggregationConfig.distinctColumns.length === 0 && <p>未选择聚合字段</p>}
                  </div>
                </div>
              )}

              {/* 显示筛选后数据预览（仅在未应用聚合时显示） */}
              {!aggregationApplied && filteredData.length > 0 && (
                <div className="mt-6">
                  <h3 className="text-sm font-medium text-gray-700 mb-2">待聚合数据预览（前5行）</h3>
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200 text-sm">
                      <thead className="bg-gray-50">
                        <tr>
                          {columns.map(col => (
                            <th key={col} className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                              {col}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {filteredData.slice(0, 5).map((row, idx) => (
                          <tr key={idx}>
                            {columns.map(col => (
                              <td key={col} className="px-4 py-2 whitespace-nowrap text-xs text-gray-900">
                                {row[col]}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 步骤5: 数据分布可视化 */}
          {currentStep === 5 && (
            <div className="space-y-6">
              <div className="flex items-center space-x-2 mb-4">
                <BarChart3 className="w-6 h-6 text-blue-600" />
                <h2 className="text-xl font-semibold">数据分布可视化</h2>
              </div>
              
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
                <h3 className="text-sm font-semibold text-blue-800 mb-2">功能说明</h3>
                <p className="text-sm text-blue-700 mb-2">查看聚合后数据字段（主要是sum字段和count字段）的分布情况，帮助理解数据特征。</p>
                <ul className="text-sm text-blue-700 space-y-1">
                  <li>• <strong>直方图</strong>：展示数据在不同区间的分布情况</li>
                  <li>• <strong>Box Plot</strong>：展示数据的统计特征（最小值、Q1、中位数、Q3、最大值）</li>
                  <li>• <strong>散点图</strong>：展示所有数据点的分布位置</li>
                </ul>
              </div>
              
              <DistributionCharts
                filteredData={filteredData}
                aggregatedData={aggregatedData}
                aggregatedColumns={aggregatedColumns}
                aggregationConfig={aggregationConfig}
                onComplete={() => setCurrentStep(6)}
                onSkip={() => setCurrentStep(6)}
                onConfigChange={setDistributionChartConfig}
              />
            </div>
          )}

          {/* 步骤6: 正态分布检验 */}
          {currentStep === 6 && (
            <div className="space-y-6">
              <div className="flex items-center space-x-2 mb-4">
                <BarChart3 className="w-6 h-6 text-blue-600" />
                <h2 className="text-xl font-semibold">正态分布检验</h2>
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
                <h3 className="text-sm font-semibold text-blue-800 mb-2">检验说明</h3>
                <p className="text-sm text-blue-700 mb-2">对聚合后的数值字段进行正态分布检验，使用Anderson-Darling检验、KS检验和Z-score检验三种方法。</p>
                <ul className="text-sm text-blue-700 space-y-1">
                  <li>• <strong>Anderson-Darling检验</strong>：基于经验分布函数和理论分布函数加权差的检验，适用于小样本（n ≥ 3），对尾部偏差特别敏感，算法稳定，检验效力强</li>
                  <li>• <strong>KS检验</strong>：基于累积分布函数的经验检验，适用于大样本（n ≥ 50）</li>
                  <li>• <strong>Z-score检验</strong>：基于偏度和峰度的正态性检验，适用于中等样本（n ≥ 8）</li>
                  <li>• <strong>分布识别</strong>：对不符合正态分布的字段，自动识别最佳拟合分布（对数正态、指数、Gamma、泊松）</li>
                </ul>
              </div>

              <NormalityTest
                aggregatedData={aggregatedData}
                aggregatedColumns={aggregatedColumns}
                aggregationConfig={aggregationConfig}
                onComplete={() => setCurrentStep(7)}
                onSkip={() => setCurrentStep(7)}
                onResults={(results) => setNormalityTestResults(results)}
              />
            </div>
          )}

          {/* 步骤7: 画像分析配置 */}
          {currentStep === 7 && (
            <div className="space-y-6">
              <div className="flex items-center space-x-2 mb-4">
                <BarChart3 className="w-6 h-6 text-blue-600" />
                <h2 className="text-xl font-semibold">画像分析配置</h2>
              </div>
              
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
                <h3 className="text-sm font-semibold text-blue-800 mb-2">配置说明</h3>
                <p className="text-sm text-blue-700 mb-2">画像分析基于聚合后的数据，以下字段请从聚合结果中选择：</p>
                <ul className="text-sm text-blue-700 space-y-1 mb-3">
                  <li>• <strong>分析对象字段</strong>：定义要分析的主体（例如：用户ID、商户号等）</li>
                  <li>• <strong>分组分析字段</strong>：按该字段的不同值分别进行画像分析（例如：流入/流出类型）</li>
                  <li>• <strong>分析字段</strong>：纳入画像分析的指标字段，需要提供字段含义解释</li>
                </ul>
                <div className="bg-white border border-blue-200 rounded p-3">
                  <p className="text-xs font-semibold text-gray-700 mb-2">聚合后可用的字段（{aggregatedColumns.length}个）：</p>
                  <div className="flex flex-wrap gap-1">
                    {aggregatedColumns.map(col => (
                      <span key={col} className="text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded">
                        {col}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
              
              {/* 分析对象字段 */}
              <div className="mb-6">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  <span className="text-red-500">*</span> 分析对象字段名称
                </label>
                <select
                  value={profileAnalysisConfig.subjectFieldName}
                  onChange={(e) => setProfileAnalysisConfig({
                    ...profileAnalysisConfig,
                    subjectFieldName: e.target.value
                  })}
                  className="w-full p-2 border border-gray-300 rounded-lg"
                >
                  <option value="">选择分析对象字段</option>
                  {aggregatedColumns.map(col => (
                    <option key={col} value={col}>{col}</option>
                  ))}
                </select>
                <p className="text-xs text-gray-500 mt-1">用于定义分析的主体对象，如用户ID、商户号等（从聚合后数据中选择）</p>
              </div>
              
              {/* 分组分析字段 */}
              <div className="mb-6">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  分组分析字段名称（可选项）
                </label>
                <select
                  value={profileAnalysisConfig.groupByFieldName}
                  onChange={(e) => setProfileAnalysisConfig({
                    ...profileAnalysisConfig,
                    groupByFieldName: e.target.value
                  })}
                  className="w-full p-2 border border-gray-300 rounded-lg"
                >
                  <option value="">选择分组分析字段</option>
                  {aggregatedColumns.map(col => (
                    <option key={col} value={col}>{col}</option>
                  ))}
                </select>
                <p className="text-xs text-gray-500 mt-1">按此字段的不同值分别进行画像分析，如transfer_type（流入/流出）（从聚合后数据中选择），可留空进行整体分析</p>
              </div>
              
              {/* 分析字段 */}
              <div className="mb-6">
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-sm font-medium text-gray-700">
                    纳入画像分析的数据字段（可选项）
                  </label>
                  <button
                    onClick={() => setProfileAnalysisConfig({
                      ...profileAnalysisConfig,
                      analysisFields: [...profileAnalysisConfig.analysisFields, { fieldName: '', description: '' }]
                    })}
                    className="px-3 py-1 bg-blue-600 text-white text-sm rounded hover:bg-blue-700"
                  >
                    + 添加字段
                  </button>
                </div>
                
                {profileAnalysisConfig.analysisFields.length === 0 && (
                  <p className="text-sm text-gray-500 mb-3">暂无分析字段，点击上方按钮添加，或留空使用默认分析</p>
                )}
                
                <div className="space-y-3">
                  {profileAnalysisConfig.analysisFields.map((field, index) => (
                    <div key={index} className="flex gap-3 items-start bg-gray-50 p-3 rounded-lg">
                      <div className="flex-1">
                        <label className="block text-xs font-medium text-gray-700 mb-1">字段名称</label>
                        <select
                          value={field.fieldName}
                          onChange={(e) => {
                            const newFields = [...profileAnalysisConfig.analysisFields];
                            newFields[index] = { ...newFields[index], fieldName: e.target.value };
                            setProfileAnalysisConfig({
                              ...profileAnalysisConfig,
                              analysisFields: newFields
                            });
                          }}
                          className="w-full p-2 border border-gray-300 rounded text-sm"
                        >
                          <option value="">选择字段</option>
                          {aggregatedColumns.map(col => (
                            <option key={col} value={col}>{col}</option>
                          ))}
                        </select>
                      </div>
                      <div className="flex-1">
                        <label className="block text-xs font-medium text-gray-700 mb-1">字段含义解释（可选项）</label>
                        <input
                          type="text"
                          value={field.description}
                          onChange={(e) => {
                            const newFields = [...profileAnalysisConfig.analysisFields];
                            newFields[index] = { ...newFields[index], description: e.target.value };
                            setProfileAnalysisConfig({
                              ...profileAnalysisConfig,
                              analysisFields: newFields
                            });
                          }}
                          placeholder="不输入时将直接使用字段名称"
                          className="w-full p-2 border border-gray-300 rounded text-sm"
                        />
                      </div>
                      <button
                        onClick={() => {
                          const newFields = profileAnalysisConfig.analysisFields.filter((_, i) => i !== index);
                          setProfileAnalysisConfig({
                            ...profileAnalysisConfig,
                            analysisFields: newFields
                          });
                        }}
                        className="mt-6 px-3 py-2 bg-red-500 text-white text-sm rounded hover:bg-red-600"
                      >
                        删除
                      </button>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-gray-500 mt-2">字段含义解释有助于模型理解画像分析的口径与参数，请准确填写</p>
              </div>

              {/* 画像分析方法配置 */}
              <div className="border-t border-gray-200 pt-6">
                <ProfileMethodConfig
                  config={methodConfig}
                  onConfigChange={setMethodConfig}
                />
              </div>

              {/* 配置预览 */}
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                <h4 className="text-sm font-semibold text-gray-700 mb-3">配置预览</h4>
                <div className="text-sm space-y-2">
                  <div>
                    <span className="font-medium">分析对象：</span>
                    <span className={profileAnalysisConfig.subjectFieldName ? 'text-green-600' : 'text-gray-400'}>
                      {profileAnalysisConfig.subjectFieldName || '未设置'}
                    </span>
                  </div>
                  <div>
                    <span className="font-medium">分组字段：</span>
                    <span className={profileAnalysisConfig.groupByFieldName ? 'text-green-600' : 'text-gray-400'}>
                      {profileAnalysisConfig.groupByFieldName || '未设置'}
                    </span>
                  </div>
                  <div>
                    <span className="font-medium">分析字段：</span>
                    <span className={profileAnalysisConfig.analysisFields.length > 0 ? 'text-green-600' : 'text-gray-400'}>
                      {profileAnalysisConfig.analysisFields.length > 0 
                        ? `${profileAnalysisConfig.analysisFields.length} 个字段 (${profileAnalysisConfig.analysisFields.map(f => f.fieldName).join(', ')})` 
                        : '未设置'}
                    </span>
                  </div>
                </div>
              </div>
              
              <div className="flex space-x-4">
                <button
                  onClick={applyAnalysis}
                  disabled={loading}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loading ? '分析中...' : '开始画像分析'}
                </button>
                <button
                  onClick={() => {
                    setAggregationApplied(false);
                    setAggregatedData([]);
                    setCurrentStep(4);
                  }}
                  className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700"
                >
                  返回修改聚合
                </button>
              </div>
            </div>
          )}

          {/* 步骤8: 分析结果 */}
          {currentStep === 8 && analysisResult && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <BarChart3 className="w-6 h-6 text-blue-600" />
                  <h2 className="text-xl font-semibold">分析结果</h2>
                </div>
                <div className="flex space-x-3">
                  <button
                    onClick={downloadExcelReport}
                    className="flex items-center space-x-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
                  >
                    <Download className="w-4 h-4" />
                    <span>下载Excel</span>
                  </button>
                  <button
                    onClick={downloadCsv}
                    className="flex items-center space-x-2 px-4 py-2 bg-yellow-600 text-white rounded-lg hover:bg-yellow-700"
                  >
                    <Download className="w-4 h-4" />
                    <span>下载CSV</span>
                  </button>
                  <button
                    onClick={(e) => {
                      console.log('下载报告按钮被点击', e);
                      console.log('当前currentStep:', currentStep);
                      console.log('当前analysisResult:', analysisResult);
                      e.preventDefault();
                      e.stopPropagation();
                      downloadReport().catch(err => {
                        console.error('downloadReport错误:', err);
                        alert('错误: ' + err);
                      });
                    }}
                    className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                  >
                    <Download className="w-4 h-4" />
                    <span>下载报告</span>
                  </button>
                  <button
                    onClick={downloadAllChartImages}
                    className="flex items-center space-x-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700"
                  >
                    <Download className="w-4 h-4" />
                    <span>下载所有图表</span>
                  </button>
                  <button
                    onClick={() => {
                      const dataStr = JSON.stringify(analysisResult, null, 2);
                      const dataBlob = new Blob([dataStr], { type: 'application/json' });
                      const url = URL.createObjectURL(dataBlob);
                      const link = document.createElement('a');
                      link.href = url;
                      link.download = 'analysis_result.json';
                      link.click();
                      URL.revokeObjectURL(url);
                    }}
                    className="flex items-center space-x-2 px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700"
                  >
                    <Download className="w-4 h-4" />
                    <span>下载JSON</span>
                  </button>
                </div>
              </div>

              {/* 数据概览 */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-blue-50 p-4 rounded-lg">
                  <p className="text-sm text-blue-600 font-medium">原始数据行数</p>
                  <p className="text-2xl font-bold text-blue-900">{analysisResult.summary.totalRows}</p>
                </div>
                <div className="bg-green-50 p-4 rounded-lg">
                  <p className="text-sm text-green-600 font-medium">筛选后行数</p>
                  <p className="text-2xl font-bold text-green-900">{analysisResult.summary.filteredRows}</p>
                </div>
                <div className="bg-purple-50 p-4 rounded-lg">
                  <p className="text-sm text-purple-600 font-medium">分组后行数</p>
                  <p className="text-2xl font-bold text-purple-900">{analysisResult.summary.groupedRows}</p>
                </div>
              </div>

              {/* 智能画像分析结果 */}
              {analysisResult.intelligentAnalysis && (
                <div>
                  <h3 className="text-lg font-semibold mb-4">智能画像分析结果</h3>
                  
                  {/* 诊断信息：显示分析配置 */}
                  <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 mb-4">
                    <h4 className="text-sm font-semibold text-gray-700 mb-2">分析配置信息</h4>
                    <div className="text-sm space-y-1">
                      <p><span className="font-medium">分析对象：</span>{profileAnalysisConfig.subjectFieldName}</p>
                      <p><span className="font-medium">分组字段：</span>{profileAnalysisConfig.groupByFieldName || '无（整体分析）'}</p>
                      <p><span className="font-medium">分析字段数量：</span>{profileAnalysisConfig.analysisFields.length} 个</p>
                      <p><span className="font-medium">分析模式：</span>
                        {analysisResult.intelligentAnalysis.hasTransferType ? '分组分析' : '整体分析'}
                      </p>
                    </div>
                  </div>
                  
                  {/* 按用户自定义的分组字段进行画像分析（有分组时显示） */}
                  {analysisResult.intelligentAnalysis.transferTypeAnalysis && analysisResult.intelligentAnalysis.hasTransferType && (
                    <div className="mb-8 space-y-6">
                      {Object.entries(analysisResult.intelligentAnalysis.transferTypeAnalysis).map(([groupKey, groupAnalysis]: [string, any]) => (
                        <div 
                          key={groupKey}
                          className={`border-2 rounded-lg p-6 ${
                            groupKey.toLowerCase().includes('in') || groupKey.includes('入') 
                              ? 'border-green-200 bg-green-50' 
                              : groupKey.toLowerCase().includes('out') || groupKey.includes('出')
                              ? 'border-red-200 bg-red-50'
                              : 'border-blue-200 bg-blue-50'
                          }`}
                        >
                          <h4 className={`text-md font-semibold mb-4 ${
                            groupKey.toLowerCase().includes('in') || groupKey.includes('入')
                              ? 'text-green-800'
                              : groupKey.toLowerCase().includes('out') || groupKey.includes('出')
                              ? 'text-red-800'
                              : 'text-blue-800'
                          }`}>
                            📊 {groupAnalysis.typeLabel || `${profileAnalysisConfig.groupByFieldName}=${groupKey}`}
                          </h4>
                          {groupAnalysis.categories && groupAnalysis.categories.length > 0 ? (
                            <>
                              {/* 分析概况 - 文字段落形式 */}
                              <div className={`mb-4 p-4 bg-white border rounded-lg ${
                                groupKey.toLowerCase().includes('in') || groupKey.includes('入')
                                  ? 'border-green-300'
                                  : groupKey.toLowerCase().includes('out') || groupKey.includes('出')
                                  ? 'border-red-300'
                                  : 'border-blue-300'
                              }`}>
                                <h5 className="text-sm font-semibold text-gray-800 mb-2">分析概况</h5>
                                <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">
                                  {formatAnalysisText(groupAnalysis.analysis, groupAnalysis.classificationParams, columnTypes, analysisResult)}
                                </p>
                              </div>

                              {/* 分类规则和参数 - 合并表格 */}
                              {groupAnalysis.classificationRules && groupAnalysis.classificationParams && (
                                <div className="mb-4 bg-white border border-gray-200 rounded-lg overflow-hidden">
                                  <h5 className="text-sm font-semibold text-gray-800 mb-0 p-3 bg-gray-50 border-b">
                                    分类规则与参数
                                  </h5>
                                  <div className="overflow-x-auto">
                                    <table className="w-full text-sm">
                                      <thead className="bg-gray-50">
                                        <tr>
                                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">分类名称</th>
                                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">分类条件</th>
                                          <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase">风险等级</th>
                                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">说明</th>
                                        </tr>
                                      </thead>
                                      <tbody className="divide-y divide-gray-200">
                                        {(() => {
                                          const params = groupAnalysis.classificationParams;
                                          return groupAnalysis.classificationRules?.map((rule: any, idx: number) => (
                                            <tr key={idx}>
                                              <td className="px-4 py-2 font-medium text-gray-900">{rule.name}</td>
                                              {/* 对 condition 中的字段名进行相对引用替换 */}
                                              <td className="px-4 py-2 text-gray-700">
                                                {rule.condition
                                                  .replace(
                                                    new RegExp(params?.valueField || '', 'g'),
                                                    getFieldLabel(params?.valueField || '', params?.valueField || '')
                                                  )
                                                  .replace(
                                                    new RegExp(params?.countField || '', 'g'),
                                                    getFieldLabel(params?.countField || '', params?.countField || '')
                                                  )
                                                }
                                              </td>
                                              <td className="px-4 py-2 text-center">
                                                <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                                                  rule.riskLevel === '高' || rule.riskLevel === 'high'
                                                    ? 'bg-red-100 text-red-800'
                                                    : 'bg-green-100 text-green-800'
                                                }`}>
                                                  {rule.riskLevel}
                                                </span>
                                              </td>
                                              <td className="px-4 py-2 text-gray-600">{rule.description}</td>
                                            </tr>
                                          ));
                                        })()}
                                      </tbody>
                                    </table>
                                  </div>
                                  <div className="p-3 bg-gray-50 border-t">
                                    <p className="text-xs text-gray-600">
                                      <span className="font-medium">参数说明：</span>
                                      {(() => {
                                        const params = groupAnalysis.classificationParams;
                                        if (!params) return '参数不可用';

                                        if (params.method === 'iqr') {
                                          // IQR 方法参数 - 添加上下倍数显示
                                          return `${getFieldLabel(params.valueField, params.valueField || params.valueLabel)} Q1=${formatParamValue(params.valueQ1, params.valueField, columnTypes, analysisResult)}, Q3=${formatParamValue(params.valueQ3, params.valueField, columnTypes, analysisResult)}, IQR=${formatParamValue(params.valueIQR, params.valueField, columnTypes, analysisResult)}, 上阈值倍数=${methodConfig?.iqr?.upperMultiplier || 'N/A'}, 高阈值=${formatParamValue(params.valueHighThreshold, params.valueField, columnTypes, analysisResult)}, 下阈值倍数=${methodConfig?.iqr?.lowerMultiplier || 'N/A'}, 低阈值=${formatParamValue(params.valueLowThreshold, params.valueField, columnTypes, analysisResult)}；${getFieldLabel(params.countField, params.countField || params.countLabel)} Q1=${formatParamValue(params.countQ1, params.countField, columnTypes, analysisResult)}, Q3=${formatParamValue(params.countQ3, params.countField, columnTypes, analysisResult)}, IQR=${formatParamValue(params.countIQR, params.countField, columnTypes, analysisResult)}, 高阈值=${formatParamValue(params.countHighThreshold, params.countField, columnTypes, analysisResult)}, 低阈值=${formatParamValue(params.countLowThreshold, params.countField, columnTypes, analysisResult)}`;
                                        } else {
                                          // 标准差方法参数 - 添加上下倍数和低阈值显示
                                          return `${getFieldLabel(params.valueField, params.valueField || params.valueLabel)} 均值=${formatParamValue(params.valueMean, params.valueField, columnTypes, analysisResult)}, 标准差=${formatParamValue(params.valueStdDev, params.valueField, columnTypes, analysisResult)}, 上阈值倍数=${methodConfig?.stddev?.upperMultiplier || 'N/A'}, 高阈值=${formatParamValue(params.valueHighThreshold, params.valueField, columnTypes, analysisResult)}, 下阈值倍数=${methodConfig?.stddev?.lowerMultiplier || 'N/A'}, 低阈值=${formatParamValue(params.valueLowThreshold, params.valueField, columnTypes, analysisResult)}；${getFieldLabel(params.countField, params.countField || params.countLabel)} 均值=${formatParamValue(params.countMean, params.countField, columnTypes, analysisResult)}, 标准差=${formatParamValue(params.countStdDev, params.countField, columnTypes, analysisResult)}, 高阈值=${formatParamValue(params.countHighThreshold, params.countField, columnTypes, analysisResult)}, 低阈值=${formatParamValue(params.countLowThreshold, params.countField, columnTypes, analysisResult)}`;
                                        }
                                      })()}
                                    </p>
                                  </div>
                                </div>
                              )}
                              
                              {/* 数据可视化图表 */}
                              <div className="mb-6">
                                <AnalysisCharts 
                                  categories={groupAnalysis.categories} 
                                  instanceId={groupKey} 
                                  profileAnalysisConfig={profileAnalysisConfig}
                                />
                              </div>
                              
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {groupAnalysis.categories.map((category: any, idx: number) => (
                                  <div key={idx} className="bg-white border border-gray-200 rounded-lg p-3 shadow-sm">
                                    <div className="flex items-center justify-between mb-2">
                                      <h5 className="font-medium text-gray-900">{category.category}</h5>
                                      <span className="text-xs text-gray-500">置信度: {formatNumberWithCommas(category.confidence * 100, 0)}%</span>
                                    </div>
                                    <div className="space-y-1 text-xs">
                                      {Object.entries(category.indicators).map(([key, value]: [string, any]) => {
                                        // 检查是否为数值字段（不假设特定领域）
                                        const isNumber = typeof value === 'number';

                                        return (
                                          <div key={key} className="flex justify-between">
                                            <span className="text-gray-500">{key}:</span>
                                            <span className={`font-medium ${
                                              isNumber ? 'text-blue-600' : 'text-gray-900'
                                            }`}>
                                              {isNumber
                                                ? formatParamValue(value, key, columnTypes, analysisResult)
                                                : value}
                                            </span>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </>
                          ) : (
                            <p className="text-sm text-gray-500">暂无该分组的数据</p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* 整体画像分析结果（无分组时显示） */}
                  {analysisResult.intelligentAnalysis.allCategories && !analysisResult.intelligentAnalysis.hasTransferType && (
                    <div className="mb-8">
                      <div className="border-2 border-blue-200 rounded-lg p-6 bg-blue-50">
                        <h4 className="text-md font-semibold mb-4 text-blue-800">
                          📊 整体画像分析结果
                        </h4>
                        {analysisResult.intelligentAnalysis.allCategories.length > 0 ? (
                          <>
                            {/* 分析概况 - 文字段落形式 */}
                            <div className="mb-4 p-4 bg-white border border-blue-300 rounded-lg">
                              <h5 className="text-sm font-semibold text-gray-800 mb-2">分析概况</h5>
                              <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">
                                {formatAnalysisText(
                                  analysisResult.intelligentAnalysis.transferTypeAnalysis?.['all']?.analysis || '暂无分析概况',
                                  analysisResult.intelligentAnalysis.classificationParams,
                                  columnTypes,
                                  analysisResult
                                )}
                              </p>
                            </div>

                            {/* 分类规则和参数 - 合并表格 */}
                            {analysisResult.intelligentAnalysis.classificationRules && analysisResult.intelligentAnalysis.classificationParams && (
                              <div className="mb-4 bg-white border border-gray-200 rounded-lg overflow-hidden">
                                <h5 className="text-sm font-semibold text-gray-800 mb-0 p-3 bg-gray-50 border-b">
                                  分类规则与参数
                                </h5>
                                <div className="overflow-x-auto">
                                  <table className="w-full text-sm">
                                    <thead className="bg-gray-50">
                                      <tr>
                                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">分类名称</th>
                                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">分类条件</th>
                                        <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase">风险等级</th>
                                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">说明</th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-200">
                                      {(() => {
                                        const params = analysisResult.intelligentAnalysis?.classificationParams;
                                        return analysisResult.intelligentAnalysis?.classificationRules?.map((rule: any, idx: number) => (
                                          <tr key={idx}>
                                            <td className="px-4 py-2 font-medium text-gray-900">{rule.name}</td>
                                            {/* 对 condition 中的字段名进行相对引用替换 */}
                                            <td className="px-4 py-2 text-gray-700">
                                              {rule.condition
                                                .replace(
                                                  new RegExp(params?.valueField || '', 'g'),
                                                  getFieldLabel(params?.valueField || '', params?.valueField || '')
                                                )
                                                .replace(
                                                  new RegExp(params?.countField || '', 'g'),
                                                  getFieldLabel(params?.countField || '', params?.countField || '')
                                                )
                                              }
                                            </td>
                                            <td className="px-4 py-2 text-center">
                                              <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                                                rule.riskLevel === '高' || rule.riskLevel === 'high'
                                                  ? 'bg-red-100 text-red-800'
                                                  : 'bg-green-100 text-green-800'
                                              }`}>
                                                {rule.riskLevel}
                                              </span>
                                            </td>
                                            <td className="px-4 py-2 text-gray-600">{rule.description}</td>
                                          </tr>
                                        ));
                                      })()}
                                    </tbody>
                                  </table>
                                </div>
                                <div className="p-3 bg-gray-50 border-t">
                                  <p className="text-xs text-gray-600">
                                    <span className="font-medium">参数说明：</span>
                                    {(() => {
                                      const cp = analysisResult.intelligentAnalysis?.classificationParams;
                                      if (!cp) return '参数不可用';

                                      if (cp.method === 'iqr') {
                                        // IQR 方法参数 - 添加上下倍数显示
                                        return `${getFieldLabel(cp.valueField, cp.valueField || cp.valueLabel)} Q1=${formatParamValue(cp.valueQ1, cp.valueField, columnTypes, analysisResult)}, Q3=${formatParamValue(cp.valueQ3, cp.valueField, columnTypes, analysisResult)}, IQR=${formatParamValue(cp.valueIQR, cp.valueField, columnTypes, analysisResult)}, 上阈值倍数=${methodConfig?.iqr?.upperMultiplier || 'N/A'}, 高阈值=${formatParamValue(cp.valueHighThreshold, cp.valueField, columnTypes, analysisResult)}, 下阈值倍数=${methodConfig?.iqr?.lowerMultiplier || 'N/A'}, 低阈值=${formatParamValue(cp.valueLowThreshold, cp.valueField, columnTypes, analysisResult)}；${getFieldLabel(cp.countField, cp.countField || cp.countLabel)} Q1=${formatParamValue(cp.countQ1, cp.countField, columnTypes, analysisResult)}, Q3=${formatParamValue(cp.countQ3, cp.countField, columnTypes, analysisResult)}, IQR=${formatParamValue(cp.countIQR, cp.countField, columnTypes, analysisResult)}, 高阈值=${formatParamValue(cp.countHighThreshold, cp.countField, columnTypes, analysisResult)}, 低阈值=${formatParamValue(cp.countLowThreshold, cp.countField, columnTypes, analysisResult)}`;
                                      } else {
                                        // 标准差方法参数 - 添加上下倍数显示
                                        return `${getFieldLabel(cp.valueField, cp.valueField || cp.valueLabel)} 均值=${formatParamValue(cp.valueMean, cp.valueField, columnTypes, analysisResult)}, 标准差=${formatParamValue(cp.valueStdDev, cp.valueField, columnTypes, analysisResult)}, 上阈值倍数=${methodConfig?.stddev?.upperMultiplier || 'N/A'}, 高阈值=${formatParamValue(cp.valueHighThreshold, cp.valueField, columnTypes, analysisResult)}, 下阈值倍数=${methodConfig?.stddev?.lowerMultiplier || 'N/A'}, 低阈值=${formatParamValue(cp.valueLowThreshold, cp.valueField, columnTypes, analysisResult)}；${getFieldLabel(cp.countField, cp.countField || cp.countLabel)} 均值=${formatParamValue(cp.countMean, cp.countField, columnTypes, analysisResult)}, 标准差=${formatParamValue(cp.countStdDev, cp.countField, columnTypes, analysisResult)}, 高阈值=${formatParamValue(cp.countHighThreshold, cp.countField, columnTypes, analysisResult)}, 低阈值=${formatParamValue(cp.countLowThreshold, cp.countField, columnTypes, analysisResult)}`;
                                      }
                                    })()}
                                  </p>
                                </div>
                              </div>
                            )}

                            {/* 数据可视化图表 */}
                            <div className="mb-6">
                              <AnalysisCharts 
                                categories={analysisResult.intelligentAnalysis.allCategories} 
                                instanceId="default" 
                                profileAnalysisConfig={profileAnalysisConfig}
                              />
                            </div>
                            
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              {analysisResult.intelligentAnalysis.allCategories.map((category: any, idx: number) => (
                                <div key={idx} className="bg-white border border-gray-200 rounded-lg p-3 shadow-sm">
                                  <div className="flex items-center justify-between mb-2">
                                    <h5 className="font-medium text-gray-900">{category.category}</h5>
                                    <span className="text-xs text-gray-500">置信度: {formatNumberWithCommas(category.confidence * 100, 0)}%</span>
                                  </div>
                                  <div className="space-y-1 text-xs">
                                    {Object.entries(category.indicators).map(([key, value]: [string, any]) => {
                                      // 不假设特定领域，简单判断是否为数值
                                      const isNumber = typeof value === 'number';

                                      return (
                                        <div key={key} className="flex justify-between">
                                          <span className="text-gray-500">{key}:</span>
                                          <span className={`font-medium ${
                                            isNumber ? 'text-blue-600' : 'text-gray-900'
                                          }`}>
                                            {isNumber
                                              ? formatParamValue(value, key, columnTypes, analysisResult)
                                              : value}
                                          </span>
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </>
                        ) : (
                          <p className="text-sm text-gray-500">暂无画像分析结果</p>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* 详细数据表格 */}
              <div>
                <h3 className="text-lg font-semibold mb-4">详细数据</h3>
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        {Object.keys(analysisResult.aggregatedData[0] || {}).map(col => (
                          <th key={col} className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            {col}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {analysisResult.aggregatedData.slice(0, 20).map((row, idx) => (
                        <tr key={idx}>
                          {Object.keys(row).map((key, cellIdx) => {
                            const val = row[key];
                            // 智能格式化：根据列类型和值类型决定如何格式化
                            if (typeof val === 'number' && !isNaN(val)) {
                              const columnType = analysisResult.columnTypes?.[key] || columnTypes[key] || 'number';
                              // 对于非百分比类型的整数，不显示小数位
                              if (columnType !== 'percentage' && Number.isInteger(val)) {
                                return (
                                  <td key={cellIdx} className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                    {formatNumberWithCommas(val)}
                                  </td>
                                );
                              }
                              // 其他情况根据列类型格式化
                              return (
                                <td key={cellIdx} className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                  {formatSmart(val, columnType, 2)}
                                </td>
                              );
                            }
                            return (
                              <td key={cellIdx} className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                {val}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-sm text-gray-500 mt-2">显示前20行，共 {analysisResult.aggregatedData.length} 行数据</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
    </SimpleAuth>
  );
}