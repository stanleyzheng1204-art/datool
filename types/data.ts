export interface DataRow {
  [key: string]: any;
}

// 列类型定义
export enum ColumnType {
  STRING = 'string',
  NUMBER = 'number',
  PERCENTAGE = 'percentage',
  DATE = 'date',
  BOOLEAN = 'boolean'
}

export interface ColumnInfo {
  name: string;
  type: ColumnType;
  description?: string;
}

export interface FilterConfig {
  type: 'unique' | 'equals';
  columnA?: string;
  columnB?: string;
  targetColumn?: string;
  targetValue?: any;
}

export interface AggregationConfig {
  groupBy: string[];
  sumColumns: string[];
  countColumns: string[];
  maxColumns: string[];
  minColumns: string[];
  distinctColumns: string[];
}

// 新增：画像分析字段定义
export interface AnalysisFieldDefinition {
  fieldName: string;
  description: string;
}

// 新增：画像分析配置
export interface ProfileAnalysisConfig {
  // 分析对象字段名称
  subjectFieldName: string;
  
  // 需按字段内容分别进行画像分析的字段名称
  groupByFieldName: string;
  
  // 纳入画像分析的数据字段名称及各字段简要意义解释
  analysisFields: AnalysisFieldDefinition[];
}

// 新增：画像分析方法配置
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

export interface ProfileAnalysis {
  pattern: string;
  value: number;
  count: number;
  percentage: number;
}

export interface AnalysisResult {
  aggregatedData: DataRow[];
  profileAnalysis: ProfileAnalysis[];
  summary: {
    totalRows: number;
    filteredRows: number;
    groupedRows: number;
  };
  // 新增：智能画像分析结果
  intelligentAnalysis?: {
    categories?: import('../lib/profileAnalyzer').ProfileCategory[];
    analysis?: string;
    indicators?: import('../lib/profileAnalyzer').AnalysisIndicator[];
    allCategories?: import('../lib/profileAnalyzer').ProfileCategory[];  // 用于无分组时的整体分析
    hasTransferType?: boolean;
    transferTypeAnalysis?: Record<string, any>;  // 支持任意分组键，使用通用类型
    classificationRules?: import('../lib/profileAnalyzer').ClassificationRule[];
    classificationParams?: import('../lib/profileAnalyzer').ClassificationParams;
  };
  // 新增：列类型信息，用于格式化显示
  columnTypes?: Record<string, ColumnType>;
}