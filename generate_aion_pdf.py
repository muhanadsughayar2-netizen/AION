from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.units import mm
from reportlab.platypus import (SimpleDocTemplate, Paragraph, Spacer,
                                 Table, TableStyle, HRFlowable)
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_RIGHT

W, H = A4
PW = W - 28*mm   # usable width

# ── Colours ──────────────────────────────────────────────────────────────────
BLUE    = '#1A73E8'
GREEN   = '#1E8E3E'
RED     = '#D93025'
YELLOW  = '#F9AB00'
PURPLE  = '#7B1FA2'
TEAL    = '#00897B'
DGREY   = '#202124'
MGREY   = '#5F6368'
LGREY   = '#F8F9FA'
BORDER  = '#DADCE0'
WHITE   = '#FFFFFF'

def C(h): return colors.HexColor(h)

# ── Styles ───────────────────────────────────────────────────────────────────
def ps(name, **kw):
    return ParagraphStyle(name, **kw)

STYLES = {
    'appname': ps('appname', fontSize=32, leading=40, fontName='Helvetica-Bold',
                  textColor=C(BLUE), alignment=TA_CENTER),
    'tagline': ps('tagline', fontSize=11, leading=16, fontName='Helvetica',
                  textColor=C(MGREY), alignment=TA_CENTER, spaceAfter=3),
    'byline':  ps('byline',  fontSize=9,  leading=13, fontName='Helvetica-Bold',
                  textColor=C(GREEN),  alignment=TA_CENTER, spaceAfter=2),
    'badges':  ps('badges',  fontSize=9,  leading=13, fontName='Helvetica',
                  textColor=C(MGREY),  alignment=TA_CENTER, spaceAfter=6),
    'sh':      ps('sh',      fontSize=11, leading=15, fontName='Helvetica-Bold',
                  textColor=C(DGREY),  alignment=TA_LEFT, spaceBefore=5, spaceAfter=3),
    'body':    ps('body',    fontSize=9,  leading=14, fontName='Helvetica',
                  textColor=C(MGREY),  alignment=TA_LEFT),
    'card_h':  ps('card_h',  fontSize=9.5,leading=13, fontName='Helvetica-Bold',
                  textColor=C(DGREY),  alignment=TA_LEFT),
    'card_b':  ps('card_b',  fontSize=8.5,leading=13, fontName='Helvetica',
                  textColor=C(MGREY),  alignment=TA_LEFT),
    'footer':  ps('footer',  fontSize=8,  leading=12, fontName='Helvetica',
                  textColor=C(MGREY),  alignment=TA_CENTER),
    'avail':   ps('avail',   fontSize=9,  leading=13, fontName='Helvetica-Bold',
                  textColor=C(BLUE),   alignment=TA_CENTER),
}

def S(name): return STYLES[name]
def HR(col=BORDER, t=0.8): return HRFlowable(width='100%', thickness=t,
                                              color=C(col), spaceBefore=4, spaceAfter=4)

def section(title, dot_color=BLUE):
    return Paragraph(
        f'<font color="{dot_color}">●</font>  <b>{title}</b>', S('sh'))

def card(title, icon, body_text, accent=BLUE):
    return [
        Paragraph(f'<font color="{accent}">{icon}</font>  <b>{title}</b>', S('card_h')),
        Spacer(1, 1.5*mm),
        Paragraph(body_text, S('card_b')),
    ]

def cards_row(items, widths):
    """items: list of (title, icon, text, accent). Returns a Table."""
    from reportlab.platypus import KeepTogether
    cells = []
    for title, icon, text, accent in items:
        inner = card(title, icon, text, accent)
        cell_content = Paragraph(
            f'<font color="{accent}">{icon}</font>  <b><font color="{DGREY}">{title}</font></b>'
            f'<br/><font size="8.5" color="{MGREY}">{text}</font>',
            S('card_b')
        )
        cells.append(cell_content)
    t = Table([cells], colWidths=widths)
    t.setStyle(TableStyle([
        ('BACKGROUND',    (0,0),(-1,-1), C(LGREY)),
        ('TOPPADDING',    (0,0),(-1,-1), 8),
        ('BOTTOMPADDING', (0,0),(-1,-1), 8),
        ('LEFTPADDING',   (0,0),(-1,-1), 10),
        ('RIGHTPADDING',  (0,0),(-1,-1), 8),
        ('VALIGN',        (0,0),(-1,-1), 'TOP'),
        ('LINEAFTER',     (0,0),(len(items)-2, 0), 0.5, C(BORDER)),
    ]))
    return t

def build(out):
    doc = SimpleDocTemplate(out, pagesize=A4,
                            leftMargin=14*mm, rightMargin=14*mm,
                            topMargin=14*mm, bottomMargin=10*mm)
    s = []

    # ── HEADER ────────────────────────────────────────────────────────────────
    s.append(Paragraph('📸  AION AI', S('appname')))
    s.append(Paragraph('Your All-in-One AI Creative Studio — Powered by Google AI Studio', S('tagline')))
    s.append(Paragraph('Built by  Muhanad Sughayar  ·  AI Developer & Automation Engineer', S('byline')))
    s.append(Paragraph(
        '✦ 100% Free &nbsp;&nbsp;✦ Zero Subscriptions &nbsp;&nbsp;'
        '✦ Use Your Own Free Google API Key &nbsp;&nbsp;✦ No Middleman',
        S('badges')))
    s.append(HR(BLUE, 1.5))
    s.append(Spacer(1, 2*mm))

    # ── WHAT IS IT ────────────────────────────────────────────────────────────
    s.append(Paragraph(
        'AION AI is a Chrome Extension that connects you directly to Google\'s most powerful AI models — '
        'Gemini, Veo, and Lyria — right inside your browser. Your API key stays with you. '
        'Your data travels directly to Google. We never see it, store it, or touch it.',
        S('body')))
    s.append(Spacer(1, 4*mm))

    # ── SNAP & BUILD ──────────────────────────────────────────────────────────
    s.append(section('Snap & Build System', BLUE))
    snap_items = [
        ('🎯 Snap Vision',
         'Snip any part of your screen. Analyse bugs, documents, '
         'layouts, or images. Get answers, translations, and fixes in seconds.'),
        ('🏗️ Live App Builder',
         'Describe any tool in plain English. AION writes the code '
         'and launches a working, interactive app inside your browser — '
         'websites, games, calculators — instantly.'),
        ('⚡ Quick Actions',
         'One-click commands built into every chat: Build, Research, '
         'Search, Read, Code, Continue. The fastest way to get things done.'),
    ]
    col3 = PW / 3
    row_cells = []
    for title, text in snap_items:
        row_cells.append(Paragraph(
            f'<b><font color="{BLUE}">{title}</font></b><br/>'
            f'<font size="8.5" color="{MGREY}">{text}</font>',
            S('card_b')))
    snap_t = Table([row_cells], colWidths=[col3]*3)
    snap_t.setStyle(TableStyle([
        ('BACKGROUND',    (0,0),(-1,-1), C(LGREY)),
        ('TOPPADDING',    (0,0),(-1,-1), 8), ('BOTTOMPADDING',(0,0),(-1,-1), 8),
        ('LEFTPADDING',   (0,0),(-1,-1), 8), ('RIGHTPADDING', (0,0),(-1,-1), 8),
        ('VALIGN',        (0,0),(-1,-1), 'TOP'),
        ('LINEAFTER',     (0,0),(1,0),   0.5, C(BORDER)),
    ]))
    s.append(snap_t)
    s.append(Spacer(1, 4*mm))

    # ── CREATIVE SUITE ────────────────────────────────────────────────────────
    s.append(section('The Creative Suite  —  4 Professional AI Studios', PURPLE))
    studio_rows = [
        [
            ('🎬 Veo Video Studio',
             f'<font color="{RED}"><b>🎬 Veo Video Studio</b></font><br/>'
             f'<font size="8.5" color="{MGREY}">Turn a text description into a cinematic video. '
             'High-quality sound auto-synced to the action. Multi-clip storyboard editor '
             'with 16:9 / 9:16 / 1:1 aspect ratios.</font>'),
            ('🎙️ Broadcast Studio',
             f'<font color="{YELLOW}"><b>🎙️ Broadcast Studio</b></font><br/>'
             f'<font size="8.5" color="{MGREY}">Turn any file or image into a multi-voice '
             'AI podcast. Meet your hosts: Zephyr (The Host), Kore (The Expert), '
             'and Fenrir (The Creative).</font>'),
        ],
        [
            ('🍌 Nano Banana',
             f'<font color="{GREEN}"><b>🍌 Nano Banana — Image Studio</b></font><br/>'
             f'<font size="8.5" color="{MGREY}">Edit, upscale, and generate photorealistic '
             'images with professional precision. Multiple styles and resolutions in seconds.</font>'),
            ('🎵 Lyria Music Studio',
             f'<font color="{TEAL}"><b>🎵 Lyria Music Studio</b></font><br/>'
             f'<font size="8.5" color="{MGREY}">Compose studio-quality background music and '
             'soundscapes. Just describe the vibe — AION delivers a full track instantly '
             "using Google's Lyria model.</font>"),
        ],
    ]
    col2 = PW / 2
    for row_data in studio_rows:
        cells = [Paragraph(text, S('card_b')) for _, text in row_data]
        row_t = Table([cells], colWidths=[col2, col2])
        row_t.setStyle(TableStyle([
            ('BACKGROUND',    (0,0),(-1,-1), C(LGREY)),
            ('TOPPADDING',    (0,0),(-1,-1), 8), ('BOTTOMPADDING',(0,0),(-1,-1), 8),
            ('LEFTPADDING',   (0,0),(-1,-1), 10),('RIGHTPADDING', (0,0),(-1,-1), 8),
            ('VALIGN',        (0,0),(-1,-1), 'TOP'),
            ('LINEAFTER',     (0,0),(0,0),   0.5, C(BORDER)),
        ]))
        s.append(row_t)
        s.append(Spacer(1, 1.5*mm))
    s.append(Spacer(1, 2*mm))

    # ── AUTOPILOT AGENT ───────────────────────────────────────────────────────
    s.append(section('Autopilot Agent  —  Real Browser Automation', TEAL))
    s.append(Paragraph(
        'Give AION a task in plain English and it executes it live in your browser using '
        'the Chrome DevTools Protocol (CDP). Real trusted clicks, real keystrokes, real results — '
        'not simulated events. Works on complex web apps, SPAs, and any site a human can use.',
        S('body')))
    s.append(Spacer(1, 2*mm))

    agent_feats = [
        (f'<font color="{TEAL}"><b>✓ Form Autofill</b></font>',
         'Fill entire forms in one call. Matches fields by label, placeholder, or name.'),
        (f'<font color="{TEAL}"><b>✓ Live App Building</b></font>',
         'Describe a tool, the agent builds and launches it in your browser.'),
        (f'<font color="{TEAL}"><b>✓ Web Research</b></font>',
         'Searches the web, reads results, and summarises findings.'),
        (f'<font color="{TEAL}"><b>✓ Read Page Data</b></font>',
         'Intercepts live API responses — reads prices, results, content directly from the source.'),
        (f'<font color="{TEAL}"><b>✓ Export Any Page to PDF</b></font>',
         'Saves any open web page as a PDF with one command.'),
        (f'<font color="{TEAL}"><b>✓ Shadow DOM Search</b></font>',
         'Finds hidden elements inside complex React/Vue apps that normal automation misses.'),
    ]
    agent_cells = [
        [Paragraph(title, S('card_b')), Paragraph(desc, S('card_b'))]
        for title, desc in agent_feats
    ]
    agent_t = Table(agent_cells, colWidths=[PW*0.30, PW*0.70])
    agent_t.setStyle(TableStyle([
        ('BACKGROUND',    (0,0),(-1,-1), C(LGREY)),
        ('TOPPADDING',    (0,0),(-1,-1), 5), ('BOTTOMPADDING',(0,0),(-1,-1), 5),
        ('LEFTPADDING',   (0,0),(-1,-1), 10),('RIGHTPADDING', (0,0),(-1,-1), 8),
        ('VALIGN',        (0,0),(-1,-1), 'TOP'),
        ('ROWBACKGROUNDS',(0,0),(-1,-1), [C(LGREY), C(WHITE)]),
        ('LINEBELOW',     (0,0),(-1,-2), 0.3, C(BORDER)),
    ]))
    s.append(agent_t)
    s.append(Spacer(1, 4*mm))

    # ── PRIVACY + MODELS ──────────────────────────────────────────────────────
    priv_data = [[
        Paragraph(
            f'<font color="{GREEN}"><b>🔐 Privacy by Design</b></font><br/>'
            f'<font size="8.5" color="{MGREY}">'
            'Your API key lives inside your browser only.<br/>'
            'Data travels directly to Google — zero middlemen.<br/>'
            'No AION account needed. We store nothing.<br/><br/>'
            f'<font color="{YELLOW}"><b>★ New Google accounts get $300 in free</b></font><br/>'
            f'<font color="{MGREY}">credits from Google Cloud to explore Veo &amp; Lyria.</font>'
            '</font>',
            S('card_b')),
        Paragraph(
            f'<font color="{BLUE}"><b>⚡ Google AI Models — Direct Access</b></font><br/>'
            f'<font size="8.5" color="{MGREY}">'
            '• <b>Gemini</b> — Text, code, reasoning &amp; vision analysis<br/>'
            '• <b>Gemini Flash</b> — Ultra-fast responses for quick tasks<br/>'
            '• <b>Veo</b> — Cinematic AI video generation<br/>'
            '• <b>Lyria</b> — Studio-quality music &amp; audio<br/>'
            '• <b>Nano Banana (Imagen)</b> — Photorealistic images<br/><br/>'
            'All models accessed directly via your own free API key.</font>',
            S('card_b')),
    ]]
    priv_t = Table(priv_data, colWidths=[PW*0.40, PW*0.60])
    priv_t.setStyle(TableStyle([
        ('BACKGROUND',    (0,0),(-1,-1), C(LGREY)),
        ('TOPPADDING',    (0,0),(-1,-1), 9), ('BOTTOMPADDING',(0,0),(-1,-1), 9),
        ('LEFTPADDING',   (0,0),(-1,-1), 10),('RIGHTPADDING', (0,0),(-1,-1), 8),
        ('VALIGN',        (0,0),(-1,-1), 'TOP'),
        ('LINEBEFORE',    (1,0),(1,0),   0.5, C(BORDER)),
    ]))
    s.append(priv_t)
    s.append(Spacer(1, 4*mm))

    # ── TECH STACK ────────────────────────────────────────────────────────────
    s.append(section('Technology Stack', RED))
    tech = [
        ('Chrome Extension MV3', BLUE),   ('Google Gemini API',   PURPLE),
        ('Google Veo',           RED),     ('Google Lyria',        GREEN),
        ('Imagen / Nano Banana', YELLOW),  ('CDP Debugger API',    TEAL),
        ('Flask + PostgreSQL',   GREEN),   ('Google OAuth',        RED),
        ('Service Workers',      BLUE),    ('Canvas + MediaRecorder', PURPLE),
    ]
    per = 5
    tech_rows = []
    for i in range(0, len(tech), per):
        chunk = tech[i:i+per]
        while len(chunk) < per: chunk.append(('', WHITE))
        cells = [
            Paragraph(f'<font color="{col}"><b>{name}</b></font>' if name else '',
                      ps('tc', fontSize=8, leading=11, fontName='Helvetica-Bold',
                         alignment=TA_CENTER))
            for name, col in chunk
        ]
        tech_rows.append(cells)
    tech_t = Table(tech_rows, colWidths=[PW/per]*per)
    tech_t.setStyle(TableStyle([
        ('BACKGROUND',    (0,0),(-1,-1), C(LGREY)),
        ('TOPPADDING',    (0,0),(-1,-1), 6), ('BOTTOMPADDING',(0,0),(-1,-1), 6),
        ('LEFTPADDING',   (0,0),(-1,-1), 4), ('RIGHTPADDING', (0,0),(-1,-1), 4),
        ('ALIGN',         (0,0),(-1,-1), 'CENTER'),
        ('VALIGN',        (0,0),(-1,-1), 'MIDDLE'),
        ('GRID',          (0,0),(-1,-1), 0.4, C(BORDER)),
    ]))
    s.append(tech_t)
    s.append(Spacer(1, 5*mm))

    # ── FOOTER ────────────────────────────────────────────────────────────────
    s.append(HR(BLUE, 1.2))
    s.append(Spacer(1, 1*mm))
    s.append(Paragraph(
        f'<font color="{BLUE}"><b>Muhanad Sughayar</b></font>  ·  AI Developer & Automation Engineer',
        S('avail')))
    s.append(Paragraph(
        'Available for custom AI projects  ·  Browser automation  ·  Business workflow AI  ·  Chrome extensions',
        S('footer')))

    doc.build(s)
    print('Done:', out)

build('aion_ai_showcase.pdf')
