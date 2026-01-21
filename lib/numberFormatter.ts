/**
 * 格式化数字，添加千分位分隔符
 * @param num 要格式化的数字
 * @param decimals 小数位数，默认2位
 * @returns 格式化后的字符串
 */
export function formatNumberWithCommas(num: number | null | undefined, decimals: number = 2): string {
  if (num === null || num === undefined || isNaN(num)) {
    return 'N/A';
  }
  return num.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });
}

/**
 * 格式化数字，添加千分位分隔符（根据数值自动选择小数位数）
 * @param num 要格式化的数字
 * @param defaultDecimals 默认小数位数，默认2位
 * @returns 格式化后的字符串
 */
export function formatNumberAutoDecimals(num: number | null | undefined, defaultDecimals: number = 2): string {
  if (num === null || num === undefined || isNaN(num)) {
    return 'N/A';
  }
  // 如果是整数，不显示小数
  if (Number.isInteger(num)) {
    return num.toLocaleString('en-US');
  }
  return num.toLocaleString('en-US', {
    minimumFractionDigits: defaultDecimals,
    maximumFractionDigits: defaultDecimals
  });
}

/**
 * 格式化百分比
 * @param num 要格式化的数字（0-1之间的小数）
 * @param decimals 小数位数，默认2位
 * @returns 格式化后的百分比字符串（例如：0.567 -> "56.70%"）
 */
export function formatPercentage(num: number | null | undefined, decimals: number = 2): string {
  if (num === null || num === undefined || isNaN(num)) {
    return 'N/A';
  }
  const percentage = num * 100;
  return percentage.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  }) + '%';
}

/**
 * 智能格式化数值，根据列类型自动选择格式
 * @param num 要格式化的数字
 * @param columnType 列类型
 * @param decimals 小数位数，默认2位
 * @returns 格式化后的字符串
 */
export function formatSmart(
  num: number | null | undefined,
  columnType: string = 'number',
  decimals: number = 2
): string {
  if (num === null || num === undefined || isNaN(num)) {
    return 'N/A';
  }

  switch (columnType) {
    case 'percentage':
      return formatPercentage(num, decimals);
    case 'number':
    default:
      return formatNumberWithCommas(num, decimals);
  }
}

/**
 * 格式化HTML表格单元格值，支持百分比格式
 * @param value 要格式化的值
 * @param columnType 列类型
 * @param decimals 小数位数，默认2位
 * @returns HTML格式化的字符串
 */
export function formatHtmlValue(value: any, columnType: string = 'string', decimals: number = 2): string {
  if (value === null || value === undefined || value === '') {
    return '';
  }

  // 如果是数字且不是字符串
  if (typeof value === 'number' && !isNaN(value)) {
    return formatSmart(value, columnType, decimals);
  }

  // 如果是字符串且是数字类型列，尝试转换为数字
  if (typeof value === 'string' && columnType === 'number') {
    const numValue = parseFloat(value);
    if (!isNaN(numValue)) {
      return formatSmart(numValue, columnType, decimals);
    }
  }

  // 如果是字符串且是百分比类型列
  if (typeof value === 'string' && columnType === 'percentage') {
    const numValue = parseFloat(value);
    if (!isNaN(numValue) && numValue >= 0 && numValue <= 1) {
      return formatPercentage(numValue, decimals);
    }
  }

  // 其他情况返回字符串
  return String(value);
}

/**
 * 根据字段名从用户配置的分析字段中获取描述（相对引用）
 * @param fieldName 要查找的字段名
 * @param defaultLabel 默认标签（如果没有找到配置或描述）
 * @param profileAnalysisConfig 用户画像分析配置
 * @returns 字段描述或默认标签
 */
export function getConfiguredFieldLabel(
  fieldName: string,
  defaultLabel: string,
  profileAnalysisConfig?: { analysisFields?: Array<{ fieldName: string; description?: string }> }
): string {
  if (!profileAnalysisConfig || !profileAnalysisConfig.analysisFields) {
    return defaultLabel;
  }

  const configuredField = profileAnalysisConfig.analysisFields.find(
    f => f.fieldName === fieldName
  );

  if (configuredField && configuredField.description && configuredField.description.trim()) {
    return configuredField.description.trim();
  }

  return defaultLabel;
}

/**
 * 格式化参数值，根据字段名获取列类型并格式化
 * @param value 要格式化的数值
 * @param fieldName 字段名（用于查找列类型）
 * @param columnTypes 列类型映射
 * @param analysisResult 分析结果（包含columnTypes）
 * @returns 格式化后的字符串
 */
export function formatParamValue(
  value: number | null | undefined,
  fieldName: string,
  columnTypes?: Record<string, string>,
  analysisResult?: { columnTypes?: Record<string, string> }
): string {
  if (value === null || value === undefined) {
    return 'N/A';
  }

  if (typeof value !== 'number' || isNaN(value)) {
    return 'N/A';
  }

  // 获取列类型，优先从analysisResult中的columnTypes获取
  const columnType = analysisResult?.columnTypes?.[fieldName] || columnTypes?.[fieldName] || 'number';
  return formatSmart(value, columnType, 2);
}

/**
 * 格式化分析概况文本中的数字
 * @param analysis 分析概况文本
 * @param classificationParams 分类参数（包含统计量和字段名）
 * @param columnTypes 列类型映射
 * @param analysisResult 分析结果（包含columnTypes）
 * @returns 格式化后的文本
 */
export function formatAnalysisText(
  analysis: string,
  classificationParams: any,
  columnTypes?: Record<string, string>,
  analysisResult?: { columnTypes?: Record<string, string> }
): string {
  if (!analysis || !classificationParams) {
    return analysis;
  }

  console.log('=== formatAnalysisText 调用 ===');
  console.log('原始分析文本长度:', analysis.length);
  console.log('ClassificationParams:', JSON.stringify(classificationParams, null, 2));

  let formattedAnalysis = analysis;

  // 提取需要格式化的数值及其字段名
  const valueField = classificationParams.valueField;
  const countField = classificationParams.countField;
  const valueLabel = classificationParams.valueLabel || valueField;
  const countLabel = classificationParams.countLabel || countField;
  const method = classificationParams.method || 'iqr';

  console.log('ValueField:', valueField, 'ValueLabel:', valueLabel);
  console.log('CountField:', countField, 'CountLabel:', countLabel);
  console.log('Method:', method);

  // 创建一个替换规则的数组：{ pattern: 正则表达式, replacement: 格式化后的字符串 }
  const replacements: Array<{ pattern: RegExp; replacement: string }> = [];

  // 辅助函数：添加替换规则
  const addReplacement = (value: number, fieldName: string) => {
    if (value === undefined || value === null || isNaN(value)) return;

    const formatted = formatParamValue(value, fieldName, columnTypes, analysisResult);
    console.log(`添加替换规则: ${value} -> ${formatted} (字段: ${fieldName})`);

    // 生成数字的字符串表示（用于匹配LLM生成的文本）
    const numStr = value.toString();

    // 尝试多种可能的格式
    const patterns = [
      // 标准格式：0.06, 0.79
      numStr,
      // 去除末尾0：0.060 -> 0.06
      numStr.replace(/\.?0+$/, ''),
      // 保留更多小数位：0.0600 -> 0.0600
      value.toFixed(6),
      // 保留2位小数
      value.toFixed(2),
      // 保留4位小数
      value.toFixed(4),
      // 科学计数法格式（如果适用）
      value.toExponential(6),
    ];

    // 去重
    const uniquePatterns = [...new Set(patterns)];
    console.log('尝试匹配的格式:', uniquePatterns);

    uniquePatterns.forEach(pattern => {
      // 转义小数点和其他特殊字符
      const escapedPattern = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      replacements.push({
        pattern: new RegExp(`\\b${escapedPattern}\\b`, 'g'),
        replacement: formatted
      });
    });
  };

  // 添加值字段的统计量
  addReplacement(classificationParams.valueMean, valueField);
  addReplacement(classificationParams.valueStdDev, valueField);
  addReplacement(classificationParams.valueQ1, valueField);
  addReplacement(classificationParams.valueQ3, valueField);
  addReplacement(classificationParams.valueIQR, valueField);
  addReplacement(classificationParams.valueHighThreshold, valueField);
  addReplacement(classificationParams.valueLowThreshold, valueField);

  // 添加计数字段的统计量
  addReplacement(classificationParams.countMean, countField);
  addReplacement(classificationParams.countStdDev, countField);
  addReplacement(classificationParams.countQ1, countField);
  addReplacement(classificationParams.countQ3, countField);
  addReplacement(classificationParams.countIQR, countField);
  addReplacement(classificationParams.countHighThreshold, countField);
  addReplacement(classificationParams.countLowThreshold, countField);

  console.log('总共添加了', replacements.length, '个替换规则');

  // 应用所有替换（按添加顺序）
  let replacedCount = 0;
  replacements.forEach(({ pattern, replacement }) => {
    const matches = formattedAnalysis.match(pattern);
    if (matches && matches.length > 0) {
      console.log(`匹配到 ${matches.length} 次: ${pattern.source} -> ${replacement}`);
      replacedCount += matches.length;
    }
    formattedAnalysis = formattedAnalysis.replace(pattern, replacement);
  });

  console.log('总共替换了', replacedCount, '处');
  console.log('格式化后的文本长度:', formattedAnalysis.length);

  // 验证替换后的分析概况是否包含正确的参数值
  // 如果替换次数太少（说明LLM生成的数字与实际参数不匹配），则根据classificationParams重新生成准确的分析概况
  const expectedReplacements = 10; // Q1, Q2, Q3, IQR, HighThreshold, LowThreshold for both fields (6) + others
  if (replacedCount < expectedReplacements) {
    console.warn('⚠️ 替换次数过少，LLM生成的分析概况可能包含错误的数字，重新生成准确的分析概况');
    formattedAnalysis = generateAccurateAnalysisText(analysis, classificationParams, columnTypes, analysisResult);
  }

  return formattedAnalysis;
}

/**
 * 根据classificationParams生成准确的分析概况文本
 * @param originalAnalysis 原始分析概况（用于提取结构信息）
 * @param classificationParams 分类参数（包含统计量和字段名）
 * @param columnTypes 列类型映射
 * @param analysisResult 分析结果（包含columnTypes）
 * @returns 生成准确的分析概况文本
 */
function generateAccurateAnalysisText(
  originalAnalysis: string,
  classificationParams: any,
  columnTypes?: Record<string, string>,
  analysisResult?: { columnTypes?: Record<string, string> }
): string {
  const valueField = classificationParams.valueField;
  const countField = classificationParams.countField;
  const valueLabel = classificationParams.valueLabel || valueField;
  const countLabel = classificationParams.countLabel || countField;
  const method = classificationParams.method || 'iqr';
  const upperMultiplier = classificationParams.upperMultiplier ?? (method === 'iqr' ? 1.5 : 1.5);
  const lowerMultiplier = classificationParams.lowerMultiplier ?? (method === 'iqr' ? 0 : 1.5);

  console.log('=== 生成准确的分析概况 ===');
  console.log('Method:', method);
  console.log('ValueField:', valueField, 'ValueLabel:', valueLabel);
  console.log('CountField:', countField, 'CountLabel:', countLabel);

  // 格式化辅助函数
  const fmt = (value: number, fieldName: string) => formatParamValue(value, fieldName, columnTypes, analysisResult);

  // 提取原始分析中的非数字部分（保留LLM生成的定性描述）
  // 使用正则表达式替换数字部分
  let accurateAnalysis = originalAnalysis;

  // 根据方法类型生成准确的参数描述
  if (method === 'iqr') {
    // IQR方法
    const valueQ1 = classificationParams.valueQ1;
    const valueQ3 = classificationParams.valueQ3;
    const valueIQR = classificationParams.valueIQR;
    const valueHighThreshold = classificationParams.valueHighThreshold;
    const valueLowThreshold = classificationParams.valueLowThreshold;

    const countQ1 = classificationParams.countQ1;
    const countQ3 = classificationParams.countQ3;
    const countIQR = classificationParams.countIQR;
    const countHighThreshold = classificationParams.countHighThreshold;
    const countLowThreshold = classificationParams.countLowThreshold;

    // 构建准确的参数描述段落
    const paramsDescription = `画像分类采用四分位数法（IQR），上阈值倍数为${upperMultiplier}，下阈值倍数为${lowerMultiplier}。${valueLabel}的Q1为${fmt(valueQ1, valueField)}，Q3为${fmt(valueQ3, valueField)}，IQR为${fmt(valueIQR, valueField)}，高阈值=Q3 + ${upperMultiplier}×IQR = ${fmt(valueHighThreshold, valueField)}，低阈值=Q1 - ${lowerMultiplier}×IQR = ${fmt(valueLowThreshold, valueField)}；${countLabel}的Q1为${fmt(countQ1, countField)}，Q3为${fmt(countQ3, countField)}，IQR为${fmt(countIQR, countField)}，高阈值=Q3 + ${upperMultiplier}×IQR = ${fmt(countHighThreshold, countField)}，低阈值=Q1 - ${lowerMultiplier}×IQR = ${fmt(countLowThreshold, countField)}。`;

    console.log('生成的准确参数描述:', paramsDescription);

    // 尝试替换分析概况中的参数描述部分
    // 匹配包含"Q1"、"Q3"、"IQR"等关键词的段落
    const paramsRegex = /画像分类采用[^。]+(?:[Q1|Q3|IQR|阈值|倍数|参数]+)[^。]*(?:。|$)/g;
    if (paramsRegex.test(accurateAnalysis)) {
      accurateAnalysis = accurateAnalysis.replace(paramsRegex, paramsDescription);
      console.log('✓ 已替换参数描述部分');
    } else {
      // 如果没有匹配到，直接替换整个分析概况
      // 保留原始分析中的定性描述（如"共分析了XX个对象"等）
      const nonNumericPart = accurateAnalysis
        .replace(/共分析了?\d+[个名]对象/g, '共分析了[对象数量]个对象')
        .replace(/总[金额数量][^。]+。/g, '')
        .replace(/平均[金额数量][^。]+。/g, '')
        .trim();

      accurateAnalysis = `${nonNumericPart ? nonNumericPart + '。' : ''}${paramsDescription}`;
      console.log('✓ 已重新生成完整的分析概况');
    }
  } else {
    // 均值标准差法
    const valueMean = classificationParams.valueMean;
    const valueStdDev = classificationParams.valueStdDev;
    const valueHighThreshold = classificationParams.valueHighThreshold;
    const valueLowThreshold = classificationParams.valueLowThreshold;

    const countMean = classificationParams.countMean;
    const countStdDev = classificationParams.countStdDev;
    const countHighThreshold = classificationParams.countHighThreshold;
    const countLowThreshold = classificationParams.countLowThreshold;

    // 构建准确的参数描述段落
    const paramsDescription = `画像分类采用均值标准差法，上阈值倍数为${upperMultiplier}，下阈值倍数为${lowerMultiplier}。${valueLabel}的均值为${fmt(valueMean, valueField)}，标准差为${fmt(valueStdDev, valueField)}，高阈值=均值 + ${upperMultiplier}×标准差 = ${fmt(valueHighThreshold, valueField)}，低阈值=均值 - ${lowerMultiplier}×标准差 = ${fmt(valueLowThreshold, valueField)}；${countLabel}的均值为${fmt(countMean, countField)}，标准差为${fmt(countStdDev, countField)}，高阈值=均值 + ${upperMultiplier}×标准差 = ${fmt(countHighThreshold, countField)}，低阈值=均值 - ${lowerMultiplier}×标准差 = ${fmt(countLowThreshold, countField)}。`;

    console.log('生成的准确参数描述:', paramsDescription);

    // 尝试替换分析概况中的参数描述部分
    const paramsRegex = /画像分类采用[^。]+(?:[均值|标准差|阈值|倍数|参数]+)[^。]*(?:。|$)/g;
    if (paramsRegex.test(accurateAnalysis)) {
      accurateAnalysis = accurateAnalysis.replace(paramsRegex, paramsDescription);
      console.log('✓ 已替换参数描述部分');
    } else {
      const nonNumericPart = accurateAnalysis
        .replace(/共分析了?\d+[个名]对象/g, '共分析了[对象数量]个对象')
        .replace(/总[金额数量][^。]+。/g, '')
        .replace(/平均[金额数量][^。]+。/g, '')
        .trim();

      accurateAnalysis = `${nonNumericPart ? nonNumericPart + '。' : ''}${paramsDescription}`;
      console.log('✓ 已重新生成完整的分析概况');
    }
  }

  console.log('生成的准确分析概况:', accurateAnalysis);

  return accurateAnalysis;
}
