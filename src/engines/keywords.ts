/**
 * Keyword extraction — no LLM, no latency, no cost.
 *
 * Strips stop words, extracts significant terms, deduplicates.
 * Extracted from idapixl-cortex/src/engines/keywords.ts.
 */

const STOP_WORDS = new Set([
  'the','a','an','is','are','was','were','be','been','being',
  'have','has','had','do','does','did','will','would','could','should',
  'may','might','shall','can','need','ought','used','to','of','in','on',
  'at','by','for','with','about','against','between','into','through',
  'during','before','after','above','below','from','up','down','and',
  'but','or','nor','so','yet','both','either','neither','not','only',
  'same','than','too','very','just','because','as','until','while',
  'although','though','that','this','these','those','it','its','i','me',
  'my','myself','we','our','ours','ourselves','you','your','yours','he',
  'him','his','she','her','hers','they','them','their','theirs','what',
  'which','who','when','where','why','how','all','each','every','no',
  'more','most','other','some','such','then','its','also','been','if',
  'now','like','well','even','back','any','there','think','see','know',
  'get','one','two','three','new','good','first','last','long','great',
  'little','own','right','big','high','different','small','large','next',
  'early','young','old','public','private','real','best','free','much',
  'want','make','time','year','day','way','man','much','many','look',
  'come','still','here','take','give','use','find','tell','ask','seem',
  'feel','leave','call','keep','let','begin','show','hear','play','run',
  'move','live','believe','hold','bring','happen','write','provide','sit',
  'stand','lose','pay','meet','include','continue','set','learn','change',
  'lead','understand','watch','follow','stop','create','speak','read','spend',
]);

/**
 * Extract up to `max` meaningful keywords from text.
 * Returns lowercase, deduplicated terms of 3+ characters.
 */
export function extractKeywords(text: string, max: number = 20): string[] {
  return [
    ...new Set(
      text
        .toLowerCase()
        .replace(/[^a-z0-9\s'-]/g, ' ')
        .split(/\s+/)
        .map(w => { let s = 0, e = w.length; while (s < e && (w[s]==="'"||w[s]==="-")) s++; while (e > s && (w[e-1]==="'"||w[e-1]==="-")) e--; return w.slice(s, e); })
        .filter(w => w.length >= 3 && !STOP_WORDS.has(w) && !/^\d+$/.test(w))
    ),
  ].slice(0, max);
}
