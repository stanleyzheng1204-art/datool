import { NextRequest, NextResponse } from 'next/server';

// Edge Runtime 配置（Cloudflare Pages 要求）
export const runtime = 'edge';

export async function POST(request: NextRequest) {
  try {
    // 解析请求体
    const body = await request.json();
    const { messages, config: llmConfig } = body;

    if (!messages || !Array.isArray(messages)) {
      return NextResponse.json(
        { error: 'Invalid request: messages array is required' },
        { status: 400 }
      );
    }

    // 获取豆包 API 配置
    // 注意：在生产环境中，API key 应该从环境变量中获取
    const API_KEY = process.env.COZE_API_KEY || '';
    const API_URL = 'https://ark.cn-beijing.volces.com/api/v3/chat/completions';

    if (!API_KEY) {
      return NextResponse.json(
        { error: 'API key not configured' },
        { status: 500 }
      );
    }

    // 调用豆包 API
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        model: llmConfig?.model || 'doubao-seed-1-6-251015',
        messages: messages,
        temperature: llmConfig?.temperature || 0.3,
        max_tokens: llmConfig?.max_tokens || 2000,
        stream: false,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('API Error:', response.status, errorText);
      return NextResponse.json(
        { error: 'API request failed', details: errorText },
        { status: response.status }
      );
    }

    const data = await response.json();

    // 返回响应
    return NextResponse.json(
      { content: data.choices[0]?.message?.content || '' },
      {
        status: 200,
        headers: {
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  } catch (error: any) {
    console.error('API Error:', error);
    return NextResponse.json(
      {
        error: 'Internal server error',
        details: error.message || 'Unknown error',
      },
      { status: 500 }
    );
  }
}

// 支持 OPTIONS 请求（CORS 预检）
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
