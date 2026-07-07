import { createRoot } from 'react-dom/client';
import { Counter } from './Counter.tsx';

// App 与 Counter 是两个独立 .tsx 文件，靠相对 import 组合——
// 加载器会递归编译 Counter.tsx 并把这里的 './Counter.tsx' 改写成 Blob URL。
function App() {
  return (
    <div className="wrap">
      <h1>🚀 浏览器直跑 TSX</h1>
      <p className="sub">
        无 webpack / 无 Vite / 无任何 build step —— importmap + Babel Standalone + 手写加载器，
        纯静态 HTML 直接把多文件 TSX 跑起来。
      </p>
      <Counter label="计数器 A" />
      <Counter label="计数器 B（从 10 起）" start={10} />
      <p className="foot">
        每个 Counter 有独立 state；本页由 App.tsx 与 Counter.tsx 两个文件组合而成。
      </p>
    </div>
  );
}

const root = document.getElementById('root')!; // TS 非空断言，会被 preset-typescript 剥掉
createRoot(root).render(<App />);
