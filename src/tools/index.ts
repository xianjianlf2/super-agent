import { weatherTool, calculatorTool } from './utility-tools';

// 传给 streamText 的工具集合：key 就是模型看到的工具名
export const tools = {
  weather: weatherTool,
  calculator: calculatorTool,
};
