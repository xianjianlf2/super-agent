import type { ToolDefinition } from './registry';

export const weatherTool: ToolDefinition = {
  name: 'get_weather',
  description: '查询指定城市的天气',
  parameters: {
    type: 'object',
    properties: {
      city: { type: 'string', description: '要查询的城市名称' },
    },
    required: ['city'],
    additionalProperties: false,
  },
  isConcurrencySafe: true,
  isReadOnly: true,
  execute: async ({ city }: { city: string }) => {
    const cityMap = new Map([
      ['北京', { temperature: 25, description: '晴天' }],
      ['上海', { temperature: 20, description: '阴天' }],
      ['广州', { temperature: 22, description: '小雨' }],
      ['深圳', { temperature: 23, description: '多云' }],
    ]);
    return cityMap.get(city) ?? { error: `城市 ${city} 暂不支持查询天气` };
  },
};

export const calculatorTool: ToolDefinition = {
  name: 'calculator',
  description: '计算数学表达式',
  parameters: {
    type: 'object',
    properties: {
      expression: { type: 'string', description: '数学表达式，例如 (1+2)*3' },
    },
    required: ['expression'],
    additionalProperties: false,
  },
  isConcurrencySafe: true,
  isReadOnly: true,
  execute: async ({ expression }: { expression: string }) => {
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
};
