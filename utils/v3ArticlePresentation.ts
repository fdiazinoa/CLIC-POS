/** Bounded URL references from the authoritative V3 record, without legacy media reads. */
export function v3ArticleImages(article: Record<string, unknown>): string[] {
  const images: string[] = [];
  const candidates = [article.image_url,
    ...(Array.isArray(article.images) ? article.images.slice(0, 4) : []), article.image];
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;
    const value = candidate.trim();
    if (!value || value.length > 2048 || images.includes(value)) continue;
    try {
      const url = new URL(value);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) continue;
    } catch { continue; }
    images.push(value);
    if (images.length === 4) break;
  }
  return images;
}
