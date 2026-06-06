import { tool, jsonSchema } from 'ai';

// 工具 = 给模型的“可调用函数”：description 告诉模型何时调用，
// inputSchema 约束参数，execute 在本地真正执行并把结果回传给模型。

export const weatherTool = tool({
  description: '查询指定城市的天气',
  inputSchema: jsonSchema<{ city: string }>({
    type: 'object',
    properties: {
      city: { type: 'string', description: '要查询的城市名称' },
    },
    required: ['city'],
    additionalProperties: false,
  }),
  execute: async ({ city }) => {
    // mock 几个城市，其他城市返回错误
    const cityMap = new Map([
        // random 几个城市
      ['北京', { temperature: 25, description: '晴天' }],
      ['上海', { temperature: 20, description: '阴天' }],
      ['广州', { temperature: 22, description: '小雨' }],
      ['深圳', { temperature: 23, description: '多云' }],
    ]);
    return cityMap.get(city) ?? { error: `城市 ${city} 暂不支持查询天气` };
  },
});

export const calculatorTool = tool({
  description: '计算数学表达式',
  inputSchema: jsonSchema<{ expression: string }>({
    type: 'object',
    properties: {
      expression: { type: 'string', description: '数学表达式，例如 (1+2)*3' },
    },
    required: ['expression'],
    additionalProperties: false,
  }),
  execute: async ({ expression }) => {
    // 只允许数字、运算符、括号、小数点和空格，避免 eval 执行任意代码
    if (!/^[\d+\-*/().\s]+$/.test(expression)) {
      return { error: `表达式包含不支持的字符: ${expression}` };
    }
    try {
      const result = eval(expression);
      return { expression, result };
    } catch {
      return { error: `无法计算表达式: ${expression}` };
    }
  },
});
