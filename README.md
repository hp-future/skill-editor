# @hp-future/skill-editor

浏览和编辑 `.zip` 技能包的 React 组件。左侧是目录树，右侧预览文件内容；文本文件可直接编辑，改动可重新打包导出。

- 目录树导航，分栏可拖拽调整
- Markdown 渲染：大纲、语法高亮、相对链接跳转；`.ts`、`.sh` 等源码文件按扩展名着色
- 文本 / Markdown 文件编辑，显式保存
- 导出为新的 `.zip`

在线演示：<https://hp-future.github.io/skill-editor/>

npm：<https://www.npmjs.com/package/@hp-future/skill-editor>

![SkillEditor](https://raw.githubusercontent.com/hp-future/skill-editor/main/docs/phase11-default.png)

## 安装

```bash
pnpm add @hp-future/skill-editor
# 或
npm install @hp-future/skill-editor
```

React 18 / 19 为 peer 依赖。样式需单独引入：

```ts
import '@hp-future/skill-editor/style.css';
```

基于源码调试时，克隆仓库后 `pnpm install && pnpm build`，再用 `pnpm add file:../skill-editor` 引用。

## 使用

```tsx
import { useRef, useState } from 'react';
import { SkillEditor } from '@hp-future/skill-editor';
import type { SkillEditorHandle } from '@hp-future/skill-editor';
import '@hp-future/skill-editor/style.css';

export function Page() {
  const [file, setFile] = useState<File | null>(null);
  const ref = useRef<SkillEditorHandle>(null);

  return (
    <>
      <input
        type="file"
        accept=".zip,application/zip"
        onChange={(event) => setFile(event.target.files?.[0] ?? null)}
      />

      <SkillEditor ref={ref} source={file} />

      <button
        onClick={async () => {
          const result = await ref.current?.exportArchive();
          if (!result) return; // 用户取消
          const url = URL.createObjectURL(result.blob);
          // 触发下载
        }}
      >
        导出
      </button>
    </>
  );
}
```

`source` 支持 `Blob` 和 `ArrayBuffer`，传新文件会重新解析，传 `null` 显示空状态。

开启 `editable` 后，文本和 Markdown 文件可以编辑：`Ctrl/⌘ + S` 保存，`Esc` 放弃草稿；草稿未保存时切换文件会弹出确认。`readOnly` 可以强制只读，即使同时开启 `editable` 也不可编辑。

## API

### Props

| 属性 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `source` | `Blob \| ArrayBuffer \| null` | — | 要展示的压缩包 |
| `editable` | `boolean` | `false` | 允许编辑文本和 Markdown 文件 |
| `readOnly` | `boolean` | `false` | 强制只读，优先级高于 `editable` |
| `previewers` | `FilePreviewer[]` | — | 自定义预览组件 |
| `renderFilePreview` | `(state, props) => ReactNode` | — | 替换预览内容，保留头部 |
| `previewMode` | `'preview' \| 'placeholder'` | `'preview'` | `placeholder` 时右侧留白 |
| `children` | `ReactNode` | — | 替换整个右侧窗格 |
| `onLoad` | `(result) => void` | — | 解析成功 |
| `onError` | `(error) => void` | — | 压缩包解析失败 |
| `onSelectChange` | `(node) => void` | — | 选中节点变化 |
| `onEditChange` | `(summary) => void` | — | 已保存的改动变化 |
| `maxSizeBytes` | `number` | `100 MB` | 超过则拒绝解析 |
| `defaultExpandedDepth` | `number` | `1` | 初始展开层级 |
| `hideExpandToggle` | `boolean` | `false` | 隐藏展开/收起全部按钮 |
| `emptyState` | `ReactNode` | — | 未载入文件时的内容 |
| `defaultTreeWidth` | `number` | 容器 28% | 目录树初始宽度 |
| `onTreeWidthChange` | `(width) => void` | — | 分栏宽度变化 |
| `className` / `style` | — | — | 根元素样式 |

### Ref

| 方法 | 说明 |
| --- | --- |
| `reload()` | 重新解析当前 `source` |
| `getResult()` | 已解析的压缩包信息 |
| `getDocument()` | 文档与改动集合，只读时为 `null` |
| `getSelectedPath()` | 当前选中节点路径 |
| `setExpanded(path, expanded)` | 展开或收起目录 |
| `expandAll()` / `collapseAll()` | 展开 / 收起全部目录 |
| `hasUnsavedChanges()` | 是否存在未导出的改动 |
| `discardEdits()` | 丢弃全部改动 |
| `exportArchive(options?)` | 导出，返回 `ExportResult \| null` |

`exportArchive()` 返回 `{ blob, fileName, stats, warnings }`，用户取消时返回 `null`。选项支持 `fileName` 和 `onProgress(written, total)`。

## 自定义预览

默认提供 Markdown、文本和图片的预览。其他格式可以注册预览组件：

```tsx
import { SkillEditor, byExtension } from '@hp-future/skill-editor';

const fontPreviewer = {
  id: 'font',
  match: byExtension('ttf', 'otf'),
  render: ({ info, objectUrl }) => (
    <FontSpecimen name={info.name} size={info.size} url={objectUrl} />
  ),
};

<SkillEditor source={file} previewers={[fontPreviewer]} />;
```

`match` 按注册顺序执行，第一个命中的生效；`render` 接收 `info`、`bytes`、`blob`、`objectUrl`。命中的预览组件优先于 `renderFilePreview`。

## 主题

颜色通过 CSS 变量控制，跟随 `prefers-color-scheme` 切换深浅色：

```css
.my-scope {
  --se-accent: #2f5fd0;
  --se-tree-width: 300px;
  --se-radius: 8px;
}
```

常用变量：`--se-bg`、`--se-surface`、`--se-border`、`--se-text`、`--se-accent`、`--se-danger`、`--se-warn`、`--se-code-*`、`--se-tree-width`、`--se-splitter-size`、`--se-radius`、`--se-mono`。完整列表见 `SkillEditor.css`。

## 键盘快捷键

| 场景 | 按键 | 行为 |
| --- | --- | --- |
| 目录树 | `↑` `↓` | 移动焦点 |
| 目录树 | `→` `←` | 展开 / 收起 |
| 目录树 | `Home` `End` | 第一行 / 最后一行 |
| 目录树 | `Enter` `Space` | 选中 |
| 分栏 | `←` `→` | 调整宽度，每次 24px |
| 分栏 | `Home` `End` | 最窄 / 最宽 |
| 分栏 | `Enter` 或双击 | 恢复默认宽度 |
| 全局 | `Ctrl/⌘ + E` | 展开全部 |
| 全局 | `Ctrl/⌘ + Shift + E` | 收起全部 |
| 编辑器 | `Ctrl/⌘ + S` | 保存 |
| 编辑器 | `Esc` | 放弃草稿并退出 |
| 对话框 | `Esc` | 取消 |

## 限制

- 仅支持编辑已有的文本和 Markdown 文件，不支持新增、删除、重命名
- 重新打包不保留 extra field、压缩包注释和外部文件属性
- 单条目上限 4 GiB；文本预览 2 MB；图片与自定义预览载荷 20 MB
- 需要 `DecompressionStream`：Chrome / Edge 80+、Firefox 113+、Safari 16.4+

## 开发

```bash
pnpm dev        # 演示页 http://localhost:5173
pnpm test
pnpm typecheck
pnpm build      # dist/ + dist-types/
```

## 许可证

MIT。见 [LICENSE](https://github.com/hp-future/skill-editor/blob/main/LICENSE)，变更记录见 [CHANGELOG.md](https://github.com/hp-future/skill-editor/blob/main/CHANGELOG.md)。
