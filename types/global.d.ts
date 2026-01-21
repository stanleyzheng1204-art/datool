// Global type declarations
declare global {
  interface Window {
    exportAnalysisCharts?: () => Promise<{
      barChart?: string;
      pieChart?: string;
      donutChart?: string;
    }>;
  }
}

export {};
