import { LLMClient, Config } from 'coze-coding-dev-sdk';

export interface Env {
  // Cloudflare Pages 会自动注入 COZE 相关的环境变量
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      // 处理 CORS 预检请求
      if (request.method === 'OPTIONS') {
        return new Response(null, {
          status: 204,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
          },
        });
      }

      // 只处理 POST 请求
      if (request.method !== 'POST') {
        return new Response(
          JSON.stringify({ error: 'Method not allowed' }),
          {
            status: 405,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
          }
        );
      }

      // 解析请求体
      const body = await request.json();
      const { messages, config } = body;

      if (!messages || !Array.isArray(messages)) {
        return new Response(
          JSON.stringify({ error: 'Invalid request: messages array is required' }),
          {
            status: 400,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
          }
        );
      }

      // 初始化 LLM 客户端
      const llmConfig = new Config();
      const client = new LLMClient(llmConfig);

      // 构建 SDK 消息格式
      const sdkMessages = messages.map((msg: any) => ({
        role: msg.role,
        content: msg.content,
      }));

      // 调用大语言模型
      const response = await client.invoke(sdkMessages, config);

      // 返回响应
      return new Response(
        JSON.stringify({ content: response.content }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        }
      );
    } catch (error: any) {
      console.error('API Error:', error);
      return new Response(
        JSON.stringify({
          error: 'Internal server error',
          details: error.message || 'Unknown error',
        }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        }
      );
    }
  },
};
