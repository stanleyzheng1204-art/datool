// 简单的消息类型定义
export type MessageRole = 'system' | 'user' | 'assistant';

export interface SimpleMessage {
  role: MessageRole;
  content: string;
}

/**
 * 模型配置接口定义
 */
export interface LLMConfig {
  /** 模型ID，从支持的模型列表中选取 */
  model: string;
  /** 是否开启深度思考能力，建议关闭 */
  thinking?: string;
  /** 控制模型输出的随机性，范围[0, 2], 默认值 1 */
  temperature?: number;
  /** 重复语句惩罚，范围[-2, 2], 默认值 0 */
  frequency_penalty?: number;
  /** 控制模型输出的多样性，范围[0, 1] , 默认值0.7*/
  top_p?: number;
  /** 控制模型输出的最大 tokens 数, 默认 4096 */
  max_tokens?: number;
}

/**
 * 调用大语言模型流式输出（通过 Cloudflare Pages Functions）
 *
 * @param messages 消息列表
 * @param config 模型配置对象
 * @returns 异步生成器，返回 AIMessageChunk
 */
export async function* callLLM(
  messages: SimpleMessage[],
  config: LLMConfig
): AsyncGenerator<any> {
  // 构建 API URL
  const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || window.location.origin;
  const apiUrl = `${baseUrl}/api/analyze`;

  // 构建 SDK 消息格式
  const sdkMessages = messages.map((msg) => ({
    role: msg.role,
    content: msg.content,
  }));

  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messages: sdkMessages,
        config: {
          model: config.model || "doubao-seed-1-6-251015",
          temperature: config.temperature || 0.3,
          thinking: config.thinking || "disabled",
          max_tokens: config.max_tokens || 2000,
        },
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.details || error.error || 'API request failed');
    }

    const data = await response.json();

    // 返回完整响应（因为 Cloudflare Pages Function 目前不支持流式）
    yield { content: data.content };
  } catch (error) {
    console.error('LLM API error:', error);
    throw error;
  }
}

/**
 * 简单收集所有模型响应
 */
export async function simpleCollectLLMResponse(messages: SimpleMessage[], config: LLMConfig): Promise<string> {
  let fullContent = "";

  try {
    for await (const chunk of callLLM(messages, config)) {
      fullContent += chunk.content;
    }
    return fullContent;
  } catch (error) {
    console.error('Collect LLM response failed:', error);
    throw error;
  }
}