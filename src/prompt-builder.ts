export type PromptPipe<Context> = (ctx: Context) => string | null;

export interface PromptPipeDebugEntry {
  name: string;
  enabled: boolean;
  chars: number;
  content: string | null;
}

export interface PromptBuildResult {
  prompt: string;
  entries: PromptPipeDebugEntry[];
  debug: string;
}

interface PromptPipeModule<Context> {
  name: string;
  fn: PromptPipe<Context>;
}

export class PromptBuilder<Context> {
  private pipes: PromptPipeModule<Context>[] = [];

  pipe(name: string, fn: PromptPipe<Context>): this {
    this.pipes.push({ name, fn });
    return this;
  }

  inspect(ctx: Context): PromptPipeDebugEntry[] {
    return this.pipes.map((pipe) => {
      const content = pipe.fn(ctx);

      return {
        name: pipe.name,
        enabled: content !== null,
        chars: content?.length ?? 0,
        content,
      };
    });
  }

  build(ctx: Context): string {
    return this.render(ctx).prompt;
  }

  render(ctx: Context): PromptBuildResult {
    const entries = this.inspect(ctx);
    const prompt = entries
      .filter((entry) => entry.enabled)
      .map((entry) => entry.content)
      .join('\n\n');
    const debug = this.formatDebug(entries);

    return { prompt, entries, debug };
  }

  debug(ctx: Context): string {
    return this.render(ctx).debug;
  }

  private formatDebug(entries: PromptPipeDebugEntry[]): string {
    const lines = entries.map((entry) =>
      entry.enabled
        ? `  ${entry.name}: [ON] ${entry.chars} chars`
        : `  ${entry.name}: [OFF]`,
    );

    return [
      '=== Prompt Pipe Debug ===',
      ...lines,
      '========================',
    ].join('\n');
  }
}

export function createPromptBuilder<Context>() {
  return new PromptBuilder<Context>();
}
