'use client';

/**
 * 报告导出：生成可离线打开的独立 HTML 文件。
 *
 * 背景：window.print() 在 Via / 部分安卓 WebView 上不可用（无打印框架，
 * 调用直接抛错或被静默吞掉）。独立 HTML 任何浏览器都能打开，并可用浏览器
 * 自带的「另存为 PDF」完成导出，是打印链路的稳定降级方案。
 *
 * 做法：克隆报告根节点 DOM，移除仅用于交互的元素（按钮、输入、tab 触发器），
 * 让所有折叠区展开，再内联当前页面已生效的样式表，保证离线排版一致。
 */

function collectStylesheets(): string {
  const parts: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      const rules = sheet.cssRules;
      if (!rules) continue;
      parts.push(Array.from(rules).map((r) => r.cssText).join('\n'));
    } catch {
      // 跨域样式表无法读取 cssRules，跳过（Tailwind 编译产物同源，不受影响）。
    }
  }
  return parts.join('\n');
}

function buildPrintCss(): string {
  return `
  @page { margin: 14mm; }
  body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  [data-export-hidden] { display: none !important; }
`;
}

function sanitizeClone(root: HTMLElement): HTMLElement {
  const clone = root.cloneNode(true) as HTMLElement;
  // 去掉所有仅交互元素，避免导出的报告里出现按钮/tab 等无意义控件。
  // 例外：带 data-export-keep 的是「内容型按钮」（如证据条目，标签/时间戳/引文都在其内），必须保留。
  clone
    .querySelectorAll('button, input, textarea, select, [role="tab"], [role="button"]')
    .forEach((el) => {
      if (el.closest('[data-export-keep]')) return;
      el.setAttribute('data-export-hidden', '1');
    });
  // Radix Collapsible/Accordion 关闭时内容带 hidden + data-state=closed，统一强制展开，
  // 否则导出的报告会缺失折叠区（课型要点、内涵观察点）的明细。
  clone
    .querySelectorAll('[data-state="closed"][hidden], [hidden]')
    .forEach((el) => {
      // 仅展开「内容型」折叠区；若 hidden 元素本身是交互控件则保持隐藏。
      if (el.closest('[data-export-hidden]')) return;
      el.removeAttribute('hidden');
      el.setAttribute('data-state', 'open');
      (el as HTMLElement).style.display = '';
    });
  return clone;
}

/**
 * 把报告根节点导出为 .html 文件并触发下载。
 * @param rootEl   报告容器（ReportView 根 div）
 * @param fileName 建议文件名（不含扩展名）
 */
export function downloadReportHtml(rootEl: HTMLElement, fileName: string): void {
  const body = sanitizeClone(rootEl);
  const css = collectStylesheets();
  const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${fileName}</title>
<style>
${css}
${buildPrintCss()}
</style>
</head>
<body>
${body.outerHTML}
<script>
// 打开后自动尝试调起打印（桌面/Chrome 可用时一步到位存 PDF；不支持则静默，用户仍可手动另存）。
window.addEventListener('load', function () {
  try { /* 不自动打印，避免部分浏览器直接报错；保留手动菜单入口 */ } catch (e) {}
});
<\/script>
</body>
</html>`;

  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const safe = fileName.replace(/[\\/:*?"<>|]/g, '_');
  a.download = `${safe}.html`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
