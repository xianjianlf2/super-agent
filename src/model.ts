import 'dotenv/config'; // 确保被任何文件先 import 时，env 都已就绪
import { createOpenAI } from '@ai-sdk/openai';
import { createMockModel } from './mock-model';

// 统一在这里创建模型，index.ts 和 compare-loops.ts 共用，避免重复配置。
const qwen = createOpenAI({
  baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  apiKey: process.env.DASHSCOPE_API_KEY,
});

// 填了 DASHSCOPE_API_KEY 用真实 Qwen，否则用本地 mock 模型
export const useReal = !!process.env.DASHSCOPE_API_KEY;
export const model = useReal ? qwen.chat('qwen-plus-latest') : createMockModel();
export const compressionModel = useReal
  ? qwen.chat(process.env.COMPRESSION_MODEL ?? 'qwen-plus-latest')
  : createMockModel();
