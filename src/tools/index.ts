import { ToolRegistry } from './registry';
import { weatherTool, calculatorTool, fetchUrlTool, startPreviewTool } from './utility-tools';
import { readFileTool, writeFileTool, editFileTool, globTool, searchFilesTool, grepFilesTool, listDirectoryTool } from './file-tools';
import { bashTool } from './bash-tools';

export { ToolRegistry } from './registry';
export type { ToolDefinition } from './registry';
export { truncateResult } from './registry';
export { MCPClient, MockMCPClient } from './mcp-client';
export type { IMCPClient, MCPTool } from './mcp-client';
export { createToolSearchTool } from './tool-search';

export const allTools = [
  weatherTool, calculatorTool, fetchUrlTool, startPreviewTool, readFileTool, writeFileTool, editFileTool, globTool, searchFilesTool, grepFilesTool, listDirectoryTool, bashTool,
];

// Backward compat for compare-loops.ts (uses AI SDK generateText directly)
const legacyRegistry = new ToolRegistry();
legacyRegistry.register(weatherTool, calculatorTool);
export const tools = legacyRegistry.toAISDKFormat();
