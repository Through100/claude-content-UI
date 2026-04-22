import { segmentPtyAssistantDisplayBlocks } from './shared/segmentPtyDiffBlocks';

const text = `──────────────────────────────────────────────────────────────────────────────────────────────────
 Bash command

   python3 - <<'EOF'
   import re

   with open("/opt/claude-content-UI/ui-uploads/bing-seo-guide-2026-1.md", "r") as f:
       raw = f.read()

   body = re.sub(r'^---.*?---\\s*', '', raw, flags=re.DOTALL)

   # Check paragraph lengths
   # Split on blank lines
   paragraphs = re.split(r'\\n\\s*\\n', body)
   long_paras = []
   for i, p in enumerate(paragraphs):
       stripped = p.strip()
       if stripped.startswith('#') or stripped.startswith('<') or stripped.startswith('|') or stripped.startswith('-'):
           continue
       clean = re.sub(r'<[^>]+>', ' ', stripped)
       clean = re.sub(r'\\[([^\\]]+)\\]\\([^\\)]+\\)', r'\\1', clean)
       clean = re.sub(r'[#*\`|_]', '', clean).strip()
       word_count = len(clean.split())
       if word_count > 80:
           long_paras.append((i+1, word_count, clean[:100]))

   print("Paragraphs > 80 words:")
   for idx, wc, preview in long_paras:
       print(f"  Para block {idx}: {wc} words — '{preview}...'")

   # Check which H2s have "bing" keyword in them
   h2s = re.findall(r'^## .+', body, re.MULTILINE)
   print(f"\\nH2s containing 'bing': {sum(1 for h in h2s if 'bing' in h.lower())}")

   EOF

   Check paragraph lengths, keyword placement, schema, OG tags, FAQ word counts, author bio

 This command requires approval

 Do you want to proceed?
 ❯ 1. Yes
   2. Yes, and don’t ask again for: python3 *
   3. No

 Esc to cancel · Tab to amend · ctrl+e to explain`;

const parts = segmentPtyAssistantDisplayBlocks(text);
console.log(JSON.stringify(parts, null, 2));
