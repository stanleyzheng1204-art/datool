import * as XLSX from 'xlsx';
import Papa from 'papaparse';
import { ColumnType, ColumnInfo } from '@/types/data';

export class DataProcessor {
  static async parseFile(file: File, sheetName?: string): Promise<any[]> {
    const extension = file.name.split('.').pop()?.toLowerCase();

    switch (extension) {
      case 'csv':
        return this.parseCSV(file);
      case 'xlsx':
      case 'xls':
        return this.parseExcel(file, sheetName);
      case 'json':
        return this.parseJSON(file);
      default:
        throw new Error(`不支持的文件格式: ${extension}`);
    }
  }

  /**
   * 识别列的类型（数字、百分比、字符串等）
   * @param data 数据数组
   * @returns 列类型映射表 { columnName: ColumnType }
   */
  static detectColumnTypes(data: any[]): Record<string, ColumnType> {
    if (!data || data.length === 0) return {};

    const columns = Object.keys(data[0]);
    const columnTypes: Record<string, ColumnType> = {};

    columns.forEach(column => {
      columnTypes[column] = this.detectSingleColumnType(data, column);
    });

    return columnTypes;
  }

  /**
   * 识别单个列的类型
   */
  private static detectSingleColumnType(data: any[], column: string): ColumnType {
    // 1. 检查列名是否包含百分比相关的关键词
    const columnNameLower = column.toLowerCase();
    const percentageKeywords = ['percent', 'percentage', '比例', '百分比', '占比', 'rate', 'ratio', '%'];
    const hasPercentageKeyword = percentageKeywords.some(keyword => columnNameLower.includes(keyword));

    if (hasPercentageKeyword) {
      // 列名包含百分比关键词，进一步验证数据是否为0-1之间的数值
      const isPercentageData = this.validatePercentageData(data, column);
      if (isPercentageData) {
        return ColumnType.PERCENTAGE;
      }
    }

    // 2. 检查原始数据是否包含"%"符号
    const hasPercentageSymbol = data.some(row => {
      const val = row[column];
      return typeof val === 'string' && val.includes('%');
    });

    if (hasPercentageSymbol) {
      return ColumnType.PERCENTAGE;
    }

    // 3. 检查是否为数字列
    let numberCount = 0;
    let totalCount = 0;
    let minValue = Infinity;
    let maxValue = -Infinity;

    data.forEach(row => {
      const value = row[column];
      if (value !== null && value !== undefined && value !== '') {
        totalCount++;
        if (typeof value === 'number' && !isNaN(value)) {
          numberCount++;
          minValue = Math.min(minValue, value);
          maxValue = Math.max(maxValue, value);
        }
      }
    });

    // 如果超过80%的值是数字
    if (totalCount > 0 && numberCount / totalCount >= 0.8) {
      // 检查是否为百分比数据（0-1之间的数值）
      if (minValue >= 0 && maxValue <= 1 && minValue !== 0 && maxValue !== 1) {
        // 值域在0-1之间，可能是百分比
        return ColumnType.PERCENTAGE;
      }
      return ColumnType.NUMBER;
    }

    return ColumnType.STRING;
  }

  /**
   * 验证数据是否符合百分比格式（0-1之间）
   */
  private static validatePercentageData(data: any[], column: string): boolean {
    let validNumberCount = 0;
    let totalCount = 0;

    data.forEach(row => {
      const value = row[column];
      if (value !== null && value !== undefined && value !== '') {
        totalCount++;
        const numValue = parseFloat(value);
        if (!isNaN(numValue) && numValue >= 0 && numValue <= 1) {
          validNumberCount++;
        }
      }
    });

    // 如果超过80%的值是0-1之间的数字，认为是百分比数据
    return totalCount > 0 && validNumberCount / totalCount >= 0.8;
  }

  /**
   * 获取列信息
   */
  static getColumnInfo(data: any[]): ColumnInfo[] {
    const columnTypes = this.detectColumnTypes(data);
    const columns = Object.keys(columnTypes);

    return columns.map(name => ({
      name,
      type: columnTypes[name]
    }));
  }

  /**
   * 获取Excel文件的所有sheet名称
   */
  static async getExcelSheetNames(file: File): Promise<string[]> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = new Uint8Array(e.target?.result as ArrayBuffer);
          const workbook = XLSX.read(data, { type: 'array' });
          resolve(workbook.SheetNames);
        } catch (error) {
          reject(error);
        }
      };
      reader.onerror = () => reject(new Error('文件读取失败'));
      reader.readAsArrayBuffer(file);
    });
  }

  private static parseCSV(file: File): Promise<any[]> {
    return new Promise((resolve, reject) => {
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => {
          if (results.errors.length > 0) {
            reject(new Error(results.errors[0].message));
          } else {
            // 进行智能类型转换
            const convertedData = this.convertCSVDataTypes(results.data);
            resolve(convertedData);
          }
        },
        error: (error) => reject(error)
      });
    });
  }

  /**
   * 智能转换CSV数据的类型
   * 尝试将字符串值转换为数字类型
   */
  private static convertCSVDataTypes(data: any[]): any[] {
    if (!data || data.length === 0) return data;

    // 获取所有列名
    const columns = Object.keys(data[0]);

    // 对每一列进行类型检查
    columns.forEach(column => {
      let numberCount = 0;
      let totalCount = 0;

      // 检查该列有多少值可以转换为数字
      data.forEach(row => {
        const value = row[column];
        if (value !== null && value !== undefined && value !== '') {
          totalCount++;
          const numValue = parseFloat(value);
          if (!isNaN(numValue)) {
            numberCount++;
          }
        }
      });

      // 如果超过80%的值可以转换为数字，则将该列转换为数字类型
      if (totalCount > 0 && numberCount / totalCount >= 0.8) {
        data.forEach(row => {
          const value = row[column];
          if (value !== null && value !== undefined && value !== '') {
            const numValue = parseFloat(value);
            if (!isNaN(numValue)) {
              row[column] = numValue;
            }
          }
        });
      }
    });

    return data;
  }

  private static parseExcel(file: File, sheetName?: string): Promise<any[]> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = new Uint8Array(e.target?.result as ArrayBuffer);
          const workbook = XLSX.read(data, { type: 'array' });
          const targetSheetName = sheetName || workbook.SheetNames[0];
          const worksheet = workbook.Sheets[targetSheetName];
          const jsonData = XLSX.utils.sheet_to_json(worksheet);
          resolve(jsonData);
        } catch (error) {
          reject(error);
        }
      };
      reader.onerror = () => reject(new Error('文件读取失败'));
      reader.readAsArrayBuffer(file);
    });
  }

  private static parseJSON(file: File): Promise<any[]> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const jsonData = JSON.parse(e.target?.result as string);
          if (Array.isArray(jsonData)) {
            resolve(jsonData);
          } else if (typeof jsonData === 'object' && jsonData.data && Array.isArray(jsonData.data)) {
            resolve(jsonData.data);
          } else {
            reject(new Error('JSON文件格式不正确，需要包含数据数组'));
          }
        } catch (error) {
          reject(new Error('JSON解析失败'));
        }
      };
      reader.onerror = () => reject(new Error('文件读取失败'));
      reader.readAsText(file);
    });
  }

  static filterData(data: any[], config: any): any[] {
    if (!config) return data;

    switch (config.type) {
      case 'unique':
        if (config.columnA && config.columnB) {
          // 获取A列的所有唯一值
          const uniqueValuesA = new Set(data.map(row => row[config.columnA]).filter(val => val != null));
          // 筛选出B列值不在A列唯一值中的行
          const filtered = data.filter(row => {
            const valueB = row[config.columnB];
            return valueB != null && !uniqueValuesA.has(valueB);
          });
          console.log('Filter result:', {
            originalRows: data.length,
            filteredRows: filtered.length,
            uniqueValuesA: Array.from(uniqueValuesA),
            columnA: config.columnA,
            columnB: config.columnB
          });
          return filtered;
        }
        break;
      
      case 'equals':
        if (config.targetColumn && config.targetValue !== undefined) {
          const filtered = data.filter(row => row[config.targetColumn] == config.targetValue);
          console.log('Filter result:', {
            originalRows: data.length,
            filteredRows: filtered.length,
            targetColumn: config.targetColumn,
            targetValue: config.targetValue
          });
          return filtered;
        }
        break;
    }
    
    console.log('No filter applied, returning original data');
    return data;
  }

  static aggregateData(data: any[], config: any): any[] {
    if (!config.groupBy || config.groupBy.length === 0) return data;

    const grouped = data.reduce((acc, row) => {
      const key = config.groupBy.map((col: string) => row[col]).join('|');
      if (!acc[key]) {
        acc[key] = { _group: key, _count: 0 };
        config.groupBy.forEach((col: string) => {
          acc[key][col] = row[col];
        });

        // 初始化 max、min、distinct 的存储结构
        if (config.maxColumns) {
          config.maxColumns.forEach((col: string) => {
            acc[key][`${col}_max`] = null;
          });
        }
        if (config.minColumns) {
          config.minColumns.forEach((col: string) => {
            acc[key][`${col}_min`] = null;
          });
        }
        if (config.distinctColumns) {
          config.distinctColumns.forEach((col: string) => {
            acc[key][`${col}_distinct`] = new Set();
          });
        }
      }

      acc[key]._count++;

      if (config.sumColumns) {
        config.sumColumns.forEach((col: string) => {
          const val = parseFloat(row[col]) || 0;
          acc[key][`${col}_sum`] = (acc[key][`${col}_sum`] || 0) + val;
        });
      }

      if (config.countColumns) {
        config.countColumns.forEach((col: string) => {
          if (row[col] != null && row[col] !== '') {
            acc[key][`${col}_count`] = (acc[key][`${col}_count`] || 0) + 1;
          }
        });
      }

      // 处理 max 聚合
      if (config.maxColumns) {
        config.maxColumns.forEach((col: string) => {
          const val = parseFloat(row[col]);
          if (!isNaN(val)) {
            if (acc[key][`${col}_max`] === null || val > acc[key][`${col}_max`]) {
              acc[key][`${col}_max`] = val;
            }
          }
        });
      }

      // 处理 min 聚合
      if (config.minColumns) {
        config.minColumns.forEach((col: string) => {
          const val = parseFloat(row[col]);
          if (!isNaN(val)) {
            if (acc[key][`${col}_min`] === null || val < acc[key][`${col}_min`]) {
              acc[key][`${col}_min`] = val;
            }
          }
        });
      }

      // 处理 distinct 聚合
      if (config.distinctColumns) {
        config.distinctColumns.forEach((col: string) => {
          if (row[col] != null && row[col] !== '') {
            acc[key][`${col}_distinct`].add(row[col]);
          }
        });
      }

      return acc;
    }, {});

    // 转换结果，将 Set 转换为数组大小
    return Object.values(grouped).map((group: any) => {
      const result: any = { ...group };
      
      // 将 distinct 的 Set 转换为计数
      if (config.distinctColumns) {
        config.distinctColumns.forEach((col: string) => {
          result[`${col}_distinct_count`] = group[`${col}_distinct`].size;
          delete result[`${col}_distinct`]; // 删除 Set 对象
        });
      }
      
      return result;
    });
  }

  /**
   * 按transfer_type分组数据
   * @param data 原始数据
   * @returns 包含流入(IN)和流出(OUT)的数据对象
   */
  static groupByTransferType(data: any[]): {
    IN: any[];
    OUT: any[];
    ALL: any[];
  } {
    const IN_DATA: any[] = [];
    const OUT_DATA: any[] = [];

    data.forEach(row => {
      const transferType = row.transfer_type;
      if (transferType === 'IN' || transferType === 'in' || transferType === '流入') {
        IN_DATA.push(row);
      } else if (transferType === 'OUT' || transferType === 'out' || transferType === '流出') {
        OUT_DATA.push(row);
      }
    });

    return {
      IN: IN_DATA,
      OUT: OUT_DATA,
      ALL: data
    };
  }

  static analyzeProfile(data: any[], valueColumn: string, countColumn: string = '_count'): any[] {
    if (!data || data.length === 0) return [];

    console.log('=== Starting Profile Analysis ===');
    console.log('Value column:', valueColumn);
    console.log('Count column:', countColumn);
    console.log('Data length:', data.length);
    console.log('Sample data item:', data[0]);
    console.log('All available columns:', Object.keys(data[0]));
    console.log('Column types:', Object.keys(data[0]).map(col => ({
      column: col,
      type: typeof data[0][col],
      value: data[0][col],
      isNumeric: typeof data[0][col] === 'number' && !isNaN(data[0][col])
    })));

    // 验证列是否存在
    if (!valueColumn || !data[0].hasOwnProperty(valueColumn)) {
      console.error('Value column not found in data:', valueColumn);
      return data.map(item => ({
        ...item,
        pattern: '数据错误',
        value: 0,
        count: parseInt(item[countColumn]) || 0,
        percentage: 0
      }));
    }

    // 计算value总和和平均值
    const values = data.map(row => {
      const val = parseFloat(row[valueColumn]);
      return isNaN(val) ? 0 : val;
    });
    
    const positiveValues = values.filter(val => val > 0);
    const valueSum = values.reduce((sum, val) => sum + val, 0);
    const avgValue = positiveValues.length > 0 ? valueSum / positiveValues.length : 0;
    
    // 计算count总和和平均值
    const counts = data.map(row => {
      const cnt = parseInt(row[countColumn]);
      return isNaN(cnt) ? 0 : cnt;
    });
    
    const positiveCounts = counts.filter(cnt => cnt > 0);
    const countSum = counts.reduce((sum, cnt) => sum + cnt, 0);
    const avgCount = positiveCounts.length > 0 ? countSum / positiveCounts.length : 0;

    console.log('=== Analysis Statistics ===');
    console.log('Total value sum:', valueSum.toFixed(2));
    console.log('Average value:', avgValue.toFixed(2));
    console.log('Total count sum:', countSum);
    console.log('Average count:', avgCount.toFixed(2));
    console.log('Positive values count:', positiveValues.length);
    console.log('Positive counts count:', positiveCounts.length);
    console.log('Sample values:', values.slice(0, 5));
    console.log('Sample counts:', counts.slice(0, 5));

    return data.map((item, index) => {
      const value = parseFloat(item[valueColumn]) || 0;
      const count = parseInt(item[countColumn]) || 0;
      
      let pattern = '';
      // 只有当value和count都有有效值时才进行分类
      if (value > 0 && count > 0) {
        if (value > avgValue && count > avgCount) {
          pattern = '高频大额';
        } else if (value > avgValue && count <= avgCount) {
          pattern = '低频大额';
        } else if (value <= avgValue && count > avgCount) {
          pattern = '高频小额';
        } else {
          pattern = '低频小额';
        }
      } else if (value === 0 && count > 0) {
        pattern = '零额用户';
      } else if (value > 0 && count === 0) {
        pattern = '计数异常';
      } else {
        pattern = '数据不完整';
      }

      const result = {
        ...item,
        pattern,
        value,
        count,
        percentage: countSum > 0 ? (count / countSum * 100) : 0
      };
      
      if (index < 3) { // 只打印前3个结果作为示例
        console.log('Sample result', index, ':', result);
      }
      
      return result;
    });
  }
}