import { useState } from 'react';

// interface + 泛型 useState + 默认参数 —— 全是 TS 语法，能跑就证明 Babel 的 typescript preset 生效了。
interface CounterProps {
  label: string;
  start?: number;
}

export function Counter({ label, start = 0 }: CounterProps) {
  const [count, setCount] = useState<number>(start);
  return (
    <div className="counter">
      <span className="label">{label}</span>
      <div className="controls">
        <button onClick={() => setCount((c) => c - 1)}>−</button>
        <output>{count}</output>
        <button onClick={() => setCount((c) => c + 1)}>+</button>
      </div>
    </div>
  );
}
