"""Development-only: generate the generic clause PDF from its canonical TS data."""
import hashlib
import json
from pathlib import Path
from xml.sax.saxutils import escape
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer

root = Path(__file__).resolve().parents[1]
source = (root / 'legal/licenseClause.ts').read_text()
payload = source.split('export const licenseClause = ', 1)[1].split(' as const;', 1)[0]
document = json.loads(payload)
digest = hashlib.sha256(payload.encode()).hexdigest()
assert f'LICENSE_DOCUMENT_HASH = "{digest}"' in source, 'Update the document hash after editing the canonical text'
styles = getSampleStyleSheet()
styles['BodyText'].fontSize = 10
styles['BodyText'].leading = 15
styles['Heading1'].textColor = colors.HexColor('#0f172a')
flow = [Paragraph(escape(document['title']), styles['Heading1']),
        Paragraph(escape(f"Proveedor: {document['provider']} · Versión: {document['version']}"), styles['BodyText']),
        Spacer(1, 12)]
for section in document['sections']:
    flow += [Paragraph(escape(section['title']), styles['Heading2']), Paragraph(escape(section['text']), styles['BodyText'])]
flow += [Spacer(1, 12), Paragraph(escape(document['checkbox']), styles['BodyText'])]
SimpleDocTemplate(str(root / 'public/legal/clic-pos-license-1.0.pdf'), title=document['title'], author=document['provider'], pagesize=(595.28, 841.89), rightMargin=45, leftMargin=45, topMargin=40, bottomMargin=40, invariant=1).build(flow)
print(f'PDF generated; canonical SHA-256 {digest}')
