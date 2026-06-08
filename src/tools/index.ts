import { ToolRegistry } from './registry';
import { weatherTool, calculatorTool } from './utility-tools';
import { readFileTool, writeFileTool, listDirectoryTool } from './file-tools';

export { ToolRegistry } from './registry';
export type { ToolDefinition } from './registry';
export { truncateResult } from './registry';

export const allTools = [
  weatherTool, calculatorTool, readFileTool, writeFileTool, listDirectoryTool,
];

// Backward compat for compare-loops.ts (uses AI SDK generateText directly)
const legacyRegistry = new ToolRegistry();
legacyRegistry.register(weatherTool, calculatorTool);
export const tools = legacyRegistry.toAISDKFormat();
