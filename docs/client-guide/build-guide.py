#!/usr/bin/env python3
"""Rebuild the Russian client guide. Requires reportlab; no network or secrets.

python3 -m pip install reportlab
python3 docs/client-guide/build-guide.py --output ../aeroCRM_инструкция_универсальные_продажи.pdf
Set --font-dir to a directory containing DejaVuSans.ttf and DejaVuSans-Bold.ttf
on systems without the standard macOS Arial or Linux DejaVu font installation.
"""
import argparse
import re
from pathlib import Path
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak,
)


def fonts(directory):
    candidates = []
    if directory:
        candidates.append((Path(directory), 'DejaVuSans.ttf', 'DejaVuSans-Bold.ttf'))
    candidates.extend([
        (Path('/System/Library/Fonts/Supplemental'), 'Arial.ttf', 'Arial Bold.ttf'),
        (Path('/usr/share/fonts/truetype/dejavu'), 'DejaVuSans.ttf', 'DejaVuSans-Bold.ttf'),
    ])
    for folder, regular, bold in candidates:
        if (folder / regular).exists() and (folder / bold).exists():
            pdfmetrics.registerFont(TTFont('Guide', str(folder / regular)))
            pdfmetrics.registerFont(TTFont('GuideBold', str(folder / bold)))
            pdfmetrics.registerFontFamily('Guide', normal='Guide', bold='GuideBold')
            return
    raise SystemExit('Cyrillic fonts missing: provide --font-dir with DejaVuSans fonts')


def inline(text):
    return re.sub(r'\*\*(.+?)\*\*', r'<b>\1</b>', escape(text))


def build(source, output, font_dir):
    fonts(font_dir)
    body = ParagraphStyle('Body', fontName='Guide', fontSize=10.2, leading=14,
                          spaceAfter=7, textColor=colors.HexColor('#171b22'))
    title = ParagraphStyle('Title', parent=body, fontName='GuideBold', fontSize=18,
                           leading=22, spaceAfter=14, keepWithNext=True)
    heading = ParagraphStyle('Heading', parent=body, fontName='GuideBold', fontSize=12,
                            leading=16, spaceBefore=7, spaceAfter=7, keepWithNext=True)
    note = ParagraphStyle('Note', parent=body, fontSize=9.3, leading=13,
                         borderPadding=8, backColor=colors.HexColor('#f2f4f6'),
                         spaceBefore=5, spaceAfter=12)
    cell = ParagraphStyle('Cell', parent=body, fontSize=9.3, leading=12.5, spaceAfter=0)
    story = []
    lines = source.read_text(encoding='utf-8').splitlines()
    i = 0
    while i < len(lines):
        line = lines[i].strip()
        i += 1
        if not line:
            continue
        if line == '---page---':
            story.append(PageBreak())
        elif line.startswith('# '):
            story.append(Paragraph(inline(line[2:]), title))
        elif line.startswith('## '):
            story.append(Paragraph(inline(line[3:]), heading))
        elif line.startswith('> '):
            story.append(Paragraph(inline(line[2:]), note))
        elif line.startswith('|'):
            rows = [line]
            while i < len(lines) and lines[i].strip().startswith('|'):
                rows.append(lines[i].strip())
                i += 1
            values = [[part.strip() for part in row.strip('|').split('|')] for row in rows]
            values = [row for row in values if not all(re.fullmatch(r'[-: ]+', v) for v in row)]
            data = [[Paragraph(inline(value), cell) for value in row] for row in values]
            widths = [53 * mm, 121 * mm] if len(values[0]) == 2 else None
            table = Table(data, colWidths=widths, repeatRows=1, hAlign='LEFT')
            table.setStyle(TableStyle([
                ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#edf0f3')),
                ('GRID', (0, 0), (-1, -1), .4, colors.HexColor('#d2d7dc')),
                ('VALIGN', (0, 0), (-1, -1), 'TOP'),
                ('LEFTPADDING', (0, 0), (-1, -1), 8),
                ('RIGHTPADDING', (0, 0), (-1, -1), 8),
                ('TOPPADDING', (0, 0), (-1, -1), 8),
                ('BOTTOMPADDING', (0, 0), (-1, -1), 8),
            ]))
            story.extend([table, Spacer(1, 9)])
        else:
            story.append(Paragraph(inline(line), body))

    def footer(canvas, document):
        canvas.saveState()
        canvas.setStrokeColor(colors.HexColor('#d2d7dc'))
        canvas.setLineWidth(.4)
        canvas.line(18 * mm, 16 * mm, 192 * mm, 16 * mm)
        canvas.setFillColor(colors.HexColor('#59616b'))
        canvas.setFont('Guide', 8)
        canvas.drawString(18 * mm, 11 * mm, 'aeroCRM | Универсальные продажи')
        canvas.drawRightString(192 * mm, 11 * mm, str(document.page))
        canvas.restoreState()

    output.parent.mkdir(parents=True, exist_ok=True)
    document = SimpleDocTemplate(str(output), pagesize=A4, rightMargin=18 * mm,
                                 leftMargin=18 * mm, topMargin=18 * mm,
                                 bottomMargin=23 * mm, title='aeroCRM - Универсальные продажи',
                                 author='aeroCRM', pageCompression=1)
    document.build(story, onFirstPage=footer, onLaterPages=footer)
    print(output)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=Path(__file__).with_name('universal-sales.md'))
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--font-dir')
    args = parser.parse_args()
    build(args.source, args.output, args.font_dir)
