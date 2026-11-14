/** Restyles the Scout SVGs into the monochrome line drawing from docs/DESIGN_SYSTEM.md. Pure string transform. */

export const SCOUT_COLORS = {
  line: 'currentColor', body: '#0d0b0b', shade: '#161313', pupil: '#060505', quiet: '#a39c95', lens: '#5cc8ff', caution: '#f3d250',
} as const;

export function monoScout(svg: string): string {
  const c = SCOUT_COLORS;
  return svg
    .replace(/<ellipse[^>]*opacity[^>]*\/>/g, '')                 // ground shadow
    .replace(/<path[^>]*#F2A66E[^>]*\/>/gi, '')                   // highlight stroke
    .replace(/(<circle[^>]*cx="80"[^>]*cy="73"[^>]*r="(?:27|30)"[^>]*fill=")#(?:5CC8FF|FFB020)(")/gi, (_m, a, b) => `${a}@LENS@${b}`)
    .replace(/#FFB020/gi, c.caution)
    .replace(/#5CC8FF/gi, c.quiet)
    .replace(/@LENS@/g, svg.includes('#FFB020') ? c.caution : c.lens)
    .replace(/#E0884A/gi, c.body).replace(/#B96A32/gi, c.shade)
    .replace(/stroke="#10141B"/gi, `stroke="${c.line}"`)
    .replace(/#10141B/gi, c.pupil)
    .replace('<svg ', '<svg width="100%" height="100%" aria-hidden="true" focusable="false" ');
}
