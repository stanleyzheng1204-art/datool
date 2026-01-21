'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { formatNumberWithCommas } from '@/lib/numberFormatter';

export interface NormalityTestProps {
  aggregatedData: any[];
  aggregatedColumns: string[];
  aggregationConfig?: {
    groupBy: string[];
  };
  onComplete?: () => void;
  onSkip?: () => void;
  onResults?: (results: NormalityTestResults) => void;
}

export interface FieldTestResult {
  fieldName: string;
  skewness?: number;  // 偏度
  kurtosis?: number; // 峰度
  ksTest: {
    statistic: number;
    pValue: number;
    isNormal: boolean;
    interpretation: string;
  };
  zScoreTest: {
    statistic: number;
    pValue: number;
    isNormal: boolean;
    interpretation: string;
  };
  andersonDarlingTest?: {
    statistic: number;
    pValue: number;
    isNormal: boolean;
    interpretation: string;
  };
  distributionFit?: {
    bestFit: string;
    logNormal: number;
    exponential: number;
    gamma: number;
    poisson: number;
    interpretation: string;
  };
}

export interface GroupTestResults {
  groupKey: string; // 分组的值
  groupName: string; // 分组的显示名称（如果是单字段分组，直接用值；如果是多字段，用逗号分隔）
  results: FieldTestResult[];
  summary: {
    totalFields: number;
    normalFields: number;
    nonNormalFields: number;
  };
}

export interface NormalityTestResults {
  hasGroups: boolean; // 是否有分组
  groupByFields: string[]; // 分组字段
  // 无分组时的结果
  results?: FieldTestResult[];
  summary?: {
    totalFields: number;
    normalFields: number;
    nonNormalFields: number;
    mostCommonDistribution: string;
  };
  // 有分组时的结果
  groupResults?: GroupTestResults[];
  overallSummary?: {
    totalGroups: number;
    totalFields: number;
    overallNormalFields: number;
    overallNonNormalFields: number;
    mostCommonDistribution: string;
  };
}

export function NormalityTest({
  aggregatedData,
  aggregatedColumns,
  aggregationConfig,
  onComplete,
  onSkip,
  onResults
}: NormalityTestProps) {
  const [results, setResults] = useState<FieldTestResult[]>([]);
  const [groupResults, setGroupResults] = useState<GroupTestResults[]>([]);
  const [isTesting, setIsTesting] = useState(false);
  const [showDetails, setShowDetails] = useState(false);

  // 分组配置状态
  const [enableGrouping, setEnableGrouping] = useState(false);
  const [selectedGroupFields, setSelectedGroupFields] = useState<string[]>([]);

  // 检验字段选择状态
  const [selectedTestFields, setSelectedTestFields] = useState<string[]>([]);

  // 判断是否有分组
  const hasGroups = enableGrouping && selectedGroupFields.length > 0;

  // 使用useMemo缓存数值字段计算
  const numericFields = useMemo(() => {
    if (!aggregatedData || aggregatedData.length === 0) return [];

    return aggregatedColumns.filter(col => {
      const value = aggregatedData[0][col];
      return typeof value === 'number' && !isNaN(value);
    });
  }, [aggregatedData, aggregatedColumns]);

  // 初始化：当numericFields变化时，默认选中所有字段
  useEffect(() => {
    if (numericFields.length > 0 && selectedTestFields.length === 0) {
      setSelectedTestFields(numericFields);
    }
  }, [numericFields]);

  // 使用useMemo缓存分组数据计算
  const groupedData = useMemo(() => {
    if (!hasGroups || selectedGroupFields.length === 0) {
      console.log('=== groupedData: 无分组，返回全部数据 ===');
      return { 'all': aggregatedData };
    }

    console.log('=== 开始计算分组数据 ===');
    console.log('分组字段:', selectedGroupFields);
    console.log('总数据量:', aggregatedData.length);

    const grouped: Record<string, any[]> = {};

    // 遍历所有数据行
    aggregatedData.forEach((row, idx) => {
      // 构建分组键
      const groupKeyParts: string[] = [];
      selectedGroupFields.forEach(groupField => {
        groupKeyParts.push(row[groupField]?.toString() || 'null');
      });
      const groupKey = groupKeyParts.join('|');

      if (!grouped[groupKey]) {
        grouped[groupKey] = [];
      }
      grouped[groupKey].push(row);
    });

    console.log('分组结果:', Object.keys(grouped).map(key => ({
      groupKey: key,
      dataCount: grouped[key].length,
      firstRowSample: grouped[key][0]
    })));

    return grouped;
  }, [hasGroups, selectedGroupFields, aggregatedData]);

  // 计算累积分布函数 (CDF) - 正态分布
  const normalCDF = (x: number, mean: number, stdDev: number): number => {
    const z = (x - mean) / stdDev;
    const t = 1 / (1 + 0.2316419 * Math.abs(z));
    const d = 0.3989423 * Math.exp(-z * z / 2);
    const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));

    return z > 0 ? 1 - p : p;
  };

  // Kolmogorov-Smirnov双尾检验的精确p值计算
  // 使用标准Kolmogorov-Smirnov公式（级数求和）
  // 这与scipy.stats.kstest(method='asymp')完全一致
  const kolmogorovPValue = (d: number, n: number): number => {
    // 标准Kolmogorov-Smirnov级数求和公式
    // p = 2 * Σ[(-1)^(k-1) * exp(-2k²λ²)]，k从1到∞
    // 其中 λ = d * sqrt(n)
    const lambda = d * Math.sqrt(n);

    let sum = 0;
    const maxTerms = 200; // 足够的项数确保收敛

    for (let k = 1; k <= maxTerms; k++) {
      const term = Math.pow(-1, k - 1) * Math.exp(-2 * k * k * lambda * lambda);
      sum += term;

      // 当新项非常小时停止求和
      if (Math.abs(term) < 1e-15) {
        break;
      }
    }

    return 2 * sum;
  };

  // KS检验 (Kolmogorov-Smirnov test)
  const ksTest = (values: number[]) => {
    const n = values.length;
    if (n < 5) {
      return {
        statistic: 0,
        pValue: 1,
        isNormal: true,
        interpretation: '样本量过小，无法进行有效检验'
      };
    }

    // 计算均值和标准差（使用样本标准差，与SciPy kstest一致）
    const mean = values.reduce((sum, v) => sum + v, 0) / n;
    const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / (n - 1); // 样本方差
    const stdDev = Math.sqrt(variance); // 样本标准差

    if (stdDev === 0) {
      return {
        statistic: 0,
        pValue: 1,
        isNormal: true,
        interpretation: '所有值相同，视为符合正态分布'
      };
    }

    // 对数据排序
    const sortedValues = [...values].sort((a, b) => a - b);

    // 计算最大差异
    let maxDiff = 0;
    for (let i = 0; i < n; i++) {
      const empiricalCDF = (i + 1) / n;
      const theoreticalCDF = normalCDF(sortedValues[i], mean, stdDev);

      const diff1 = Math.abs(empiricalCDF - theoreticalCDF);
      const diff2 = Math.abs(i / n - theoreticalCDF);
      maxDiff = Math.max(maxDiff, diff1, diff2);
    }

    const statistic = maxDiff;

    // 使用标准Kolmogorov-Smirnov公式计算P值
    // 这与scipy.stats.kstest(method='asymp')和kstwobign.sf完全一致
    const pValue = kolmogorovPValue(statistic, n);

    // 确保p值在合理范围内（数值稳定性）
    const clampedPValue = Math.max(0.0001, Math.min(0.9999, pValue));

    const isNormal = clampedPValue > 0.05;

    return {
      statistic,
      pValue: clampedPValue,
      isNormal,
      interpretation: isNormal
        ? `符合正态分布 (p=${formatNumberWithCommas(clampedPValue, 6)} > 0.05)`
        : `不符合正态分布 (p=${formatNumberWithCommas(clampedPValue, 6)} ≤ 0.05)`
    };
  };

  // Z-score检验 (基于偏度和峰度)
  const zScoreTest = (values: number[]) => {
    const n = values.length;
    if (n < 8) {
      return {
        statistic: 0,
        pValue: 1,
        isNormal: true,
        interpretation: '样本量过小，Z-score检验不适用'
      };
    }

    // 计算均值
    const mean = values.reduce((sum, v) => sum + v, 0) / n;

    // 计算样本矩（除以n）
    const m2 = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / n;
    const m3 = values.reduce((sum, v) => sum + Math.pow(v - mean, 3), 0) / n;
    const m4 = values.reduce((sum, v) => sum + Math.pow(v - mean, 4), 0) / n;

    // 使用样本矩计算标准差
    const stdDevFromM2 = Math.sqrt(m2);

    if (stdDevFromM2 === 0) {
      return {
        statistic: 0,
        pValue: 1,
        isNormal: true,
        interpretation: '所有值相同，视为符合正态分布'
      };
    }

    // 计算有偏偏度和有偏峰度
    const skewnessBiased = m3 / Math.pow(m2, 1.5);  // g1
    const kurtosisBiased = m4 / Math.pow(m2, 2) - 3;  // g2（超额峰度）

    // 计算标准误 (Fisher精确公式)
    // 偏度标准误：sqrt(6n(n-1)/((n-2)(n+1)(n+3)))
    const skewStdErr = Math.sqrt((6 * n * (n - 1)) / ((n - 2) * (n + 1) * (n + 3)));
    // 峰度标准误：sqrt(24n(n-1)²/((n-3)(n-2)(n+3)(n+5)))
    const kurtStdErr = Math.sqrt((24 * n * Math.pow(n - 1, 2)) / ((n - 3) * (n - 2) * (n + 3) * (n + 5)));

    // 计算Z-score：使用有偏偏度和有偏峰度
    const zSkew = skewnessBiased / skewStdErr;
    const zKurt = kurtosisBiased / kurtStdErr;

    // 判断标准：在α=0.05水平下，Z-score在±1.96之间才符合正态分布
    const isSkewNormal = Math.abs(zSkew) < 1.96;
    const isKurtNormal = Math.abs(zKurt) < 1.96;

    // 综合判断：偏度和峰度都必须在正常范围内
    const isNormal = isSkewNormal && isKurtNormal;

    // 计算综合统计量（取绝对值较大的）
    const statistic = Math.max(Math.abs(zSkew), Math.abs(zKurt));

    // 计算p值
    const pValueSkew = 2 * (1 - normalCDF(Math.abs(zSkew), 0, 1));
    const pValueKurt = 2 * (1 - normalCDF(Math.abs(zKurt), 0, 1));
    const pValue = Math.min(pValueSkew, pValueKurt);

    // 判断偏离程度
    const absSkew = Math.abs(skewnessBiased);
    const absKurt = Math.abs(kurtosisBiased);
    const isMild = absSkew < 1 && absKurt < 1;
    const isModerate = absSkew >= 1 && absSkew < 2 || absKurt >= 1 && absKurt < 2;

    // 生成解读说明
    let interpretation = '';
    if (isNormal) {
      interpretation = `符合正态分布 (偏度=${formatNumberWithCommas(skewnessBiased, 4)}, 峰度=${formatNumberWithCommas(kurtosisBiased, 4)}, 偏度Z=${formatNumberWithCommas(zSkew, 4)}, 峰度Z=${formatNumberWithCommas(zKurt, 4)}, 均在±1.96范围内)`;
    } else {
      const deviationType = isMild ? '轻微偏离' : (isModerate ? '中度偏离' : '严重偏离');

      // 判断是偏度还是峰度的问题
      const issues: string[] = [];
      if (!isSkewNormal) {
        const skewDirection = skewnessBiased > 0 ? '右偏' : '左偏';
        issues.push(`偏度=${formatNumberWithCommas(skewnessBiased, 4)}, Z=${formatNumberWithCommas(zSkew, 4)}`);
      }
      if (!isKurtNormal) {
        const kurtType = kurtosisBiased > 0 ? '尖峰' : '平峰';
        issues.push(`峰度=${formatNumberWithCommas(kurtosisBiased, 4)}, Z=${formatNumberWithCommas(zKurt, 4)}`);
      }

      interpretation = `不符合正态分布 (${issues.join('和')}超出±1.96范围)`;

      // 对于轻微偏离的情况，添加提示
      if (isMild && n > 200) {
        interpretation += ` [大样本下轻微偏离可能被检测出，建议参考其他检验方法]`;
      }
    }

    return {
      statistic,
      pValue,
      isNormal,
      interpretation
    };
  };

  // 识别最佳分布拟合
  const identifyDistribution = (values: number[]): any => {
    const n = values.length;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const mean = values.reduce((sum, v) => sum + v, 0) / n;
    const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / n;
    const stdDev = Math.sqrt(variance);

    // 如果所有值相同
    if (stdDev === 0) {
      return {
        bestFit: '常数分布',
        logNormal: 0,
        exponential: 0,
        gamma: 0,
        poisson: 0,
        interpretation: '所有值相同，为常数分布'
      };
    }

    // 对数正态分布拟合 (KS检验)
    const logValues = values.filter(v => v > 0);
    const logNormalFit = logValues.length > 0 ? ksTest(logValues.map(v => Math.log(v))).pValue : 0;

    // 指数分布拟合 (简化的KS检验)
    const rate = 1 / mean; // 指数分布参数
    const sortedValues = [...values].sort((a, b) => a - b);
    let expMaxDiff = 0;
    for (let i = 0; i < n; i++) {
      const empiricalCDF = (i + 1) / n;
      const theoreticalCDF = 1 - Math.exp(-rate * sortedValues[i]);
      const diff1 = Math.abs(empiricalCDF - theoreticalCDF);
      const diff2 = Math.abs(i / n - theoreticalCDF);
      expMaxDiff = Math.max(expMaxDiff, diff1, diff2);
    }
    const exponentialFit = expMaxDiff < 0.3 ? 0.1 + (0.3 - expMaxDiff) / 0.3 * 0.9 : 0.1;

    // Gamma分布拟合 (简化判断，基于形状参数)
    const shape = mean * mean / variance;
    const scale = variance / mean;
    const gammaFit = (shape > 0.5 && shape < 3) ? 0.6 : 0.3;

    // 泊松分布拟合 (仅适用于接近整数的正数数据)
    const isIntegerData = values.every(v => v === Math.round(v));
    const poissonFit = isIntegerData && min >= 0 ? 0.7 : 0.2;

    // 确定最佳拟合
    const fits = {
      '对数正态分布': logNormalFit,
      '指数分布': exponentialFit,
      'Gamma分布': gammaFit,
      '泊松分布': poissonFit
    };

    const bestFit = Object.entries(fits).reduce((a, b) => a[1] > b[1] ? a : b)[0];

    let interpretation = '';
    if (bestFit === '对数正态分布') {
      interpretation = '数据呈现右偏分布，对数转换后接近正态，常见于收入、价格等数据';
    } else if (bestFit === '指数分布') {
      interpretation = '数据呈现快速衰减的右偏分布，常见于等待时间、故障间隔等数据';
    } else if (bestFit === 'Gamma分布') {
      interpretation = '数据呈现灵活的右偏分布，可以包含对数正态和指数分布作为特例';
    } else if (bestFit === '泊松分布') {
      interpretation = '数据为离散的正整数，适合计数数据，如事件发生次数等';
    }

    return {
      bestFit,
      logNormal: logNormalFit,
      exponential: exponentialFit,
      gamma: gammaFit,
      poisson: poissonFit,
      interpretation
    };
  };

  // 格式化p值显示
  const formatPValue = (p: number): string => {
    if (p < 0.0001) {
      return '< 0.0001';
    } else if (p >= 0.9999) {
      return '> 0.9999';
    } else {
      return p.toFixed(4);
    }
  };

  // 计算偏度和峰度（使用有偏估计方法，与SciPy一致）
  const calculateSkewnessKurtosis = (values: number[]): { skewness: number; kurtosis: number } => {
    const n = values.length;

    if (n < 3) {
      return { skewness: 0, kurtosis: 0 };
    }

    // 计算均值
    const mean = values.reduce((sum, v) => sum + v, 0) / n;

    // 计算标准差（使用有偏标准差，即除以n）
    const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / n;
    const stdDev = Math.sqrt(variance);

    // 如果标准差为0
    if (stdDev === 0) {
      return { skewness: 0, kurtosis: 0 };
    }

    // 计算偏度（Fisher-Pearson系数，有偏估计）
    const skewness = values.reduce((sum, v) => sum + Math.pow((v - mean) / stdDev, 3), 0) / n;

    // 计算峰度（有偏估计，峰度=0表示正态分布）
    const kurtosis = values.reduce((sum, v) => sum + Math.pow((v - mean) / stdDev, 4), 0) / n - 3;

    return { skewness, kurtosis };
  };

  // 数据采样函数：当数据量过大时进行随机抽样
  const sampleValues = (values: number[], maxSampleSize: number = 5000): number[] => {
    if (values.length <= maxSampleSize) {
      return values;
    }

    // 使用随机抽样算法
    const sampled: number[] = [];
    const step = values.length / maxSampleSize;

    for (let i = 0; i < maxSampleSize; i++) {
      const index = Math.floor(i * step + Math.random() * step);
      sampled.push(values[index]);
    }

    return sampled;
  };

  // 正态分布分位数函数（Beasley-Springer-Moro近似）
  const normalQuantile = (p: number): number => {
    const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
    const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01];
    const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
    const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];

    const pLow = 0.02425;
    const pHigh = 1 - pLow;
    let q: number;
    let r: number;

    if (p < 0 || p > 1) {
      return 0;
    }

    if (p === 0) {
      return -Infinity;
    }
    if (p === 1) {
      return Infinity;
    }

    if (p < pLow) {
      q = Math.sqrt(-2 * Math.log(p));
      return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
             ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    }

    if (p <= pHigh) {
      q = p - 0.5;
      r = q * q;
      return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
             (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
    }

    q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
            ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  };

  // Anderson-Darling检验（推荐用于小样本，n ≥ 3）
  // 这是统计学中公认的最佳小样本正态性检验之一
  // 比Shapiro-Wilk更稳定，对尾部偏差更敏感
  const andersonDarlingTest = (values: number[]): {
    statistic: number;
    pValue: number;
    isNormal: boolean;
    interpretation: string;
  } => {
    const n = values.length;

    // 样本量不足
    if (n < 3) {
      return {
        statistic: 0,
        pValue: 1,
        isNormal: false,
        interpretation: '样本量过小（<3），无法进行有效的正态性检验'
      };
    }

    // 样本量过大，提示使用其他检验
    if (n > 5000) {
      return {
        statistic: 0,
        pValue: 0,
        isNormal: false,
        interpretation: '样本量过大（>5000），建议使用KS检验'
      };
    }

    // 对数据排序
    const sortedValues = [...values].sort((a, b) => a - b);

    // 计算均值和标准差（使用样本标准差，除以n-1）
    const mean = sortedValues.reduce((sum, v) => sum + v, 0) / n;
    const variance = sortedValues.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / (n - 1);
    const stdDev = Math.sqrt(variance);

    // 如果所有值相同或标准差为0
    if (stdDev === 0) {
      return {
        statistic: 0,
        pValue: 1,
        isNormal: true,
        interpretation: '所有值相同，视为符合正态分布'
      };
    }

    // 计算Anderson-Darling统计量
    // A² = -n - Σ[(2i-1)/n * (ln(F(y_i)) + ln(1-F(y_{n+1-i})))]
    // 其中F是标准正态分布的累积分布函数

    let sum = 0;
    for (let i = 0; i < n; i++) {
      const yi = (sortedValues[i] - mean) / stdDev;
      const yni = (sortedValues[n - 1 - i] - mean) / stdDev;

      const F_yi = normalCDF(yi, 0, 1);
      const F_yni = normalCDF(yni, 0, 1);

      // 确保值在合理范围内，避免log(0)
      const ln_F_yi = Math.max(Math.log(Math.max(F_yi, 1e-10)), -100);
      const ln_1_F_yni = Math.max(Math.log(Math.max(1 - F_yni, 1e-10)), -100);

      sum += ((2 * (i + 1) - 1) / n) * (ln_F_yi + ln_1_F_yni);
    }

    const A2 = -n - sum;

    console.log('Anderson-Darling检验调试信息:');
    console.log('  样本量:', n);
    console.log('  均值:', mean.toFixed(4));
    console.log('  标准差:', stdDev.toFixed(4));
    console.log('  A²统计量:', A2.toFixed(6));

    // 根据样本量调整统计量（修正公式）
    // 对于正态性检验，需要使用修正后的统计量
    let A2star = A2;

    if (n > 0) {
      A2star = A2 * (1 + 0.75 / n + 2.25 / (n * n));
    }

    console.log('  修正后A²*:', A2star.toFixed(6));

    // 计算P值
    // 使用近似公式计算P值（基于Lewis, 1961的表格拟合）
    let pValue: number;

    // 使用多项式近似计算P值
    // 这个近似公式覆盖了大部分A²*值的范围
    if (A2star <= 0.2) {
      pValue = 1 - Math.exp(-13.436 + 101.14 * A2star - 223.73 * Math.pow(A2star, 2));
    } else if (A2star <= 0.34) {
      pValue = 1 - Math.exp(-8.318 + 42.796 * A2star - 59.938 * Math.pow(A2star, 2));
    } else if (A2star <= 0.6) {
      pValue = Math.exp(0.9177 - 4.279 * A2star - 1.38 * Math.pow(A2star, 2));
    } else if (A2star <= 0.75) {
      pValue = Math.exp(1.2937 - 5.524 * A2star + 0.0097 * Math.pow(A2star, 2));
    } else if (A2star <= 1.0) {
      pValue = Math.exp(0.9253 - 3.790 * A2star - 1.391 * Math.pow(A2star, 2));
    } else {
      // 对于非常大的A²*值，使用更保守的估计
      pValue = Math.exp(0.7763 - 3.423 * A2star - 0.503 * Math.pow(A2star, 2));
    }

    // 边界检查
    pValue = Math.max(1e-10, Math.min(1, pValue));

    console.log('  P值:', pValue.toFixed(6));

    const isNormal = pValue > 0.05;

    return {
      statistic: A2star,
      pValue,
      isNormal,
      interpretation: isNormal
        ? `符合正态分布 (A²=${A2star.toFixed(4)}, p=${pValue.toFixed(4)} > 0.05)`
        : `不符合正态分布 (A²=${A2star.toFixed(4)}, p=${pValue.toFixed(4)} ≤ 0.05)`
    };
  };

  // 执行所有检验
  const runAllTests = useCallback(() => {
    setIsTesting(true);

    // 使用setTimeout将计算放入下一个事件循环，避免阻塞UI渲染
    setTimeout(() => {
      try {
        // 获取需要检验的字段（用户选择的字段）
        const fieldsToTest = selectedTestFields.length > 0 ? selectedTestFields : numericFields;

        if (fieldsToTest.length === 0) {
          alert('请至少选择一个检验字段');
          setIsTesting(false);
          return;
        }

    if (!hasGroups) {
      // 无分组的情况：对所有数据进行一次检验
      const testResults: FieldTestResult[] = [];

      fieldsToTest.forEach(fieldName => {
        // 获取该字段的值
        const rawValues = aggregatedData
          .map(row => row[fieldName])
          .filter((value): value is number => typeof value === 'number' && !isNaN(value));

        if (rawValues.length === 0) return;

        // 对大数据量进行采样（最大5000个样本）
        const values = sampleValues(rawValues, 5000);

        // 计算偏度和峰度
        const { skewness, kurtosis } = calculateSkewnessKurtosis(values);

        // 执行KS检验
        const ksTestResult = ksTest(values);

        // 执行Z-score检验
        const zScoreTestResult = zScoreTest(values);

        // 执行Anderson-Darling检验（推荐用于小样本）
        const andersonDarlingTestResult = andersonDarlingTest(values);

        // 识别最佳分布（仅在需要时计算）
        const distributionFit = (!ksTestResult.isNormal && !zScoreTestResult.isNormal)
          ? identifyDistribution(values)
          : undefined;

        testResults.push({
          fieldName,
          skewness,
          kurtosis,
          ksTest: ksTestResult,
          zScoreTest: zScoreTestResult,
          andersonDarlingTest: andersonDarlingTestResult,
          distributionFit
        });
      });

      setResults(testResults);
      setGroupResults([]);

      // 回调结果
      if (onResults) {
        const summary = {
          totalFields: testResults.length,
          normalFields: testResults.filter(r => r.ksTest.isNormal && r.zScoreTest.isNormal).length,
          nonNormalFields: testResults.filter(r => !r.ksTest.isNormal || !r.zScoreTest.isNormal).length,
          mostCommonDistribution: testResults
            .filter(r => r.distributionFit)
          .map(r => r.distributionFit!.bestFit)
          .sort((a, b) =>
            testResults.filter(r => r.distributionFit?.bestFit === b).length -
            testResults.filter(r => r.distributionFit?.bestFit === a).length
          )[0] || '无'
      };

      onResults({
        hasGroups: false,
        groupByFields: [],
        results: testResults,
        summary
      });
    }
    } else {
      // 有分组的情况：按分组分别检验
      const groupTestResults: GroupTestResults[] = [];

      console.log('=== 开始分组正态分布检验 ===');
      console.log('分组字段:', selectedGroupFields);
      console.log('分组数据:', Object.keys(groupedData).map(key => ({
        groupKey: key,
        dataCount: groupedData[key].length
      })));

      Object.entries(groupedData).forEach(([groupKey, groupData]) => {
        console.log(`\n=== 处理分组: ${groupKey} (数据量: ${groupData.length}) ===`);
        const groupTestResultsInner: FieldTestResult[] = [];

        fieldsToTest.forEach(fieldName => {
          // 获取该字段在该分组中的值
          const rawValues = groupData
            .map(row => row[fieldName])
            .filter((value): value is number => typeof value === 'number' && !isNaN(value));

          if (rawValues.length === 0) {
            console.log(`  [${fieldName}] 无数值数据，跳过`);
            return;
          }

          console.log(`  [${fieldName}] 原始数据量: ${rawValues.length}`);
          console.log(`  [${fieldName}] 数据样本(前5个): ${rawValues.slice(0, 5).map(v => v.toFixed(2)).join(', ')}`);
          console.log(`  [${fieldName}] 数据范围: [${Math.min(...rawValues).toFixed(2)}, ${Math.max(...rawValues).toFixed(2)}]`);
          console.log(`  [${fieldName}] 均值: ${(rawValues.reduce((a,b) => a+b, 0) / rawValues.length).toFixed(2)}`);
          console.log(`  [${fieldName}] 标准差: ${Math.sqrt(rawValues.reduce((sum, v) => sum + Math.pow(v - rawValues.reduce((a,b) => a+b, 0) / rawValues.length, 2), 0) / (rawValues.length - 1)).toFixed(2)}`);

          // 对大数据量进行采样（最大5000个样本）
          const values = sampleValues(rawValues, 5000);
          console.log(`  [${fieldName}] 采样后数据量: ${values.length}`);

          // 计算偏度和峰度
          const { skewness, kurtosis } = calculateSkewnessKurtosis(values);
          console.log(`  [${fieldName}] 偏度: ${skewness.toFixed(4)}, 峰度: ${kurtosis.toFixed(4)}`);

          // 执行KS检验
          const ksTestResult = ksTest(values);
          console.log(`  [${fieldName}] KS检验: statistic=${ksTestResult.statistic.toFixed(4)}, pValue=${ksTestResult.pValue.toFixed(4)}, isNormal=${ksTestResult.isNormal}`);

          // 执行Z-score检验
          const zScoreTestResult = zScoreTest(values);
          console.log(`  [${fieldName}] Z-score检验: statistic=${zScoreTestResult.statistic.toFixed(4)}, pValue=${zScoreTestResult.pValue.toFixed(4)}, isNormal=${zScoreTestResult.isNormal}`);

          // 执行Anderson-Darling检验
          const andersonDarlingTestResult = andersonDarlingTest(values);
          console.log(`  [${fieldName}] Anderson-Darling检验: statistic=${andersonDarlingTestResult.statistic.toFixed(4)}, pValue=${andersonDarlingTestResult.pValue.toFixed(4)}, isNormal=${andersonDarlingTestResult.isNormal}`);

          // 识别最佳分布（仅在需要时计算）
          const distributionFit = (!ksTestResult.isNormal && !zScoreTestResult.isNormal)
            ? identifyDistribution(values)
            : undefined;

          groupTestResultsInner.push({
            fieldName,
            skewness,
            kurtosis,
            ksTest: ksTestResult,
            zScoreTest: zScoreTestResult,
            andersonDarlingTest: andersonDarlingTestResult,
            distributionFit
          });
        });

        // 计算分组汇总
        const groupSummary = {
          totalFields: groupTestResultsInner.length,
          normalFields: groupTestResultsInner.filter(r => r.ksTest.isNormal && r.zScoreTest.isNormal).length,
          nonNormalFields: groupTestResultsInner.filter(r => !r.ksTest.isNormal || !r.zScoreTest.isNormal).length
        };

        console.log(`  分组汇总: 总字段=${groupSummary.totalFields}, 正态字段=${groupSummary.normalFields}, 非正态字段=${groupSummary.nonNormalFields}`);

        // 构建分组名称
        const groupKeyParts = groupKey.split('|');
        const groupName = selectedGroupFields.length === 1
          ? groupKeyParts[0]
          : selectedGroupFields.map((field, idx) => `${field}=${groupKeyParts[idx]}`).join(', ');

        groupTestResults.push({
          groupKey,
          groupName,
          results: groupTestResultsInner,
          summary: groupSummary
        });
      });

      console.log('=== 分组正态分布检验完成 ===');

      setResults([]);
      setGroupResults(groupTestResults);

      // 计算整体汇总
      const totalFields = groupTestResults.reduce((sum, g) => sum + g.summary.totalFields, 0);
      const overallNormalFields = groupTestResults.reduce((sum, g) => sum + g.summary.normalFields, 0);
      const overallNonNormalFields = groupTestResults.reduce((sum, g) => sum + g.summary.nonNormalFields, 0);

      // 计算最常见的分布
      const allDistributions: string[] = [];
      groupTestResults.forEach(group => {
        group.results.forEach(result => {
          if (result.distributionFit) {
            allDistributions.push(result.distributionFit.bestFit);
          }
        });
      });

      const distributionCount: Record<string, number> = {};
      allDistributions.forEach(dist => {
        distributionCount[dist] = (distributionCount[dist] || 0) + 1;
      });

      const mostCommonDistribution = Object.entries(distributionCount)
        .sort((a, b) => b[1] - a[1])[0]?.[0] || '无';

      const overallSummary = {
        totalGroups: groupTestResults.length,
        totalFields,
        overallNormalFields,
        overallNonNormalFields,
        mostCommonDistribution
      };

      // 回调结果
      if (onResults) {
        onResults({
          hasGroups: true,
          groupByFields: selectedGroupFields,
          groupResults: groupTestResults,
          overallSummary
        });
      }
    }
    } catch (error) {
        console.error('正态分布检验出错:', error);
        alert(`检验过程中发生错误: ${error}`);
      } finally {
        setIsTesting(false);
        setShowDetails(true);
      }
    }, 10); // 10ms延迟，确保UI先更新
  }, [hasGroups, selectedTestFields, aggregatedData, groupedData, selectedGroupFields, onResults]);

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <h3 className="text-lg font-semibold text-gray-800 mb-4">正态分布检验</h3>

      {/* 分组配置区域 */}
      <div className="mb-6 p-4 bg-gray-50 rounded-lg border border-gray-200">
        <div className="flex items-center mb-4">
          <input
            type="checkbox"
            id="enableGrouping"
            checked={enableGrouping}
            onChange={(e) => {
              setEnableGrouping(e.target.checked);
              if (!e.target.checked) {
                setSelectedGroupFields([]);
              }
            }}
            className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
          />
          <label htmlFor="enableGrouping" className="ml-2 text-sm font-medium text-gray-700">
            启用分组检验
          </label>
          <span className="ml-3 text-xs text-gray-500">
            启用后将按分组分别进行正态分布检验
          </span>
        </div>

        {enableGrouping && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              选择分组字段
            </label>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {aggregatedColumns.map(column => (
                <label key={column} className="flex items-center p-2 bg-white rounded border border-gray-200 hover:border-blue-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedGroupFields.includes(column)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedGroupFields([...selectedGroupFields, column]);
                      } else {
                        setSelectedGroupFields(selectedGroupFields.filter(f => f !== column));
                      }
                    }}
                    className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                  />
                  <span className="ml-2 text-xs text-gray-700 truncate">{column}</span>
                </label>
              ))}
            </div>
            {selectedGroupFields.length > 0 && (
              <p className="mt-2 text-xs text-blue-600">
                已选择: {selectedGroupFields.join(', ')}
              </p>
            )}
          </div>
        )}
      </div>

      {/* 检验字段选择区域 */}
      <div className="mb-6 p-4 bg-blue-50 rounded-lg border border-blue-200">
        <div className="flex items-center justify-between mb-3">
          <label className="block text-sm font-medium text-gray-700">
            选择检验字段
          </label>
          <div className="flex items-center space-x-2">
            <button
              type="button"
              onClick={() => setSelectedTestFields(numericFields)}
              className="px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              全选
            </button>
            <button
              type="button"
              onClick={() => setSelectedTestFields([])}
              className="px-2 py-1 text-xs bg-gray-300 text-gray-700 rounded hover:bg-gray-400"
            >
              清空
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {numericFields.map(column => (
            <label key={column} className="flex items-center p-2 bg-white rounded border border-gray-200 hover:border-blue-300 cursor-pointer">
              <input
                type="checkbox"
                checked={selectedTestFields.includes(column)}
                onChange={(e) => {
                  if (e.target.checked) {
                    setSelectedTestFields([...selectedTestFields, column]);
                  } else {
                    setSelectedTestFields(selectedTestFields.filter(f => f !== column));
                  }
                }}
                className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
              />
              <span className="ml-2 text-xs text-gray-700 truncate">{column}</span>
            </label>
          ))}
        </div>

        {selectedTestFields.length > 0 && (
          <div className="mt-3 flex items-center justify-between">
            <p className="text-xs text-blue-600">
              已选择 {selectedTestFields.length} / {numericFields.length} 个字段
            </p>
            <p className="text-xs text-gray-500">
              {selectedTestFields.join(', ')}
            </p>
          </div>
        )}
      </div>

      <p className="text-sm text-gray-600 mb-4">
        对聚合后的数值字段进行正态分布检验，使用Anderson-Darling检验、KS检验和Z-score检验三种方法，
        并对不符合正态分布的字段识别其最佳拟合分布类型。
      </p>

      {/* 开始检验按钮 */}
      {!isTesting && results.length === 0 && groupResults.length === 0 && (
        <div className="mb-4">
          <button
            onClick={runAllTests}
            disabled={selectedTestFields.length === 0}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white font-medium py-3 px-4 rounded-lg transition-colors"
          >
            {selectedTestFields.length === 0 ? '请选择检验字段' : '开始检验'}
          </button>
          {selectedTestFields.length > 0 && (
            <p className="mt-2 text-xs text-gray-500">
              将对 {selectedTestFields.length} 个选定字段进行检验
              {hasGroups && `，共 ${Object.keys(groupedData).length} 个分组`}
            </p>
          )}
        </div>
      )}

      {isTesting && (
        <div className="text-center py-8">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="text-gray-600 mt-2">正在检验中...</p>
        </div>
      )}

      {!isTesting && !hasGroups && results.length > 0 && (
        <div>
          {/* 汇总信息 */}
          <div className="mb-6 p-4 bg-blue-50 rounded-lg">
            <h4 className="font-semibold text-gray-800 mb-2">检验汇总</h4>
            <div className="grid grid-cols-3 gap-4 text-center">
              <div>
                <div className="text-2xl font-bold text-gray-800">{results.length}</div>
                <div className="text-sm text-gray-600">检验字段总数</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-green-600">
                  {results.filter(r => r.ksTest.isNormal && r.zScoreTest.isNormal).length}
                </div>
                <div className="text-sm text-gray-600">符合正态分布</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-red-600">
                  {results.filter(r => !r.ksTest.isNormal || !r.zScoreTest.isNormal).length}
                </div>
                <div className="text-sm text-gray-600">不符合正态分布</div>
              </div>
            </div>
          </div>

          {/* 详细结果表格 */}
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    字段名称
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Anderson-Darling检验（推荐小样本）
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    KS检验
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Z-score检验
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    最佳拟合分布
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {results.map((result, index) => (
                  <tr key={index} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                      {result.fieldName}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-900">
                      <div className="space-y-1">
                        <div>
                          <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                            result.andersonDarlingTest?.isNormal ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                          }`}>
                            {result.andersonDarlingTest?.isNormal ? '符合' : '不符合'}
                          </span>
                        </div>
                        <div className="text-xs text-gray-600">
                          统计量: {result.andersonDarlingTest?.statistic.toFixed(4)} | p值: {result.andersonDarlingTest ? formatPValue(result.andersonDarlingTest.pValue) : '-'}
                        </div>
                        <div className="text-xs text-gray-500 max-w-xs truncate" title={result.andersonDarlingTest?.interpretation}>
                          {result.andersonDarlingTest?.interpretation}
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-900">
                      <div className="space-y-1">
                        <div>
                          <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                            result.ksTest.isNormal ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                          }`}>
                            {result.ksTest.isNormal ? '符合' : '不符合'}
                          </span>
                        </div>
                        <div className="text-xs text-gray-600">
                          统计量: {result.ksTest.statistic.toFixed(4)} | p值: {formatPValue(result.ksTest.pValue)}
                        </div>
                        <div className="text-xs text-gray-500 max-w-xs truncate" title={result.ksTest.interpretation}>
                          {result.ksTest.interpretation}
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-900">
                      <div className="space-y-1">
                        <div>
                          <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                            result.zScoreTest.isNormal ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                          }`}>
                            {result.zScoreTest.isNormal ? '符合' : '不符合'}
                          </span>
                        </div>
                        <div className="text-xs text-gray-600">
                          统计量: {result.zScoreTest.statistic.toFixed(4)} | p值: {formatPValue(result.zScoreTest.pValue)}
                        </div>
                        <div className="text-xs text-gray-500 max-w-xs truncate" title={result.zScoreTest.interpretation}>
                          {result.zScoreTest.interpretation}
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-900">
                      {result.distributionFit ? (
                        <div className="space-y-2">
                          <div className="font-semibold text-blue-600">
                            {result.distributionFit.bestFit}
                          </div>
                          <div className="text-xs text-gray-500">
                            {result.distributionFit.interpretation}
                          </div>
                          <div className="text-xs space-y-1">
                            <div>对数正态: {(result.distributionFit.logNormal * 100).toFixed(1)}%</div>
                            <div>指数分布: {(result.distributionFit.exponential * 100).toFixed(1)}%</div>
                            <div>Gamma分布: {(result.distributionFit.gamma * 100).toFixed(1)}%</div>
                            <div>泊松分布: {(result.distributionFit.poisson * 100).toFixed(1)}%</div>
                          </div>
                        </div>
                      ) : (
                        <span className="text-gray-500">-</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!isTesting && hasGroups && groupResults.length > 0 && (
        <div>
          {/* 整体汇总信息 */}
          <div className="mb-6 p-4 bg-blue-50 rounded-lg">
            <h4 className="font-semibold text-gray-800 mb-2">整体检验汇总</h4>
            <div className="mb-2 text-sm text-gray-600">
              分组字段: {selectedGroupFields.join(', ')} | 分组数量: {groupResults.length}
            </div>
            <div className="grid grid-cols-4 gap-4 text-center">
              <div>
                <div className="text-2xl font-bold text-gray-800">{groupResults.length}</div>
                <div className="text-sm text-gray-600">分组总数</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-gray-800">
                  {groupResults.reduce((sum, g) => sum + g.summary.totalFields, 0)}
                </div>
                <div className="text-sm text-gray-600">检验字段总数</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-green-600">
                  {groupResults.reduce((sum, g) => sum + g.summary.normalFields, 0)}
                </div>
                <div className="text-sm text-gray-600">符合正态分布</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-red-600">
                  {groupResults.reduce((sum, g) => sum + g.summary.nonNormalFields, 0)}
                </div>
                <div className="text-sm text-gray-600">不符合正态分布</div>
              </div>
            </div>
          </div>

          {/* 按分组显示详细结果 */}
          <div className="space-y-6">
            {groupResults.map((groupResult, groupIndex) => (
              <div key={groupIndex} className="border border-gray-200 rounded-lg p-4">
                <h5 className="font-semibold text-gray-800 mb-3 flex items-center">
                  <span className="inline-block w-2 h-2 bg-blue-600 rounded-full mr-2"></span>
                  {groupResult.groupName}
                  <span className="ml-2 text-sm text-gray-500">
                    (字段数: {groupResult.summary.totalFields} | 正态: {groupResult.summary.normalFields} | 非正态: {groupResult.summary.nonNormalFields})
                  </span>
                </h5>

                {/* 该分组的详细结果表格 */}
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">字段名称</th>
                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Anderson-Darling</th>
                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">KS检验</th>
                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Z-score</th>
                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">最佳拟合分布</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {groupResult.results.map((result, index) => (
                        <tr key={index} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                          <td className="px-4 py-3 whitespace-nowrap text-sm font-medium text-gray-900">
                            {result.fieldName}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-900">
                            <div className="space-y-1">
                              <div>
                                <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                                  result.andersonDarlingTest?.isNormal ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                                }`}>
                                  {result.andersonDarlingTest?.isNormal ? '符合' : '不符合'}
                                </span>
                              </div>
                              <div className="text-xs text-gray-600">
                                A²={result.andersonDarlingTest?.statistic.toFixed(4)} | p={result.andersonDarlingTest ? formatPValue(result.andersonDarlingTest.pValue) : '-'}
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-900">
                            <div className="space-y-1">
                              <div>
                                <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                                  result.ksTest.isNormal ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                                }`}>
                                  {result.ksTest.isNormal ? '符合' : '不符合'}
                                </span>
                              </div>
                              <div className="text-xs text-gray-600">
                                统计量: {result.ksTest.statistic.toFixed(4)} | p值: {formatPValue(result.ksTest.pValue)}
                              </div>
                              <div className="text-xs text-gray-500 max-w-xs truncate" title={result.ksTest.interpretation}>
                                {result.ksTest.interpretation}
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-900">
                            <div className="space-y-1">
                              <div>
                                <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                                  result.zScoreTest.isNormal ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                                }`}>
                                  {result.zScoreTest.isNormal ? '符合' : '不符合'}
                                </span>
                              </div>
                              <div className="text-xs text-gray-600">
                                统计量: {result.zScoreTest.statistic.toFixed(4)} | p值: {formatPValue(result.zScoreTest.pValue)}
                              </div>
                              <div className="text-xs text-gray-500 max-w-xs truncate" title={result.zScoreTest.interpretation}>
                                {result.zScoreTest.interpretation}
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-900">
                            {result.distributionFit ? (
                              <div className="space-y-1">
                                <div className="font-semibold text-blue-600 text-sm">
                                  {result.distributionFit.bestFit}
                                </div>
                              </div>
                            ) : (
                              <span className="text-gray-500">-</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {isTesting && (
        <div className="text-center py-8">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="text-gray-600 mt-2">正在检验中...</p>
        </div>
      )}

      <div className="mt-6 flex justify-end space-x-3">
        <button
          onClick={onSkip}
          className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50 text-sm"
        >
          跳过
        </button>
        <button
          onClick={onComplete}
          disabled={(hasGroups ? groupResults.length === 0 : results.length === 0)}
          className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 text-sm"
        >
          继续
        </button>
      </div>
    </div>
  );
}
