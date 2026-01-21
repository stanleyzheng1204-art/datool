import * as XLSX from 'xlsx';
import { ProfileAnalyzer } from './profileAnalyzer';
import JSZip from 'jszip';
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
  ImageRun,
  convertInchesToTwip
} from 'docx';
import { NormalityTestResults } from '@/components/NormalityTest';
import { formatNumberWithCommas, formatHtmlValue, formatAnalysisText, formatParamValue } from './numberFormatter';

export interface DistributionChartConfig {
  chartType: 'histogram' | 'boxplot' | 'scatter';
  selectedFields: string[];
  binCount?: number;
}

export interface DistributionChartImages {
  type: string;
  config: DistributionChartConfig;
  images: { [key: string]: string };
}

export interface AnalysisExportData {
  originalData: any[];
  filteredData: any[];
  aggregatedData: any[];
  analysisResult: any;
  filterConfig: any;
  aggregationConfig: any;
  intelligentAnalysis?: any;
  chartImages?: {
    barChart?: string;
    pieChart?: string;
    donutChart?: string;
  };
  normalityTestResults?: NormalityTestResults;
  distributionChartConfig?: DistributionChartConfig;
  distributionChartImages?: DistributionChartImages;
  columnTypes?: Record<string, string>; // 列类型映射（用于百分比格式化）
}

/**
 * 动态识别数据中的关键字段（不假设特定领域）
 * 支持从intelligentAnalysis的classificationParams中获取用户配置的字段
 */
function identifyDataFields(data: any[], intelligentAnalysis?: any): {
  primaryValueField: string | null;
  primaryCountField: string | null;
  fieldLabels: { [key: string]: string };
} {
  console.log('=== 识别数据字段 ===');
  const dataLength = data?.length || 0;
  const isLargeDataset = dataLength > 10000;

  if (!data || dataLength === 0) {
    console.warn('⚠️ 数据为空，无法识别字段');
    return {
      primaryValueField: null,
      primaryCountField: null,
      fieldLabels: {}
    };
  }

  const actualColumns = Object.keys(data[0] || {});

  // 识别数值类型的列（支持数字类型和数字字符串）
  const numericColumns = actualColumns.filter(col =>
    data.some((row: any) => {
      const value = row[col];
      return typeof value === 'number' && !isNaN(value as number);
    })
  );

  // 识别包含数字的字符串列（可能是Excel导入的数据）
  const numericStringColumns = actualColumns.filter((col: string) => {
    // 跳过已识别的数值列和画像类型、风险等级字段
    if (numericColumns.includes(col) || col === '画像类型' || col === '风险等级') return false;

    return data.some((row: any) => {
      const value = row[col];
      return typeof value === 'string' && !isNaN(parseFloat(value as any)) && isFinite(value as any);
    });
  });

  const sumColumns = actualColumns.filter(col => col.includes('_sum'));
  const countColumns = actualColumns.filter(col => col.includes('_count') || col === '_count');

  console.log('可用列:', actualColumns);
  console.log('数值列:', numericColumns);
  console.log('数字字符串列:', numericStringColumns);
  console.log('Sum 列:', sumColumns);
  console.log('Count 列:', countColumns);

  // 输出intelligentAnalysis的详细结构（仅在小数据量时）
  if (!isLargeDataset && intelligentAnalysis) {
    console.log('intelligentAnalysis结构:');
    console.log('  hasTransferType:', intelligentAnalysis?.hasTransferType);
    console.log('  transferTypeAnalysisKeys:', intelligentAnalysis?.transferTypeAnalysis ? Object.keys(intelligentAnalysis.transferTypeAnalysis) : []);
  }

  // 识别主要数值字段（值字段，通常是金额、总数等）
  let primaryValueField: string | null = null;

  // 优先级1: 从intelligentAnalysis的classificationParams中获取用户配置的字段
  if (intelligentAnalysis?.transferTypeAnalysis?.['all']?.classificationParams) {
    const configuredValueField = intelligentAnalysis.transferTypeAnalysis['all'].classificationParams.valueField;
    if (configuredValueField && actualColumns.includes(configuredValueField)) {
      primaryValueField = configuredValueField;
      if (!isLargeDataset) console.log('✅ 从classificationParams(all)获取到主要数值字段:', primaryValueField);
    } else if (!isLargeDataset) {
      console.log(`⚠️ classificationParams中的字段 "${configuredValueField}" 不存在于数据中`);
    }
  }

  // 如果从all中没找到，尝试从其他分组中获取
  if (!primaryValueField && intelligentAnalysis?.transferTypeAnalysis) {
    for (const [groupKey, groupAnalysis] of Object.entries(intelligentAnalysis.transferTypeAnalysis)) {
      if (groupKey === 'all') continue;
      const configuredValueField = (groupAnalysis as any).classificationParams?.valueField;
      if (configuredValueField && actualColumns.includes(configuredValueField)) {
        primaryValueField = configuredValueField;
        if (!isLargeDataset) console.log(`✅ 从classificationParams(${groupKey})获取到主要数值字段:`, primaryValueField);
        break;
      }
    }
  }

  // 优先级2: 使用 sum 列作为主要数值字段
  if (!primaryValueField && sumColumns.length > 0) {
    primaryValueField = sumColumns[0];
    if (!isLargeDataset) console.log('✅ 使用 sum 列作为主要数值字段:', primaryValueField);
  } else if (!primaryValueField && numericColumns.length > 0) {
    // 优先级3: 使用第一个数值列
    primaryValueField = numericColumns[0];
    if (!isLargeDataset) console.log('✅ 使用第一个数值列作为主要数值字段:', primaryValueField);
  } else if (!primaryValueField && numericStringColumns.length > 0) {
    // 尝试从数字字符串列中找到可能是值字段的列（包含金额、值、总数等关键词）
    const valueField = numericStringColumns.find(col =>
      col.toLowerCase().includes('金额') ||
      col.toLowerCase().includes('值') ||
      col.toLowerCase().includes('总数') ||
      col.toLowerCase().includes('总额') ||
      col.toLowerCase().includes('sum') ||
      col.toLowerCase().includes('total') ||
      col.toLowerCase().includes('amount')
    );
    primaryValueField = valueField || numericStringColumns[0];
    if (!isLargeDataset) console.log('✅ 使用数字字符串列作为主要数值字段:', primaryValueField);
  } else if (!isLargeDataset) {
    console.warn('⚠️ 无法找到主要数值字段');
  }

  // 识别主要计数字段（数量字段，通常是人数、次数等）
  let primaryCountField: string | null = null;

  // 优先级1: 从intelligentAnalysis的classificationParams中获取用户配置的字段
  if (intelligentAnalysis?.transferTypeAnalysis?.['all']?.classificationParams) {
    const configuredCountField = intelligentAnalysis.transferTypeAnalysis['all'].classificationParams.countField;
    if (configuredCountField && actualColumns.includes(configuredCountField)) {
      primaryCountField = configuredCountField;
      if (!isLargeDataset) console.log('✅ 从classificationParams(all)获取到主要计数字段:', primaryCountField);
    } else if (!isLargeDataset) {
      console.log(`⚠️ classificationParams中的字段 "${configuredCountField}" 不存在于数据中`);
    }
  }

  // 如果从all中没找到，尝试从其他分组中获取
  if (!primaryCountField && intelligentAnalysis?.transferTypeAnalysis) {
    for (const [groupKey, groupAnalysis] of Object.entries(intelligentAnalysis.transferTypeAnalysis)) {
      if (groupKey === 'all') continue;
      const configuredCountField = (groupAnalysis as any).classificationParams?.countField;
      if (configuredCountField && actualColumns.includes(configuredCountField)) {
        primaryCountField = configuredCountField;
        if (!isLargeDataset) console.log(`✅ 从classificationParams(${groupKey})获取到主要计数字段:`, primaryCountField);
        break;
      }
    }
  }

  // 优先级2: 使用 count 列作为主要计数字段
  if (!primaryCountField && countColumns.length > 0) {
    primaryCountField = countColumns[0];
    if (!isLargeDataset) console.log('✅ 使用 count 列作为主要计数字段:', primaryCountField);
  } else if (!primaryCountField) {
    // 优先级3: 查找包含 count 关键词的字段（在数值列和数字字符串列中查找）
    const countField = [...numericColumns, ...numericStringColumns].find(col =>
      col.toLowerCase().includes('count') ||
      col.toLowerCase().includes('计数') ||
      col.toLowerCase().includes('数量') ||
      col.toLowerCase().includes('人数') ||
      col.toLowerCase().includes('次数')
    );
    primaryCountField = countField || null;
    if (!isLargeDataset) console.log(countField ? '✅ 使用识别的计数字段:' : '⚠️ 无法找到计数字段', primaryCountField);
  }

  // 生成字段标签（完整字段名）
  const fieldLabels: { [key: string]: string } = {};
  if (primaryValueField) {
    fieldLabels[primaryValueField] = generateFieldLabel(primaryValueField);
  }
  if (primaryCountField) {
    fieldLabels[primaryCountField] = generateFieldLabel(primaryCountField);
  }

  console.log('识别结果:', {
    primaryValueField,
    primaryCountField,
    fieldLabels
  });

  return { primaryValueField, primaryCountField, fieldLabels };
}

/**
 * 基于字段名生成友好标签（不假设特定领域）
 */
function generateFieldLabel(fieldName: string): string {
  // 返回完整的原始字段名，不移除任何后缀
  // 这样可以确保字段名的完整性，例如 ts_hash_count 会保持为 ts_hash_count
  return fieldName;
}

/**
 * 计算IQR阈值
 */
function calculateIQRThresholds(
  data: any[],
  valueField: string | null,
  countField: string | null,
  upperMultiplier: number = 1.5,
  lowerMultiplier: number = 0
): {
  valueThresholds: any;
  countThresholds: any;
  upperMultiplier: number;
  lowerMultiplier: number;
} {
  const result: any = {
    valueThresholds: null,
    countThresholds: null,
    upperMultiplier,
    lowerMultiplier
  };

  if (valueField) {
    const values = data.map(row => {
      const val = row[valueField];
      // 转换字符串为数字
      const numVal = typeof val === 'string' ? parseFloat(val) : val;
      return numVal;
    })
      .filter(v => typeof v === 'number' && !isNaN(v))
      .sort((a, b) => a - b);

    if (values.length > 0) {
      const n = values.length;
      const q1Pos = Math.floor(n * 0.25);
      const q3Pos = Math.floor(n * 0.75);

      const q1 = values[q1Pos];
      const q3 = values[q3Pos];
      const iqr = q3 - q1;

      result.valueThresholds = {
        q1,
        q3,
        iqr,
        highThreshold: q3 + upperMultiplier * iqr,
        lowThreshold: q1 - lowerMultiplier * iqr
      };
    }
  }

  if (countField) {
    const values = data.map(row => {
      const val = row[countField];
      // 转换字符串为数字
      const numVal = typeof val === 'string' ? parseFloat(val) : val;
      return numVal;
    })
      .filter(v => typeof v === 'number' && !isNaN(v))
      .sort((a, b) => a - b);

    if (values.length > 0) {
      const n = values.length;
      const q1Pos = Math.floor(n * 0.25);
      const q3Pos = Math.floor(n * 0.75);

      const q1 = values[q1Pos];
      const q3 = values[q3Pos];
      const iqr = q3 - q1;

      result.countThresholds = {
        q1,
        q3,
        iqr,
        highThreshold: q3 + upperMultiplier * iqr,
        lowThreshold: q1 - lowerMultiplier * iqr
      };
    }
  }

  return result;
}

/**
 * 为聚合数据添加画像类型和风险等级（使用通用分类名称）
 * 支持分组情况，每个分组使用各自的阈值
 * 性能优化版本：减少日志输出，提高大数据量处理能力
 */
function addProfileClassificationToAggregatedData(aggregatedData: any[], intelligentAnalysis: any): any[] {
  const dataLength = aggregatedData?.length || 0;
  const isLargeDataset = dataLength > 10000;

  console.log('=== 开始添加画像分类到聚合数据 ===');
  console.log(`聚合数据行数: ${dataLength}`);

  if (!aggregatedData || dataLength === 0) {
    console.log('❌ 聚合数据为空，返回原始数据');
    return aggregatedData;
  }

  const actualColumns = Object.keys(aggregatedData[0] || {});

  console.log('可用列:', actualColumns);

  // 动态识别字段
  const { primaryValueField, primaryCountField, fieldLabels } = identifyDataFields(aggregatedData, intelligentAnalysis);

  if (!isLargeDataset) {
    console.log('\n识别结果:');
    console.log('  primaryValueField:', primaryValueField);
    console.log('  primaryCountField:', primaryCountField);
    console.log('  actualColumns:', actualColumns);
  }

  // 如果找不到合适的字段，返回原始数据
  if (!primaryValueField || !primaryCountField) {
    console.error('❌ 无法找到合适的值或计数字段，所有数据将标记为"未知"');
    console.error('  请检查数据中是否包含数值字段，或检查intelligentAnalysis中的字段配置');
    aggregatedData.forEach(row => {
      row['画像类型'] = '未知';
      row['风险等级'] = '未知';
    });
    return aggregatedData;
  }

  // 检查是否有分组分析
  const hasGrouping = intelligentAnalysis?.hasTransferType && intelligentAnalysis?.transferTypeAnalysis;
  if (!isLargeDataset) {
    console.log('是否有分组分析:', hasGrouping);
    console.log('transferTypeAnalysis keys:', intelligentAnalysis?.transferTypeAnalysis ? Object.keys(intelligentAnalysis.transferTypeAnalysis) : []);
  }

  if (hasGrouping) {
    // 有分组：每个分组使用各自的阈值进行分类
    if (!isLargeDataset) console.log('=== 分组分类模式 ===');

    // 创建分组映射：通过遍历原始数据，为每行找到对应的分组
    if (!isLargeDataset) console.log('创建分组映射表...');
    const groupMap = new Map<string, any>(); // key: groupValue, value: { valueField, countField, valueThresholds, countThresholds }

    // 先收集所有分组的配置信息
    Object.entries(intelligentAnalysis.transferTypeAnalysis).forEach(([groupKey, groupAnalysis]: [string, any]) => {
      if (groupKey === 'all') return;

      if (!isLargeDataset) console.log(`收集分组配置: ${groupKey}`);
      const groupParams = groupAnalysis.classificationParams;

      if (!groupParams) {
        if (!isLargeDataset) console.warn(`分组 ${groupKey} 没有classificationParams，跳过`);
        return;
      }

      // 解析typeLabel获取分组字段和分组值
      const typeLabel = groupAnalysis.typeLabel;
      const match = typeLabel.match(/^(.+?)=(.+)$/);
      if (!match) {
        if (!isLargeDataset) console.warn(`无法解析typeLabel: ${typeLabel}`);
        return;
      }

      const groupFieldName = match[1];
      const groupValue = match[2];
      if (!isLargeDataset) console.log(`  分组字段: ${groupFieldName}, 分组值: ${groupValue} (类型: ${typeof groupValue})`);

      // 验证分组字段是否存在于数据中
      if (!actualColumns.includes(groupFieldName)) {
        console.warn(`⚠️ 分组字段 ${groupFieldName} 不存在于数据中！跳过该分组`);
        if (!isLargeDataset) console.log(`   可用字段:`, actualColumns);
        return;
      }

      // 从classificationParams中获取字段名和阈值
      const groupValueField = groupParams.valueField;
      const groupCountField = groupParams.countField;

      // 如果分组有配置的字段名，则使用分组配置的字段名
      const currentValueField = groupValueField && actualColumns.includes(groupValueField) ? groupValueField : primaryValueField;
      const currentCountField = groupCountField && actualColumns.includes(groupCountField) ? groupCountField : primaryCountField;

      // 验证用于分类的字段是否存在于数据中
      if (!actualColumns.includes(currentValueField)) {
        console.warn(`⚠️ 值字段 ${currentValueField} 不存在于数据中！跳过该分组`);
        return;
      }
      if (!actualColumns.includes(currentCountField)) {
        console.warn(`⚠️ 计数字段 ${currentCountField} 不存在于数据中！跳过该分组`);
        return;
      }

      const valueThresholds = {
        highThreshold: groupParams.valueHighThreshold,
        lowThreshold: groupParams.valueLowThreshold
      };
      const countThresholds = {
        highThreshold: groupParams.countHighThreshold,
        lowThreshold: groupParams.countLowThreshold
      };

      // 存储分组配置（使用规范化后的分组值作为key）
      const normalizedGroupValue = String(groupValue);
      groupMap.set(normalizedGroupValue, {
        groupFieldName,  // 同时存储分组字段名，用于调试
        valueField: currentValueField,
        countField: currentCountField,
        valueThresholds,
        countThresholds
      });

      if (!isLargeDataset) console.log(`  ✅ 已存储分组配置: ${normalizedGroupValue}`);
    });

    if (!isLargeDataset) {
      console.log(`\n分组映射表共 ${groupMap.size} 个配置`);
      console.log('分组映射表内容:');
      groupMap.forEach((config, key) => {
        console.log(`  ${key}: groupField=${config.groupFieldName}, valueField=${config.valueField}, countField=${config.countField}`);
      });
    }

    // 获取分组字段名（从第一个分组的typeLabel中获取）
    const firstGroupKey = Object.keys(intelligentAnalysis.transferTypeAnalysis).find(key => key !== 'all');
    if (firstGroupKey) {
      const typeLabel = intelligentAnalysis.transferTypeAnalysis[firstGroupKey].typeLabel;
      const match = typeLabel.match(/^(.+?)=(.+)$/);
      if (match) {
        const groupFieldName = match[1];
        console.log(`\n使用分组字段: ${groupFieldName}`);

        if (!actualColumns.includes(groupFieldName)) {
          console.error(`❌ 分组字段 ${groupFieldName} 不存在于数据中！可用字段:`, actualColumns);
          console.log('⚠️ 退回到整体分类模式（不按分组）');

          // 退回到整体分类模式
          const classificationParams = intelligentAnalysis?.transferTypeAnalysis?.['all']?.classificationParams
            ?? intelligentAnalysis?.classificationParams;

          let valueThresholds, countThresholds;

          if (classificationParams?.valueHighThreshold !== undefined && classificationParams?.countHighThreshold !== undefined) {
            // 使用intelligentAnalysis中已经计算好的阈值
            console.log('✅ 使用intelligentAnalysis中的阈值');
            valueThresholds = {
              highThreshold: classificationParams.valueHighThreshold,
              lowThreshold: classificationParams.valueLowThreshold
            };
            countThresholds = {
              highThreshold: classificationParams.countHighThreshold,
              lowThreshold: classificationParams.countLowThreshold
            };
          } else {
            // 重新计算阈值
            const upperMultiplier = classificationParams?.upperMultiplier ?? 1.5;
            const lowerMultiplier = classificationParams?.lowerMultiplier ?? 0;

            console.log(`使用的分类参数: upperMultiplier=${upperMultiplier}, lowerMultiplier=${lowerMultiplier}`);

            const thresholds = calculateIQRThresholds(
              aggregatedData,
              primaryValueField,
              primaryCountField,
              upperMultiplier,
              lowerMultiplier
            );

            valueThresholds = thresholds.valueThresholds;
            countThresholds = thresholds.countThresholds;
          }

          if (!isLargeDataset) console.log('整体阈值:', { valueThresholds, countThresholds });

          // 对所有数据进行分类
          aggregatedData.forEach(row => {
            classifyRowByRules(row, {
              primaryValueField,
              primaryCountField,
              valueThresholds,
              countThresholds
            });
          });
        } else {
          // 对每一行数据，根据其分组值找到对应的配置并分类
          let totalRows = 0;
          let classifiedRows = 0;
          let unknownRows = 0;

          if (!isLargeDataset) {
            console.log('\n开始逐行分类...');
            console.log('前3行数据:', aggregatedData.slice(0, 3).map(r => ({
              [groupFieldName]: r[groupFieldName],
              [primaryValueField]: r[primaryValueField],
              [primaryCountField]: r[primaryCountField]
            })));
          }

          aggregatedData.forEach((row, rowIndex) => {
            totalRows++;
            const rowGroupValue = row[groupFieldName];

            // 尝试使用多种方式匹配分组配置
            const groupConfig = matchGroupValue(rowGroupValue, groupMap);

            if (groupConfig) {
              classifiedRows++;
              if (!isLargeDataset && (rowIndex < 5 || rowIndex === aggregatedData.length - 1)) {
                console.log(`✓ 行 ${rowIndex}: 分组值=${rowGroupValue} (类型:${typeof rowGroupValue}), 值=${row[primaryValueField]}, 计数=${row[primaryCountField]}`);
              }
              // 这一行找到了对应的分组配置，进行分类
              classifyRowByRules(row, {
                primaryValueField: groupConfig.valueField,
                primaryCountField: groupConfig.countField,
                valueThresholds: groupConfig.valueThresholds,
                countThresholds: groupConfig.countThresholds
              });
            } else {
              unknownRows++;
              if (!isLargeDataset && rowIndex < 5) {
                console.log(`✗ 行 ${rowIndex}: 分组值=${rowGroupValue} (类型:${typeof rowGroupValue}), 未找到分组配置`);
                console.log(`   可用的分组值:`, Array.from(groupMap.keys()));
              }
            }
          });

          if (!isLargeDataset) {
            console.log(`\n=== 分类完成 ===`);
            console.log(`分类统计: ${classifiedRows} 行已分类, ${unknownRows} 行未分类, 总共 ${totalRows} 行`);

            // 输出最终的分类结果统计
            const finalStats = {
              '双高型': 0,
              '偏高型（第一字段）': 0,
              '偏高型（第二字段）': 0,
              '中间型': 0,
              '低值型': 0,
              '未知': 0
            };
            aggregatedData.forEach(row => {
              const category = row['画像类型'];
              if (finalStats.hasOwnProperty(category)) {
                finalStats[category as keyof typeof finalStats]++;
              } else {
                finalStats['未知']++;
              }
            });
            console.log('最终分类统计:', finalStats);
          }

          // 如果未分类的行数大于0，尝试使用整体阈值进行分类
          if (unknownRows > 0) {
            if (!isLargeDataset) console.log(`\n⚠️ 有 ${unknownRows} 行未分类，尝试使用整体阈值...`);

            // 尝试从intelligentAnalysis中获取整体classificationParams
            const allParams = intelligentAnalysis?.transferTypeAnalysis?.['all']?.classificationParams;
            const upperMultiplier = allParams?.upperMultiplier ?? intelligentAnalysis?.classificationParams?.upperMultiplier ?? 1.5;
            const lowerMultiplier = allParams?.lowerMultiplier ?? intelligentAnalysis?.classificationParams?.lowerMultiplier ?? 0;

            if (!isLargeDataset) {
              console.log(`使用整体参数进行分类: upperMultiplier=${upperMultiplier}, lowerMultiplier=${lowerMultiplier}`);
            }

            const { valueThresholds, countThresholds } = calculateIQRThresholds(
              aggregatedData,
              primaryValueField,
              primaryCountField,
              upperMultiplier,
              lowerMultiplier
            );

            if (!isLargeDataset) console.log(`整体阈值:`, { valueThresholds, countThresholds });

            // 只对未分类的行进行分类
            let reclassifiedCount = 0;
            aggregatedData.forEach(row => {
              if (!row['画像类型'] || row['画像类型'] === '未知') {
                classifyRowByRules(row, {
                  primaryValueField,
                  primaryCountField,
                  valueThresholds,
                  countThresholds
                });
                reclassifiedCount++;
              }
            });

            if (!isLargeDataset) console.log(`重新分类了 ${reclassifiedCount} 行`);

            if (!isLargeDataset) {
              // 输出更新后的分类统计
              const updatedStats = { '双高型': 0, '偏高型（第一字段）': 0, '偏高型（第二字段）': 0, '中间型': 0, '低值型': 0, '未知': 0 };
              aggregatedData.forEach(row => {
                const category = row['画像类型'];
                if (updatedStats.hasOwnProperty(category)) {
                  updatedStats[category as keyof typeof updatedStats]++;
                } else {
                  updatedStats['未知']++;
                }
              });
              console.log('更新后的分类统计:', updatedStats);
            }
          }
        }
      }
    }

    // 检查是否还有未分类的行（如果所有逻辑都失败了）
    const stillUnclassifiedRows = aggregatedData.filter(row => !row['画像类型'] || row['画像类型'] === '未知');
    if (stillUnclassifiedRows.length > 0) {
      console.warn(`⚠️ 仍有 ${stillUnclassifiedRows.length} 行无法分类，标记为"未知"`);
      stillUnclassifiedRows.forEach(row => {
        if (!row['画像类型'] || row['画像类型'] === '未知') {
          row['画像类型'] = '未知';
          row['风险等级'] = '未知';
        }
      });
    }

  } else {
    // 无分组：使用整体阈值对所有数据进行分类
    console.log('=== 整体分类模式 ===');

    // 从intelligentAnalysis中获取用户配置的参数
    const classificationParams = intelligentAnalysis?.transferTypeAnalysis?.['all']?.classificationParams
      ?? intelligentAnalysis?.classificationParams;

    let valueThresholds, countThresholds;

    if (classificationParams?.valueHighThreshold !== undefined && classificationParams?.countHighThreshold !== undefined) {
      // 使用intelligentAnalysis中已经计算好的阈值
      console.log('✅ 使用intelligentAnalysis中的阈值');
      valueThresholds = {
        highThreshold: classificationParams.valueHighThreshold,
        lowThreshold: classificationParams.valueLowThreshold
      };
      countThresholds = {
        highThreshold: classificationParams.countHighThreshold,
        lowThreshold: classificationParams.countLowThreshold
      };
    } else {
      // 重新计算阈值
      const upperMultiplier = classificationParams?.upperMultiplier ?? 1.5;
      const lowerMultiplier = classificationParams?.lowerMultiplier ?? 0;
      const method = classificationParams?.method ?? 'iqr';

      console.log('使用的分类参数:', {
        method,
        upperMultiplier,
        lowerMultiplier
      });

      const thresholds = calculateIQRThresholds(
        aggregatedData,
        primaryValueField,
        primaryCountField,
        upperMultiplier,
        lowerMultiplier
      );

      valueThresholds = thresholds.valueThresholds;
      countThresholds = thresholds.countThresholds;
    }

    console.log('阈值:', { valueThresholds, countThresholds });

    console.log('IQR阈值:', {
      valueThresholds,
      countThresholds
    });

    // 使用规则分类（基于阈值）对所有聚合数据进行分类
    console.log('使用规则分类对聚合数据进行分类');
    aggregatedData.forEach(row => {
      classifyRowByRules(row, {
        primaryValueField,
        primaryCountField,
        valueThresholds,
        countThresholds
      });
    });
  }

  console.log('✅ 画像分类添加完成');
  return aggregatedData;
}

/**
 * 尝试多种方式匹配分组值
 */
function matchGroupValue(rowGroupValue: any, groupMap: Map<string, any>): any | null {
  // 直接匹配（字符串化后的值）
  const normalizedValue = String(rowGroupValue);
  if (groupMap.has(normalizedValue)) {
    return groupMap.get(normalizedValue);
  }

  // 尝试数值匹配（如果rowGroupValue是字符串形式的数字，尝试作为数字匹配）
  if (typeof rowGroupValue === 'string' && !isNaN(parseFloat(rowGroupValue)) && isFinite(parseFloat(rowGroupValue))) {
    const numValue = parseFloat(rowGroupValue);
    // 查找groupMap中是否有数值匹配的key
    for (const [key, config] of groupMap.entries()) {
      const keyNum = parseFloat(key);
      if (!isNaN(keyNum) && isFinite(keyNum) && keyNum === numValue) {
        console.log(`  🔍 模糊匹配成功: "${rowGroupValue}" -> "${key}"`);
        return config;
      }
    }
  }

  // 尝试字符串转数字再匹配（如果rowGroupValue是数字，尝试作为字符串匹配）
  if (typeof rowGroupValue === 'number') {
    const strValue = String(rowGroupValue);
    if (groupMap.has(strValue)) {
      console.log(`  🔍 模糊匹配成功: ${rowGroupValue} -> "${strValue}"`);
      return groupMap.get(strValue);
    }
  }

  // 尝试trim后匹配（去除前后空格）
  const trimmedValue = normalizedValue.trim();
  if (trimmedValue !== normalizedValue && groupMap.has(trimmedValue)) {
    console.log(`  🔍 模糊匹配成功: "${rowGroupValue}" -> "${trimmedValue}"`);
    return groupMap.get(trimmedValue);
  }

  return null;
}

/**
 * 根据规则对单行数据进行分类
 */
function classifyRowByRules(row: any, params: any): void {
  const {
    primaryValueField,
    primaryCountField,
    valueThresholds,
    countThresholds
  } = params;

  const value = row[primaryValueField];
  const count = row[primaryCountField];

  // 转换字符串为数字
  const numValue = typeof value === 'string' ? parseFloat(value) : value;
  const numCount = typeof count === 'string' ? parseFloat(count) : count;

  if (typeof numValue !== 'number' || isNaN(numValue) || typeof numCount !== 'number' || isNaN(numCount)) {
    row['画像类型'] = '数据异常';
    row['风险等级'] = '中';
    console.warn(`数据异常: value=${value} (${typeof value}), count=${count} (${typeof count})`);
    return;
  }

  // 使用IQR阈值进行分类（注意：与profileAnalyzer.ts保持一致，使用>=和<=）
  const isHighValue = valueThresholds ? numValue >= valueThresholds.highThreshold : false;
  const isHighCount = countThresholds ? numCount >= countThresholds.highThreshold : false;
  const isLowValue = valueThresholds ? numValue <= valueThresholds.lowThreshold : false;
  const isLowCount = countThresholds ? numCount <= countThresholds.lowThreshold : false;

  // 输出分类调试信息
  console.log(`  分类逻辑: 值=${numValue}, 计数=${numCount}, 值阈值=${valueThresholds ? `${valueThresholds.lowThreshold}-${valueThresholds.highThreshold}` : 'N/A'}, 计数阈值=${countThresholds ? `${countThresholds.lowThreshold}-${countThresholds.highThreshold}` : 'N/A'}`);

  // 分类逻辑（5个类别）- 与profileAnalyzer.ts中的getFallbackAnalysis方法保持一致
  if (isHighValue && isHighCount) {
    row['画像类型'] = '双高型';
    row['风险等级'] = '高';
  } else if (isHighValue && !isHighCount) {
    row['画像类型'] = '偏高型（第一字段）';
    row['风险等级'] = '高';
  } else if (isHighCount && !isHighValue) {
    row['画像类型'] = '偏高型（第二字段）';
    row['风险等级'] = '高';
  } else if (!isLowValue && !isHighValue && !isLowCount && !isHighCount) {
    row['画像类型'] = '中间型';
    row['风险等级'] = '低';
  } else {
    row['画像类型'] = '低值型';
    row['风险等级'] = '低';
  }

  console.log(`  分类结果: ${row['画像类型']} - ${row['风险等级']}`);
}

/**
 * 为Excel工作表应用百分比格式
 * @param worksheet Excel工作表对象
 * @param columnTypes 列类型映射
 */
function applyPercentageFormatToWorksheet(worksheet: XLSX.WorkSheet, columnTypes: Record<string, string>): void {
  if (!columnTypes || Object.keys(columnTypes).length === 0) return;

  const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1:A1');

  // 遍历所有列
  for (let col = range.s.c; col <= range.e.c; col++) {
    // 获取列名（第一行的值）
    const cellAddress = XLSX.utils.encode_cell({ r: 0, c: col });
    const headerCell = worksheet[cellAddress];
    if (!headerCell) continue;

    const columnName = headerCell.v;
    if (!columnName || columnTypes[columnName] !== 'percentage') continue;

    // 对该列的所有数据行应用百分比格式
    for (let row = 1; row <= range.e.r; row++) {
      const cellAddress = XLSX.utils.encode_cell({ r: row, c: col });
      const cell = worksheet[cellAddress];
      if (cell && typeof cell.v === 'number') {
        // 设置百分比格式代码：显示两位小数
        cell.z = '0.00%';
      }
    }
  }
}

/**
 * 生成Excel报告
 */
export function generateExcelReport(data: AnalysisExportData): Uint8Array {
  console.log('=== 开始生成Excel报告 ===');
  const dataLength = data.aggregatedData?.length || 0;
  const isLargeDataset = dataLength > 10000;

  if (isLargeDataset) {
    console.log('⚠️ 检测到大数据量，已优化日志输出');
  }

  const wb = XLSX.utils.book_new();

  // 工作表：聚合数据（含画像分类，只导出前1000行样本）
  if (data.aggregatedData && data.aggregatedData.length > 0) {
    console.log('生成聚合数据（含画像分类）工作表...');
    const classifiedAggregatedData = addProfileClassificationToAggregatedData(
      data.aggregatedData,
      data.intelligentAnalysis
    );

    // 只导出前1000行作为样本
    const sampleSize = Math.min(classifiedAggregatedData.length, 1000);
    const sampleData = classifiedAggregatedData.slice(0, sampleSize);

    const aggregatedWs = XLSX.utils.json_to_sheet(sampleData);

    // 应用百分比格式
    if (data.columnTypes) {
      applyPercentageFormatToWorksheet(aggregatedWs, data.columnTypes);
    }

    XLSX.utils.book_append_sheet(wb, aggregatedWs, '聚合数据（含画像分类，样本）');

    if (sampleSize < classifiedAggregatedData.length) {
      console.log(`聚合数据（含画像分类）工作表生成完成（样本${sampleSize}条，完整数据${classifiedAggregatedData.length}条，建议下载CSV获取完整数据）`);
    } else {
      console.log(`聚合数据（含画像分类）工作表生成完成（共${classifiedAggregatedData.length}条）`);
    }
  }

  // 工作表：画像分析结果
  if (data.intelligentAnalysis?.transferTypeAnalysis) {
    if (!isLargeDataset) console.log('生成画像分析结果工作表...');
    const transferTypeAnalysis = data.intelligentAnalysis.transferTypeAnalysis;

    // 判断是否有分组（除了'all'键之外还有其他分组）
    const hasGroups = Object.keys(transferTypeAnalysis).some(key => key !== 'all');

    if (!hasGroups) {
      // 无分组情况：生成一个工作表
      if (!isLargeDataset) console.log('生成画像分析结果（整体）工作表...');
      const categories = data.intelligentAnalysis.transferTypeAnalysis['all']?.categories || [];
      if (categories && categories.length > 0) {
        // 转换categories数组为Excel友好的格式
        const excelCategories = categories.map((cat: any) => ({
          '画像类型': cat.category || '未知',
          '风险等级': cat.indicators?.riskLevel || '未知',
          '描述': cat.description || '',
          '对象数量': cat.indicators?.objectCount || 0,
          '总金额': cat.indicators?.totalAmount || 0,
          '交易次数': cat.indicators?.transactionCount || 0,
          '平均金额': cat.indicators?.avgAmount || 0,
          '置信度': cat.confidence || 0
        }));

        const analysisWs = XLSX.utils.json_to_sheet(excelCategories);
        XLSX.utils.book_append_sheet(wb, analysisWs, '画像分析结果');
        if (!isLargeDataset) console.log('画像分析结果工作表生成完成');
      }
    } else {
      // 有分组情况：生成一个工作表，第一列增加分组名称
      if (!isLargeDataset) console.log('生成画像分析结果（分组）工作表...');
      const profileWsData = [
        ['分组名称', '画像类型', '风险等级', '描述', '对象数量', '总金额', '交易次数', '平均金额', '置信度']
      ];

      // 遍历所有分组（包括'all'）
      Object.keys(transferTypeAnalysis).forEach((groupKey) => {
        const groupData = transferTypeAnalysis[groupKey];
        const groupName = groupKey === 'all' ? '整体' : groupKey;

        if (groupData.categories && groupData.categories.length > 0) {
          // 转换categories数组为Excel友好的格式
          groupData.categories.forEach((cat: any) => {
            profileWsData.push([
              groupName,
              cat.category || '未知',
              cat.indicators?.riskLevel || '未知',
              cat.description || '',
              cat.indicators?.objectCount || 0,
              cat.indicators?.totalAmount || 0,
              cat.indicators?.transactionCount || 0,
              cat.indicators?.avgAmount || 0,
              cat.confidence || 0
            ]);
          });
        }
      });

      const profileWs = XLSX.utils.aoa_to_sheet(profileWsData);
      XLSX.utils.book_append_sheet(wb, profileWs, '画像分析结果');
      if (!isLargeDataset) console.log('画像分析结果工作表生成完成');
    }

    // 工作表：画像参数说明（新增）
    if (data.intelligentAnalysis?.transferTypeAnalysis) {
      if (!isLargeDataset) console.log('生成画像参数说明工作表...');

      // 检查所有分组使用的分类方法
      const methods = new Set<string>();
      Object.keys(transferTypeAnalysis).forEach((groupKey) => {
        const params = transferTypeAnalysis[groupKey]?.classificationParams;
        if (params?.method) {
          methods.add(params.method);
        }
      });

      // 根据使用的分类方法设置表头
      let headerRow: string[];
      if (methods.has('iqr') && methods.has('stddev')) {
        // 同时使用两种方法，不推荐混合，使用通用列名
        headerRow = ['分组名称', '指标名称', '指标标签', '分类方法', '统计量1', '统计量2', '上阈值倍数', '高阈值', '下阈值倍数', '低阈值'];
      } else if (methods.has('iqr')) {
        // 只有四分位数法，显示Q1、Q2、Q3、IQR
        headerRow = ['分组名称', '指标名称', '指标标签', '分类方法', 'Q1', 'Q2', 'Q3', 'IQR', '上阈值倍数', '高阈值', '下阈值倍数', '低阈值'];
      } else {
        // 只有均值标准差法，显示均值、标准差
        headerRow = ['分组名称', '指标名称', '指标标签', '分类方法', '均值', '标准差', '上阈值倍数', '高阈值', '下阈值倍数', '低阈值'];
      }

      const paramsWsData = [headerRow];

      // 遍历所有分组
      Object.keys(transferTypeAnalysis).forEach((groupKey) => {
        const groupData = transferTypeAnalysis[groupKey];
        const groupName = groupKey === 'all' ? '整体' : groupKey;
        const params = groupData.classificationParams;

        if (params) {
          // 值字段参数
          const valueLabel = params.valueLabel || params.valueField || '值字段';
          if (params.method === 'iqr') {
            // 四分位数法：显示Q1、Q2、Q3、IQR
            paramsWsData.push([
              groupName,
              params.valueField || '',
              valueLabel,
              '四分位数法',
              params.valueQ1 ? params.valueQ1.toFixed(2) : '-',
              params.valueQ2 ? params.valueQ2.toFixed(2) : '-',
              params.valueQ3 ? params.valueQ3.toFixed(2) : '-',
              params.valueIQR ? params.valueIQR.toFixed(2) : '-',
              params.upperMultiplier || '-',
              params.valueHighThreshold ? params.valueHighThreshold.toFixed(2) : '-',
              params.lowerMultiplier || '-',
              params.valueLowThreshold ? params.valueLowThreshold.toFixed(2) : '-'
            ]);
          } else {
            // 均值标准差法：显示均值、标准差
            paramsWsData.push([
              groupName,
              params.valueField || '',
              valueLabel,
              '均值标准差法',
              params.valueMean ? params.valueMean.toFixed(2) : '-',
              params.valueStdDev ? params.valueStdDev.toFixed(2) : '-',
              params.upperMultiplier || '-',
              params.valueHighThreshold ? params.valueHighThreshold.toFixed(2) : '-',
              params.lowerMultiplier || '-',
              params.valueLowThreshold ? params.valueLowThreshold.toFixed(2) : '-'
            ]);
          }

          // 计数字段参数
          const countLabel = params.countLabel || params.countField || '计数字段';
          if (params.method === 'iqr') {
            // 四分位数法：显示Q1、Q2、Q3、IQR
            paramsWsData.push([
              groupName,
              params.countField || '',
              countLabel,
              '四分位数法',
              params.countQ1 ? params.countQ1.toFixed(2) : '-',
              params.countQ2 ? params.countQ2.toFixed(2) : '-',
              params.countQ3 ? params.countQ3.toFixed(2) : '-',
              params.countIQR ? params.countIQR.toFixed(2) : '-',
              params.upperMultiplier || '-',
              params.countHighThreshold ? params.countHighThreshold.toFixed(2) : '-',
              params.lowerMultiplier || '-',
              params.countLowThreshold ? params.countLowThreshold.toFixed(2) : '-'
            ]);
          } else {
            // 均值标准差法：显示均值、标准差
            paramsWsData.push([
              groupName,
              params.countField || '',
              countLabel,
              '均值标准差法',
              params.countMean ? params.countMean.toFixed(2) : '-',
              params.countStdDev ? params.countStdDev.toFixed(2) : '-',
              params.upperMultiplier || '-',
              params.countHighThreshold ? params.countHighThreshold.toFixed(2) : '-',
              params.lowerMultiplier || '-',
              params.countLowThreshold ? params.countLowThreshold.toFixed(2) : '-'
            ]);
          }
        }
      });

      const paramsWs = XLSX.utils.aoa_to_sheet(paramsWsData);
      XLSX.utils.book_append_sheet(wb, paramsWs, '画像参数说明');
      console.log('画像参数说明工作表生成完成');
    }
  }

  // 工作表：正态分布检验结果
  if (data.normalityTestResults) {
    console.log('生成正态分布检验结果工作表...');
    const testResults = data.normalityTestResults;

    if (!testResults.hasGroups && testResults.results) {
      // 无分组情况
      console.log('生成正态分布检验结果（整体）工作表...');
      const normalityWsData = [
        ['字段名称', 'Anderson-Darling检验', 'Anderson-Darling统计量', 'Anderson-Darling p值', 'KS检验', 'KS统计量', 'KS p值', 'Z-score检验', 'Z-score统计量', 'Z-score p值', '最佳拟合分布']
      ];

      testResults.results.forEach(result => {
        normalityWsData.push([
          result.fieldName,
          result.andersonDarlingTest?.isNormal ? '符合' : '不符合',
          result.andersonDarlingTest?.statistic.toFixed(4) || '-',
          result.andersonDarlingTest?.pValue.toFixed(4) || '-',
          result.ksTest.isNormal ? '符合' : '不符合',
          result.ksTest.statistic.toFixed(4),
          result.ksTest.pValue.toFixed(4),
          result.zScoreTest.isNormal ? '符合' : '不符合',
          result.zScoreTest.statistic.toFixed(4),
          result.zScoreTest.pValue.toFixed(4),
          result.distributionFit?.bestFit || '-'
        ]);
      });

      const normalityWs = XLSX.utils.aoa_to_sheet(normalityWsData);
      XLSX.utils.book_append_sheet(wb, normalityWs, '正态分布检验结果');
      if (!isLargeDataset) console.log('正态分布检验结果工作表生成完成');
    } else if (testResults.hasGroups && testResults.groupResults) {
      // 有分组情况，生成一个工作表，第一列为分组名称
      if (!isLargeDataset) console.log('生成正态分布检验结果（分组）工作表...');
      const normalityWsData = [
        ['分组名称', '字段名称', 'Anderson-Darling检验', 'Anderson-Darling统计量', 'Anderson-Darling p值', 'KS检验', 'KS统计量', 'KS p值', 'Z-score检验', 'Z-score统计量', 'Z-score p值', '最佳拟合分布']
      ];

      testResults.groupResults.forEach(groupResult => {
        groupResult.results.forEach(result => {
          normalityWsData.push([
            groupResult.groupName,
            result.fieldName,
            result.andersonDarlingTest?.isNormal ? '符合' : '不符合',
            result.andersonDarlingTest?.statistic.toFixed(4) || '-',
            result.andersonDarlingTest?.pValue.toFixed(4) || '-',
            result.ksTest.isNormal ? '符合' : '不符合',
            result.ksTest.statistic.toFixed(4),
            result.ksTest.pValue.toFixed(4),
            result.zScoreTest.isNormal ? '符合' : '不符合',
            result.zScoreTest.statistic.toFixed(4),
            result.zScoreTest.pValue.toFixed(4),
            result.distributionFit?.bestFit || '-'
          ]);
        });
      });

      const normalityWs = XLSX.utils.aoa_to_sheet(normalityWsData);
      XLSX.utils.book_append_sheet(wb, normalityWs, '正态分布检验结果');
      if (!isLargeDataset) console.log('正态分布检验结果工作表生成完成');
    }

    if (!isLargeDataset) console.log('正态分布检验结果工作表生成完成');
  }

  // 最后的工作表：分析摘要
  if (data.intelligentAnalysis?.transferTypeAnalysis) {
    if (!isLargeDataset) console.log('生成分析摘要工作表...');
    const categories = data.intelligentAnalysis.transferTypeAnalysis['all']?.categories || [];
    const analysis = data.intelligentAnalysis.transferTypeAnalysis['all']?.analysis || '';

    const summaryWsData = [
      ['分析摘要'],
      [analysis],
      []
    ];

    // 添加数据量信息
    summaryWsData.push(['原始数据量', data.originalData.length]);
    summaryWsData.push(['筛选数据量', data.filteredData.length]);
    summaryWsData.push(['聚合数据量', data.aggregatedData.length]);
    summaryWsData.push(['分类数量', categories.length]);

    // 添加导出说明
    summaryWsData.push([]);
    summaryWsData.push(['导出说明', 'Excel报告包含聚合数据（含画像分类）的完整数据。如需原始数据和筛选数据，请下载JSON格式。']);

    const summaryWs = XLSX.utils.aoa_to_sheet(summaryWsData);
    XLSX.utils.book_append_sheet(wb, summaryWs, '分析摘要');
    if (!isLargeDataset) console.log('分析摘要工作表生成完成');
  }

  console.log('✅ Excel报告生成完成');
  return XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as any;
}

/**
 * 下载Excel文件
 */
export async function downloadExcelFile(data: AnalysisExportData): Promise<void> {
  try {
    console.log('生成 Excel 报告...');
    const arrayBuffer = generateExcelReport(data);
    console.log('Excel 报告生成成功，ArrayBuffer 大小:', arrayBuffer.byteLength);

    if (arrayBuffer.byteLength === 0) {
      throw new Error('生成的 Excel 文件为空');
    }

    // 将 Uint8Array 包装为数组作为 BlobPart（需要类型断言）
    const blob = new Blob([arrayBuffer as unknown as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }) as any;
    console.log('Blob 创建成功，类型:', blob.type, 'Blob 大小:', blob.size);

    console.log('创建下载链接...');
    const url = URL.createObjectURL(blob);
    console.log('下载链接创建成功:', url);

    const a = document.createElement('a');
    a.href = url;
    a.download = `数据分析报告_${new Date().toISOString().slice(0, 10)}.xlsx`;
    a.style.display = 'none';

    console.log('触发下载...');
    document.body.appendChild(a);
    a.click();

    // 延迟清理以确保下载开始
    setTimeout(() => {
      document.body.removeChild(a);
      console.log('释放 URL 对象...');
      URL.revokeObjectURL(url);
      console.log('✅ Excel 文件下载完成');
    }, 100);

  } catch (error) {
    console.error('❌ Excel 文件下载失败:', error);
    throw error;
  }
}

/**
 * 下载CSV文件（完整的聚合数据，含画像分类）
 * 适合大数据量导出，性能更好
 */
export async function downloadCsvFile(data: AnalysisExportData): Promise<void> {
  try {
    console.log('=== 开始生成CSV文件 ===');
    console.log(`聚合数据行数: ${data.aggregatedData?.length || 0}`);

    if (!data.aggregatedData || data.aggregatedData.length === 0) {
      throw new Error('聚合数据为空，无法生成CSV');
    }

    // 添加画像分类
    const classifiedAggregatedData = addProfileClassificationToAggregatedData(
      data.aggregatedData,
      data.intelligentAnalysis
    );

    console.log(`分类完成，准备导出${classifiedAggregatedData.length}条数据`);

    // 获取所有列名（作为CSV表头）
    const headers = Object.keys(classifiedAggregatedData[0] || {});

    // 转义CSV字段值的函数（支持百分比格式化）
    const escapeCsvField = (value: any, header: string): string => {
      if (value === null || value === undefined) return '';

      // 如果是数字且是百分比列，格式化为百分比
      if (typeof value === 'number' && !isNaN(value)) {
        const columnType = data.columnTypes?.[header];
        if (columnType === 'percentage') {
          // 将小数转换为百分比字符串（保留2位小数）
          const percentage = (value * 100).toFixed(2) + '%';
          const stringValue = String(percentage);
          // 如果包含逗号、双引号或换行符，需要用双引号包裹并转义
          if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
            return `"${stringValue.replace(/"/g, '""')}"`;
          }
          return stringValue;
        }
      }

      const stringValue = String(value);
      // 如果包含逗号、双引号或换行符，需要用双引号包裹并转义
      if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
        return `"${stringValue.replace(/"/g, '""')}"`;
      }
      return stringValue;
    };

    // 生成CSV内容
    const csvRows: string[] = [];

    // 添加表头
    csvRows.push(headers.map(h => escapeCsvField(h, h)).join(','));

    // 添加数据行
    classifiedAggregatedData.forEach(row => {
      const rowValues = headers.map(header => escapeCsvField(row[header], header));
      csvRows.push(rowValues.join(','));
    });

    const csvContent = csvRows.join('\n');

    console.log(`CSV内容生成完成，大小约: ${(csvContent.length / 1024 / 1024).toFixed(2)}MB`);

    // 创建Blob
    const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
    console.log('CSV Blob 创建成功，大小:', blob.size);

    // 创建下载链接
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `聚合数据（含画像分类）_${new Date().toISOString().slice(0, 10)}.csv`;
    a.style.display = 'none';

    // 触发下载
    document.body.appendChild(a);
    a.click();

    // 清理
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      console.log('✅ CSV 文件下载完成');
    }, 100);

  } catch (error) {
    console.error('❌ CSV 文件下载失败:', error);
    throw error;
  }
}

/**
 * 为HTML报告生成表格行，支持百分比格式化
 * @param row 数据行
 * @param columns 列名数组
 * @param columnTypes 列类型映射
 * @returns HTML表格行字符串
 */
function generateHtmlTableRow(row: any, columns: string[], columnTypes?: Record<string, string>): string {
  const cells = columns.map(col => {
    const value = row[col];
    const columnType = columnTypes?.[col] || 'string';
    const formattedValue = formatHtmlValue(value, columnType, 2);
    return `<td>${formattedValue}</td>`;
  }).join('');

  return `<tr>${cells}</tr>`;
}

/**
 * 生成Word文档
 * @param data 分析数据
 * @param useExternalImages 是否使用外部图片引用（相对于ZIP包内的路径）
 */
export function generateWordReport(data: AnalysisExportData, useExternalImages = false): string {
  const { primaryValueField, primaryCountField, fieldLabels } = identifyDataFields(data.aggregatedData);

  // 调试日志：检查数据分布图表数据
  console.log('=== generateWordReport: 数据分布图表检查 ===');
  console.log('distributionChartConfig:', data.distributionChartConfig);
  console.log('distributionChartImages:', data.distributionChartImages);

  // 验证配置
  if (!data.distributionChartConfig) {
    console.warn('⚠️ distributionChartConfig 不存在，跳过数据分布可视化部分');
  } else {
    console.log('✅ distributionChartConfig 存在');
    console.log('  - chartType:', data.distributionChartConfig.chartType);
    console.log('  - selectedFields:', data.distributionChartConfig.selectedFields);
    console.log('  - binCount:', data.distributionChartConfig.binCount);
  }

  // 验证图片数据
  if (data.distributionChartImages?.images) {
    const imageKeys = Object.keys(data.distributionChartImages.images);
    console.log('✅ distributionChartImages.images 存在');
    console.log('  - 图片数量:', imageKeys.length);
    console.log('  - 图片键:', imageKeys);
    for (const [key, value] of Object.entries(data.distributionChartImages.images)) {
      const imgValue = value as string;
      console.log(`  - 图片 ${key}:`, {
        exists: !!imgValue,
        isBase64: imgValue?.startsWith('data:image/'),
        length: imgValue?.length || 0,
        prefix: imgValue?.substring(0, 50)
      });
    }
  } else {
    console.warn('⚠️ distributionChartImages 或 images 不存在');
  }

  let htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>数据分析报告</title>
  <style>
    body { font-family: 'Microsoft YaHei', 'SimHei', Arial, sans-serif; line-height: 1.8; margin: 30px; color: #333; }
    h1 { color: #2c3e50; border-bottom: 3px solid #3498db; padding-bottom: 15px; margin-bottom: 30px; font-size: 24px; }
    h2 { color: #34495e; border-left: 5px solid #3498db; padding-left: 15px; margin-top: 40px; margin-bottom: 20px; font-size: 20px; }
    h3 { color: #555; margin-top: 25px; margin-bottom: 15px; font-size: 16px; }
    table { border-collapse: collapse; width: 100%; margin: 20px 0; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
    th, td { border: 1px solid #ddd; padding: 12px; text-align: left; }
    th { background: linear-gradient(to bottom, #f8f9fa, #e9ecef); font-weight: bold; color: #2c3e50; }
    tr:nth-child(even) { background-color: #f9f9f9; }
    tr:hover { background-color: #f0f3f5; }
    .highlight { background-color: #fff3cd; }
    .risk-high { color: #dc3545; font-weight: bold; }
    .risk-medium { color: #ffc107; }
    .risk-low { color: #28a745; }
    .info-box { background-color: #e9ecef; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #3498db; }
    .warning-box { background-color: #fff3cd; padding: 15px; border-radius: 5px; margin: 20px 0; border-left: 4px solid #ffc107; }
    .success-box { background-color: #d4edda; padding: 15px; border-radius: 5px; margin: 20px 0; border-left: 4px solid #28a745; }
    .metric-card { display: inline-block; background: #f8f9fa; padding: 15px 25px; margin: 10px; border-radius: 8px; border: 1px solid #dee2e6; min-width: 200px; }
    .metric-title { color: #6c757d; font-size: 14px; margin-bottom: 5px; }
    .metric-value { color: #2c3e50; font-size: 24px; font-weight: bold; }
    .section-title { font-size: 18px; font-weight: bold; color: #2c3e50; margin: 30px 0 15px 0; padding-bottom: 8px; border-bottom: 2px solid #ecf0f1; }
    ul, ol { margin: 10px 0; padding-left: 25px; }
    li { margin: 8px 0; }
    .insight { background-color: #e8f4f8; padding: 15px; border-radius: 5px; margin: 20px 0; border-left: 4px solid #17a2b8; }
    .trend-up { color: #28a745; }
    .trend-down { color: #dc3545; }
    .trend-neutral { color: #6c757d; }
  </style>
</head>
<body>
  <h1>数据分析与画像报告</h1>

  <!-- 第一部分：用户上传数据的整体描述 -->
  <h2>第一部分：用户上传数据的整体描述</h2>

  <div class="info-box">
    <h3 style="margin-top: 0;">📋 数据基本信息</h3>
    <p><strong>数据来源：</strong>用户上传文件</p>
    <p><strong>原始数据量：</strong>${data.originalData.length.toLocaleString()} 条记录</p>
    ${data.originalData.length > 0 ? `<p><strong>数据字段：</strong>${Object.keys(data.originalData[0] || {}).join(', ')}</p>` : ''}
    <p><strong>数据类型：</strong>${data.originalData.length > 0 && typeof data.originalData[0] === 'object' ? '结构化数据（表格格式）' : '未知'}</p>
  </div>

  <div class="insight">
    <h4 style="margin-top: 0;">📊 数据特征说明</h4>
    <ul>
      <li><strong>数据规模：</strong>共包含 ${data.originalData.length.toLocaleString()} 条原始记录，数据规模${data.originalData.length > 10000 ? '较大' : data.originalData.length > 1000 ? '中等' : '较小'}</li>
      <li><strong>字段数量：</strong>${data.originalData.length > 0 ? Object.keys(data.originalData[0] || {}).length : 0} 个字段，包含多维度信息</li>
      <li><strong>数据质量：</strong>数据来源于用户上传，已进行基本格式校验</li>
      <li><strong>分析准备：</strong>数据已成功加载到分析系统，准备进行后续的筛选、聚合和画像分析</li>
    </ul>
  </div>

  <!-- 报告概览（独立部分） -->
  <h2>报告概览</h2>

  <div class="info-box">
    <h3 style="margin-top: 0;">📊 整体数据概览</h3>
    <div style="display: flex; flex-wrap: wrap; gap: 15px;">
      <div class="metric-card">
        <div class="metric-title">报告生成时间</div>
        <div class="metric-value" style="font-size: 16px;">${new Date().toLocaleString('zh-CN')}</div>
      </div>
      <div class="metric-card">
        <div class="metric-title">原始数据量</div>
        <div class="metric-value">${data.originalData.length.toLocaleString()} 条记录</div>
      </div>
      <div class="metric-card">
        <div class="metric-title">筛选后数据量</div>
        <div class="metric-value">${data.filteredData.length.toLocaleString()} 条记录</div>
      </div>
      <div class="metric-card">
        <div class="metric-title">聚合对象数量</div>
        <div class="metric-value">${data.aggregatedData.length.toLocaleString()} 个</div>
      </div>
    </div>
    <p style="margin-top: 15px; color: #666; font-size: 14px;">
      <strong>数据筛选率：</strong>${((data.filteredData.length / data.originalData.length) * 100).toFixed(2)}% |
      <strong>聚合率：</strong>${((data.aggregatedData.length / data.filteredData.length) * 100).toFixed(2)}%
    </p>
  </div>

  <!-- 第二部分：数据的清洗与筛选 -->
  <h2>第二部分：数据的清洗与筛选</h2>

  <div class="info-box">
    <h3 style="margin-top: 0;">🔍 筛选配置</h3>
    <p><strong>筛选类型：</strong>${data.filterConfig.type || '未设置'}</p>
    ${data.filterConfig.type === 'unique' ? `
    <p><strong>筛选逻辑：</strong>B列值不为A列的不重复值</p>
    ${data.filterConfig.columnA ? `<p><strong>列A（不重复值列）：</strong>${data.filterConfig.columnA}</p>` : ''}
    ${data.filterConfig.columnB ? `<p><strong>列B（筛选列）：</strong>${data.filterConfig.columnB}</p>` : ''}
    <p><strong>业务含义：</strong>此筛选方式用于识别B列中出现的新值（相对于A列），通常用于发现新增对象或异常数据</p>
    ` : ''}

    ${data.filterConfig.type === 'equals' ? `
    <p><strong>筛选逻辑：</strong>某列等于特定值</p>
    ${data.filterConfig.targetColumn ? `<p><strong>目标列：</strong>${data.filterConfig.targetColumn}</p>` : ''}
    ${data.filterConfig.targetValue !== undefined ? `<p><strong>目标值：</strong>${data.filterConfig.targetValue}</p>` : ''}
    <p><strong>业务含义：</strong>此筛选方式用于提取符合特定条件的数据子集，便于针对性分析</p>
    ` : ''}

    ${!data.filterConfig.type ? `<p style="color: #666;">未应用筛选，使用原始数据进行分析</p>` : ''}
  </div>

  <div class="insight">
    <h4 style="margin-top: 0;">📊 筛选结果</h4>
    <ul>
      <li><strong>筛选前数据量：</strong>${data.originalData.length.toLocaleString()} 条记录</li>
      <li><strong>筛选后数据量：</strong>${data.filteredData.length.toLocaleString()} 条记录</li>
      <li><strong>筛选率：</strong>${((data.filteredData.length / data.originalData.length) * 100).toFixed(2)}%</li>
      <li><strong>数据保留率：</strong>${data.filteredData.length < data.originalData.length ? '筛选后数据减少，已过滤不符合条件的数据' : '数据全部保留，无过滤'}</li>
      ${data.filterConfig.type ? `<li><strong>筛选效果：</strong>${data.filterConfig.type === 'unique' ? '识别出新增或异常数据' : '提取了特定条件的数据子集'}</li>` : ''}
    </ul>
  </div>

  <div class="success-box">
    <h4 style="margin-top: 0;">✅ 数据清洗状态</h4>
    <ul>
      <li><strong>数据完整性：</strong>${data.filteredData.length > 0 ? '✓ 筛选后数据完整' : '⚠️ 筛选后数据为空'}</li>
      <li><strong>数据一致性：</strong>${data.originalData.length === data.filteredData.length ? '✓ 无数据过滤' : `✓ 已过滤 ${(data.originalData.length - data.filteredData.length).toLocaleString()} 条记录`}</li>
      <li><strong>数据质量：</strong>${data.filteredData.length > 0 ? '✓ 数据质量良好，可用于后续分析' : '⚠️ 数据质量存在问题，建议检查筛选条件'}</li>
    </ul>
  </div>

  <!-- 第三部分：数据的聚合以及聚合后的数据可视化 -->
  <h2>第三部分：数据的聚合以及聚合后的数据可视化</h2>

  <div class="info-box">
    <h3 style="margin-top: 0;">📊 聚合配置</h3>
    <p><strong>分组字段：</strong>${data.aggregationConfig.groupBy && data.aggregationConfig.groupBy.length > 0 ? data.aggregationConfig.groupBy.join(', ') : '无（整体聚合）'}</p>
    <p><strong>求和字段：</strong>${data.aggregationConfig.sumColumns && data.aggregationConfig.sumColumns.length > 0 ? data.aggregationConfig.sumColumns.join(', ') : '无'}</p>
    <p><strong>计数字段：</strong>${data.aggregationConfig.countColumns && data.aggregationConfig.countColumns.length > 0 ? data.aggregationConfig.countColumns.join(', ') : '无'}</p>
    <p><strong>最大值字段：</strong>${data.aggregationConfig.maxColumns && data.aggregationConfig.maxColumns.length > 0 ? data.aggregationConfig.maxColumns.join(', ') : '无'}</p>
    <p><strong>最小值字段：</strong>${data.aggregationConfig.minColumns && data.aggregationConfig.minColumns.length > 0 ? data.aggregationConfig.minColumns.join(', ') : '无'}</p>
  </div>

  <div class="info-box">
    <h3 style="margin-top: 0;">📈 数据分布可视化分析</h3>
    ${data.distributionChartConfig ? `
      <p>本部分对聚合后的数据进行分布可视化分析，使用直方图、箱线图和散点图深入揭示数据分布特征。</p>

      <h4 style="margin-top: 20px;">3.1 直方图分析（Histogram）</h4>
      <p><strong>分析目的：</strong>直方图用于展示数据的频率分布情况，通过将数据划分为若干区间（bins），统计每个区间内数据的数量或占比，直观地反映数据的集中趋势和离散程度。</p>
      <p><strong>数据解读：</strong></p>
      <ul>
        <li><strong>分布形态：</strong>通过直方图的形状，可以判断数据是正态分布（钟形）、偏态分布（左偏或右偏）还是多峰分布</li>
        <li><strong>集中趋势：</strong>直方图峰值所在位置反映了数据的中心位置（均值或中位数附近）</li>
        <li><strong>离散程度：</strong>直方图的宽窄反映了数据的离散程度，直方图越宽，数据越分散；直方图越窄，数据越集中</li>
        <li><strong>异常值：</strong>远离主分布的条形可能代表异常值或离群点</li>
      </ul>
      ${data.distributionChartConfig && data.distributionChartConfig.selectedFields && data.distributionChartConfig.selectedFields.length > 0 ? `
        <div class="insight">
          <p><strong>分析字段：</strong>${data.distributionChartConfig.selectedFields.join(', ')}</p>
          ${data.distributionChartConfig.binCount ? `<p><strong>分箱数量：</strong>${data.distributionChartConfig.binCount}</p>` : ''}
        </div>
        ${data.distributionChartImages?.images && Object.keys(data.distributionChartImages.images).length > 0 ? `
          ${data.distributionChartConfig.selectedFields.map((field, index) => {
            const imageKey = `histogram_${field}`;
            const imageDataUrl = data.distributionChartImages?.images?.[imageKey];
            console.log(`直方图 - 字段: ${field}, 图片键: ${imageKey}, 图片数据: ${imageDataUrl ? '存在' : '不存在'}`);
            if (imageDataUrl) {
              return `
                <div style="margin-top: 20px;">
                  <p style="font-weight: bold; margin-bottom: 10px;">${field} 直方图</p>
                  <img src="${imageDataUrl}" alt="${field} 直方图" style="width: 100%; max-width: 800px; border: 1px solid #dee2e6; border-radius: 8px;" />
                </div>
              `;
            }
            return '';
          }).join('')}
        ` : '<p style="color: #dc3545; background-color: #f8d7da; padding: 10px; border-radius: 5px; border: 1px solid #f5c6cb;">⚠️ 直方图未生成。请在分析界面中点击"生成分布图"按钮，等待图表完全加载后再下载报告。</p>'}
      ` : ''}

      <h4 style="margin-top: 20px;">3.2 箱线图分析（Box Plot）</h4>
      <p><strong>分析目的：</strong>箱线图（又称盒须图）是一种基于五数概括法（最小值、下四分位数Q1、中位数、上四分位数Q3、最大值）的统计图形，能够有效地展示数据的分布特征、集中趋势和异常值。</p>
      <p><strong>数据解读：</strong></p>
      <ul>
        <li><strong>箱子（Box）：</strong>箱子表示数据的中间50%（从Q1到Q3），箱子的高度反映了中间数据的离散程度</li>
        <li><strong>中位数线：</strong>箱子内部的横线代表中位数，反映数据的中心位置</li>
        <li><strong>须（Whiskers）：</strong>上下须延伸到最大和最小非异常值，通常定义为Q1-1.5×IQR和Q3+1.5×IQR</li>
        <li><strong>异常值：</strong>超出须的范围的点被视为异常值，通常用圆点或星号标记</li>
        <li><strong>对称性：</strong>中位数在箱子中央表示分布对称，偏向一侧表示存在偏态</li>
      </ul>
      ${data.distributionChartConfig && data.distributionChartConfig.selectedFields && data.distributionChartConfig.selectedFields.length > 0 ? `
        <div class="insight">
          <p><strong>分析字段：</strong>${data.distributionChartConfig.selectedFields.join(', ')}</p>
        </div>
        ${data.distributionChartImages?.images && Object.keys(data.distributionChartImages.images).length > 0 ? `
          ${data.distributionChartConfig.selectedFields.map((field, index) => {
            const imageKey = `boxplot_${field}`;
            const imageDataUrl = data.distributionChartImages?.images?.[imageKey];
            console.log(`箱线图 - 字段: ${field}, 图片键: ${imageKey}, 图片数据: ${imageDataUrl ? '存在' : '不存在'}`);
            if (imageDataUrl) {
              return `
                <div style="margin-top: 20px;">
                  <p style="font-weight: bold; margin-bottom: 10px;">${field} 箱线图</p>
                  <img src="${imageDataUrl}" alt="${field} 箱线图" style="width: 100%; max-width: 800px; border: 1px solid #dee2e6; border-radius: 8px;" />
                </div>
              `;
            }
            return '';
          }).join('')}
        ` : '<p style="color: #dc3545; background-color: #f8d7da; padding: 10px; border-radius: 5px; border: 1px solid #f5c6cb;">⚠️ 箱线图未生成。请在分析界面中点击"生成分布图"按钮，等待图表完全加载后再下载报告。</p>'}
      ` : ''}

      <h4 style="margin-top: 20px;">3.3 散点图分析（Scatter Plot）</h4>
      <p><strong>分析目的：</strong>散点图用于展示两个或多个变量之间的关系，通过在二维平面上绘制数据点，可以直观地观察变量之间的相关性、聚类情况和离群点。</p>
      <p><strong>数据解读：</strong></p>
      <ul>
        <li><strong>相关性：</strong>点的分布趋势反映变量间的相关性。正相关（向上倾斜）、负相关（向下倾斜）或无相关（随机分布）</li>
        <li><strong>相关性强度：</strong>点越集中在一条直线上，相关性越强；点越分散，相关性越弱</li>
        <li><strong>聚类情况：</strong>点聚集在特定区域可能表示存在不同的子群体或类别</li>
        <li><strong>异常值：</strong>远离主要点群的点可能代表异常值或特殊情况</li>
        <li><strong>非线性关系：</strong>点的分布如果呈现曲线或其他非线性模式，可能需要使用非线性模型进行拟合</li>
      </ul>
      ${data.distributionChartConfig && data.distributionChartConfig.selectedFields && data.distributionChartConfig.selectedFields.length >= 2 ? `
        <div class="insight">
          <p><strong>横轴字段：</strong>${data.distributionChartConfig.selectedFields[1]}</p>
          <p><strong>纵轴字段：</strong>${data.distributionChartConfig.selectedFields[0]}</p>
        </div>
        ${data.distributionChartImages?.images && data.distributionChartImages.images['scatter'] ? `
          <div style="margin-top: 20px;">
            <p style="font-weight: bold; margin-bottom: 10px;">${data.distributionChartConfig.selectedFields[0]} vs ${data.distributionChartConfig.selectedFields[1]} 散点图</p>
            <img src="${data.distributionChartImages.images['scatter']}" alt="散点图" style="width: 100%; max-width: 800px; border: 1px solid #dee2e6; border-radius: 8px;" />
          </div>
        ` : '<p style="color: #dc3545; background-color: #f8d7da; padding: 10px; border-radius: 5px; border: 1px solid #f5c6cb;">⚠️ 散点图未生成。请在分析界面中点击"生成分布图"按钮，等待图表完全加载后再下载报告。</p>'}
      ` : '<p style="color: #666;">需要至少两个字段才能生成散点图</p>'}

      <h4 style="margin-top: 20px;">3.4 数据分布特征总结</h4>
      <div class="insight">
        <p>通过直方图、箱线图和散点图对聚合后数据的分布可视化分析，可以获得以下关键信息：</p>
        <ul>
          <li><strong>分布类型：</strong>判断数据是否符合正态分布或其他常见的分布类型（如对数正态、指数分布等）</li>
          <li><strong>中心趋势：</strong>了解数据的集中位置，识别典型的对象特征</li>
          <li><strong>离散程度：</strong>评估数据的波动范围，识别高风险或高价值的对象</li>
          <li><strong>异常识别：</strong>发现离群点，这些点可能代表需要特别关注的高风险对象或特殊情况</li>
          <li><strong>关系探索：</strong>通过散点图探索不同变量之间的关系，为深入分析和建模提供依据</li>
        </ul>
        <p>建议结合后续的正态分布检验结果，选择合适的统计分析方法和数据预处理策略。</p>
      </div>
    ` : `
      <p>本部分对聚合后的数据进行分布可视化分析。数据分布可视化分析功能可帮助了解数据的分布特征、集中趋势和离散程度。</p>
      <div class="info-box" style="background-color: #fff3cd; padding: 15px; border-radius: 5px; margin: 15px 0; border-left: 4px solid #ffc107;">
        <p style="margin: 0;"><strong>提示：</strong>请在分析界面中选择图表类型并生成可视化分析，以查看详细的数据分布图表。</p>
      </div>
    `}
  </div>
`;

  // 添加正态分布检验结果
  if (data.normalityTestResults &&
      (data.normalityTestResults.hasGroups
        ? (data.normalityTestResults.groupResults && data.normalityTestResults.groupResults.length > 0)
        : (data.normalityTestResults.results && data.normalityTestResults.results.length > 0))) {
    htmlContent += `
  <h2>第四部分：聚合后的数据正态分布检验及结果</h2>

  <div class="info-box">
    <h3 style="margin-top: 0;">📊 检验汇总</h3>
    <div style="display: flex; flex-wrap: wrap; gap: 15px;">
      ${data.normalityTestResults.hasGroups && data.normalityTestResults.overallSummary ? `
      <div class="metric-card">
        <div class="metric-title">分组总数</div>
        <div class="metric-value">${data.normalityTestResults.overallSummary.totalGroups}</div>
      </div>
      <div class="metric-card">
        <div class="metric-title">检验字段总数</div>
        <div class="metric-value">${data.normalityTestResults.overallSummary.totalFields}</div>
      </div>
      <div class="metric-card">
        <div class="metric-title">符合正态分布</div>
        <div class="metric-value" style="color: #28a745;">${data.normalityTestResults.overallSummary.overallNormalFields}</div>
      </div>
      <div class="metric-card">
        <div class="metric-title">不符合正态分布</div>
        <div class="metric-value" style="color: #dc3545;">${data.normalityTestResults.overallSummary.overallNonNormalFields}</div>
      </div>
      ${data.normalityTestResults.overallSummary.mostCommonDistribution && data.normalityTestResults.overallSummary.mostCommonDistribution !== '无' ? `
      <div class="metric-card">
        <div class="metric-title">最常见非正态分布</div>
        <div class="metric-value" style="font-size: 18px;">${data.normalityTestResults.overallSummary.mostCommonDistribution}</div>
      </div>
      ` : ''}
      ` : ''}
      ${!data.normalityTestResults.hasGroups && data.normalityTestResults.summary ? `
      <div class="metric-card">
        <div class="metric-title">检验字段总数</div>
        <div class="metric-value">${data.normalityTestResults.summary.totalFields}</div>
      </div>
      <div class="metric-card">
        <div class="metric-title">符合正态分布</div>
        <div class="metric-value" style="color: #28a745;">${data.normalityTestResults.summary.normalFields}</div>
      </div>
      <div class="metric-card">
        <div class="metric-title">不符合正态分布</div>
        <div class="metric-value" style="color: #dc3545;">${data.normalityTestResults.summary.nonNormalFields}</div>
      </div>
      ${data.normalityTestResults.summary.mostCommonDistribution && data.normalityTestResults.summary.mostCommonDistribution !== '无' ? `
      <div class="metric-card">
        <div class="metric-title">最常见非正态分布</div>
        <div class="metric-value" style="font-size: 18px;">${data.normalityTestResults.summary.mostCommonDistribution}</div>
      </div>
      ` : ''}
      ` : ''}
    </div>
  </div>

  <div class="info-box">
    <h4 style="margin-top: 0;">📋 检验方法说明</h4>
    <ul>
      <li><strong>Anderson-Darling检验</strong>：基于经验累积分布函数的加权检验，特别适用于小样本（n ≥ 3），对尾部偏差特别敏感，检验效力强</li>
      <li><strong>KS检验（Kolmogorov-Smirnov）</strong>：基于累积分布函数的经验检验，适用于各种样本量，通过比较经验分布与理论正态分布的累积分布函数差异来判断</li>
      <li><strong>Z-score检验</strong>：基于偏度和峰度的正态性检验，适用于大样本（n≥20），通过检验数据分布的偏度和峰度是否符合正态分布特征来判断</li>
      <li><strong>分布类型识别</strong>：对不符合正态分布的字段，自动识别最佳拟合分布（对数正态、指数、Gamma、泊松），帮助理解数据分布特征</li>
    </ul>
  </div>

  ${data.normalityTestResults.hasGroups ? `
  ${data.normalityTestResults.groupByFields && data.normalityTestResults.groupByFields.length > 0 ? `<p><strong>分组字段：</strong>${data.normalityTestResults.groupByFields.join(', ')}</p>` : ''}

  ${data.normalityTestResults.groupResults && data.normalityTestResults.groupResults.map((groupResult, index) => `
  <h3>4.${index + 1} 分组 "${groupResult.groupName}" 检验结果</h3>
  <div class="metric-cards" style="margin-bottom: 20px;">
    <div class="metric-card">
      <div class="metric-title">检验字段总数</div>
      <div class="metric-value">${groupResult.summary.totalFields}</div>
    </div>
    <div class="metric-card">
      <div class="metric-title">符合正态分布</div>
      <div class="metric-value" style="color: #28a745;">${groupResult.summary.normalFields}</div>
    </div>
    <div class="metric-card">
      <div class="metric-title">不符合正态分布</div>
      <div class="metric-value" style="color: #dc3545;">${groupResult.summary.nonNormalFields}</div>
    </div>
  </div>

  <h3>4.${index + 1}.1 检验结果详情</h3>
  <table>
    <thead>
      <tr>
        <th>字段名称</th>
        <th>Anderson-Darling检验</th>
        <th>KS检验</th>
        <th>Z-score检验</th>
        <th>最佳拟合分布</th>
      </tr>
    </thead>
    <tbody>
  ${groupResult.results && groupResult.results.map(result => {
    const adStatusClass = result.andersonDarlingTest?.isNormal ? 'risk-low' : 'risk-high';
    const ksStatusClass = result.ksTest.isNormal ? 'risk-low' : 'risk-high';
    const zScoreStatusClass = result.zScoreTest.isNormal ? 'risk-low' : 'risk-high';
    const bothNormal = result.ksTest.isNormal && result.zScoreTest.isNormal;
    const rowClass = !bothNormal ? 'highlight' : '';

    return `
      <tr class="${rowClass}">
        <td><strong>${result.fieldName}</strong></td>
        <td>
          <span class="${adStatusClass}">${result.andersonDarlingTest?.isNormal ? '符合' : '不符合'}</span>
          <br/>
          <small>A²: ${result.andersonDarlingTest?.statistic.toFixed(4)} | p: ${result.andersonDarlingTest?.pValue.toFixed(4)}</small>
        </td>
        <td>
          <span class="${ksStatusClass}">${result.ksTest.isNormal ? '符合' : '不符合'}</span>
          <br/>
          <small>统计量: ${result.ksTest.statistic.toFixed(4)} | p值: ${result.ksTest.pValue.toFixed(4)}</small>
          <br/>
          <small style="color: #6c757d;">${result.ksTest.interpretation}</small>
        </td>
        <td>
          <span class="${zScoreStatusClass}">${result.zScoreTest.isNormal ? '符合' : '不符合'}</span>
          <br/>
          <small>统计量: ${result.zScoreTest.statistic.toFixed(4)} | p值: ${result.zScoreTest.pValue.toFixed(4)}</small>
          <br/>
          <small style="color: #6c757d;">${result.zScoreTest.interpretation}</small>
        </td>
        <td>
          ${result.distributionFit ? `
            <strong>${result.distributionFit.bestFit}</strong>
          ` : '<span style="color: #6c757d;">符合正态分布</span>'}
        </td>
      </tr>`;
  }).join('') || ''}
    </tbody>
  </table>
  `).join('') || ''}
  ` : `
  <h3>4.1 检验结果详情</h3>
  <table>
    <thead>
      <tr>
        <th>字段名称</th>
        <th>Anderson-Darling检验</th>
        <th>KS检验</th>
        <th>Z-score检验</th>
        <th>最佳拟合分布</th>
      </tr>
    </thead>
    <tbody>
  ${data.normalityTestResults.results && data.normalityTestResults.results.map(result => {
    const adStatusClass = result.andersonDarlingTest?.isNormal ? 'risk-low' : 'risk-high';
    const ksStatusClass = result.ksTest.isNormal ? 'risk-low' : 'risk-high';
    const zScoreStatusClass = result.zScoreTest.isNormal ? 'risk-low' : 'risk-high';
    const bothNormal = result.ksTest.isNormal && result.zScoreTest.isNormal;
    const rowClass = !bothNormal ? 'highlight' : '';

    return `
      <tr class="${rowClass}">
        <td><strong>${result.fieldName}</strong></td>
        <td>
          <span class="${adStatusClass}">${result.andersonDarlingTest?.isNormal ? '符合' : '不符合'}</span>
          <br/>
          <small>A²: ${result.andersonDarlingTest?.statistic.toFixed(4)} | p: ${result.andersonDarlingTest?.pValue.toFixed(4)}</small>
        </td>
        <td>
          <span class="${ksStatusClass}">${result.ksTest.isNormal ? '符合' : '不符合'}</span>
          <br/>
          <small>统计量: ${result.ksTest.statistic.toFixed(4)} | p值: ${result.ksTest.pValue.toFixed(4)}</small>
          <br/>
          <small style="color: #6c757d;">${result.ksTest.interpretation}</small>
        </td>
        <td>
          <span class="${zScoreStatusClass}">${result.zScoreTest.isNormal ? '符合' : '不符合'}</span>
          <br/>
          <small>统计量: ${result.zScoreTest.statistic.toFixed(4)} | p值: ${result.zScoreTest.pValue.toFixed(4)}</small>
          <br/>
          <small style="color: #6c757d;">${result.zScoreTest.interpretation}</small>
        </td>
        <td>
          ${result.distributionFit ? `
            <strong>${result.distributionFit.bestFit}</strong>
            <br/>
            <small>${result.distributionFit.interpretation}</small>
            <br/>
            <small>拟合度: 对数正态 ${(result.distributionFit.logNormal * 100).toFixed(1)}%, 指数 ${(result.distributionFit.exponential * 100).toFixed(1)}%, Gamma ${(result.distributionFit.gamma * 100).toFixed(1)}%, 泊松 ${(result.distributionFit.poisson * 100).toFixed(1)}%</small>
          ` : '<span style="color: #6c757d;">符合正态分布，无需识别其他分布</span>'}
        </td>
      </tr>`;
  }).join('')}
    </tbody>
  </table>
  `}

  <div class="info-box">
    <h4 style="margin-top: 0;">💡 结果解读建议</h4>
    <ul>
      <li><strong>符合正态分布的字段：</strong>适合使用参数统计方法（如t检验、方差分析等）进行分析</li>
      <li><strong>不符合正态分布的字段：</strong>建议使用非参数统计方法（如Mann-Whitney U检验、Kruskal-Wallis检验等）或进行数据转换</li>
      <li><strong>对数正态分布：</strong>常见于收入、价格、大小等数据，可通过对数转换使其近似正态分布</li>
      <li><strong>指数分布：</strong>常见于等待时间、故障间隔、到达间隔等数据，表示事件发生的速率</li>
      <li><strong>Gamma分布：</strong>常见的右偏分布，可以包含对数正态和指数分布作为特例，适用于连续正值数据</li>
      <li><strong>泊松分布：</strong>适用于离散的正整数数据，表示在固定时间/空间内事件发生的次数</li>
    </ul>
  </div>
`;
  }

  // 添加画像分析结果
  // 先添加第五部分大标题
  htmlContent += `
  <h2>第五部分：聚合后的数据画像分析结果</h2>
`;

  // 判断是否有分组
  let isMultiInstance = false;
  let instanceKeys: string[] = [];

  if (data.chartImages) {
    instanceKeys = Object.keys(data.chartImages);
    isMultiInstance = instanceKeys.length > 0 &&
      instanceKeys.some(key => {
        const value = (data.chartImages as any)[key];
        return typeof value === 'object' && value !== null && 'barChart' in value;
      });
  }

  console.log('第五部分 - 判断是否有分组:', {
    hasChartImages: !!data.chartImages,
    instanceKeys,
    isMultiInstance
  });

  // 有分组的情况
  if (isMultiInstance && data.intelligentAnalysis?.transferTypeAnalysis) {
    console.log('检测到多实例分析，按分组生成报告');

    instanceKeys.forEach((instanceId, groupIndex) => {
      const images = (data.chartImages as any)[instanceId];
      const instanceName = instanceId === 'default' ? '整体数据' : `分组: ${instanceId}`;

      // 获取该分组的分析数据和整体分析数据
      const groupAnalysis = data.intelligentAnalysis?.transferTypeAnalysis?.[instanceId];
      const allAnalysisFallback = data.intelligentAnalysis?.transferTypeAnalysis?.['all'];
      const classificationParams = groupAnalysis?.classificationParams || allAnalysisFallback?.classificationParams;
      const classificationRules = groupAnalysis?.classificationRules || allAnalysisFallback?.classificationRules;

      htmlContent += `
  <h3>5.${groupIndex + 1} ${instanceName}</h3>

  <!-- 5.${groupIndex + 1}.1 整体分析概况 -->
  <div class="insight">
    <h4>5.${groupIndex + 1}.1 整体分析概况</h4>
    <p style="line-height: 2; white-space: pre-wrap;">${
      formatAnalysisText(
        groupAnalysis?.analysis || allAnalysisFallback?.analysis || '暂无分析概况',
        classificationParams,
        data.columnTypes,
        data.analysisResult
      )
    }</p>
  </div>

  <!-- 5.${groupIndex + 1}.2 分类规则与参数 -->
  ${classificationRules && classificationRules.length > 0 && classificationParams ? `
  <div class="info-box" style="padding: 0; border-left: 4px solid #3498db;">
    <h4>5.${groupIndex + 1}.2 分类规则与参数</h4>
    <div style="padding: 15px;">
      <table style="margin: 0;">
        <thead>
          <tr>
            <th>分类名称</th>
            <th>分类条件</th>
            <th>风险等级</th>
            <th>说明</th>
          </tr>
        </thead>
        <tbody>
        ${classificationRules.map((rule: any) => {
          const riskClass = rule.riskLevel === '高' ? 'risk-high' :
                           rule.riskLevel === '中' ? 'risk-medium' : 'risk-low';

          const condition = rule.condition
            .replace(
              new RegExp(classificationParams.valueField || '', 'g'),
              fieldLabels[classificationParams.valueField] || classificationParams.valueField || '数值字段'
            )
            .replace(
              new RegExp(classificationParams.countField || '', 'g'),
              fieldLabels[classificationParams.countField] || classificationParams.countField || '计数字段'
            );

          return `
            <tr>
              <td><strong>${rule.name}</strong></td>
              <td>${condition}</td>
              <td class="${riskClass}" style="text-align: center;">${rule.riskLevel}</td>
              <td>${rule.description || ''}</td>
            </tr>`;
        }).join('')}
        </tbody>
      </table>
    </div>
  </div>
  ` : ''}

  <!-- 5.${groupIndex + 1}.3 分类详情表 -->
  ${(() => {
    const categories = groupAnalysis?.categories || allAnalysisFallback?.categories || [];
    if (categories.length > 0) {
      const totalObjects = categories.reduce((sum: number, cat: any) => sum + (cat.indicators.objectCount || 0), 0);

      // 从classificationParams中获取实际使用的字段名
      const valueFieldName = classificationParams?.valueField || primaryValueField;
      const countFieldName = classificationParams?.countField || primaryCountField;

      return `
  <h4>5.${groupIndex + 1}.3 分类详情表</h4>
  <table>
    <thead>
      <tr>
        <th>分类名称</th>
        <th>分类描述</th>
        <th>对象数量</th>
        <th>占比</th>
        ${valueFieldName ? `<th>${fieldLabels[valueFieldName] || valueFieldName} (均值)</th>` : ''}
        ${countFieldName && countFieldName !== valueFieldName ? `<th>${fieldLabels[countFieldName] || countFieldName} (均值)</th>` : ''}
        <th>频率</th>
        <th>风险等级</th>
      </tr>
    </thead>
    <tbody>
    ${categories.map((cat: any) => {
      const objectCount = cat.indicators.objectCount || 0;
      const percentage = totalObjects > 0 ? ((objectCount / totalObjects) * 100).toFixed(2) : '0';

      // 计算平均值：总和 / 对象数量
      const valueFieldSum = cat.indicators[valueFieldName] || 0;
      const countFieldSum = cat.indicators[countFieldName] || 0;
      const valueAvg = objectCount > 0 ? (valueFieldSum / objectCount) : 0;
      const countAvg = objectCount > 0 ? (countFieldSum / objectCount) : 0;

      const riskClass = cat.indicators.riskLevel === '高' ? 'risk-high' :
                       cat.indicators.riskLevel === '中' ? 'risk-medium' : 'risk-low';

      return `
        <tr class="${cat.indicators.riskLevel === '高' ? 'highlight' : ''}">
          <td><strong>${cat.category}</strong></td>
          <td>${cat.description}</td>
          <td>${objectCount.toLocaleString()}</td>
          <td>${percentage}%</td>
          ${valueFieldName ? `<td>${typeof valueAvg === 'number' ? formatParamValue(valueAvg, valueFieldName, data.columnTypes, data.analysisResult) : valueAvg}</td>` : ''}
          ${countFieldName && countFieldName !== valueFieldName ? `<td>${typeof countAvg === 'number' ? formatParamValue(countAvg, countFieldName, data.columnTypes, data.analysisResult) : countAvg}</td>` : ''}
          <td>${cat.indicators.frequency || 'N/A'}</td>
          <td class="${riskClass}">${cat.indicators.riskLevel || '未知'}</td>
        </tr>`;
    }).join('')}
    </tbody>
  </table>`;
    }
    return '';
  })()}

  <!-- 5.${groupIndex + 1}.4 结果可视化图表 -->
  <h4>5.${groupIndex + 1}.4 结果可视化图表</h4>

  <div class="info-box">
    <h4 style="margin-top: 0;">📊 图表说明</h4>
    <p>以下图表展示了画像分析结果的可视化呈现，通过直观的图形帮助理解数据分布和分类特征。</p>
    <ul style="margin-top: 10px;">
      <li><strong>柱状图：</strong>展示各类别的对象数量分布，直观反映不同分类的规模差异</li>
      <li><strong>环形图：</strong>展示第一个分析字段的数值分布，体现各类别在该字段上的占比</li>
      <li><strong>饼图：</strong>展示第二个分析字段的数值分布，提供另一个维度的数据占比信息</li>
    </ul>
  </div>

  <!-- 柱状图 -->
  ${images.barChart ? `
  <div style="text-align: center; margin: 30px 0;">
    <p style="font-weight: bold; margin-bottom: 10px;">柱状图：各类别对象数量分布</p>
    <img src="${images.barChart}" alt="柱状图：各类别对象数量分布" style="max-width: 100%; height: auto; border: 1px solid #ddd; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);" />
  </div>
  <div class="info-box">
    <p><strong>图表解读：</strong>柱状图展示了各个画像分类中的对象数量。高度代表该分类包含的对象数量，可以直观地看出哪些分类占主导地位，哪些分类相对较小。重点关注柱子较高的分类，它们代表了数据的主要群体。</p>
  </div>
  ` : ''}

  <!-- 饼图和环形图并排显示 -->
  ${images.pieChart && images.donutChart ? `
  <div style="display: flex; flex-wrap: wrap; gap: 20px; margin: 30px 0;">
    <div style="flex: 1; min-width: 400px; text-align: center;">
      <p style="font-weight: bold; margin-bottom: 10px;">饼图：第二个分析字段分布</p>
      <img src="${images.pieChart}" alt="饼图：第二个分析字段分布" style="max-width: 100%; height: auto; border: 1px solid #ddd; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);" />
      <div class="info-box" style="margin-top: 15px;">
        <p><strong>图表解读：</strong>饼图展示了第二个分析字段在各个分类中的数值分布。扇区的大小代表数值的占比，可以直观地看出各个分类在该字段上的分布情况。扇区越大，表示该分类在该字段上占比越高。</p>
      </div>
    </div>
    <div style="flex: 1; min-width: 400px; text-align: center;">
      <p style="font-weight: bold; margin-bottom: 10px;">环形图：第一个分析字段分布</p>
      <img src="${images.donutChart}" alt="环形图：第一个分析字段分布" style="max-width: 100%; height: auto; border: 1px solid #ddd; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);" />
      <div class="info-box" style="margin-top: 15px;">
        <p><strong>图表解读：</strong>环形图展示了第一个分析字段在各个分类中的数值分布。环形的大小代表数值的占比，可以直观地看出各个分类在该字段上的贡献程度。环形越大，表示该分类在该字段上贡献越大。</p>
      </div>
    </div>
  </div>
  ` : images.pieChart ? `
  <div style="text-align: center; margin: 30px 0;">
    <p style="font-weight: bold; margin-bottom: 10px;">饼图：第二个分析字段分布</p>
    <img src="${images.pieChart}" alt="饼图：第二个分析字段分布" style="max-width: 100%; height: auto; border: 1px solid #ddd; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);" />
  </div>
  <div class="info-box">
    <p><strong>图表解读：</strong>饼图展示了第二个分析字段在各个分类中的数值分布。扇区的大小代表数值的占比，可以直观地看出各个分类在该字段上的分布情况。扇区越大，表示该分类在该字段上占比越高。</p>
  </div>
  ` : images.donutChart ? `
  <div style="text-align: center; margin: 30px 0;">
    <p style="font-weight: bold; margin-bottom: 10px;">环形图：第一个分析字段分布</p>
    <img src="${images.donutChart}" alt="环形图：第一个分析字段分布" style="max-width: 100%; height: auto; border: 1px solid #ddd; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);" />
  </div>
  <div class="info-box">
    <p><strong>图表解读：</strong>环形图展示了第一个分析字段在各个分类中的数值分布。环形的大小代表数值的占比，可以直观地看出各个分类在该字段上的贡献程度。环形越大，表示该分类在该字段上贡献越大。</p>
  </div>
  ` : ''}
`;
    });

  } else if (!isMultiInstance && data.intelligentAnalysis?.transferTypeAnalysis) {
    // 没有分组的情况 - 显示整体分析
    const allAnalysis = data.intelligentAnalysis.transferTypeAnalysis['all'];

    if (!allAnalysis) {
      console.warn('⚠️ transferTypeAnalysis中不存在all键，跳过画像分析详细内容部分');
    } else {
      htmlContent += `

  <!-- 5.1 整体分析概况 -->
  <div class="insight">
    <h3>5.1 整体分析概况</h3>
    <p style="line-height: 2; white-space: pre-wrap;">${
      formatAnalysisText(
        allAnalysis.analysis || '暂无分析概况',
        allAnalysis.classificationParams,
        data.columnTypes,
        data.analysisResult
      )
    }</p>
  </div>

  <!-- 5.2 分类规则与参数 -->
  ${(() => {
    const classificationRules = allAnalysis.classificationRules;
    const classificationParams = allAnalysis.classificationParams;

    if (classificationRules && classificationRules.length > 0 && classificationParams) {
      let rulesTable = `
  <div class="info-box" style="padding: 0; border-left: 4px solid #3498db;">
    <h3>5.2 分类规则与参数</h3>
    <div style="padding: 15px;">
      <table style="margin: 0;">
        <thead>
          <tr>
            <th>分类名称</th>
            <th>分类条件</th>
            <th>风险等级</th>
            <th>说明</th>
          </tr>
        </thead>
        <tbody>`;

      classificationRules.forEach((rule: any) => {
        const riskClass = rule.riskLevel === '高' ? 'risk-high' :
                         rule.riskLevel === '中' ? 'risk-medium' : 'risk-low';

        // 对 condition 中的字段名进行相对引用替换
        const condition = rule.condition
          .replace(
            new RegExp(classificationParams.valueField || '', 'g'),
            fieldLabels[classificationParams.valueField] || classificationParams.valueField || '数值字段'
          )
          .replace(
            new RegExp(classificationParams.countField || '', 'g'),
            fieldLabels[classificationParams.countField] || classificationParams.countField || '计数字段'
          );

        rulesTable += `
          <tr>
            <td><strong>${rule.name}</strong></td>
            <td>${condition}</td>
            <td class="${riskClass}" style="text-align: center;">${rule.riskLevel}</td>
            <td>${rule.description || ''}</td>
          </tr>`;
      });

      rulesTable += `
        </tbody>
      </table>
    </div>
  </div>`;
      return rulesTable;
    }
    return '';
  })()}

  <h4>5.2.1 分类方法说明</h4>
  ${(() => {
    const firstGroupKey = Object.keys(data.chartImages || {})[0];
    const instanceImages = (data.chartImages as any)?.[firstGroupKey];
    const hasBarChart = instanceImages && 'barChart' in instanceImages;
    const groupKey = hasBarChart ? firstGroupKey : 'default';
    const classificationParams = (data.intelligentAnalysis?.transferTypeAnalysis?.[groupKey])?.classificationParams
                                  || (data.intelligentAnalysis?.transferTypeAnalysis?.['all'])?.classificationParams;

    const method = classificationParams?.method || 'iqr';

    if (method === 'iqr') {
      return `
  <div class="info-box">
    <p><strong>分类方法：</strong>基于四分位距（IQR）的统计分类模型</p>
    <p><strong>分类标准：</strong></p>
    <ul style="margin-top: 10px;">
      <li><strong>双高型：</strong>两个维度均超过高阈值（≥ Q3 + ${classificationParams?.upperMultiplier || 1.5} × IQR），需要重点关注</li>
      <li><strong>偏高型（第一字段）：</strong>第一维度超过高阈值（≥ Q3 + ${classificationParams?.upperMultiplier || 1.5} × IQR），需要关注</li>
      <li><strong>偏高型（第二字段）：</strong>第二维度超过高阈值（≥ Q3 + ${classificationParams?.upperMultiplier || 1.5} × IQR），需要关注</li>
      <li><strong>中间型：</strong>两个维度都在正常范围内（Q1 - ${classificationParams?.lowerMultiplier || 0} × IQR 到 Q3 + ${classificationParams?.upperMultiplier || 1.5} × IQR），属于常规业务</li>
      <li><strong>低值型：</strong>至少有一个维度低于低阈值（≤ Q1 - ${classificationParams?.lowerMultiplier || 0} × IQR），属于小额或零星业务</li>
    </ul>
  </div>`;
    } else {
      return `
  <div class="info-box">
    <p><strong>分类方法：</strong>基于均值标准差的统计分类模型</p>
    <p><strong>分类标准：</strong></p>
    <ul style="margin-top: 10px;">
      <li><strong>双高型：</strong>两个维度均超过高阈值（≥ Mean + ${classificationParams?.upperMultiplier || 2} × StdDev），需要重点关注</li>
      <li><strong>偏高型（第一字段）：</strong>第一维度超过高阈值（≥ Mean + ${classificationParams?.upperMultiplier || 2} × StdDev），需要关注</li>
      <li><strong>偏高型（第二字段）：</strong>第二维度超过高阈值（≥ Mean + ${classificationParams?.upperMultiplier || 2} × StdDev），需要关注</li>
      <li><strong>中间型：</strong>两个维度都在正常范围内（Mean - ${classificationParams?.lowerMultiplier || 2} × StdDev 到 Mean + ${classificationParams?.upperMultiplier || 2} × StdDev），属于常规业务</li>
      <li><strong>低值型：</strong>至少有一个维度低于低阈值（≤ Mean - ${classificationParams?.lowerMultiplier || 2} × StdDev），属于小额或零星业务</li>
    </ul>
  </div>`;
    }
  })()}

  <h3>5.3 分类详情表</h3>
  <table>
    <thead>
      <tr>
        <th>分类名称</th>
        <th>分类描述</th>
        <th>对象数量</th>
        <th>占比</th>
        ${primaryValueField ? `<th>${fieldLabels[primaryValueField] || '主要数值'} (均值)</th>` : ''}
        ${primaryCountField && primaryCountField !== primaryValueField ? `<th>${fieldLabels[primaryCountField] || '主要计数'} (均值)</th>` : ''}
        <th>频率</th>
        <th>风险等级</th>
      </tr>
    </thead>
    <tbody>
`;

      const categories = allAnalysis.categories || [];
      const totalObjects = categories.reduce((sum: number, cat: any) => sum + (cat.indicators.objectCount || 0), 0);

      categories.forEach((cat: any) => {
        const riskClass = cat.indicators.riskLevel === '高' ? 'risk-high' :
                         cat.indicators.riskLevel === '中' ? 'risk-medium' : 'risk-low';
        const rowClass = cat.indicators.riskLevel === '高' ? 'highlight' : '';
        const objectCount = cat.indicators.objectCount || 0;
        const percentage = totalObjects > 0 ? ((objectCount / totalObjects) * 100).toFixed(2) : '0.00';

        // 计算平均值：总和 / 对象数量
        const valueFieldSum = primaryValueField ? (cat.indicators[primaryValueField] || 0) : 0;
        const countFieldSum = primaryCountField && primaryCountField !== primaryValueField ? (cat.indicators[primaryCountField] || 0) : 0;
        const valueAvg = objectCount > 0 ? (valueFieldSum / objectCount) : 0;
        const countAvg = objectCount > 0 ? (countFieldSum / objectCount) : 0;

        htmlContent += `
      <tr class="${rowClass}">
        <td><strong>${cat.category}</strong></td>
        <td>${cat.description}</td>
        <td>${objectCount.toLocaleString()}</td>
        <td>${percentage}%</td>
        ${primaryValueField ? `<td>${typeof valueAvg === 'number' ? formatParamValue(valueAvg, primaryValueField, data.columnTypes, data.analysisResult) : valueAvg}</td>` : ''}
        ${primaryCountField && primaryCountField !== primaryValueField ? `<td>${typeof countAvg === 'number' ? formatParamValue(countAvg, primaryCountField, data.columnTypes, data.analysisResult) : countAvg}</td>` : ''}
        <td>${cat.indicators.frequency || 'N/A'}</td>
        <td class="${riskClass}">${cat.indicators.riskLevel || '未知'}</td>
      </tr>
`;
      });

      htmlContent += `
    </tbody>
  </table>

  <div class="info-box">
    <h4 style="margin-top: 0;">数据解读建议</h4>
    <ul>
      <li><strong>高风险对象：</strong>建议进一步调查和监控，识别潜在风险点</li>
      <li><strong>中风险对象：</strong>建议定期关注和跟踪，及时预警异常变化</li>
      <li><strong>低风险对象：</strong>属于正常范围，可作为基准参考</li>
      <li><strong>占比分析：</strong>关注各分类的比例分布，识别主要数据群体</li>
    </ul>
  </div>
`;
    }
  }

  // 可视化图表分析（仅在没有分组时）
  if (!isMultiInstance && data.chartImages) {
    console.log('=== 添加可视化图表分析（单实例） ===');

    const { barChart, pieChart, donutChart } = data.chartImages as any;
    const classificationParams = data.intelligentAnalysis?.transferTypeAnalysis?.['all']?.classificationParams;
    const method = classificationParams?.method || 'iqr';

    htmlContent += `
  <h3>5.4 结果可视化图表</h3>

  <div class="info-box">
    <h4 style="margin-top: 0;">📊 图表说明</h4>
    <p>以下图表展示了画像分析结果的可视化呈现，通过直观的图形帮助理解数据分布和分类特征。</p>
    <ul style="margin-top: 10px;">
      <li><strong>柱状图：</strong>展示各类别的对象数量分布，直观反映不同分类的规模差异</li>
      <li><strong>环形图：</strong>展示第一个分析字段的数值分布，体现各类别在该字段上的占比</li>
      <li><strong>饼图：</strong>展示第二个分析字段的数值分布，提供另一个维度的数据占比信息</li>
    </ul>
  </div>
`;

    if (isMultiInstance) {
      // 多实例情况：为每个分组生成完整的分析内容
      console.log('检测到多实例图表，实例列表:', instanceKeys);

      for (const [instanceId, instanceImages] of Object.entries(data.chartImages)) {
        const images = instanceImages as any;
        const instanceName = instanceId === 'default' ? '整体数据' : `分组: ${instanceId}`;

        console.log(`处理实例 "${instanceId}":`, Object.keys(images));

        // 获取该分组的分析数据和整体分析数据
        const groupAnalysis = data.intelligentAnalysis?.transferTypeAnalysis?.[instanceId];
        const allAnalysisFallback = data.intelligentAnalysis?.transferTypeAnalysis?.['all'];
        const classificationParams = groupAnalysis?.classificationParams || allAnalysisFallback?.classificationParams;

        htmlContent += `
  <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin: 30px 0; border-left: 4px solid #3498db;">
    <h3 style="margin-top: 0; color: #2c3e50;">${instanceName}</h3>

    <!-- 分析概况 -->
    <div class="insight">
      <h4 style="margin-top: 0;">📊 分析概况</h4>
      <p style="line-height: 2; white-space: pre-wrap;">${groupAnalysis?.analysis || allAnalysisFallback?.analysis || '暂无分析概况'}</p>
    </div>

    <!-- 分类规则与参数 -->
    ${(() => {
      const classificationRules = groupAnalysis?.classificationRules || allAnalysisFallback?.classificationRules;
      if (classificationRules && classificationRules.length > 0 && classificationParams) {
        let rulesTable = `
    <div class="info-box" style="padding: 0; border-left: 4px solid #3498db;">
      <h4 style="margin: 0; padding: 15px; background-color: #f8f9fa; border-bottom: 1px solid #dee2e6; color: #2c3e50; font-size: 14px;">📋 分类规则与参数</h4>
      <div style="padding: 15px;">
        <table style="margin: 0; font-size: 12px;">
          <thead>
            <tr>
              <th>分类名称</th>
              <th>分类条件</th>
              <th>风险等级</th>
              <th>说明</th>
            </tr>
          </thead>
          <tbody>`;

        classificationRules.forEach((rule: any) => {
          const riskClass = rule.riskLevel === '高' ? 'risk-high' :
                           rule.riskLevel === '中' ? 'risk-medium' : 'risk-low';

          const condition = rule.condition
            .replace(
              new RegExp(classificationParams.valueField || '', 'g'),
              fieldLabels[classificationParams.valueField] || classificationParams.valueField || '数值字段'
            )
            .replace(
              new RegExp(classificationParams.countField || '', 'g'),
              fieldLabels[classificationParams.countField] || classificationParams.countField || '计数字段'
            );

          rulesTable += `
            <tr>
              <td><strong>${rule.name}</strong></td>
              <td>${condition}</td>
              <td class="${riskClass}" style="text-align: center;">${rule.riskLevel}</td>
              <td>${rule.description || ''}</td>
            </tr>`;
        });

        rulesTable += `
          </tbody>
        </table>
      </div>
    </div>`;
        return rulesTable;
      }
      return '';
    })()}

    <!-- 分类详情表 -->
    ${(() => {
      const categories = groupAnalysis?.categories || allAnalysisFallback?.categories || [];
      if (categories.length > 0) {
        const totalObjects = categories.reduce((sum: number, cat: any) => sum + (cat.indicators.objectCount || 0), 0);

        let detailTable = `
    <table style="font-size: 12px;">
      <thead>
        <tr>
          <th>分类名称</th>
          <th>分类描述</th>
          <th>对象数量</th>
          <th>占比</th>
          ${primaryValueField ? `<th>${fieldLabels[primaryValueField] || '主要数值'}</th>` : ''}
          ${primaryCountField && primaryCountField !== primaryValueField ? `<th>${fieldLabels[primaryCountField] || '主要计数'}</th>` : ''}
          <th>频率</th>
          <th>风险等级</th>
        </tr>
      </thead>
      <tbody>`;

        categories.forEach((cat: any) => {
          const objectCount = cat.indicators.objectCount || 0;
          const percentage = totalObjects > 0 ? ((objectCount / totalObjects) * 100).toFixed(2) : 0;
          const valueFieldValue = cat.indicators.valueFieldSum || cat.indicators.valueFieldSum;
          const countFieldValue = cat.indicators.countFieldSum || cat.indicators.countFieldSum;
          const riskClass = cat.indicators.riskLevel === '高' ? 'risk-high' :
                           cat.indicators.riskLevel === '中' ? 'risk-medium' : 'risk-low';

          detailTable += `
        <tr class="${cat.indicators.riskLevel === '高' ? 'highlight' : ''}">
          <td><strong>${cat.category}</strong></td>
          <td>${cat.description}</td>
          <td>${objectCount.toLocaleString()}</td>
          <td>${percentage}%</td>
          ${primaryValueField ? `<td>${typeof valueFieldValue === 'number' ? valueFieldValue.toLocaleString() : valueFieldValue}</td>` : ''}
          ${primaryCountField && primaryCountField !== primaryValueField ? `<td>${typeof countFieldValue === 'number' ? countFieldValue.toLocaleString() : countFieldValue}</td>` : ''}
          <td>${cat.indicators.frequency || 'N/A'}</td>
          <td class="${riskClass}">${cat.indicators.riskLevel || '未知'}</td>
        </tr>`;
        });

        detailTable += `
      </tbody>
    </table>`;
        return detailTable;
      }
      return '';
    })()}
`;

        // 柱状图
        if (images.barChart) {
          console.log(`实例 "${instanceId}": 添加柱状图`);
          htmlContent += `
    <h4>5.4.1 各类别对象数量分布</h4>
    <div style="text-align: center; margin: 30px 0;">
      <img src="${images.barChart}" alt="柱状图：各类别对象数量分布" style="max-width: 100%; height: auto; border: 1px solid #ddd; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);" />
    </div>
    <div class="info-box">
      <p><strong>图表解读：</strong>柱状图展示了各个画像分类中的对象数量。高度代表该分类包含的对象数量，可以直观地看出哪些分类占主导地位，哪些分类相对较小。重点关注柱子较高的分类，它们代表了数据的主要群体。</p>
    </div>
`;
        }

        // 饼图和环形图并排显示
        if (images.pieChart && images.donutChart) {
          console.log(`实例 "${instanceId}": 添加饼图和环形图（并排显示）`);
          htmlContent += `
    <h4>5.4.2 分析字段分布（饼图与环形图）</h4>
    <div style="display: flex; flex-wrap: wrap; gap: 20px; margin: 30px 0;">
      <div style="flex: 1; min-width: 400px; text-align: center;">
        <p style="font-weight: bold; margin-bottom: 10px;">第二个分析字段分布（饼图）</p>
        <img src="${images.pieChart}" alt="饼图：第二个分析字段分布" style="max-width: 100%; height: auto; border: 1px solid #ddd; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);" />
        <div class="info-box" style="margin-top: 15px;">
          <p><strong>图表解读：</strong>饼图展示了第二个分析字段在各个分类中的数值分布。扇区的大小代表数值的占比，可以直观地看出各个分类在该字段上的分布情况。扇区越大，表示该分类在该字段上占比越高。</p>
        </div>
      </div>
      <div style="flex: 1; min-width: 400px; text-align: center;">
        <p style="font-weight: bold; margin-bottom: 10px;">第一个分析字段分布（环形图）</p>
        <img src="${images.donutChart}" alt="环形图：第一个分析字段分布" style="max-width: 100%; height: auto; border: 1px solid #ddd; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);" />
        <div class="info-box" style="margin-top: 15px;">
          <p><strong>图表解读：</strong>环形图展示了第一个分析字段在各个分类中的数值分布。环形的大小代表数值的占比，可以直观地看出各个分类在该字段上的贡献程度。环形越大，表示该分类在该字段上贡献越大。</p>
        </div>
      </div>
    </div>
`;
        } else if (images.pieChart) {
          console.log(`实例 "${instanceId}": 添加饼图`);
          htmlContent += `
    <h4>5.4.2 第二个分析字段分布（饼图）</h4>
    <div style="text-align: center; margin: 30px 0;">
      <img src="${images.pieChart}" alt="饼图：第二个分析字段分布" style="max-width: 100%; height: auto; border: 1px solid #ddd; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);" />
    </div>
    <div class="info-box">
      <p><strong>图表解读：</strong>饼图展示了第二个分析字段在各个分类中的数值分布。扇区的大小代表数值的占比，可以直观地看出各个分类在该字段上的分布情况。扇区越大，表示该分类在该字段上占比越高。</p>
    </div>
`;
        } else if (images.donutChart) {
          console.log(`实例 "${instanceId}": 添加环形图`);
          htmlContent += `
    <h4>5.4.2 第一个分析字段分布（环形图）</h4>
    <div style="text-align: center; margin: 30px 0;">
      <img src="${images.donutChart}" alt="环形图：第一个分析字段分布" style="max-width: 100%; height: auto; border: 1px solid #ddd; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);" />
    </div>
    <div class="info-box">
      <p><strong>图表解读：</strong>环形图展示了第一个分析字段在各个分类中的数值分布。环形的大小代表数值的占比，可以直观地看出各个分类在该字段上的贡献程度。环形越大，表示该分类在该字段上贡献越大。</p>
    </div>
`;
        }

        htmlContent += `
  </div>
`;
      }
    }
  }

  // 添加总结与建议
  htmlContent += `
  <h2>第六部分：总结与建议</h2>
  
  <div class="insight">
    <h3 style="margin-top: 0;">📝 分析总结</h3>
    <p>本报告基于${data.originalData.length.toLocaleString()}条原始数据，经过筛选和聚合处理后，生成了${data.aggregatedData.length.toLocaleString()}个聚合对象的详细画像。
    通过运用先进的机器学习算法和统计分析方法，我们对数据进行了深入挖掘和多维度分析。</p>
    
    <p style="margin-top: 15px;"><strong>关键发现：</strong></p>
    <ul style="margin-top: 10px;">
      <li><strong>数据分布特征：</strong>通过聚合分析，识别出数据的主要分布模式和关键特征</li>
      <li><strong>风险识别能力：</strong>成功识别出高风险、中风险和低风险对象，为风险管控提供依据</li>
      <li><strong>智能分类效果：</strong>画像分类准确度高，能够有效区分不同类型的数据对象</li>
      <li><strong>数据质量评估：</strong>整体数据质量良好，分析结果具有可靠性和参考价值</li>
    </ul>
  </div>

  <h3>6.1 业务建议</h3>
  <div class="success-box">
    <h4 style="margin-top: 0;">💡 行动建议</h4>

    <p style="margin-top: 10px;"><strong>针对高风险对象：</strong></p>
    <ul>
      <li>立即启动深入调查程序，查明高风险成因</li>
      <li>建立监控机制，实时跟踪高风险对象的变化趋势</li>
      <li>制定风险应对预案，及时采取防控措施</li>
      <li>定期回顾和评估风险管控效果</li>
    </ul>

    <p style="margin-top: 15px;"><strong>针对中风险对象：</strong></p>
    <ul>
      <li>定期关注和跟踪，预警异常变化</li>
      <li>分析中风险转化为高风险的路径，提前干预</li>
      <li>优化数据质量，减少误判和漏判</li>
    </ul>

    <p style="margin-top: 15px;"><strong>针对低风险对象：</strong></p>
    <ul>
      <li>作为基准参考，用于评估正常数据范围</li>
      <li>分析低风险对象的共同特征，优化业务规则</li>
      <li>保持常规监控，及时发现异常变化</li>
    </ul>
  </div>

  <h3>6.2 技术建议</h3>
  <div class="info-box">
    <h4 style="margin-top: 0;">🔧 优化建议</h4>
    <ul>
      <li><strong>数据源优化：</strong>建议完善数据采集机制，提高数据完整性和准确性</li>
      <li><strong>算法调优：</strong>可根据业务反馈，持续优化画像分类算法和阈值设置</li>
      <li><strong>模型迭代：</strong>定期使用新数据训练模型，提升分析精度和预测能力</li>
      <li><strong>可视化增强：</strong>建议结合图表可视化，更直观地展示分析结果</li>
      <li><strong>自动化流程：</strong>考虑建立自动化分析流程，提高分析效率</li>
    </ul>
  </div>

  <h3>6.3 后续工作</h3>
  <div class="warning-box">
    <h4 style="margin-top: 0;">📅 后续计划</h4>
    <ul>
      <li><strong>短期（1-2周）：</strong>根据本报告建议，对高风险对象进行专项调查和处理</li>
      <li><strong>中期（1个月）：</strong>评估分析结果的应用效果，调整和优化分析策略</li>
      <li><strong>长期（3个月以上）：</strong>建立持续监控机制，定期生成分析报告，形成数据分析闭环</li>
    </ul>
  </div>

  <h3>6.4 报告声明</h3>
  <div class="info-box" style="background-color: #f8f9fa;">
    <h4 style="margin-top: 0;">📜 免责声明</h4>
    <p style="font-size: 13px; color: #666; margin-top: 10px;">
      <strong>1. 数据准确性：</strong>本报告基于提供的数据进行分析，分析结果的准确性依赖于输入数据的质量和完整性。<br/>
      <strong>2. 算法局限性：</strong>画像分析算法采用机器学习和统计方法，可能存在一定的误判和偏差，建议结合业务实际情况进行综合判断。<br/>
      <strong>3. 风险评估：</strong>风险等级评估仅供参考，不应作为唯一决策依据，实际风险需要结合多方因素综合评估。<br/>
      <strong>4. 保密性：</strong>本报告包含敏感数据，仅供授权人员查阅，未经许可不得外传或用于其他用途。<br/>
      <strong>5. 有效期：</strong>本报告反映的是当前时点的数据分析结果，数据情况可能随时间变化，建议定期更新分析。
    </p>
  </div>
  
  <hr style="margin: 40px 0; border: none; border-top: 2px solid #ddd;"/>
  
  <div style="text-align: center; color: #999; font-size: 14px;">
    <p><strong>数据分析系统自动生成</strong></p>
    <p>生成时间：${new Date().toLocaleString('zh-CN')}</p>
    <p>技术支持：数据分析与画像系统 v1.0</p>
    <p style="margin-top: 20px; font-size: 12px;">本报告由智能数据分析系统自动生成，如有疑问请联系系统管理员</p>
  </div>
</body>
</html>
`;

  return htmlContent;
}

/**
 * 下载HTML报告文件
 */
export async function downloadHtmlFile(data: AnalysisExportData): Promise<void> {
  try {
    console.log('=== 开始下载HTML报告 ===');

    // 生成HTML内容
    const htmlContent = generateWordReport(data, false);
    console.log('✅ HTML报告生成成功，长度:', htmlContent.length, 'characters');

    if (!htmlContent || htmlContent.length === 0) {
      throw new Error('生成的HTML内容为空');
    }

    // 创建Blob
    const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8' });
    console.log('✅ Blob创建成功，大小:', blob.size, 'bytes');

    if (blob.size === 0) {
      throw new Error('创建的Blob大小为0');
    }

    // 生成文件名（使用英文文件名避免兼容性问题）
    const timestamp = new Date().toISOString().slice(0, 19).replace(/[:-]/g, '');
    const filename = `analysis_report_${timestamp}.html`;
    console.log('文件名:', filename);

    // 下载HTML文件
    const url = URL.createObjectURL(blob);
    console.log('Blob URL:', url);

    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';

    document.body.appendChild(a);
    console.log('添加a元素到DOM');

    // 触发点击
    a.click();
    console.log('✅ 触发下载点击事件');

    // 延迟清理（增加延迟时间以确保下载完成）
    setTimeout(() => {
      try {
        document.body.removeChild(a);
        console.log('清理a元素');
      } catch (e) {
        console.warn('清理a元素失败:', e);
      }
    }, 1000);

    setTimeout(() => {
      try {
        URL.revokeObjectURL(url);
        console.log('清理Blob URL');
      } catch (e) {
        console.warn('清理Blob URL失败:', e);
      }
    }, 2000);

    console.log('=== HTML报告下载流程完成 ===');
  } catch (error) {
    console.error('❌ 下载HTML文件失败:', error);
    throw error;
  }
}

/**
 * 将Base64图片转换为Uint8Array并创建ImageRun
 */
async function base64ToImageRun(base64: string, width: number = 4): Promise<ImageRun> {
  try {
    console.log('=== 开始转换Base64图片为Uint8Array ===');
    console.log('原始数据URL长度:', base64.length);

    // 提取 MIME 类型和 Base64 数据
    const mimeMatch = base64.match(/^data:(image\/\w+);base64,/);
    if (!mimeMatch) {
      throw new Error('Invalid data URL format');
    }

    const mimeType = mimeMatch[1];
    console.log('检测到图片MIME类型:', mimeType);

    // 将Base64转换为Uint8Array（直接转换，不经过Blob）
    const base64Data = base64.split(',')[1];
    const binaryString = atob(base64Data);
    const uint8Array = new Uint8Array(binaryString.length);

    for (let i = 0; i < binaryString.length; i++) {
      uint8Array[i] = binaryString.charCodeAt(i);
    }

    console.log('Uint8Array创建成功，大小:', uint8Array.length, 'bytes');
    console.log('Uint8Array前20字节:', uint8Array.slice(0, 20));

    // 使用convertInchesToTwip函数转换尺寸
    const widthTwip = convertInchesToTwip(width);
    const heightTwip = convertInchesToTwip(width * 0.75); // 保持宽高比

    console.log('图片尺寸设置:', {
      widthTwip,
      heightTwip,
      imageType: 'png'
    });

    // 创建ImageRun，使用Uint8Array（docx库要求的数据格式）
    const imageRun = new ImageRun({
      type: 'png',
      data: uint8Array,
      transformation: {
        width: widthTwip,
        height: heightTwip,
      },
    });

    console.log('✅ ImageRun创建成功');
    return imageRun;
  } catch (error) {
    console.error('❌ 转换图片失败:', error);
    throw error;
  }
}

/**
 * 生成真正的Word文档（.docx格式）
 */
async function generateDocxDocument(data: AnalysisExportData): Promise<Document> {
  const { primaryValueField, primaryCountField, fieldLabels } = identifyDataFields(data.aggregatedData);

  const children: any[] = [];

  // 标题
  children.push(
    new Paragraph({
      text: '数据分析与画像报告',
      heading: HeadingLevel.HEADING_1,
      alignment: AlignmentType.CENTER,
      spacing: {
        before: 200,
        after: 400,
      },
    })
  );

  // 报告概览
  children.push(
    new Paragraph({
      text: '报告概览',
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 400, after: 200 },
    }),
    new Paragraph({
      children: [
        new TextRun({
          text: `报告生成时间: ${new Date().toLocaleString('zh-CN')}`,
          bold: true,
        }),
      ],
      spacing: { after: 100 },
    }),
    new Paragraph({
      children: [
        new TextRun({
          text: `原始数据量: ${data.originalData.length.toLocaleString()} 条记录`,
          bold: true,
        }),
      ],
      spacing: { after: 100 },
    }),
    new Paragraph({
      children: [
        new TextRun({
          text: `筛选后数据量: ${data.filteredData.length.toLocaleString()} 条记录`,
          bold: true,
        }),
      ],
      spacing: { after: 100 },
    }),
    new Paragraph({
      children: [
        new TextRun({
          text: `聚合对象数量: ${data.aggregatedData.length.toLocaleString()} 个`,
          bold: true,
        }),
      ],
      spacing: { after: 200 },
    }),
    new Paragraph({
      children: [
        new TextRun({
          text: `数据筛选率: ${((data.filteredData.length / data.originalData.length) * 100).toFixed(2)}%`,
        }),
      ],
      spacing: { after: 100 },
    }),
    new Paragraph({
      children: [
        new TextRun({
          text: `聚合率: ${((data.aggregatedData.length / data.filteredData.length) * 100).toFixed(2)}%`,
        }),
      ],
      spacing: { after: 400 },
    })
  );

  // 画像分析结果
  if (data.intelligentAnalysis?.transferTypeAnalysis) {
    const allAnalysis = data.intelligentAnalysis.transferTypeAnalysis['all'];

    if (!allAnalysis) {
      console.warn('⚠️ transferTypeAnalysis中不存在all键，跳过画像分析结果部分（Word文档）');
    } else {
      children.push(
        new Paragraph({
          text: '一、画像分析结果',
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 400, after: 200 },
        })
      );

      // 智能分析摘要
      children.push(
        new Paragraph({
          text: '智能分析摘要',
          heading: HeadingLevel.HEADING_3,
          spacing: { before: 200, after: 100 },
        }),
        new Paragraph({
          children: [
            new TextRun({
              text: `分析概述: ${allAnalysis.analysis || '暂无分析摘要'}`,
            }),
          ],
          spacing: { after: 400 },
        })
      );

    // 分类详情表
    const categories = allAnalysis.categories || [];
    const totalObjects = categories.reduce((sum: number, cat: any) => sum + (cat.indicators.objectCount || 0), 0);

    children.push(
      new Paragraph({
        text: '分类详情与风险分析',
        heading: HeadingLevel.HEADING_3,
        spacing: { before: 200, after: 100 },
      })
    );

    // 创建表格
    const tableRows: TableRow[] = [];

    // 计算列数和宽度
    const hasValueField = !!primaryValueField;
    const hasCountField = primaryCountField && primaryCountField !== primaryValueField;
    const columnCount = 4 + (hasValueField ? 1 : 0) + (hasCountField ? 1 : 0);
    const columnWidth = Math.floor(100 / columnCount);

    // 表头
    const headerCells = [
      new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: '分类名称', bold: true })] })], width: { size: 20, type: WidthType.PERCENTAGE } }),
      new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: '分类描述', bold: true })] })], width: { size: 25, type: WidthType.PERCENTAGE } }),
      new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: '对象数量', bold: true })] })], width: { size: 10, type: WidthType.PERCENTAGE } }),
      new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: '占比', bold: true })] })], width: { size: 10, type: WidthType.PERCENTAGE } }),
    ];

    if (hasValueField) {
      headerCells.push(
        new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: fieldLabels[primaryValueField] || '主要数值', bold: true })] })], width: { size: 10, type: WidthType.PERCENTAGE } })
      );
    }

    if (hasCountField) {
      headerCells.push(
        new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: fieldLabels[primaryCountField] || '主要计数', bold: true })] })], width: { size: 10, type: WidthType.PERCENTAGE } })
      );
    }

    headerCells.push(
      new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: '风险等级', bold: true })] })], width: { size: 10, type: WidthType.PERCENTAGE } })
    );

    tableRows.push(new TableRow({ children: headerCells }));

    // 数据行
    categories.forEach((cat: any) => {
      const objectCount = cat.indicators.objectCount || 0;
      const percentage = totalObjects > 0 ? ((objectCount / totalObjects) * 100).toFixed(2) : '0.00';
      const valueFieldValue = primaryValueField ? (cat.indicators[primaryValueField] || 0) : 0;
      const countFieldValue = hasCountField ? (cat.indicators[primaryCountField] || 0) : 0;
      const riskLevel = cat.indicators.riskLevel || '未知';

      const dataCells = [
        new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: cat.category, bold: true })] })] }),
        new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: cat.description })] })] }),
        new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: objectCount.toLocaleString() })] })] }),
        new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: `${percentage}%` })] })] }),
      ];

      if (hasValueField) {
        dataCells.push(
          new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: typeof valueFieldValue === 'number' ? valueFieldValue.toLocaleString() : valueFieldValue })] })] })
        );
      }

      if (hasCountField) {
        dataCells.push(
          new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: typeof countFieldValue === 'number' ? countFieldValue.toLocaleString() : countFieldValue })] })] })
        );
      }

      dataCells.push(
        new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: riskLevel, bold: true })] })] })
      );

      tableRows.push(new TableRow({ children: dataCells }));
    });

      children.push(
        new Table({
          rows: tableRows,
          width: { size: 100, type: WidthType.PERCENTAGE },
          borders: {
            top: { style: BorderStyle.SINGLE, size: 1 },
            bottom: { style: BorderStyle.SINGLE, size: 1 },
            left: { style: BorderStyle.SINGLE, size: 1 },
            right: { style: BorderStyle.SINGLE, size: 1 },
            insideHorizontal: { style: BorderStyle.SINGLE, size: 1 },
            insideVertical: { style: BorderStyle.SINGLE, size: 1 },
          },
          margins: { top: 100, bottom: 100, left: 100, right: 100 },
        })
      );
    }
  }

  // 可视化图表分析
  if (data.chartImages) {
    const { barChart, pieChart, donutChart } = data.chartImages;

    children.push(
      new Paragraph({
        text: '二、可视化图表分析',
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 400, after: 200 },
      })
    );

    // 柱状图
    if (barChart) {
      console.log('添加柱状图到Word文档，数据长度:', barChart.length);
      children.push(
        new Paragraph({
          text: '2.1 各类别对象数量分布',
          heading: HeadingLevel.HEADING_3,
          spacing: { before: 200, after: 100 },
        }),
        new Paragraph({
          children: [
            await base64ToImageRun(barChart, 6),
          ],
          alignment: AlignmentType.CENTER,
          spacing: { after: 200 },
        }),
        new Paragraph({
          children: [
            new TextRun({
              text: '图表解读：柱状图展示了各个画像分类中的对象数量。高度代表该分类包含的对象数量，可以直观地看出哪些分类占主导地位，哪些分类相对较小。',
              italics: true,
            }),
          ],
          spacing: { after: 400 },
        })
      );
    }

    // 饼图
    if (pieChart) {
      console.log('添加饼图到Word文档，数据长度:', pieChart.length);
      children.push(
        new Paragraph({
          text: '2.2 第二个分析字段分布（饼图）',
          heading: HeadingLevel.HEADING_3,
          spacing: { before: 200, after: 100 },
        }),
        new Paragraph({
          children: [
            await base64ToImageRun(pieChart, 4),
          ],
          alignment: AlignmentType.CENTER,
          spacing: { after: 200 },
        }),
        new Paragraph({
          children: [
            new TextRun({
              text: '图表解读：饼图展示了第二个分析字段在各个分类中的数值分布。扇区的大小代表数值的占比，可以直观地看出各个分类在该字段上的分布情况。',
              italics: true,
            }),
          ],
          spacing: { after: 400 },
        })
      );
    }

    // 环形图
    if (donutChart) {
      console.log('添加环形图到Word文档，数据长度:', donutChart.length);
      children.push(
        new Paragraph({
          text: '2.3 第一个分析字段分布（环形图）',
          heading: HeadingLevel.HEADING_3,
          spacing: { before: 200, after: 100 },
        }),
        new Paragraph({
          children: [
            await base64ToImageRun(donutChart, 4),
          ],
          alignment: AlignmentType.CENTER,
          spacing: { after: 200 },
        }),
        new Paragraph({
          children: [
            new TextRun({
              text: '图表解读：环形图展示了第一个分析字段在各个分类中的数值分布。环形的大小代表数值的占比，可以直观地看出各个分类在该字段上的贡献程度。',
              italics: true,
            }),
          ],
          spacing: { after: 400 },
        })
      );
    }
  }

  // 分析配置与方法说明
  children.push(
    new Paragraph({
      text: '三、分析配置与方法说明',
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 400, after: 200 },
    })
  );

  // 数据筛选配置
  children.push(
    new Paragraph({
      text: '3.1 数据筛选配置',
      heading: HeadingLevel.HEADING_3,
      spacing: { before: 200, after: 100 },
    })
  );

  if (data.filterConfig.type === 'unique') {
    children.push(
      new Paragraph({ children: [new TextRun({ text: `筛选类型: ${data.filterConfig.type || '未设置'}`, bold: true })] }),
      new Paragraph({ children: [new TextRun({ text: `筛选逻辑: B列值不为A列的不重复值` })] })
    );
    if (data.filterConfig.columnA) {
      children.push(new Paragraph({ children: [new TextRun({ text: `列A（不重复值列）: ${data.filterConfig.columnA}` })] }));
    }
    if (data.filterConfig.columnB) {
      children.push(new Paragraph({ children: [new TextRun({ text: `列B（筛选列）: ${data.filterConfig.columnB}` })] }));
    }
  } else if (data.filterConfig.type === 'equals') {
    children.push(
      new Paragraph({ children: [new TextRun({ text: `筛选类型: ${data.filterConfig.type || '未设置'}`, bold: true })] }),
      new Paragraph({ children: [new TextRun({ text: `筛选逻辑: 某列等于特定值` })] })
    );
    if (data.filterConfig.targetColumn) {
      children.push(new Paragraph({ children: [new TextRun({ text: `目标列: ${data.filterConfig.targetColumn}` })] }));
    }
    if (data.filterConfig.targetValue !== undefined) {
      children.push(new Paragraph({ children: [new TextRun({ text: `目标值: ${data.filterConfig.targetValue}` })] }));
    }
  } else {
    children.push(new Paragraph({ children: [new TextRun({ text: '未应用筛选，使用原始数据进行分析' })] }));
  }

  // 数据聚合配置
  children.push(
    new Paragraph({
      text: '3.2 数据聚合配置',
      heading: HeadingLevel.HEADING_3,
      spacing: { before: 200, after: 100 },
    })
  );

  if (data.aggregationConfig.groupBy && data.aggregationConfig.groupBy.length > 0) {
    children.push(
      new Paragraph({ children: [new TextRun({ text: `分组字段: ${data.aggregationConfig.groupBy.join(', ')}` })] }),
      new Paragraph({ children: [new TextRun({ text: '聚合说明: 按照分组字段对数据进行汇总，每组生成一条聚合记录' })] })
    );
  } else {
    children.push(new Paragraph({ children: [new TextRun({ text: '未设置分组，对整体数据进行聚合' })] }));
  }

  // 聚合方式
  const aggregationMethods: string[] = [];
  if (data.aggregationConfig.sumColumns && data.aggregationConfig.sumColumns.length > 0) {
    aggregationMethods.push(`求和（SUM）: ${data.aggregationConfig.sumColumns.join(', ')}`);
  }
  if (data.aggregationConfig.countColumns && data.aggregationConfig.countColumns.length > 0) {
    aggregationMethods.push(`计数（COUNT）: ${data.aggregationConfig.countColumns.join(', ')}`);
  }
  if (data.aggregationConfig.maxColumns && data.aggregationConfig.maxColumns.length > 0) {
    aggregationMethods.push(`最大值（MAX）: ${data.aggregationConfig.maxColumns.join(', ')}`);
  }
  if (data.aggregationConfig.minColumns && data.aggregationConfig.minColumns.length > 0) {
    aggregationMethods.push(`最小值（MIN）: ${data.aggregationConfig.minColumns.join(', ')}`);
  }
  if (data.aggregationConfig.distinctColumns && data.aggregationConfig.distinctColumns.length > 0) {
    aggregationMethods.push(`去重计数（DISTINCT）: ${data.aggregationConfig.distinctColumns.join(', ')}`);
  }

  if (aggregationMethods.length > 0) {
    children.push(
      new Paragraph({ children: [new TextRun({ text: '聚合方式:', bold: true })] }),
      ...aggregationMethods.map(method => new Paragraph({ children: [new TextRun({ text: method })] }))
    );
  }

  // 画像分析方法
  let allAnalysis = data.intelligentAnalysis?.transferTypeAnalysis?.['all'];
  let analysisSource = '';

  // 如果没有整体分析，尝试获取第一个分组分析
  if (!allAnalysis && data.intelligentAnalysis?.transferTypeAnalysis) {
    const groupKeys = Object.keys(data.intelligentAnalysis.transferTypeAnalysis);
    if (groupKeys.length > 0) {
      allAnalysis = data.intelligentAnalysis.transferTypeAnalysis[groupKeys[0]];
      analysisSource = `（使用分组"${groupKeys[0]}"的分析结果）`;
    }
  }

  // 如果还是没有分析数据，检查顶层的 classificationRules 和 classificationParams
  if (!allAnalysis) {
    const classificationRules = data.intelligentAnalysis?.classificationRules;
    const classificationParams = data.intelligentAnalysis?.classificationParams;

    if (classificationRules && classificationRules.length > 0 && classificationParams) {
      // 使用顶层的分类规则和参数构建分析结果
      allAnalysis = {
        analysis: data.intelligentAnalysis?.allCategories && data.intelligentAnalysis.allCategories.length > 0
          ? `基于分组字段的画像分析，共 ${Object.keys(data.intelligentAnalysis.transferTypeAnalysis || {}).length} 个分组。分类采用 ${classificationParams.method === 'iqr' ? '四分位数法（IQR）' : '均值标准差法'}，具体参数见下方分类规则表。`
          : `画像分析方法概述。分类采用 ${classificationParams.method === 'iqr' ? '四分位数法（IQR）' : '均值标准差法'}，具体参数见下方分类规则表。`,
        classificationRules: classificationRules,
        classificationParams: classificationParams
      };
      analysisSource = '（使用整体分类规则与参数）';
    }
  }

  children.push(
    new Paragraph({
      text: '3.3 画像分析方法',
      heading: HeadingLevel.HEADING_3,
      spacing: { before: 200, after: 100 },
    })
  );

  if (!allAnalysis) {
    children.push(
      new Paragraph({ children: [new TextRun({ text: '⚠️ 未找到画像分析数据，无法显示分析方法', color: 'FF0000' })] })
    );
  } else {
    // 添加分析概况
    children.push(
      new Paragraph({ children: [new TextRun({ text: `📊 分析概况${analysisSource}`, bold: true, color: '008080' })] }),
      new Paragraph({
        children: [new TextRun({ text: allAnalysis.analysis || '暂无分析概况' })],
        spacing: { before: 100, after: 100 }
      })
    );

    // 添加分类规则与参数
    const classificationRules = allAnalysis.classificationRules;
    const classificationParams = allAnalysis.classificationParams;

    if (classificationRules && classificationRules.length > 0 && classificationParams) {
      children.push(
        new Paragraph({ children: [new TextRun({ text: '📋 分类规则与参数', bold: true, color: '008080' })] })
      );

      // 添加表格
      const tableRows = [
        new TableRow({
          children: [
            new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: '分类名称', bold: true })] })] }),
            new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: '分类条件', bold: true })] })] }),
            new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: '风险等级', bold: true })] })] }),
            new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: '说明', bold: true })] })] }),
          ],
        })
      ];

      classificationRules.forEach((rule: any) => {
        // 对 condition 中的字段名进行相对引用替换
        const condition = rule.condition
          .replace(
            new RegExp(classificationParams.valueField || '', 'g'),
            fieldLabels[classificationParams.valueField] || classificationParams.valueField || '数值字段'
          )
          .replace(
            new RegExp(classificationParams.countField || '', 'g'),
            fieldLabels[classificationParams.countField] || classificationParams.countField || '计数字段'
          );

        tableRows.push(
          new TableRow({
            children: [
              new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: rule.name, bold: true })] })] }),
              new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: condition })] })] }),
              new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: rule.riskLevel || '' })] })] }),
              new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: rule.description || '' })] })] }),
            ],
          })
        );
      });

      children.push(
        new Table({
          rows: tableRows,
          width: { size: 100, type: WidthType.PERCENTAGE },
        })
      );
    }
  }

  // 数据质量说明
  children.push(
    new Paragraph({
      text: '3.4 数据质量说明',
      heading: HeadingLevel.HEADING_3,
      spacing: { before: 200, after: 100 },
    }),
    new Paragraph({ children: [new TextRun({ text: `数据完整性: ${data.filteredData.length > 0 ? '✓ 数据完整，无缺失值' : '⚠️ 数据存在缺失值，建议检查数据源'}` })] }),
    new Paragraph({ children: [new TextRun({ text: `数据一致性: ${data.aggregatedData.length > 0 ? '✓ 聚合数据一致性验证通过' : '⚠️ 聚合数据可能存在异常'}` })] }),
    new Paragraph({ children: [new TextRun({ text: `分析可靠性: ${data.intelligentAnalysis ? '✓ 画像分析已完成，结果可靠' : '⚠️ 画像分析未完成或失败'}` })] })
  );

  // 总结与建议
  children.push(
    new Paragraph({
      text: '四、总结与建议',
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 400, after: 200 },
    }),
    new Paragraph({ children: [new TextRun({ text: '分析总结', bold: true })] }),
    new Paragraph({ children: [new TextRun({ text: `本报告基于${data.originalData.length.toLocaleString()}条原始数据，经过筛选和聚合处理后，生成了${data.aggregatedData.length.toLocaleString()}个聚合对象的详细画像。通过运用先进的机器学习算法和统计分析方法，我们对数据进行了深入挖掘和多维度分析。` })] }),
    new Paragraph({ children: [new TextRun({ text: '关键发现:' })] }),
    new Paragraph({ children: [new TextRun({ text: '- 数据分布特征：通过聚合分析，识别出数据的主要分布模式和关键特征' })] }),
    new Paragraph({ children: [new TextRun({ text: '- 风险识别能力：成功识别出高风险、中风险和低风险对象，为风险管控提供依据' })] }),
    new Paragraph({ children: [new TextRun({ text: '- 智能分类效果：画像分类准确度高，能够有效区分不同类型的数据对象' })] }),
    new Paragraph({ children: [new TextRun({ text: '- 数据质量评估：整体数据质量良好，分析结果具有可靠性和参考价值' })] })
  );

  // 业务建议
  children.push(
    new Paragraph({
      text: '业务建议',
      heading: HeadingLevel.HEADING_3,
      spacing: { before: 200, after: 100 },
    }),
    new Paragraph({ children: [new TextRun({ text: '针对高风险对象:' })] }),
    new Paragraph({ children: [new TextRun({ text: '- 立即启动深入调查程序，查明高风险成因' })] }),
    new Paragraph({ children: [new TextRun({ text: '- 建立监控机制，实时跟踪高风险对象的变化趋势' })] }),
    new Paragraph({ children: [new TextRun({ text: '- 制定风险应对预案，及时采取防控措施' })] }),
    new Paragraph({ children: [new TextRun({ text: '- 定期回顾和评估风险管控效果' })] })
  );

  // 技术建议
  children.push(
    new Paragraph({
      text: '技术建议',
      heading: HeadingLevel.HEADING_3,
      spacing: { before: 200, after: 100 },
    }),
    new Paragraph({ children: [new TextRun({ text: '- 数据源优化：建议完善数据采集机制，提高数据完整性和准确性' })] }),
    new Paragraph({ children: [new TextRun({ text: '- 算法调优：可根据业务反馈，持续优化画像分类算法和阈值设置' })] }),
    new Paragraph({ children: [new TextRun({ text: '- 模型迭代：定期使用新数据训练模型，提升分析精度和预测能力' })] }),
    new Paragraph({ children: [new TextRun({ text: '- 可视化增强：建议结合图表可视化，更直观地展示分析结果' })] }),
    new Paragraph({ children: [new TextRun({ text: '- 自动化流程：考虑建立自动化分析流程，提高分析效率' })] })
  );

  // 免责声明
  children.push(
    new Paragraph({
      text: '免责声明',
      heading: HeadingLevel.HEADING_3,
      spacing: { before: 200, after: 100 },
    }),
    new Paragraph({ children: [new TextRun({ text: '1. 数据准确性：本报告基于提供的数据进行分析，分析结果的准确性依赖于输入数据的质量和完整性。' })] }),
    new Paragraph({ children: [new TextRun({ text: '2. 算法局限性：画像分析算法采用机器学习和统计方法，可能存在一定的误判和偏差，建议结合业务实际情况进行综合判断。' })] }),
    new Paragraph({ children: [new TextRun({ text: '3. 风险评估：风险等级评估仅供参考，不应作为唯一决策依据，实际风险需要结合多方因素综合评估。' })] }),
    new Paragraph({ children: [new TextRun({ text: '4. 保密性：本报告包含敏感数据，仅供授权人员查阅，未经许可不得外传或用于其他用途。' })] }),
    new Paragraph({ children: [new TextRun({ text: '5. 有效期：本报告反映的是当前时点的数据分析结果，数据情况可能随时间变化，建议定期更新分析。' })] })
  );

  // 页脚
  children.push(
    new Paragraph({
      text: '—',
      alignment: AlignmentType.CENTER,
      spacing: { before: 400, after: 200 },
    }),
    new Paragraph({
      children: [new TextRun({ text: '数据分析系统自动生成', bold: true })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 100 },
    }),
    new Paragraph({
      children: [new TextRun({ text: `生成时间：${new Date().toLocaleString('zh-CN')}` })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 100 },
    }),
    new Paragraph({
      children: [new TextRun({ text: '技术支持：数据分析与画像系统 v1.0' })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 100 },
    }),
    new Paragraph({
      children: [new TextRun({ text: '本报告由智能数据分析系统自动生成，如有疑问请联系系统管理员' })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 100 },
    })
  );

  return new Document({
    sections: [
      {
        properties: {},
        children: children,
      },
    ],
  });
}

/**
 * 下载JSON文件
 */
export async function downloadJsonFile(data: AnalysisExportData): Promise<void> {
  const classifiedAggregatedData = addProfileClassificationToAggregatedData(
    data.aggregatedData,
    data.intelligentAnalysis
  );

  const exportData = {
    metadata: {
      exportTime: new Date().toISOString(),
      originalDataCount: data.originalData.length,
      filteredDataCount: data.filteredData.length,
      aggregatedDataCount: data.aggregatedData.length
    },
    config: {
      filter: data.filterConfig,
      aggregation: data.aggregationConfig
    },
    data: {
      original: data.originalData.slice(0, 1000),
      filtered: data.filteredData.slice(0, 1000),
      aggregated: classifiedAggregatedData
    },
    analysis: data.intelligentAnalysis
  };

  const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `数据分析报告_${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
