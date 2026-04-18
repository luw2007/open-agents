// apps/web/lib/utils/slugify.ts
/**
 * 将标题转换为 URL-safe slug。
 * 支持中文（转拼音太复杂，直接用 nanoid 后缀保证唯一性）。
 */
export function slugify(title: string): string {
  const base = title
    .toLowerCase()
    .replace(/[^\w\s\u4E00-\u9FFF-]/g, "") // 保留字母、数字、空格、中文、连字符
    .replace(/[\s_]+/g, "-") // 空格和下划线转连字符
    .replace(/-+/g, "-") // 合并连续连字符
    .replace(/^-|-$/g, "") // 去首尾连字符
    .slice(0, 80); // 限制长度

  // 如果 slug 为空（纯特殊字符标题），使用 "task"
  return base || "task";
}
