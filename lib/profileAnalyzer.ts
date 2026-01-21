import { callLLM, LLMConfig, simpleCollectLLMResponse, SimpleMessage } from './llmService';
import { ProfileAnalysisConfig, MethodConfig } from '../types/data';
import { formatNumberWithCommas, formatSmart } from './numberFormatter';

export interface ProfileCategory {
  category: string;
  description: string;
  indicators: {
    [key: string]: any;
    totalAmount?: number;
    transactionCount?: number;
    avgAmount?: number;
    frequency?: string;
    timeInterval?: string;
    riskLevel?: string;
    objectCount?: number;
  };
  confidence: number;
}

export interface AnalysisIndicator {
  totalAmount: number;
  transactionCount: number;
  avgAmount: number;
  frequency: string;
  timeInterval: string;
  [key: string]: any;
}

export interface ClassificationRule {
  name: string;
  condition: string;
  riskLevel: string;
  description: string;
}

export interface ClassificationParams {
  valueField: string;
  valueLabel: string;
  countField: string;
  countLabel: string;
  // IQR方法参数
  valueQ1?: number;
  valueQ2?: number;
  valueQ3?: number;
  valueIQR?: number;
  valueHighThreshold?: number;
  valueLowThreshold?: number;
  countQ1?: number;
  countQ2?: number;
  countQ3?: number;
  countIQR?: number;
  countHighThreshold?: number;
  countLowThreshold?: number;
  // 均值标准差方法参数
  valueMean?: number;
  valueStdDev?: number;
  countMean?: number;
  countStdDev?: number;
  // 方法类型
  method: 'iqr' | 'stddev';
  // 倍数参数
  upperMultiplier?: number;
  lowerMultiplier?: number;
}

export interface GroupAnalysisResult {
  groupValue: string;
  categories: ProfileCategory[];
  analysis: string;
  indicators: any[];
}

/**
 * 使用大语言模型进行智能画像分析
 * 采用相对引用原则，基于实际数据和用户配置进行动态分析
 */
export class ProfileAnalyzer {
  
  /**
   * 分析聚合后的数据，生成智能分类
   * @param aggregatedData 聚合后的数据
   * @param columns 数据列名
   * @param config 用户配置的分析参数（可选）
   * @param methodConfig 用户配置的方法和参数（可选）
   */
  static async analyzeWithModel(
    aggregatedData: any[],
    columns: string[],
    config?: ProfileAnalysisConfig,
    methodConfig?: MethodConfig,
    columnTypes?: Record<string, string>
  ): Promise<{
    categories: ProfileCategory[];
    analysis: string;
    indicators: AnalysisIndicator[];
    classificationRules?: ClassificationRule[];
    classificationParams?: ClassificationParams;
  }> {
    if (!aggregatedData || aggregatedData.length === 0) {
      throw new Error('没有聚合数据可供分析');
    }

    // 动态识别字段（不假设任何特定领域）
    const fieldIdentify = this.identifyFields(aggregatedData, columns, config);

    // 根据方法配置计算阈值（IQR或标准差）
    const thresholds = methodConfig?.method === 'stddev'
      ? this.calculateStdDevThresholds(
          aggregatedData,
          fieldIdentify.primaryValueField,
          fieldIdentify.primaryCountField,
          methodConfig.stddev.upperMultiplier,
          methodConfig.stddev.lowerMultiplier
        )
      : this.calculateIQRThresholds(
          aggregatedData,
          fieldIdentify.primaryValueField,
          fieldIdentify.primaryCountField,
          methodConfig?.iqr.upperMultiplier,
          methodConfig?.iqr.lowerMultiplier
        );

    // 检查阈值是否计算成功
    if (!thresholds.valueThresholds || !thresholds.countThresholds) {
      const methodName = methodConfig?.method === 'stddev' ? '均值标准差法' : '四分位法（IQR）';
      throw new Error(`无法使用${methodName}计算分类阈值。请确保数据中包含有效的数值字段。`);
    }

    // 构建基于实际数据的通用提示词
    const analysisPrompt = this.buildDynamicAnalysisPrompt(
      aggregatedData,
      columns,
      fieldIdentify,
      config,
      thresholds
    );

    console.log('=== Dynamic LLM Analysis Configuration ===');
    console.log('Data rows:', aggregatedData.length);
    console.log('Identified fields:', fieldIdentify);
    console.log('Method config:', methodConfig);
    console.log('Thresholds:', JSON.stringify(thresholds, null, 2));
    console.log('Prompt length:', analysisPrompt.length);

    try {
      const modelConfig: LLMConfig = {
        model: "doubao-seed-1-6-251015",
        temperature: 0.3,
        max_tokens: 2000,
        thinking: "disabled"
      };

      console.log('=== Calling LLM Model ===');

      const messages: SimpleMessage[] = [
        { role: 'system', content: this.getUniversalSystemPrompt(fieldIdentify) },
        { role: 'user', content: analysisPrompt }
      ];

      // 调用模型并获取响应
      const fullResponse = await simpleCollectLLMResponse(messages, modelConfig);

      console.log('=== LLM Response Received ===');
      console.log('Response length:', fullResponse.length);

      // 解析JSON响应
      try {
        const jsonMatch = fullResponse.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsedResult = JSON.parse(jsonMatch[0]);
          console.log('=== LLM Response Parsed Successfully ===');
          console.log('Categories count:', parsedResult.categories?.length || 0);

          // 基于实际数据为每个分类统计对象数量
          if (parsedResult.categories && Array.isArray(parsedResult.categories)) {
            this.calculateObjectCount(
              parsedResult.categories,
              aggregatedData,
              fieldIdentify,
              methodConfig
            );

            // 确保所有用户配置的分析字段都被添加到indicators中
            if (config && config.analysisFields && config.analysisFields.length > 0) {
              console.log('=== Adding User Configured Analysis Fields to Categories ===');
              const configuredFields = config.analysisFields.map(f => f.fieldName);

              parsedResult.categories.forEach((category: any) => {
                if (!category.indicators) {
                  category.indicators = {};
                }

                // 为每个用户配置的字段添加到indicators
                configuredFields.forEach(fieldName => {
                  if (category.indicators[fieldName] === undefined) {
                    category.indicators[fieldName] = 0;
                    console.log(`Added field "${fieldName}" to category "${category.category}" with default value 0`);
                  }
                });

                // 如果还没有累加这些字段的值，根据分类重新计算
                if (!this.areUserFieldsAggregated(category, configuredFields)) {
                  console.log(`Aggregating user fields for category "${category.category}"...`);
                  const aggregatedValues = this.aggregateUserFieldsForCategory(
                    category,
                    aggregatedData,
                    fieldIdentify.primaryValueField,
                    fieldIdentify.primaryCountField,
                    thresholds.valueThresholds,
                    thresholds.countThresholds,
                    configuredFields
                  );

                  // 更新indicators中的用户字段值
                  Object.entries(aggregatedValues).forEach(([fieldName, value]) => {
                    if (category.indicators[fieldName] !== undefined) {
                      category.indicators[fieldName] = value;
                      console.log(`Updated category "${category.category}" field "${fieldName}" to value: ${value}`);
                    }
                  });
                }
              });
            }
          }

          // 如果LLM没有返回classificationRules和classificationParams，则使用备用分析方案生成
          if (!parsedResult.classificationRules || !parsedResult.classificationParams) {
            console.log('LLM did not return classification rules/params, generating fallback...');
            const fallback = this.getFallbackAnalysis(aggregatedData, columns, fieldIdentify, config, methodConfig, columnTypes);
            parsedResult.classificationRules = fallback.classificationRules;
            parsedResult.classificationParams = fallback.classificationParams;
          }

          return parsedResult as any;
        } else {
          throw new Error('Model response format is incorrect');
        }
      } catch (parseError) {
        console.error('=== JSON parsing failed, using fallback ===');
        console.error('Parse error:', parseError);
        return this.getFallbackAnalysis(aggregatedData, columns, fieldIdentify, config, methodConfig, columnTypes);
      }

    } catch (error) {
      console.error('=== Model call failed, using fallback ===');
      console.error('Error:', error);
      return this.getFallbackAnalysis(aggregatedData, columns, fieldIdentify, config, methodConfig, columnTypes);
    }
  }

  /**
   * 动态识别数据中的关键字段（不假设特定领域）
   */
  private static identifyFields(
    data: any[], 
    columns: string[],
    config?: ProfileAnalysisConfig
  ): {
    primaryValueField: string | null;
    primaryCountField: string | null;
    secondaryValueField: string | null;
    fieldLabels: { [key: string]: string };
  } {
    const actualColumns = Object.keys(data[0] || {});
    const numericColumns = actualColumns.filter(col =>
      data.some(row => typeof row[col] === 'number' && !isNaN(row[col]))
    );
    const sumColumns = actualColumns.filter(col => col.includes('_sum'));
    const countColumns = actualColumns.filter(col => col.includes('_count') || col === '_count');

    console.log('=== Identifying Fields from Data ===');
    console.log('Available columns:', actualColumns);
    console.log('Numeric columns:', numericColumns);
    console.log('Sum columns:', sumColumns);
    console.log('Count columns:', countColumns);

    // 识别主要数值字段（用于分类的主要依据）
    let primaryValueField: string | null = null;

    // 优先级1: 使用配置的分析字段（直接使用用户配置的第一个字段名）
    if (config && config.analysisFields && config.analysisFields.length > 0) {
      const firstConfiguredField = config.analysisFields[0].fieldName;
      if (actualColumns.includes(firstConfiguredField)) {
        primaryValueField = firstConfiguredField;
        console.log('Using configured 1st analysis field as primary value field:', primaryValueField);
      }
    }

    // 优先级2: 优先使用 sum 列作为主要数值字段
    if (!primaryValueField && sumColumns.length > 0) {
      primaryValueField = sumColumns[0];
      console.log('Using sum column as primary value field:', primaryValueField);
    }

    // 优先级3: 使用第一个数值字段
    if (!primaryValueField && numericColumns.length > 0) {
      primaryValueField = numericColumns[0];
      console.log('Using first numeric column as primary value field:', primaryValueField);
    }

    // 识别主要计数字段
    let primaryCountField: string | null = null;

    // 优先级1: 使用配置的分析字段（从第二个字段开始）
    if (config && config.analysisFields && config.analysisFields.length > 1) {
      const configuredCountField = config.analysisFields[1].fieldName;
      if (actualColumns.includes(configuredCountField)) {
        primaryCountField = configuredCountField;
        console.log('Using configured 2nd analysis field as primary count field:', primaryCountField);
      }
    }

    // 优先级2: 使用包含 _count 的列
    if (!primaryCountField && countColumns.length > 0) {
      primaryCountField = countColumns[0];
      console.log('Using count column as primary count field:', primaryCountField);
    } else if (!primaryCountField) {
      // 查找包含 count 关键词的字段
      const countField = numericColumns.find(col =>
        col.toLowerCase().includes('count') ||
        col.toLowerCase().includes('计数') ||
        col.toLowerCase().includes('数量') ||
        col.toLowerCase().includes('次数')
      );
      primaryCountField = countField || null;
      console.log('Using identified count field:', primaryCountField);
    }

    // 识别次要数值字段（用于补充分析）
    let secondaryValueField: string | null = null;
    if (sumColumns.length > 1) {
      secondaryValueField = sumColumns[1];
    } else if (numericColumns.length > 1 && numericColumns[0] !== primaryValueField) {
      secondaryValueField = numericColumns[1];
    }

    // 动态生成字段标签（基于实际字段名）
    const fieldLabels: { [key: string]: string } = {};
    if (primaryValueField) {
      fieldLabels[primaryValueField] = this.generateFieldLabel(primaryValueField);
    }
    if (primaryCountField) {
      fieldLabels[primaryCountField] = this.generateFieldLabel(primaryCountField);
    }
    if (secondaryValueField) {
      fieldLabels[secondaryValueField] = this.generateFieldLabel(secondaryValueField);
    }

    return {
      primaryValueField,
      primaryCountField,
      secondaryValueField,
      fieldLabels
    };
  }

  /**
   * 基于字段名生成友好的标签（不假设特定领域）
   * 注意：这个标签仅用于后端日志和显示，实际显示使用前端 getConfiguredFieldLabel
   */
  private static generateFieldLabel(fieldName: string): string {
    // 返回完整的原始字段名，不移除任何后缀
    // 这样可以确保字段名的完整性，例如 ts_hash_count 会保持为 ts_hash_count
    return fieldName;
  }

  /**
   * 获取通用的 System Prompt（不假设特定领域）
   */
  private static getUniversalSystemPrompt(fieldIdentify: any): string {
    const valueLabel = fieldIdentify.fieldLabels[fieldIdentify.primaryValueField] || '主要数值';
    const countLabel = fieldIdentify.fieldLabels[fieldIdentify.primaryCountField] || '主要计数';

    return `You are a professional data analyst. You need to perform data profiling analysis based on aggregated data.

【Core Requirements - Universal Classification】
The data may come from any domain (e-commerce, finance, healthcare, education, etc.). You must:
1. NOT assume any specific domain terminology
2. Use the actual field names provided in the data
3. Provide generic but meaningful category descriptions
4. Base all analysis on the actual data values and structure

【Field Descriptions - Based on Actual Data】
- Primary Value Field: ${fieldIdentify.primaryValueField} (${valueLabel})
- Primary Count Field: ${fieldIdentify.primaryCountField} (${countLabel})

【Core Classification Method】
You will be provided with the classification method (IQR or Standard Deviation) and exact threshold values in the user message. Use those exact values for classification.

Classification is based on two dimensions:
1. Value dimension (based on primary value field)
2. Frequency dimension (based on primary count field)

【Five Generic Categories】
Use generic but descriptive category names (do NOT use domain-specific terms):
1. **双高型** (High-High)
   - Primary value field ≥ High Threshold for value
   - Primary count field ≥ High Threshold for count
   - Risk Level: High
   - Description: Both dimensions exceed high thresholds, requiring close attention

2. **偏高型（第一字段）** (High for First Field)
   - Primary value field ≥ High Threshold for value
   - Primary count field < High Threshold for count
   - Risk Level: High
   - Description: Primary value dimension exceeds high threshold, requiring attention

3. **偏高型（第二字段）** (High for Second Field)
   - Primary count field ≥ High Threshold for count
   - Primary value field < High Threshold for value
   - Risk Level: High
   - Description: Secondary (count) dimension exceeds high threshold, requiring attention

4. **中间型** (Middle)
   - Primary value field between Low and High Thresholds for value (normal range)
   - Primary count field between Low and High Thresholds for count (normal range)
   - Risk Level: Low
   - Description: Both dimensions are within normal ranges

5. **低值型** (Low-Low)
   - Primary value field ≤ Low Threshold for value
   - OR Primary count field ≤ Low Threshold for count
   - Risk Level: Low
   - Description: At least one dimension is below the low threshold, or neither dimension exceeds the high threshold

【Output Format - Strict JSON】
Output must be in strict JSON format. All values must be based on actual calculations from data.

{
  "categories": [
    {
      "category": "Category name (use one of the five generic categories above)",
      "description": "Category description (generic, not domain-specific)",
      "indicators": {
        "${fieldIdentify.primaryValueField || 'totalAmount'}": Total value for this category (required, number type),
        "${fieldIdentify.primaryCountField || 'transactionCount'}": Total count for this category (required, number type),
        "avgAmount": Average value for this category (required, number type, calculation: totalValue/totalCount),
        "frequency": "high" or "low" (required, string type),
        "timeInterval": "regular" or other interval description (required, string type),
        "riskLevel": "high" or "low" (required, string type),
        "objectCount": Number of objects in this category (required, number type)
      },
      "confidence": 0.85
    }
  ],
  "analysis": "Overall analysis summary (paragraph format). Must describe: (1) Total number of objects analyzed, (2) Profiling classification method explicitly state whether it's '四分位数法（IQR）' or '均值标准差法' with actual parameter values (IQR multipliers or Standard Deviation multipliers), (3) Actual threshold values used for both dimensions (show calculations like Q3 + N*IQR or Mean + N*StdDev), (4) Count of objects in each category, (5) Overall total and average values. Use generic language, do NOT assume domain-specific context. Write as a continuous paragraph, not bullet points.",
  "indicators": [
    {
      "${fieldIdentify.primaryValueField || 'totalAmount'}": Total value (required, number type),
      "${fieldIdentify.primaryCountField || 'transactionCount'}": Total count (required, number type),
      "avgAmount": Average value (required, number type),
      "frequency": "high" or "low",
      "timeInterval": "regular" or other description,
      "objectCount": Number of objects (required, number type)
    }
  ],
  "classificationRules": [
    {
      "name": "Category name",
      "condition": "Classification condition with actual thresholds",
      "riskLevel": "high" or "low",
      "description": "Brief description"
    }
  ],
  "classificationParams": {
    "valueField": "Primary value field name",
    "valueLabel": "Primary value field label",
    "countField": "Primary count field name",
    "countLabel": "Primary count field label",
    "method": "iqr" or "stddev",
    "valueMean": Mean value (number, for stddev method),
    "valueStdDev": Standard deviation value (number, for stddev method),
    "valueQ1": Q1 value (number, for iqr method),
    "valueQ2": Q2 value (number, for iqr method),
    "valueQ3": Q3 value (number, for iqr method),
    "valueIQR": IQR value (number, for iqr method),
    "valueHighThreshold": High threshold value (number)",
    "valueLowThreshold": Low threshold value (number)",
    "countMean": Mean value (number, for stddev method)",
    "countStdDev": Standard deviation value (number, for stddev method)",
    "countQ1": Q1 value (number, for iqr method)",
    "countQ2": Q2 value (number, for iqr method)",
    "countQ3": Q3 value (number, for iqr method)",
    "countIQR": IQR value (number, for iqr method)",
    "countHighThreshold": High threshold value (number)",
    "countLowThreshold": Low threshold value (number)"
  }
}

【CRITICAL REQUIREMENTS】
1. MUST use the classification method and threshold values provided in the user message
2. Category names must be generic (双高型, 偏高型（第一字段）, 偏高型（第二字段）, 中间型, 低值型)
3. All field names in indicators must match the actual field names in the data
4. All values must be based on actual calculation from the provided data
5. Do NOT use domain-specific terminology in category names or descriptions
6. objectCount must reflect the actual number of data rows classified into each category
7. Classification parameters must include the method used ("iqr" or "stddev")
7. MUST use the exact IQR threshold values provided in the prompt for classification`;
  }

  /**
   * 构建基于实际数据的动态分析提示词
   */
  private static buildDynamicAnalysisPrompt(
    data: any[],
    columns: string[],
    fieldIdentify: any,
    config?: ProfileAnalysisConfig,
    thresholds?: any
  ): string {
    const { primaryValueField, primaryCountField, secondaryValueField, fieldLabels } = fieldIdentify;

    console.log('=== Calculated Thresholds ===');
    console.log('Primary Value Field:', primaryValueField);
    console.log('Thresholds:', thresholds);
    console.log('Method:', thresholds?.method || 'iqr');

    // 生成数据摘要
    const dataSummary = data.slice(0, 20).map((row, index) => {
      const rowData: any = { index: index + 1 };
      columns.forEach(col => {
        const value = row[col];
        rowData[col] = typeof value === 'number' && !isNaN(value) ? value.toFixed(2) : (value || 'N/A');
      });
      return rowData;
    });

    let prompt = '=== Data Overview ===\n';
    prompt += `Total records: ${data.length}\n`;
    prompt += `Available columns: ${columns.join(', ')}\n\n`;

    prompt += '=== Field Identification ===\n';
    if (primaryValueField) {
      prompt += `Primary Value Field: ${primaryValueField} (${fieldLabels[primaryValueField]})\n`;
    }
    if (primaryCountField) {
      prompt += `Primary Count Field: ${primaryCountField} (${fieldLabels[primaryCountField]})\n`;
    }
    if (secondaryValueField) {
      prompt += `Secondary Value Field: ${secondaryValueField} (${fieldLabels[secondaryValueField]})\n`;
    }
    prompt += '\n';

    const method = thresholds?.method || 'iqr';

    // 根据方法类型生成不同的阈值信息
    if (method === 'iqr') {
      // IQR方法阈值
      if (thresholds?.valueThresholds) {
        const { q1, q2, q3, iqr, highThreshold, lowThreshold } = thresholds.valueThresholds;
        prompt += '=== Value Field IQR Thresholds ===\n';
        prompt += `Field: ${primaryValueField}\n`;
        prompt += `Q1 (25%): ${q1.toFixed(2)}\n`;
        prompt += `Q2 (Median, 50%): ${q2.toFixed(2)}\n`;
        prompt += `Q3 (75%): ${q3.toFixed(2)}\n`;
        prompt += `IQR (Q3 - Q1): ${iqr.toFixed(2)}\n`;
        prompt += `High Threshold (Q3 + ${thresholds.upperMultiplier}*IQR): ${highThreshold.toFixed(2)}\n`;
        prompt += `Low Threshold (Q1 - ${thresholds.lowerMultiplier}*IQR): ${lowThreshold.toFixed(2)}\n\n`;
      }

      if (thresholds?.countThresholds) {
        const { q1, q2, q3, iqr, highThreshold, lowThreshold } = thresholds.countThresholds;
        prompt += '=== Count Field IQR Thresholds ===\n';
        prompt += `Field: ${primaryCountField}\n`;
        prompt += `Q1 (25%): ${q1.toFixed(2)}\n`;
        prompt += `Q2 (Median, 50%): ${q2.toFixed(2)}\n`;
        prompt += `Q3 (75%): ${q3.toFixed(2)}\n`;
        prompt += `IQR (Q3 - Q1): ${iqr.toFixed(2)}\n`;
        prompt += `High Threshold (Q3 + ${thresholds.upperMultiplier}*IQR): ${highThreshold.toFixed(2)}\n`;
        prompt += `Low Threshold (Q1 - ${thresholds.lowerMultiplier}*IQR): ${lowThreshold.toFixed(2)}\n\n`;
      }
    } else {
      // 标准差方法阈值
      if (thresholds?.valueThresholds && primaryValueField) {
        const { mean, stdDev, highThreshold, lowThreshold } = thresholds.valueThresholds;
        prompt += '=== Value Field Standard Deviation Thresholds ===\n';
        prompt += `Field: ${primaryValueField}\n`;
        prompt += `Mean: ${mean.toFixed(2)}\n`;
        prompt += `Standard Deviation: ${stdDev.toFixed(2)}\n`;
        prompt += `High Threshold (Mean + ${thresholds.upperMultiplier}*StdDev): ${highThreshold.toFixed(2)}\n`;
        prompt += `Low Threshold (Mean - ${thresholds.lowerMultiplier}*StdDev): ${lowThreshold.toFixed(2)}\n\n`;
      }

      if (thresholds?.countThresholds && primaryCountField) {
        const { mean, stdDev, highThreshold, lowThreshold } = thresholds.countThresholds;
        prompt += '=== Count Field Standard Deviation Thresholds ===\n';
        prompt += `Field: ${primaryCountField}\n`;
        prompt += `Mean: ${mean.toFixed(2)}\n`;
        prompt += `Standard Deviation: ${stdDev.toFixed(2)}\n`;
        prompt += `High Threshold (Mean + ${thresholds.upperMultiplier}*StdDev): ${highThreshold.toFixed(2)}\n`;
        prompt += `Low Threshold (Mean - ${thresholds.lowerMultiplier}*StdDev): ${lowThreshold.toFixed(2)}\n\n`;
      }
    }

    prompt += `=== Data Sample (first 20 records) ===\n${JSON.stringify(dataSummary, null, 2)}\n\n`;

    // 生成分类规则（使用实际阈值）
    prompt += '=== Classification Rules (Use These Exact Thresholds) ===\n';

    if (thresholds?.valueThresholds && thresholds?.countThresholds) {
      const { highThreshold: highValue, lowThreshold: lowValue } = thresholds.valueThresholds;
      const { highThreshold: highCount, lowThreshold: lowCount } = thresholds.countThresholds;

      if (method === 'iqr') {
        prompt += `1. 双高型: ${fieldLabels[primaryValueField]} ≥ ${highValue.toFixed(2)} (Q3 + ${thresholds.upperMultiplier}*IQR) AND ${fieldLabels[primaryCountField]} ≥ ${highCount.toFixed(2)} (Q3 + ${thresholds.upperMultiplier}*IQR), Risk: High\n`;
        prompt += `2. 偏高型（第一字段）: ${fieldLabels[primaryValueField]} ≥ ${highValue.toFixed(2)} (Q3 + ${thresholds.upperMultiplier}*IQR) AND ${fieldLabels[primaryCountField]} < ${highCount.toFixed(2)}, Risk: High\n`;
        prompt += `3. 偏高型（第二字段）: ${fieldLabels[primaryValueField]} < ${highValue.toFixed(2)} AND ${fieldLabels[primaryCountField]} ≥ ${highCount.toFixed(2)} (Q3 + ${thresholds.upperMultiplier}*IQR), Risk: High\n`;
        prompt += `4. 中间型: ${fieldLabels[primaryValueField]} between ${lowValue.toFixed(2)} and ${highValue.toFixed(2)} AND ${fieldLabels[primaryCountField]} between ${lowCount.toFixed(2)} and ${highCount.toFixed(2)}, Risk: Low\n`;
        prompt += `5. 低值型: ${fieldLabels[primaryValueField]} ≤ ${lowValue.toFixed(2)} (Q1 - ${thresholds.lowerMultiplier}*IQR) AND ${fieldLabels[primaryCountField]} ≤ ${lowCount.toFixed(2)} (Q1 - ${thresholds.lowerMultiplier}*IQR), Risk: Low\n\n`;
      } else {
        prompt += `1. 双高型: ${fieldLabels[primaryValueField]} ≥ ${highValue.toFixed(2)} (Mean + ${thresholds.upperMultiplier}*StdDev) AND ${fieldLabels[primaryCountField]} ≥ ${highCount.toFixed(2)} (Mean + ${thresholds.upperMultiplier}*StdDev), Risk: High\n`;
        prompt += `2. 偏高型（第一字段）: ${fieldLabels[primaryValueField]} ≥ ${highValue.toFixed(2)} (Mean + ${thresholds.upperMultiplier}*StdDev) AND ${fieldLabels[primaryCountField]} < ${highCount.toFixed(2)}, Risk: High\n`;
        prompt += `3. 偏高型（第二字段）: ${fieldLabels[primaryValueField]} < ${highValue.toFixed(2)} AND ${fieldLabels[primaryCountField]} ≥ ${highCount.toFixed(2)} (Mean + ${thresholds.upperMultiplier}*StdDev), Risk: High\n`;
        prompt += `4. 中间型: ${fieldLabels[primaryValueField]} between ${lowValue.toFixed(2)} and ${highValue.toFixed(2)} AND ${fieldLabels[primaryCountField]} between ${lowCount.toFixed(2)} and ${highCount.toFixed(2)}, Risk: Low\n`;
        prompt += `5. 低值型: ${fieldLabels[primaryValueField]} ≤ ${lowValue.toFixed(2)} (Mean - ${thresholds.lowerMultiplier}*StdDev) AND ${fieldLabels[primaryCountField]} ≤ ${lowCount.toFixed(2)} (Mean - ${thresholds.lowerMultiplier}*StdDev), Risk: Low\n\n`;
      }
    } else {
      prompt += '1. 双高型: value ≥ (Q3 + 1.5*IQR) AND count ≥ (Q3 + 1.5*IQR), Risk: High\n';
      prompt += '2. 偏高型（第一字段）: value ≥ (Q3 + 1.5*IQR) AND count < (Q3 + 1.5*IQR), Risk: High\n';
      prompt += '3. 偏高型（第二字段）: value < (Q3 + 1.5*IQR) AND count ≥ (Q3 + 1.5*IQR), Risk: High\n';
      prompt += '4. 中间型: value between Q1 and (Q3 + 1.5*IQR) AND count between Q1 and (Q3 + 1.5*IQR), Risk: Low\n';
      prompt += '5. 低值型: value ≤ Q1 AND count ≤ Q1, Risk: Low\n\n';
    }

    prompt += '=== Analysis Steps ===\n';
    prompt += '1. Use the primary value field and primary count field identified above\n';
    prompt += '2. Apply the exact threshold values provided above (do NOT recalculate)\n';
    prompt += '3. Classify each object into one of the four generic categories\n';
    prompt += '4. Aggregate values for each category\n';
    prompt += '5. Calculate averages: avgAmount = totalValue / totalCount\n';
    prompt += '6. Determine frequency (high/low) based on count thresholds\n';
    prompt += '7. Determine timeInterval pattern (regular/irregular)\n';
    prompt += '8. Count objects in each category\n\n';

    if (config && config.analysisFields && config.analysisFields.length > 0) {
      prompt += '=== User Configured Analysis Fields ===\n';
      config.analysisFields.forEach(field => {
        prompt += `- ${field.fieldName}: ${field.description}\n`;
      });
      prompt += '\n';
    }

    return prompt;
  }

  /**
   * 计算IQR阈值
   */
  private static calculateIQRThresholds(
    data: any[],
    valueField: string | null,
    countField: string | null,
    upperMultiplier: number = 1.5,
    lowerMultiplier: number = 0
  ): {
    valueThresholds: any;
    countThresholds: any;
    method: 'iqr';
    upperMultiplier: number;
    lowerMultiplier: number;
  } {
    const result: any = {
      valueThresholds: null,
      countThresholds: null,
      method: 'iqr',
      upperMultiplier,
      lowerMultiplier
    };

    if (valueField) {
      const values = data.map(row => row[valueField])
        .filter(v => typeof v === 'number' && !isNaN(v))
        .sort((a, b) => a - b);

      if (values.length > 0) {
        const n = values.length;
        const q1Pos = Math.floor(n * 0.25);
        const q2Pos = Math.floor(n * 0.5);
        const q3Pos = Math.floor(n * 0.75);

        const q1 = values[q1Pos];
        const q2 = values[q2Pos];
        const q3 = values[q3Pos];
        const iqr = q3 - q1;

        result.valueThresholds = {
          q1,
          q2,
          q3,
          iqr,
          highThreshold: q3 + upperMultiplier * iqr,
          lowThreshold: q1 - lowerMultiplier * iqr
        };
      }
    }

    if (countField) {
      const values = data.map(row => row[countField])
        .filter(v => typeof v === 'number' && !isNaN(v))
        .sort((a, b) => a - b);

      if (values.length > 0) {
        const n = values.length;
        const q1Pos = Math.floor(n * 0.25);
        const q2Pos = Math.floor(n * 0.5);
        const q3Pos = Math.floor(n * 0.75);

        const q1 = values[q1Pos];
        const q2 = values[q2Pos];
        const q3 = values[q3Pos];
        const iqr = q3 - q1;

        result.countThresholds = {
          q1,
          q2,
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
   * 计算标准差阈值
   */
  private static calculateStdDevThresholds(
    data: any[],
    valueField: string | null,
    countField: string | null,
    upperMultiplier: number = 2,
    lowerMultiplier: number = 2
  ): {
    valueThresholds: any;
    countThresholds: any;
    method: 'stddev';
    upperMultiplier: number;
    lowerMultiplier: number;
  } {
    console.log('=== Calculating Standard Deviation Thresholds ===');
    console.log('Value field:', valueField);
    console.log('Count field:', countField);
    console.log('Upper multiplier:', upperMultiplier);
    console.log('Lower multiplier:', lowerMultiplier);

    const result: any = {
      valueThresholds: null,
      countThresholds: null,
      method: 'stddev',
      upperMultiplier,
      lowerMultiplier
    };

    const calculateMeanAndStdDev = (values: number[]): { mean: number; stdDev: number } => {
      const n = values.length;
      if (n === 0) return { mean: 0, stdDev: 0 };

      const mean = values.reduce((sum, v) => sum + v, 0) / n;
      const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / n;
      const stdDev = Math.sqrt(variance);

      return { mean, stdDev };
    };

    if (valueField) {
      const values = data.map(row => row[valueField])
        .filter(v => typeof v === 'number' && !isNaN(v));

      console.log(`Value field "${valueField}" values count:`, values.length);
      if (values.length > 0) {
        const { mean, stdDev } = calculateMeanAndStdDev(values);

        result.valueThresholds = {
          mean,
          stdDev,
          highThreshold: mean + upperMultiplier * stdDev,
          lowThreshold: mean - lowerMultiplier * stdDev
        };
        console.log(`Value field thresholds:`, result.valueThresholds);
      } else {
        console.warn(`No valid numeric values found for field "${valueField}"`);
      }
    } else {
      console.warn('Value field is null or undefined');
    }

    if (countField) {
      const values = data.map(row => row[countField])
        .filter(v => typeof v === 'number' && !isNaN(v));

      console.log(`Count field "${countField}" values count:`, values.length);
      if (values.length > 0) {
        const { mean, stdDev } = calculateMeanAndStdDev(values);

        result.countThresholds = {
          mean,
          stdDev,
          highThreshold: mean + upperMultiplier * stdDev,
          lowThreshold: mean - lowerMultiplier * stdDev
        };
        console.log(`Count field thresholds:`, result.countThresholds);
      } else {
        console.warn(`No valid numeric values found for field "${countField}"`);
      }
    } else {
      console.warn('Count field is null or undefined');
    }

    console.log('Final result:', JSON.stringify(result, null, 2));
    return result;
  }

  /**
   * 为每个分类计算对象数量
   */
  private static calculateObjectCount(
    categories: any[],
    data: any[],
    fieldIdentify: any,
    methodConfig?: MethodConfig
  ): void {
    const { primaryValueField, primaryCountField } = fieldIdentify;
    
    if (!primaryValueField || !primaryCountField) {
      console.warn('Cannot calculate objectCount: missing primary fields');
      return;
    }

    // 根据方法配置重新计算阈值（确保与模型使用的阈值一致）
    const thresholds = methodConfig?.method === 'stddev'
      ? this.calculateStdDevThresholds(
          data,
          primaryValueField,
          primaryCountField,
          methodConfig?.stddev.upperMultiplier,
          methodConfig?.stddev.lowerMultiplier
        )
      : this.calculateIQRThresholds(
          data,
          primaryValueField,
          primaryCountField,
          methodConfig?.iqr?.upperMultiplier,
          methodConfig?.iqr?.lowerMultiplier
        );
    const { highThreshold: highValue, lowThreshold: lowValue } = thresholds.valueThresholds;
    const { highThreshold: highCount, lowThreshold: lowCount } = thresholds.countThresholds;

    console.log('=== Calculating objectCount for each category ===');
    console.log('Method:', methodConfig?.method || 'iqr');
    console.log('Value thresholds:', { high: highValue, low: lowValue });
    console.log('Count thresholds:', { high: highCount, low: lowCount });

    // 为每个分类统计对象数量
    categories.forEach((cat: any) => {
      const categoryName = cat.category;
      let count = 0;

      data.forEach(row => {
        const value = row[primaryValueField] || 0;
        const countVal = row[primaryCountField] || 0;

        let belongsToCategory = false;
        
        if (categoryName === '双高型') {
          belongsToCategory = value >= highValue && countVal >= highCount;
        } else if (categoryName === '偏高型（第一字段）') {
          belongsToCategory = value >= highValue && countVal < highCount;
        } else if (categoryName === '偏高型（第二字段）') {
          belongsToCategory = countVal >= highCount && value < highValue;
        } else if (categoryName === '中间型') {
          belongsToCategory = value > lowValue && value < highValue &&
                             countVal > lowCount && countVal < highCount;
        } else if (categoryName === '低值型') {
          belongsToCategory = value <= lowValue && countVal <= lowCount;
        }

        if (belongsToCategory) {
          count++;
        }
      });

      if (!cat.indicators) {
        cat.indicators = {};
      }
      cat.indicators.objectCount = count;
      console.log(`Category "${categoryName}": objectCount = ${count}`);
    });
  }

  /**
   * 备选分析方案（当LLM调用失败时）
   */
  private static getFallbackAnalysis(
    aggregatedData: any[],
    columns: string[],
    fieldIdentify: any,
    config?: ProfileAnalysisConfig,
    methodConfig?: MethodConfig,
    columnTypes?: Record<string, string>
  ): {
    categories: ProfileCategory[];
    analysis: string;
    indicators: AnalysisIndicator[];
    classificationRules: ClassificationRule[];
    classificationParams: ClassificationParams;
  } {
    const method = methodConfig?.method || 'iqr';
    console.log(`Using fallback analysis based on ${method} method`);

    const { primaryValueField, primaryCountField, fieldLabels } = fieldIdentify;

    const thresholds = method === 'stddev'
      ? this.calculateStdDevThresholds(
          aggregatedData,
          primaryValueField,
          primaryCountField,
          methodConfig?.stddev.upperMultiplier,
          methodConfig?.stddev.lowerMultiplier
        )
      : this.calculateIQRThresholds(
          aggregatedData,
          primaryValueField,
          primaryCountField,
          methodConfig?.iqr.upperMultiplier,
          methodConfig?.iqr.lowerMultiplier
        );

    const valueThresholds = thresholds.valueThresholds;
    const countThresholds = thresholds.countThresholds;

    if (!valueThresholds || !countThresholds) {
      throw new Error('无法计算阈值，请检查数据');
    }

    const { highThreshold: highValue, lowThreshold: lowValue } = valueThresholds;
    const { highThreshold: highCount, lowThreshold: lowCount } = countThresholds;

    // 获取用户配置的所有分析字段，确保这些字段也被聚合到分类中
    const configuredAnalysisFields = config?.analysisFields?.map(f => f.fieldName) || [];
    console.log('Configured analysis fields to include in indicators:', configuredAnalysisFields);

    // 确定用于分类的字段名（注意：这里使用字段名，不是描述）
    // 前端会根据这些字段名从 profileAnalysisConfig 中动态获取描述
    let valueFieldName = primaryValueField;
    let countFieldName = primaryCountField;

    if (config && config.analysisFields && config.analysisFields.length > 0) {
      // valueFieldName 使用第一个分析字段
      if (config.analysisFields[0] && config.analysisFields[0].fieldName) {
        valueFieldName = config.analysisFields[0].fieldName;
        console.log(`Using 1st analysis field for value: ${valueFieldName}`);
      }

      // countFieldName 使用第二个分析字段
      if (config.analysisFields[1] && config.analysisFields[1].fieldName) {
        countFieldName = config.analysisFields[1].fieldName;
        console.log(`Using 2nd analysis field for count: ${countFieldName}`);
      }
    }

    // 初始化分类基础指标（显式类型）
    const baseIndicators: any = {
      [primaryValueField]: 0,
      [primaryCountField]: 0,
      avgAmount: 0,
      frequency: 'high',
      timeInterval: 'regular',
      riskLevel: 'high',
      objectCount: 0
    };

    // 添加用户配置的字段到基础指标中
    configuredAnalysisFields.forEach(fieldName => {
      if (!baseIndicators.hasOwnProperty(fieldName)) {
        baseIndicators[fieldName] = 0;
      }
    });

    const categories = [
      {
        category: '双高型',
        description: `两个维度均超过高阈值，需要重点关注`,
        indicators: { ...baseIndicators },
        confidence: 0.90
      },
      {
        category: '偏高型（第一字段）',
        description: `第一维度超过高阈值，需要关注`,
        indicators: {
          [primaryValueField]: 0,
          [primaryCountField]: 0,
          avgAmount: 0,
          frequency: 'high',
          timeInterval: 'regular',
          riskLevel: 'high',
          objectCount: 0
        },
        confidence: 0.90
      },
      {
        category: '偏高型（第二字段）',
        description: `第二维度超过高阈值，需要关注`,
        indicators: {
          [primaryValueField]: 0,
          [primaryCountField]: 0,
          avgAmount: 0,
          frequency: 'high',
          timeInterval: 'regular',
          riskLevel: 'high',
          objectCount: 0
        },
        confidence: 0.90
      },
      {
        category: '中间型',
        description: `两个维度都在正常范围内`,
        indicators: {
          [primaryValueField]: 0,
          [primaryCountField]: 0,
          avgAmount: 0,
          frequency: 'normal',
          timeInterval: 'regular',
          riskLevel: 'low',
          objectCount: 0
        },
        confidence: 0.90
      },
      {
        category: '低值型',
        description: `至少有一个维度低于低阈值`,
        indicators: {
          [primaryValueField]: 0,
          [primaryCountField]: 0,
          avgAmount: 0,
          frequency: 'low',
          timeInterval: 'irregular',
          riskLevel: 'low',
          objectCount: 0
        },
        confidence: 0.90
      }
    ];

    // 分类并聚合数据
    aggregatedData.forEach(row => {
      const value = row[primaryValueField] || 0;
      const countVal = row[primaryCountField] || 0;

      let categoryIndex = 0;
      if (value >= highValue && countVal >= highCount) {
        categoryIndex = 0; // 双高型
      } else if (value >= highValue && countVal < highCount) {
        categoryIndex = 1; // 偏高型（第一字段）
      } else if (countVal >= highCount && value < highValue) {
        categoryIndex = 2; // 偏高型（第二字段）
      } else if (value > lowValue && value < highValue && countVal > lowCount && countVal < highCount) {
        categoryIndex = 3; // 中间型
      } else {
        categoryIndex = 4; // 低值型
      }

      const category = categories[categoryIndex];
      const indicators = category.indicators;
      indicators[primaryValueField] += value;
      indicators[primaryCountField] += countVal;
      indicators.objectCount += 1;

      // 累加所有用户配置的分析字段
      configuredAnalysisFields.forEach(fieldName => {
        if (row[fieldName] !== undefined && typeof row[fieldName] === 'number') {
          if (indicators[fieldName] === undefined) {
            indicators[fieldName] = 0;
          }
          indicators[fieldName] += row[fieldName];
        }
      });
    });

    // 计算平均值
    categories.forEach(cat => {
      if (cat.indicators[primaryCountField] > 0) {
        cat.indicators.avgAmount = cat.indicators[primaryValueField] / cat.indicators[primaryCountField];
      }
    });

    // 获取字段标签（用于显示）
    const valueLabelForDisplay = fieldLabels[valueFieldName] || valueFieldName || '数值';
    const countLabelForDisplay = fieldLabels[countFieldName] || countFieldName || '计数';

    // 根据方法生成分类规则
    let methodDesc = '';
    if (method === 'iqr') {
      methodDesc = `四分位数法（IQR）`;
    } else {
      methodDesc = `均值标准差法`;
    }

    const classificationRules = [
      {
        name: '双高型',
        condition: `${valueFieldName} ≥ ${formatSmart(highValue, columnTypes?.[primaryValueField] || 'number', 2)} 且 ${countFieldName} ≥ ${formatSmart(highCount, columnTypes?.[primaryCountField] || 'number', 2)}`,
        riskLevel: '高',
        description: '两个维度均超过高阈值，需要重点关注'
      },
      {
        name: '偏高型（第一字段）',
        condition: `${valueFieldName} ≥ ${formatSmart(highValue, columnTypes?.[primaryValueField] || 'number', 2)} 且 ${countFieldName} < ${formatSmart(highCount, columnTypes?.[primaryCountField] || 'number', 2)}`,
        riskLevel: '高',
        description: '第一维度超过高阈值，需要关注'
      },
      {
        name: '偏高型（第二字段）',
        condition: `${countFieldName} ≥ ${formatSmart(highCount, columnTypes?.[primaryCountField] || 'number', 2)} 且 ${valueFieldName} < ${formatSmart(highValue, columnTypes?.[primaryValueField] || 'number', 2)}`,
        riskLevel: '高',
        description: '第二维度超过高阈值，需要关注'
      },
      {
        name: '中间型',
        condition: `${countFieldName} 在 (${formatSmart(lowCount, columnTypes?.[primaryCountField] || 'number', 2)}, ${formatSmart(highCount, columnTypes?.[primaryCountField] || 'number', 2)}) 且 ${valueFieldName} 在 (${formatSmart(lowValue, columnTypes?.[primaryValueField] || 'number', 2)}, ${formatSmart(highValue, columnTypes?.[primaryValueField] || 'number', 2)})`,
        riskLevel: '低',
        description: '两个维度都在正常范围内'
      },
      {
        name: '低值型',
        condition: `${valueFieldName} ≤ ${formatSmart(lowValue, columnTypes?.[primaryValueField] || 'number', 2)} 或 ${countFieldName} ≤ ${formatSmart(lowCount, columnTypes?.[primaryCountField] || 'number', 2)}`,
        riskLevel: '低',
        description: '至少有一个维度低于低阈值'
      }
    ];

    // 生成classificationParams，根据方法类型包含不同的参数
    const classificationParams: any = {
      valueField: valueFieldName,
      valueLabel: valueFieldName,
      countField: countFieldName,
      countLabel: countFieldName,
      method: method,
      upperMultiplier: thresholds.upperMultiplier,
      lowerMultiplier: thresholds.lowerMultiplier
    };

    if (method === 'iqr') {
      Object.assign(classificationParams, {
        valueQ1: valueThresholds.q1,
        valueQ2: valueThresholds.q2,
        valueQ3: valueThresholds.q3,
        valueIQR: valueThresholds.iqr,
        valueHighThreshold: highValue,
        valueLowThreshold: lowValue,
        countQ1: countThresholds.q1,
        countQ2: countThresholds.q2,
        countQ3: countThresholds.q3,
        countIQR: countThresholds.iqr,
        countHighThreshold: highCount,
        countLowThreshold: lowCount
      });
    } else {
      Object.assign(classificationParams, {
        valueMean: valueThresholds.mean,
        valueStdDev: valueThresholds.stdDev,
        valueHighThreshold: highValue,
        valueLowThreshold: lowValue,
        countMean: countThresholds.mean,
        countStdDev: countThresholds.stdDev,
        countHighThreshold: highCount,
        countLowThreshold: lowCount
      });
    }

    const totalValue = aggregatedData.reduce((sum, row) => sum + (row[primaryValueField] || 0), 0);
    const totalCount = aggregatedData.reduce((sum, row) => sum + (row[primaryCountField] || 0), 0);

    // 分析概况（文字段落形式）
    let analysis = '';
    if (method === 'iqr') {
      analysis = `本次画像分析基于${methodDesc}对 ${aggregatedData.length} 个对象进行了智能分类。分析过程中，系统根据${fieldLabels[primaryCountField]}和${fieldLabels[primaryValueField]}两个维度，通过计算四分位数（Q1、Q2、Q3）和四分位距（IQR），确定了分类的上下阈值。${fieldLabels[primaryCountField]}的Q1为${formatSmart(countThresholds.q1, columnTypes?.[primaryCountField] || 'number', 2)}，Q3为${formatSmart(countThresholds.q3, columnTypes?.[primaryCountField] || 'number', 2)}，IQR为${formatSmart(countThresholds.iqr, columnTypes?.[primaryCountField] || 'number', 2)}，上阈值倍数为${thresholds.upperMultiplier}，高阈值为Q3+${thresholds.upperMultiplier}*IQR即${formatSmart(highCount, columnTypes?.[primaryCountField] || 'number', 2)}，下阈值倍数为${thresholds.lowerMultiplier}，低阈值为Q1-${thresholds.lowerMultiplier}*IQR即${formatSmart(lowCount, columnTypes?.[primaryCountField] || 'number', 2)}；${fieldLabels[primaryValueField]}的Q1为${formatSmart(valueThresholds.q1, columnTypes?.[primaryValueField] || 'number', 2)}，Q3为${formatSmart(valueThresholds.q3, columnTypes?.[primaryValueField] || 'number', 2)}，IQR为${formatSmart(valueThresholds.iqr, columnTypes?.[primaryValueField] || 'number', 2)}，上阈值倍数为${thresholds.upperMultiplier}，高阈值为${formatSmart(highValue, columnTypes?.[primaryValueField] || 'number', 2)}，下阈值倍数为${thresholds.lowerMultiplier}，低阈值为${formatSmart(lowValue, columnTypes?.[primaryValueField] || 'number', 2)}。基于这些阈值，系统将所有对象分为双高型、偏高型（第一字段）、偏高型（第二字段）、中间型、低值型五个类别，其中双高型、偏高型（第一字段）、偏高型（第二字段）对象被识别为高风险群体，需要重点关注。分析结果显示，${categories[0].indicators.objectCount}个对象被归类为双高型，${categories[1].indicators.objectCount}个对象被归类为偏高型（第一字段），${categories[2].indicators.objectCount}个对象被归类为偏高型（第二字段），${categories[3].indicators.objectCount}个对象为中间型，${categories[4].indicators.objectCount}个对象为低值型。整体来看，${fieldLabels[primaryValueField]}总计为${formatSmart(totalValue, columnTypes?.[primaryValueField] || 'number', 2)}，${fieldLabels[primaryCountField]}总计为${formatSmart(totalCount, columnTypes?.[primaryCountField] || 'number', 2)}。`;
    } else {
      analysis = `本次画像分析基于${methodDesc}对 ${aggregatedData.length} 个对象进行了智能分类。分析过程中，系统根据${fieldLabels[primaryCountField]}和${fieldLabels[primaryValueField]}两个维度，通过计算均值和标准差，确定了分类的上下阈值。${fieldLabels[primaryCountField]}的均值为${formatSmart(countThresholds.mean, columnTypes?.[primaryCountField] || 'number', 2)}，标准差为${formatSmart(countThresholds.stdDev, columnTypes?.[primaryCountField] || 'number', 2)}，上阈值倍数为${thresholds.upperMultiplier}，高阈值为Mean+${thresholds.upperMultiplier}*StdDev即${formatSmart(highCount, columnTypes?.[primaryCountField] || 'number', 2)}，下阈值倍数为${thresholds.lowerMultiplier}，低阈值为Mean-${thresholds.lowerMultiplier}*StdDev即${formatSmart(lowCount, columnTypes?.[primaryCountField] || 'number', 2)}；${fieldLabels[primaryValueField]}的均值为${formatSmart(valueThresholds.mean, columnTypes?.[primaryValueField] || 'number', 2)}，标准差为${formatSmart(valueThresholds.stdDev, columnTypes?.[primaryValueField] || 'number', 2)}，上阈值倍数为${thresholds.upperMultiplier}，高阈值为${formatSmart(highValue, columnTypes?.[primaryValueField] || 'number', 2)}，下阈值倍数为${thresholds.lowerMultiplier}，低阈值为${formatSmart(lowValue, columnTypes?.[primaryValueField] || 'number', 2)}。基于这些阈值，系统将所有对象分为双高型、偏高型（第一字段）、偏高型（第二字段）、中间型、低值型五个类别，其中双高型、偏高型（第一字段）、偏高型（第二字段）对象被识别为高风险群体，需要重点关注。分析结果显示，${categories[0].indicators.objectCount}个对象被归类为双高型，${categories[1].indicators.objectCount}个对象被归类为偏高型（第一字段），${categories[2].indicators.objectCount}个对象被归类为偏高型（第二字段），${categories[3].indicators.objectCount}个对象为中间型，${categories[4].indicators.objectCount}个对象为低值型。整体来看，${fieldLabels[primaryValueField]}总计为${formatSmart(totalValue, columnTypes?.[primaryValueField] || 'number', 2)}，${fieldLabels[primaryCountField]}总计为${formatSmart(totalCount, columnTypes?.[primaryCountField] || 'number', 2)}。`;
    }

    return {
      categories,
      analysis,
      indicators: categories.map(cat => ({
        totalAmount: cat.indicators[primaryValueField],
        transactionCount: cat.indicators[primaryCountField],
        avgAmount: cat.indicators.avgAmount,
        frequency: cat.indicators.frequency,
        timeInterval: cat.indicators.timeInterval,
        objectCount: cat.indicators.objectCount
      })) as AnalysisIndicator[],
      classificationRules,
      classificationParams
    };
  }

  /**
   * 使用用户自定义配置进行分析
   */
  static async analyzeWithCustomConfig(
    aggregatedData: any[],
    config: ProfileAnalysisConfig,
    methodConfig?: MethodConfig,
    columnTypes?: Record<string, string>
  ): Promise<any> {
    console.log('=== Analyzing with User Custom Config ===');
    console.log('Config:', JSON.stringify(config, null, 2));
    console.log('Method Config:', JSON.stringify(methodConfig, null, 2));
    console.log('Group By Field:', config.groupByFieldName);

    const columns = Object.keys(aggregatedData[0] || {});

    // 检查是否配置了分组字段
    const hasGroupBy = config.groupByFieldName && config.groupByFieldName.trim() !== '';

    if (!hasGroupBy) {
      // 无分组：直接根据上一步聚合结果进行画像分析并返回结果
      console.log('=== No group field specified, performing overall analysis ===');
      const result = await this.analyzeWithModel(aggregatedData, columns, config, methodConfig, columnTypes);

      return {
        basicAnalysis: result,
        aggregatedData,
        intelligentAnalysis: {
          transferTypeAnalysis: {
            'all': {
              type: 'all',
              typeLabel: '整体分析',
              categories: result.categories,
              analysis: result.analysis,
              indicators: result.indicators,
              classificationRules: result.classificationRules,
              classificationParams: result.classificationParams
            }
          },
          allCategories: result.categories,
          classificationRules: result.classificationRules,
          classificationParams: result.classificationParams,
          hasTransferType: false
        }
      };
    }

    // 有分组：按照分组字段的不重复值，循环筛选聚合结果等于选定值的聚合结果，
    // 然后针对选定的聚合结果进行画像分析
    console.log('=== Group analysis mode enabled ===');
    console.log(`Grouping by field: ${config.groupByFieldName}`);

    // 验证分组字段是否存在
    if (!aggregatedData[0] || !aggregatedData[0].hasOwnProperty(config.groupByFieldName)) {
      throw new Error(`分组字段 "${config.groupByFieldName}" 在聚合数据中不存在`);
    }

    // 获取分组字段的所有不重复值
    const groupValues = [...new Set(aggregatedData.map(row => row[config.groupByFieldName] ?? 'null'))];
    console.log(`Found ${groupValues.length} distinct group values:`, groupValues);

    const transferTypeAnalysis: Record<string, any> = {};
    const allCategories: any[] = [];

    // 循环每个分组值，分别进行画像分析
    for (const groupValue of groupValues) {
      console.log(`\n=== Analyzing group: ${config.groupByFieldName} = ${groupValue} ===`);

      // 筛选该分组的数据
      const groupData = aggregatedData.filter(row => row[config.groupByFieldName] === groupValue);
      console.log(`Group data rows: ${groupData.length}`);

      if (groupData.length === 0) {
        console.log(`No data found for group ${groupValue}, skipping`);
        continue;
      }

      // 对该分组数据进行画像分析
      const groupResult = await this.analyzeWithModel(groupData, columns, config, methodConfig, columnTypes);
      console.log(`Group ${groupValue} analysis completed, categories: ${groupResult.categories.length}`);

      // 存储分组分析结果
      transferTypeAnalysis[String(groupValue)] = {
        type: String(groupValue),
        typeLabel: `${config.groupByFieldName}=${groupValue}`,
        categories: groupResult.categories,
        analysis: groupResult.analysis,
        indicators: groupResult.indicators,
        classificationRules: groupResult.classificationRules,
        classificationParams: groupResult.classificationParams
      };

      // 收集所有分类（用于整体统计）
      allCategories.push(...groupResult.categories);
    }

    console.log(`\n=== All groups analyzed ===`);
    console.log(`Total groups: ${Object.keys(transferTypeAnalysis).length}`);
    console.log(`Total categories: ${allCategories.length}`);

    // 从第一个分组中获取分类规则和参数（所有分组应该使用相同的规则）
    const firstGroupKey = Object.keys(transferTypeAnalysis)[0];
    const classificationRules = transferTypeAnalysis[firstGroupKey]?.classificationRules;
    const classificationParams = transferTypeAnalysis[firstGroupKey]?.classificationParams;

    return {
      basicAnalysis: allCategories.length > 0 ? {
        categories: allCategories,
        analysis: `基于分组字段 ${config.groupByFieldName} 的画像分析，共 ${Object.keys(transferTypeAnalysis).length} 个分组`,
        indicators: allCategories.map(cat => cat.indicators).flat()
      } : null,
      aggregatedData,
      intelligentAnalysis: {
        transferTypeAnalysis,
        allCategories,
        classificationRules,
        classificationParams,
        hasTransferType: true
      }
    };
  }

  /**
   * 检查分类中的用户字段是否已经被聚合（有非零值）
   */
  private static areUserFieldsAggregated(
    category: ProfileCategory,
    userFields: string[]
  ): boolean {
    const indicators = category.indicators || {};

    // 检查至少有一个用户字段有非零值
    return userFields.some(fieldName => {
      const value = indicators[fieldName];
      return value !== undefined && value !== null && value !== 0;
    });
  }

  /**
   * 为特定分类聚合用户字段的值
   */
  private static aggregateUserFieldsForCategory(
    category: ProfileCategory,
    data: any[],
    primaryValueField: string | null,
    primaryCountField: string | null,
    valueThresholds: any,
    countThresholds: any,
    userFields: string[]
  ): { [fieldName: string]: number } {
    const aggregatedValues: { [fieldName: string]: number } = {};
    userFields.forEach(fieldName => {
      aggregatedValues[fieldName] = 0;
    });

    if (!primaryValueField || !primaryCountField) {
      console.warn('Cannot aggregate user fields: missing primary fields');
      return aggregatedValues;
    }

    const categoryName = category.category;
    const { highThreshold: highValue, lowThreshold: lowValue } = valueThresholds;
    const { highThreshold: highCount, lowThreshold: lowCount } = countThresholds;

    console.log(`Aggregating user fields for category "${categoryName}"...`);

    // 根据分类名称筛选数据行
    data.forEach(row => {
      const value = row[primaryValueField] || 0;
      const countVal = row[primaryCountField] || 0;

      let belongsToCategory = false;

      if (categoryName === '双高型') {
        belongsToCategory = value >= highValue && countVal >= highCount;
      } else if (categoryName === '偏高型（第一字段）') {
        belongsToCategory = value >= highValue && countVal < highCount;
      } else if (categoryName === '偏高型（第二字段）') {
        belongsToCategory = countVal >= highCount && value < highValue;
      } else if (categoryName === '中间型') {
        belongsToCategory = value > lowValue && value < highValue &&
                           countVal > lowCount && countVal < highCount;
      } else if (categoryName === '低值型') {
        belongsToCategory = value <= lowValue && countVal <= lowCount;
      }

      if (belongsToCategory) {
        // 累加所有用户字段
        userFields.forEach(fieldName => {
          if (row[fieldName] !== undefined && typeof row[fieldName] === 'number') {
            aggregatedValues[fieldName] += row[fieldName];
          }
        });
      }
    });

    console.log(`Aggregated values for category "${categoryName}":`, aggregatedValues);
    return aggregatedValues;
  }
}
