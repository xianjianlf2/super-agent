import { createInterface, type Interface } from 'node:readline';

// readline 的 question() 只在被调用时才监听下一行，没人等的时候到达的行会被直接丢掉。
// 交互终端里没问题（人总是等提示才输入），但管道输入的行是一次性全部到达的：
// agent loop 处理第一个问题期间，后面的行全丢，多轮测试跑不起来。
// 解法：常驻 line 监听 + 队列缓冲，行到了没人等就先存着，question 时优先取队列。
export interface LineReader {
  question(prompt: string): Promise<string | null>;
  close(): void;
}

export function createLineReader(
  input: NodeJS.ReadableStream,
  output: NodeJS.WritableStream,
): LineReader {
  const isTTY = (input as NodeJS.ReadStream).isTTY === true;
  const rl: Interface = createInterface({ input, output, terminal: isTTY });

  const buffered: string[] = [];
  let waiter: ((line: string | null) => void) | null = null;
  let closed = false;

  rl.on('line', (line) => {
    if (waiter) {
      const w = waiter;
      waiter = null;
      w(line);
    } else {
      buffered.push(line);
    }
  });

  rl.on('close', () => {
    closed = true;
    if (waiter) {
      const w = waiter;
      waiter = null;
      w(null);
    }
  });

  return {
    async question(prompt: string): Promise<string | null> {
      if (isTTY) {
        rl.setPrompt(prompt);
        rl.prompt();
      }

      let line: string | null;
      if (buffered.length > 0) {
        line = buffered.shift()!;
      } else if (closed) {
        line = null;
      } else {
        line = await new Promise((resolve) => { waiter = resolve; });
      }

      // 非 TTY 时终端不会回显输入，消费时补一条「提示符 + 行」，让管道运行的记录可读。
      if (!isTTY) output.write(prompt + (line ?? '') + '\n');
      return line;
    },
    close() {
      rl.close();
    },
  };
}
