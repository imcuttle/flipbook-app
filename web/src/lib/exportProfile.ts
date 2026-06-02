// 导出渲染形态（export profile）。所有 export 专属定制集中于此，
// 由编译期常量 __FLIPBOOK_EXPORT__ 驱动，便于 Rollup 死分支消除。
//
// export 与 readOnly 是正交维度：readOnly 仅禁用写操作；export 在
// readOnly 基底上还有品牌定制（页脚版权、GitHub 直出、语言固化、
// 标题跟随、扁平顶栏）。详见 spec §2.1。

export const IS_EXPORT: boolean = __FLIPBOOK_EXPORT__;

// 顶栏在导出形态下的呈现开关。
export const exportChrome = {
  // 顶栏右侧直出 GitHub 图标（在线版收在 More 菜单里）。
  githubInTopBar: IS_EXPORT,
  // 导出版语言由 payload 烤死，不提供运行时切换。
  showLangSwitch: !IS_EXPORT,
  // 导出版不需要分享 / 返回图库 / More 菜单。
  showShare: !IS_EXPORT,
  showBackToGallery: !IS_EXPORT,
  showMoreMenu: !IS_EXPORT,
  // 导出版把「热点标签显隐」开关作为顶栏直出按钮（在线版收在 More 菜单里）。
  labelsInTopBar: IS_EXPORT,
  // 页脚版权条仅在导出形态显示。
  showFooter: IS_EXPORT,
};

// 导出形态下注入页面的数据。data.js 设置 window.__FLIPBOOK__。
export type FlipbookPayload = {
  topic: string;
  root: string | null;
  orientation: 'landscape' | 'portrait';
  lang: 'zh' | 'en';
  nodes: Record<string, any>;
  tree: { nodes: Record<string, any>; root: string | null };
};

export function readExportPayload(): FlipbookPayload | null {
  if (!IS_EXPORT) return null;
  const w = window as unknown as { __FLIPBOOK__?: FlipbookPayload };
  return w.__FLIPBOOK__ ?? null;
}
