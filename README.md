# skill-editor

一款在线编辑 skill 的 React 组件。

**第一阶段（已完成）**

1. 组件接收一个 `.zip` 文件；
2. 组件为左右布局：左侧展示解压后的目录树，右侧留白。

**第二阶段（已完成）**

3. 右侧留白区补上文件内容预览：选中左侧文件即可查看内容。

**第三阶段（已完成）**

4. 目录树支持一键全部展开 / 全部收起（面板头部按钮，或 `Ctrl/⌘ + E` 展开、`Ctrl/⌘ + Shift + E` 收起）。

**第四阶段（已完成）**

5. 顶部那条工具栏（标题 / 选择 `.zip 文件` / 清除）移出组件，改由宿主提供，组件只接收外部传入的文件。

**第五阶段（已完成）**

6. 目录区域不再提供「选择文件」入口（连带隐藏的 `<input type="file">` 一并移除），文件只能从外部传入；空状态只保留一句提示。

![SkillEditor 目录树](docs/phase1.png)

## 目录树操作

| 操作 | 方式 |
| --- | --- |
| 展开/收起单个目录 | 点击目录行，或聚焦后按 `→` / `←` |
| 全部展开 | 点击「目录结构」右侧按钮（处于收起态时），或 `Ctrl/⌘ + E` |
| 全部收起 | 再次点击同一按钮，或 `Ctrl/⌘ + Shift + E` |
| 浏览 | `↑` `↓` 移动焦点（不改变右侧预览），`Enter` / 空格 选中并预览 |

按钮的 `aria-label` 与图标始终反映当前状态（全部展开后显示「全部收起目录」）；若只需程序化控制，可用 `ref` 的 `expandAll()` / `collapseAll()`，或用 `hideExpandToggle` 隐藏按钮。

![全部收起后的目录树](docs/phase3-collapsed.png)

## 文件预览能力

| 文件类型 | 预览方式 |
| --- | --- |
| `.md` / `.markdown` | 默认渲染为文档（标题、列表、表格、代码块、引用、frontmatter），可一键切到源码 |
| 文本类（`.yaml` `.json` `.txt` `.py` `.sh` …，以及 `LICENSE` 这类无扩展名文件） | 原样等宽展示 |
| 图片（`.png` `.jpg` `.gif` `.svg` `.webp` …） | 内联显示，保留原图下载 |
| 其他二进制（`.docx` `.xlsx` `.pdf` `.exe` …） | 提示不支持预览，可下载 |

预览面板顶部带有文件路径、体积、类型、行数，以及**复制内容**与**下载文件**按钮；Markdown 文件额外提供「预览 / 源码」切换。

![Markdown 渲染预览](docs/phase2-selected.png)

![预览表格](docs/phase2-table.png)

![源码模式](docs/phase2-source.png)

## 快速开始

```bash
pnpm install
pnpm dev        # 打开 http://localhost:5173 查看演示页（默认载入示例技能包）
pnpm test       # 单元测试与组件测试
pnpm typecheck  # TypeScript 类型检查
pnpm build      # 产出 dist/ 组件包 + dist-types/ 类型声明
```

演示页的工具栏由宿主自己实现（就是 `src/demo/DemoApp.tsx` 里那条：选择文件 / 载入示例包 / 清除）。

## 使用方式

### 文件只能由外部传入

组件内**没有任何文件选择入口**：既没有顶部工具栏，也没有隐藏的 `<input type="file">`。文件通过 `source` 传入，宿主自己放按钮：

```tsx
import { SkillEditor } from './components/SkillEditor';
import 'skill-editor/style.css';

function Page() {
  const [file, setFile] = useState<File | null>(null);
  const inputId = 'zip-input';

  return (
    <>
      {/* 宿主自己的工具栏 */}
      <div className="my-toolbar">
        <span>{file?.name ?? 'Skill Editor'}</span>
        <label htmlFor={inputId}>选择 .zip 文件</label>
        <input
          id={inputId}
          type="file"
          accept=".zip,application/zip"
          hidden
          onChange={(event) => {
            setFile(event.target.files?.[0] ?? null);
            event.target.value = '';
          }}
        />
        <button type="button" onClick={() => setFile(null)}>清除</button>
      </div>

      <SkillEditor
        source={file}
        onLoad={(result) => console.log(result.tree.fileCount)}
        onError={(error) => console.error(error.message)}
        onSelectChange={(node) => console.log(node?.path)}
      />
    </>
  );
}
```

传 `source={null}`（或不传 `source`、`source` 为 `undefined`）即显示空状态：左栏只有一句「尚未载入技能包」，右栏提示「尚未选择文件」。

此外，把 `.zip` 拖进组件区域仍会直接载入 —— 这是拖拽手势本身的处理，不涉及任何文件选择控件。

### 右侧内容区

默认渲染内置的文件预览（`previewMode="preview"`）。三种接管方式：

```tsx
// 1) 完全自定义：children 会替换整个右侧面板
<SkillEditor source={file}>
  <FileViewer path={selectedPath} />
</SkillEditor>

// 2) 只替换预览主体，保留文件头（路径 / 体积 / 复制 / 下载）
<SkillEditor
  source={file}
  renderFilePreview={(state) => state.kind === 'image' ? null : <MyCodeView text={state.text} />}
/>

// 3) 退回第一阶段的占位（右侧留白）
<SkillEditor source={file} previewMode="placeholder" />
```

也可以单独使用预览组件与取值 Hook：

```tsx
import { FilePreview, useFilePreview } from 'skill-editor';

const state = useFilePreview({ archive, tree, selectedPath });
<FilePreview
  path="references/api-index.md"
  kind="markdown"
  status={state.kind === 'markdown' ? 'ready' : 'loading'}
  text={state.kind === 'markdown' ? state.text : undefined}
/>
```

### 命令式 API

```tsx
const ref = useRef<SkillEditorHandle>(null);

ref.current?.reload();          // 重新解析当前文件
ref.current?.expandAll();       // 展开全部目录
ref.current?.collapseAll();     // 收起全部目录
ref.current?.getResult();       // 取得解析结果（含原始 ZipArchive 与 readFile）
```

## 组件属性

| 属性 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `source` | `Blob \| ArrayBuffer \| null` | — | 要展示的 `.zip`，由宿主传入；`null` / 不传即空状态。组件自身不选取文件 |
| `children` | `ReactNode` | — | 替换整个右侧面板 |
| `previewMode` | `'preview' \| 'placeholder'` | `'preview'` | 右侧是否渲染内置预览 |
| `renderFilePreview` | `(state, props) => ReactNode` | — | 替换预览主体，保留文件头 |
| `onLoad` | `(result: SkillArchiveResult) => void` | — | 解析成功后回调 |
| `onError` | `(error: Error) => void` | — | 解析失败或文件不合法时回调 |
| `onSelectChange` | `(node: SkillTreeNode \| null) => void` | — | 选中节点变化时回调 |
| `maxSizeBytes` | `number` | `100 MB` | 文件体积上限 |
| `defaultExpandedDepth` | `number` | `1` | 初始展开层级 |
| `hideExpandToggle` | `boolean` | `false` | 隐藏目录面板的「全部展开 / 收起」按钮 |
| `emptyState` | `ReactNode` | — | 自定义空状态 |
| `className` / `style` | — | — | 透传到根元素 |

## 目录结构

```
src/
  components/SkillEditor/
    SkillEditor.tsx       # 左右布局、文件接收、状态管理
    FileTree.tsx          # 通用目录树（ARIA + 键盘导航）
    FilePreview.tsx       # 右侧预览：文件头 + 内容主体
    useFilePreview.ts     # 选中文件的按需读取 / 解码 / 状态机
    SkillEditor.css       # 全部样式（.se-root 作用域内）
    FilePreview.css       # 预览相关样式
    icons.tsx             # 内联 SVG 图标
    index.ts
  lib/
    zip/zipArchive.ts     # 零依赖 ZIP 解析（central directory + 按需解压）
    skillTree.ts          # 目录树构建、展开状态、扁平化
    skillManifest.ts      # SKILL.md frontmatter / 标题 / 描述提取
    frontmatter.ts        # frontmatter 解析（预览与摘要共用）
    markdown.tsx          # 轻量 Markdown → React 渲染器
    fileKind.ts           # 类型判定（按扩展名 + 内容嗅探）
    loadSkillArchive.ts   # 串联解析流程，识别 wrapper 目录
    format.ts
  demo/                   # 演示页（宿主工具栏 DemoApp + main.tsx + 示例技能包）
  test/                   # Vitest 用例与 ZIP 构造器
scripts/
  inspect-zip.mts         # 命令行检查任意 .zip 的解析结果
  make-image-zip.mts      # 生成带图片的临时压缩包（预览自测用）
  drive-page.mjs          # 用无头 Chrome 驱动演示页做交互验证
```

## 关键实现说明

- **ZIP 解析零依赖**：`src/lib/zip/zipArchive.ts` 只读取中央目录，文件名与结构立即可用；文件内容在真正需要时才通过 `DecompressionStream('deflate-raw')` 解压。支持 stored / deflate、data descriptor、ZIP64 定位记录、UTF-8 与 CP437 文件名。
- **wrapper 目录折叠**：压缩包若只有一个顶层目录（如 `api-call-by-knowledge/…`），该目录会作为根节点展示，避免出现无意义的单层嵌套。条目通过 `zipEntry` 指回原始记录，因此折叠后依然能正确读取内容。
- **目录树能力**：隐式目录合并、显式目录记录去重、目录优先 + 自然排序、`role="tree"` 语义、↑↓←→ / Home / End / Enter 键盘导航与 roving tabindex。
- **按需读取**：选中文件时才解压该条目；异步读取带请求序号，快速切换不会出现旧内容覆盖新内容。
- **预览安全**：Markdown 渲染器不使用 `dangerouslySetInnerHTML`，文本一律转义，`javascript:` 等危险链接目标被丢弃；因此恶意压缩包无法通过预览注入脚本。
- **大文件保护**：超过 2 MB 的文本、超过 20 MB 的图片不生成预览，改为提示 + 下载；图片用 `URL.createObjectURL` 并随选择切换 / 组件卸载回收。
- **样式隔离**：所有样式限定在 `.se-root` 下，使用 CSS 变量，自带深色模式；容器宽度小于 560px 时（需容器查询支持）上下堆叠。

## 后续可扩展

- 文件编辑与回写（导出修改后的 `.zip`）、`SKILL.md` 表单化编辑；
- 目录树搜索与过滤（`SkillTreeNode.pathLower` 已预处理）；
- Markdown 渲染器补充语法高亮、锚点目录；
- 预览 Markdown 内部相对链接时直接跳转到对应文件。
