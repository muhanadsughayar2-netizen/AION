from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.units import mm
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, HRFlowable
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_LEFT, TA_CENTER

W, H = A4

BLUE   = colors.HexColor('#1A73E8')
GREEN  = colors.HexColor('#0F9D58')
RED    = colors.HexColor('#DB4437')
YELLOW = colors.HexColor('#F4B400')
PURPLE = colors.HexColor('#7B1FA2')
TEAL   = colors.HexColor('#00897B')
GREY   = colors.HexColor('#F8F9FA')
LGREY  = colors.HexColor('#E8EAED')
TEXT   = colors.HexColor('#202124')
TEXT2  = colors.HexColor('#5F6368')
WHITE  = colors.white

def p(name, **kw):
    return ParagraphStyle(name, **kw)

TITLE  = p('title',  fontSize=28, leading=34, textColor=BLUE,   fontName='Helvetica-Bold', alignment=TA_CENTER, spaceAfter=2)
SUB    = p('sub',    fontSize=11, leading=15, textColor=TEXT2,   fontName='Helvetica',      alignment=TA_CENTER, spaceAfter=4)
NAME   = p('name',   fontSize=10, leading=13, textColor=GREEN,   fontName='Helvetica-Bold', alignment=TA_CENTER, spaceAfter=2)
FREE   = p('free',   fontSize=10, leading=13, textColor=RED,     fontName='Helvetica-Bold', alignment=TA_CENTER)
H2     = p('h2',     fontSize=12, leading=15, textColor=BLUE,    fontName='Helvetica-Bold', spaceBefore=6, spaceAfter=3)
H3     = p('h3',     fontSize=9,  leading=12, textColor=TEXT,    fontName='Helvetica-Bold', spaceAfter=1)
BODY   = p('body',   fontSize=8.5,leading=13, textColor=TEXT2,   fontName='Helvetica',      spaceAfter=1)
BULLET = p('bullet', fontSize=8.5,leading=13, textColor=TEXT2,   fontName='Helvetica',      leftIndent=8)
FOOT   = p('foot',   fontSize=8,  leading=11, textColor=TEXT2,   fontName='Helvetica',      alignment=TA_CENTER)

def hr(color=LGREY, thickness=0.8):
    return HRFlowable(width='100%', thickness=thickness, color=color, spaceAfter=4, spaceBefore=4)

def section(title, color=BLUE):
    hex_c = {BLUE:'1A73E8', GREEN:'0F9D58', RED:'DB4437',
              YELLOW:'F4B400', PURPLE:'7B1FA2', TEAL:'00897B'}[color]
    return Paragraph(f'<font color="#{hex_c}"><b>{title}</b></font>', H2)

def feature_row(items):
    """items = list of (icon, title, description) tuples"""
    cells = []
    for icon, title, desc in items:
        content = Paragraph(
            f'<b>{icon} {title}</b><br/>'
            f'<font color="#5F6368" size="8">{desc}</font>',
            BODY
        )
        cells.append(content)
    t = Table([cells], colWidths=[( W - 22*mm) / len(items)] * len(items))
    t.setStyle(TableStyle([
        ('BACKGROUND',    (0,0),(-1,-1), GREY),
        ('TOPPADDING',    (0,0),(-1,-1), 6),
        ('BOTTOMPADDING', (0,0),(-1,-1), 6),
        ('LEFTPADDING',   (0,0),(-1,-1), 8),
        ('RIGHTPADDING',  (0,0),(-1,-1), 6),
        ('VALIGN',        (0,0),(-1,-1), 'TOP'),
        ('GRID',          (0,0),(-1,-1), 0.5, WHITE),
        ('ROWBACKGROUNDS',(0,0),(-1,-1), [GREY]),
    ]))
    return t


def build(path):
    doc = SimpleDocTemplate(
        path, pagesize=A4,
        leftMargin=15*mm, rightMargin=15*mm,
        topMargin=15*mm, bottomMargin=12*mm
    )
    pw = W - 30*mm
    s = []

    # ── Header ────────────────────────────────────────────────────────────────
    s.append(Paragraph('📸  AION AI', TITLE))
    s.append(Paragraph('Your All-in-One AI Creative Studio — Powered by Google AI Studio', SUB))
    s.append(Paragraph('Built by Muhanad Sughayar  ·  AI Developer & Automation Engineer', NAME))
    s.append(Paragraph('100% Free  ·  No Subscriptions  ·  Use Your Own Google API Key', FREE))
    s.append(Spacer(1, 3*mm))
    s.append(hr(BLUE, 1.5))

    # ── What is it ────────────────────────────────────────────────────────────
    s.append(Paragraph(
        'AION AI is a Chrome Extension that gives you direct access to '
        "Google's most powerful AI models — Gemini, Veo, and Lyria — "
        'right inside your browser. No monthly fees. No middleman. '
        'Your API key, your data, your control.',
        BODY
    ))
    s.append(Spacer(1, 3*mm))

    # ── Snap & Build ──────────────────────────────────────────────────────────
    s.append(section('📸  Snap & Build System  —  Your Superpower'))
    s.append(feature_row([
        ('🎯', 'Snap Vision',
         'Snip any part of your screen. Analyze bugs, documents, or layouts. Get answers, '
         'translations, and fixes in seconds.'),
        ('🏗️', 'Live App Builder',
         'Describe any tool in plain English. AION writes the code and launches a working, '
         'interactive app inside your browser — websites, games, calculators, instantly.'),
        ('⚡', 'Quick Actions',
         'One-click commands: Build, Research, Search, Read, Code, Continue. '
         'The fastest way to get things done with AI.'),
    ]))
    s.append(Spacer(1, 3*mm))

    # ── Creative Suite ────────────────────────────────────────────────────────
    s.append(section('🎨  The Creative Suite  —  4 Professional AI Studios', PURPLE))
    s.append(feature_row([
        ('🎬', 'Veo 3.1 Video Studio',
         'Text to cinematic video. High-quality sound auto-synced. Multi-clip storyboard editor. '
         '16:9 / 9:16 / 1:1 ratios.'),
        ('🎙️', 'Broadcast Studio',
         'Turn any file or image into a multi-voice AI podcast. Meet your hosts: Zephyr, Kore & Fenrir.'),
    ]))
    s.append(Spacer(1, 1.5*mm))
    s.append(feature_row([
        ('🍌', 'Nano Banana Image Studio',
         'Edit, upscale, and create photorealistic images with professional precision. '
         'Multiple styles in seconds.'),
        ('🎵', 'Lyria Music Studio',
         "Compose studio-grade background music. Just describe the vibe. "
         "Google's Lyria model — directly in your browser."),
    ]))
    s.append(Spacer(1, 3*mm))

    # ── Autopilot Agent ───────────────────────────────────────────────────────
    s.append(section('🤖  Autopilot Agent  —  21 CDP Browser Automation Tools', TEAL))
    s.append(Paragraph(
        'Give AION a task in plain English — it executes it live in your browser. '
        'Real clicks, real keystrokes, real results. Not simulated.',
        BODY
    ))
    s.append(Spacer(1, 1.5*mm))

    tools = [
        ['click', 'type', 'autofill', 'drag', 'doubleClick', 'pressKey', 'hover'],
        ['navigate', 'scroll', 'waitForElement', 'readText', 'snapshotPage', 'findElement', 'select'],
        ['exportPDF', 'setMobileMode', 'readNetworkResponse', 'readStorage', 'writeChunk', 'screenshot', 'getPageContext'],
    ]
    for row in tools:
        cells = [Paragraph(f'<font color="#1A73E8"><b>{t}</b></font>', BODY) for t in row]
        t_row = Table([cells], colWidths=[pw/7]*7)
        t_row.setStyle(TableStyle([
            ('BACKGROUND',    (0,0),(-1,-1), GREY),
            ('TOPPADDING',    (0,0),(-1,-1), 4),
            ('BOTTOMPADDING', (0,0),(-1,-1), 4),
            ('LEFTPADDING',   (0,0),(-1,-1), 6),
            ('RIGHTPADDING',  (0,0),(-1,-1), 4),
            ('GRID',          (0,0),(-1,-1), 0.5, WHITE),
            ('ALIGN',         (0,0),(-1,-1), 'CENTER'),
        ]))
        s.append(t_row)
        s.append(Spacer(1, 1*mm))
    s.append(Spacer(1, 2*mm))

    # ── Privacy + Models ──────────────────────────────────────────────────────
    priv_model = [[
        Paragraph(
            '<b><font color="#0F9D58">🔐 100% Private</font></b><br/>'
            '<font color="#5F6368" size="8">'
            'Your API key stays in YOUR browser only.<br/>'
            'Data goes directly to Google — we never see it.<br/>'
            'No accounts needed. Zero data collection.<br/>'
            '$300 Google Cloud free credits available.'
            '</font>',
            BODY
        ),
        Paragraph(
            '<b><font color="#1A73E8">⚡ Google AI Models</font></b><br/>'
            '<font color="#5F6368" size="8">'
            'Gemini 2.5 Pro  ·  Gemini 3 Flash (Preview)<br/>'
            'Gemini 2.5 Flash  ·  Veo 3.1 Video Generation<br/>'
            'Lyria Audio & Music  ·  Nano Banana (Imagen)<br/>'
            'All models accessed directly via your free API key.'
            '</font>',
            BODY
        ),
    ]]
    pm_table = Table(priv_model, colWidths=[pw*0.42, pw*0.58])
    pm_table.setStyle(TableStyle([
        ('BACKGROUND',    (0,0),(-1,-1), GREY),
        ('TOPPADDING',    (0,0),(-1,-1), 7),
        ('BOTTOMPADDING', (0,0),(-1,-1), 7),
        ('LEFTPADDING',   (0,0),(-1,-1), 10),
        ('RIGHTPADDING',  (0,0),(-1,-1), 8),
        ('VALIGN',        (0,0),(-1,-1), 'TOP'),
        ('LINEBEFORE',    (1,0),(1,0),   0.8, LGREY),
    ]))
    s.append(pm_table)
    s.append(Spacer(1, 3*mm))

    # ── Tech Stack ────────────────────────────────────────────────────────────
    s.append(section('⚙️  Technology Stack', RED))
    tech_labels = [
        'Chrome Extension MV3', 'Google Gemini 2.5 Pro', 'Gemini 3 Flash',
        'Google Veo 3.1', 'Lyria Audio AI', 'Nano Banana / Imagen',
        'Chrome DevTools Protocol', 'Flask + PostgreSQL', 'Google OAuth',
        'Service Workers', 'Canvas + MediaRecorder', 'EBML WebM Parser',
    ]
    tech_cols = 6
    tech_colors = [BLUE, PURPLE, PURPLE, RED, GREEN, YELLOW,
                   TEAL, GREEN, RED, BLUE, PURPLE, TEAL]
    tech_rows_data = []
    for i in range(0, len(tech_labels), tech_cols):
        chunk = tech_labels[i:i+tech_cols]
        chunk_colors = tech_colors[i:i+tech_cols]
        row_cells = []
        for label, c_ in zip(chunk, chunk_colors):
            hex_c = {BLUE:'1A73E8',GREEN:'0F9D58',RED:'DB4437',
                     YELLOW:'F4B400',PURPLE:'7B1FA2',TEAL:'00897B'}[c_]
            row_cells.append(
                Paragraph(f'<font color="#{hex_c}"><b>{label}</b></font>',
                          p('tc', fontSize=7.5, leading=10, fontName='Helvetica-Bold',
                            alignment=TA_CENTER, textColor=c_))
            )
        while len(row_cells) < tech_cols:
            row_cells.append(Paragraph('', BODY))
        tech_rows_data.append(row_cells)

    tech_t = Table(tech_rows_data, colWidths=[pw/tech_cols]*tech_cols)
    tech_t.setStyle(TableStyle([
        ('BACKGROUND',    (0,0),(-1,-1), GREY),
        ('TOPPADDING',    (0,0),(-1,-1), 5),
        ('BOTTOMPADDING', (0,0),(-1,-1), 5),
        ('LEFTPADDING',   (0,0),(-1,-1), 4),
        ('RIGHTPADDING',  (0,0),(-1,-1), 4),
        ('GRID',          (0,0),(-1,-1), 0.5, WHITE),
        ('ALIGN',         (0,0),(-1,-1), 'CENTER'),
        ('VALIGN',        (0,0),(-1,-1), 'MIDDLE'),
    ]))
    s.append(tech_t)
    s.append(Spacer(1, 4*mm))

    # ── Footer ────────────────────────────────────────────────────────────────
    s.append(hr(BLUE, 1.2))
    s.append(Paragraph(
        '<b>Muhanad Sughayar</b>  ·  AI Developer & Automation Engineer  '
        '·  Custom AI Workflows  ·  Browser Automation  ·  Business Process AI  '
        '·  Available for Projects',
        FOOT
    ))

    doc.build(s)
    print('Done:', path)

build('aion_ai_showcase.pdf')
