from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.units import mm
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_RIGHT
from reportlab.platypus import Flowable
import math

W, H = A4

# ── Palette (bright, Google-inspired) ───────────────────────────────────────
G_BLUE   = colors.HexColor('#4285F4')
G_RED    = colors.HexColor('#EA4335')
G_YELLOW = colors.HexColor('#FBBC05')
G_GREEN  = colors.HexColor('#34A853')
PURPLE   = colors.HexColor('#7C3AED')
TEAL     = colors.HexColor('#0EA5E9')
PINK     = colors.HexColor('#EC4899')
ORANGE   = colors.HexColor('#F97316')
INDIGO   = colors.HexColor('#6366F1')

BG       = colors.HexColor('#F8FAFF')
CARD_BG  = colors.white
BORDER   = colors.HexColor('#E2E8F0')
TEXT     = colors.HexColor('#1E293B')
TEXT2    = colors.HexColor('#475569')
TEXT3    = colors.HexColor('#94A3B8')
WHITE    = colors.white

# ── Styles ───────────────────────────────────────────────────────────────────
def sty(name, **kw):
    return ParagraphStyle(name, **kw)

s_title   = sty('T',  fontSize=22, leading=28, textColor=WHITE,  fontName='Helvetica-Bold', alignment=TA_CENTER)
s_tagline = sty('TL', fontSize=9.5,leading=13, textColor=colors.HexColor('#CBD5E1'), fontName='Helvetica', alignment=TA_CENTER)
s_name    = sty('N',  fontSize=8,  leading=11, textColor=colors.HexColor('#93C5FD'), fontName='Helvetica-Bold', alignment=TA_CENTER)
s_sec     = sty('SH', fontSize=10, leading=13, textColor=TEXT,   fontName='Helvetica-Bold', alignment=TA_LEFT)
s_body    = sty('B',  fontSize=7.5,leading=11, textColor=TEXT2,  fontName='Helvetica', alignment=TA_LEFT)
s_small   = sty('SM', fontSize=6.5,leading=9,  textColor=TEXT3,  fontName='Helvetica', alignment=TA_LEFT)
s_badge   = sty('BD', fontSize=6.5,leading=8,  textColor=WHITE,  fontName='Helvetica-Bold', alignment=TA_CENTER)
s_tool    = sty('TL2',fontSize=7,  leading=9,  textColor=G_BLUE, fontName='Helvetica-Bold', alignment=TA_CENTER)
s_card_h  = sty('CH', fontSize=8.5,leading=11, textColor=TEXT,   fontName='Helvetica-Bold', alignment=TA_LEFT)
s_card_b  = sty('CB', fontSize=7,  leading=10, textColor=TEXT2,  fontName='Helvetica', alignment=TA_LEFT)
s_center  = sty('CC', fontSize=7.5,leading=10, textColor=TEXT2,  fontName='Helvetica', alignment=TA_CENTER)
s_footer  = sty('FT', fontSize=7,  leading=10, textColor=TEXT3,  fontName='Helvetica', alignment=TA_CENTER)
s_free    = sty('FR', fontSize=11, leading=14, textColor=G_GREEN, fontName='Helvetica-Bold', alignment=TA_CENTER)

class HeroBlock(Flowable):
    def __init__(self, pw):
        super().__init__()
        self.width = pw
        self.height = 52*mm
    def draw(self):
        c = self.canv
        # Gradient background (simulated with layered rects)
        steps = 30
        for i in range(steps):
            t = i / steps
            r = 0.259 + t*(0.486 - 0.259)
            g = 0.522 + t*(0.102 - 0.522)
            b = 0.957 + t*(0.937 - 0.957)
            c.setFillColorRGB(r, g, b)
            y0 = (self.height / steps) * i
            c.rect(0, y0, self.width, self.height/steps + 1, fill=1, stroke=0)
        # Decorative circles
        c.setFillColor(colors.HexColor('#FFFFFF'))
        c.setFillAlpha = lambda a: None
        for cx2, cy2, r2, alpha in [(self.width*0.85, self.height*0.7, 18*mm, 0.07),
                                     (self.width*0.1,  self.height*0.3, 12*mm, 0.05),
                                     (self.width*0.5,  self.height*1.1, 25*mm, 0.04)]:
            c.setFillColor(colors.HexColor('#FFFFFF' ))
            c.circle(cx2, cy2, r2, fill=1, stroke=0)
        # Camera emoji + title
        c.setFillColor(WHITE)
        c.setFont('Helvetica-Bold', 24)
        c.drawCentredString(self.width/2, self.height - 16*mm, '\U0001f4f8  Aion AI')
        c.setFillColor(colors.HexColor('#CBD5E1'))
        c.setFont('Helvetica', 9)
        c.drawCentredString(self.width/2, self.height - 24*mm,
            'AI-Powered Chrome Extension  \u00b7  Browser Automation  \u00b7  Multi-Modal Intelligence')
        # FREE badge
        c.setFillColor(G_GREEN)
        bw, bh = 22*mm, 7*mm
        bx = self.width/2 - bw/2
        by = self.height - 34*mm
        c.roundRect(bx, by, bw, bh, 3, fill=1, stroke=0)
        c.setFillColor(WHITE)
        c.setFont('Helvetica-Bold', 8)
        c.drawCentredString(self.width/2, by + 1.8*mm, '100% FREE')
        # Name
        c.setFillColor(colors.HexColor('#93C5FD'))
        c.setFont('Helvetica-Bold', 8)
        c.drawCentredString(self.width/2, self.height - 44*mm, 'Built by Muhanad Sughayar  \u00b7  AI Developer & Automation Engineer')

class ColoredRect(Flowable):
    def __init__(self, w, h, fill, radius=4, stroke_color=None):
        super().__init__()
        self.width, self.height = w, h
        self.fill, self.radius, self.stroke_color = fill, radius, stroke_color
    def draw(self):
        c = self.canv
        c.setFillColor(self.fill)
        if self.stroke_color:
            c.setStrokeColor(self.stroke_color)
            c.roundRect(0, 0, self.width, self.height, self.radius, fill=1, stroke=1)
        else:
            c.roundRect(0, 0, self.width, self.height, self.radius, fill=1, stroke=0)

COLOR_HEX = {
    G_BLUE: '4285F4', G_RED: 'EA4335', G_YELLOW: 'FBBC05', G_GREEN: '34A853',
    PURPLE: '7C3AED', TEAL: '0EA5E9', PINK: 'EC4899', ORANGE: 'F97316',
    INDIGO: '6366F1',
}

def section_header(title, color=G_BLUE):
    h = COLOR_HEX.get(color, '4285F4')
    return Paragraph(f'<font color="#{h}"><b>{title}</b></font>', s_sec)

def card(icon, title, bullets, accent=G_BLUE):
    h = COLOR_HEX.get(accent, '4285F4')
    lines = [f'<font color="#475569" size="7">\u2022 {b}</font>' for b in bullets]
    txt = f'<font color="#{h}"><b>{icon}  {title}</b></font><br/>' + '<br/>'.join(lines)
    return Paragraph(txt, s_body)

def build_pdf(path):
    doc = SimpleDocTemplate(path, pagesize=A4,
        leftMargin=12*mm, rightMargin=12*mm, topMargin=0, bottomMargin=8*mm)
    pw = W - 24*mm
    story = []

    # ── HERO ─────────────────────────────────────────────────────────────────
    story.append(HeroBlock(pw))
    story.append(Spacer(1, 4*mm))

    # ── ROW 1: Screenshots + Upload + Autopilot Agent ─────────────────────────
    story.append(section_header('⚡  Core Features', G_BLUE))
    story.append(Spacer(1, 2*mm))

    col3 = pw/3 - 2*mm
    feat_data = [[
        card('📸', 'Screenshot Capture', [
            'Full page & region snip capture',
            'Queue up to 10 screenshots',
            'Drag & drop reordering',
            'Multi-select operations',
            'Annotation tools & stickers',
            'Privacy-first (session storage)',
        ], G_BLUE),
        card('🚀', 'Batch AI Upload', [
            'Auto-detects ChatGPT, Claude, Grok',
            'One-click batch upload',
            'Upload Mode with smart detection',
            'Works on all major AI platforms',
            'No backend needed for capture',
            'Instant multi-image delivery',
        ], G_RED),
        card('🤖', 'AI Autopilot Agent', [
            'Natural language task input',
            '20+ CDP browser tools',
            '4-step click fallback chain',
            'Smart wait after every action',
            '3-failure safety stop guard',
            'Powered by Gemini 2.5 Pro',
        ], PURPLE),
    ]]
    feat_table = Table(feat_data, colWidths=[col3]*3, spaceBefore=0)
    feat_table.setStyle(TableStyle([
        ('BACKGROUND',    (0,0),(-1,-1), CARD_BG),
        ('TOPPADDING',    (0,0),(-1,-1), 5),
        ('BOTTOMPADDING', (0,0),(-1,-1), 5),
        ('LEFTPADDING',   (0,0),(-1,-1), 5),
        ('RIGHTPADDING',  (0,0),(-1,-1), 5),
        ('VALIGN',        (0,0),(-1,-1), 'TOP'),
        ('BOX',           (0,0),(0,0),   0.5, colors.HexColor('#E0F2FE')),
        ('BOX',           (1,0),(1,0),   0.5, colors.HexColor('#FEE2E2')),
        ('BOX',           (2,0),(2,0),   0.5, colors.HexColor('#EDE9FE')),
        ('ROUNDEDCORNERS',[4]),
    ]))
    story.append(feat_table)
    story.append(Spacer(1, 3*mm))

    # ── ROW 2: AI MODES ───────────────────────────────────────────────────────
    story.append(section_header('🧠  Multi-Modal AI  —  4 Studio Modes', PURPLE))
    story.append(Spacer(1, 2*mm))

    col4 = pw/4 - 1.5*mm
    ai_data = [[
        card('👁️', 'Vision Mode', [
            'Gemini 2.5 Pro reads screenshots',
            'Understands any page or doc',
            'Answers questions about images',
            'Context-aware responses',
        ], G_BLUE),
        card('🎨', 'Image Studio', [
            'AI image generation',
            'Gemini image models',
            'Multiple styles & prompts',
            'Download & share results',
        ], PINK),
        card('🎵', 'Song Studio', [
            'Text-to-speech music',
            'Natural voice TTS',
            'Chunked audio playback',
            'Multiple voice styles',
        ], G_GREEN),
        card('🎬', 'Video Studio', [
            'Google Veo video generation',
            'Multi-clip chaining',
            '16:9 / 9:16 / 1:1 ratios',
            'Storyboard editor + AI director',
        ], ORANGE),
    ]]
    ai_table = Table(ai_data, colWidths=[col4]*4)
    ai_table.setStyle(TableStyle([
        ('BACKGROUND',    (0,0),(-1,-1), CARD_BG),
        ('TOPPADDING',    (0,0),(-1,-1), 5),
        ('BOTTOMPADDING', (0,0),(-1,-1), 5),
        ('LEFTPADDING',   (0,0),(-1,-1), 5),
        ('RIGHTPADDING',  (0,0),(-1,-1), 5),
        ('VALIGN',        (0,0),(-1,-1), 'TOP'),
        ('BOX',           (0,0),(0,0),   0.5, colors.HexColor('#E0F2FE')),
        ('BOX',           (1,0),(1,0),   0.5, colors.HexColor('#FCE7F3')),
        ('BOX',           (2,0),(2,0),   0.5, colors.HexColor('#DCFCE7')),
        ('BOX',           (3,0),(3,0),   0.5, colors.HexColor('#FFEDD5')),
        ('ROUNDEDCORNERS',[4]),
    ]))
    story.append(ai_table)
    story.append(Spacer(1, 3*mm))

    # ── CDP AUTOMATION TOOLS GRID ─────────────────────────────────────────────
    story.append(section_header('🔬  Chrome DevTools Protocol  —  21 Automation Tools', TEAL))
    story.append(Spacer(1, 2*mm))

    tools = [
        ('click','Trusted CDP click'),('doubleClick','True double-click'),
        ('type','Smart text input'),('pressKey','Key combos Ctrl+S'),
        ('hover','Hover & reveal menus'),('select','HTML dropdowns'),
        ('drag','Real CDP drag & drop'),('scroll','Page scrolling'),
        ('navigate','URL navigation'),('waitForElement','Async load waits'),
        ('readText','Extract exact text'),('autofill','Fill forms in 1 call'),
        ('snapshotPage','Deep DOM snapshot'),('exportPDF','Any page → PDF'),
        ('findElement','Shadow DOM search'),('setMobileMode','iPhone viewport'),
        ('readNetworkResponse','Intercept API JSON'),('readStorage','localStorage + cookies'),
        ('writeChunk','Append long content'),('screenshot','Visual context'),
        ('getPageContext','Full page state'),
    ]
    per_row = 7
    tool_rows = []
    for i in range(0, len(tools), per_row):
        row_tools = tools[i:i+per_row]
        while len(row_tools) < per_row:
            row_tools.append(('',''))
        cells = []
        for name, desc in row_tools:
            if name:
                txt = (f'<font color="#4285F4"><b>{name}</b></font><br/>'
                       f'<font color="#94A3B8" size="5.5">{desc}</font>')
            else:
                txt = ''
            cells.append(Paragraph(txt, s_card_b))
        tool_rows.append(cells)

    tool_table = Table(tool_rows, colWidths=[pw/per_row]*per_row)
    tool_table.setStyle(TableStyle([
        ('BACKGROUND',    (0,0),(-1,-1), colors.HexColor('#F0F9FF')),
        ('TOPPADDING',    (0,0),(-1,-1), 4),
        ('BOTTOMPADDING', (0,0),(-1,-1), 4),
        ('LEFTPADDING',   (0,0),(-1,-1), 4),
        ('RIGHTPADDING',  (0,0),(-1,-1), 3),
        ('GRID',          (0,0),(-1,-1), 0.4, colors.HexColor('#BAE6FD')),
        ('VALIGN',        (0,0),(-1,-1), 'TOP'),
    ]))
    story.append(tool_table)
    story.append(Spacer(1, 3*mm))

    # ── ROW 3: Enterprise + UX + Global ──────────────────────────────────────
    col3b = pw/3 - 2*mm
    feat2_data = [[
        card('🌍', 'Global Ready', [
            '55 languages supported',
            'RTL language support',
            'Pre-rendered SEO HTML per lang',
            'Canonical URLs + hreflang tags',
            'XML sitemap + robots.txt',
            'Google Search Console linked',
        ], G_GREEN),
        card('🏢', 'Enterprise / White-Label', [
            'Multi-tenant institutions',
            'Role-based access control',
            'Per-member access expiry',
            'Custom branding per org',
            'Admin dashboard',
            'Email-only member onboarding',
        ], INDIGO),
        card('✨', 'UI / UX Features', [
            'Glassmorphism dark popup',
            'Right-click Mouse Wand Menu',
            'Chrome side-panel (Sidebar)',
            'Light & dark theme system',
            'In-app video tutorials',
            'Review prompting system',
        ], PINK),
    ]]
    feat2_table = Table(feat2_data, colWidths=[col3b]*3)
    feat2_table.setStyle(TableStyle([
        ('BACKGROUND',    (0,0),(-1,-1), CARD_BG),
        ('TOPPADDING',    (0,0),(-1,-1), 5),
        ('BOTTOMPADDING', (0,0),(-1,-1), 5),
        ('LEFTPADDING',   (0,0),(-1,-1), 5),
        ('RIGHTPADDING',  (0,0),(-1,-1), 5),
        ('VALIGN',        (0,0),(-1,-1), 'TOP'),
        ('BOX',           (0,0),(0,0),   0.5, colors.HexColor('#DCFCE7')),
        ('BOX',           (1,0),(1,0),   0.5, colors.HexColor('#E0E7FF')),
        ('BOX',           (2,0),(2,0),   0.5, colors.HexColor('#FCE7F3')),
        ('ROUNDEDCORNERS',[4]),
    ]))
    story.append(feat2_table)
    story.append(Spacer(1, 3*mm))

    # ── TECH STACK BADGES ────────────────────────────────────────────────────
    story.append(section_header('⚙️  Technology Stack', G_YELLOW))
    story.append(Spacer(1, 2*mm))

    tech = [
        ('Chrome MV3',          G_BLUE),
        ('Gemini 2.5 Pro',      PURPLE),
        ('Gemini 2.5 Flash',    INDIGO),
        ('Google Veo',          PINK),
        ('CDP Debugger API',    TEAL),
        ('Flask Python',        G_GREEN),
        ('PostgreSQL',          colors.HexColor('#336791')),
        ('Google OAuth',        G_RED),
        ('Whop Payments',       ORANGE),
        ('Service Workers',     G_BLUE),
        ('Canvas + MediaRec',   PURPLE),
        ('55-Lang SEO',         G_GREEN),
    ]
    per_row_t = 6
    badge_rows = []
    for i in range(0, len(tech), per_row_t):
        row = tech[i:i+per_row_t]
        cells = []
        for label, col_c in row:
            cells.append(Paragraph(
                f'<font color="white"><b>{label}</b></font>',
                s_badge
            ))
        badge_rows.append(cells)

    bw = pw / per_row_t

    # Build badge table with alternating colors
    badge_table = Table(badge_rows, colWidths=[bw]*per_row_t)
    ts = [
        ('TOPPADDING',    (0,0),(-1,-1), 4),
        ('BOTTOMPADDING', (0,0),(-1,-1), 4),
        ('LEFTPADDING',   (0,0),(-1,-1), 2),
        ('RIGHTPADDING',  (0,0),(-1,-1), 2),
        ('ALIGN',         (0,0),(-1,-1), 'CENTER'),
        ('VALIGN',        (0,0),(-1,-1), 'MIDDLE'),
        ('GRID',          (0,0),(-1,-1), 1, WHITE),
    ]
    for i, (row_items) in enumerate(badge_rows):
        for j, (label, col_c) in enumerate(tech[i*per_row_t:(i+1)*per_row_t]):
            ts.append(('BACKGROUND', (j,i),(j,i), col_c))
    badge_table.setStyle(TableStyle(ts))
    story.append(badge_table)
    story.append(Spacer(1, 3*mm))

    # ── FOOTER ────────────────────────────────────────────────────────────────
    footer_data = [[
        Paragraph(
            '<b><font color="#4285F4">Muhanad Sughayar</font></b>  '
            '<font color="#94A3B8">\u00b7  AI Developer & Automation Engineer\u00b7  '
            'Available for custom AI solutions, browser automation, and business workflow AI</font>',
            sty('FT2', fontSize=7.5, leading=10, fontName='Helvetica', alignment=TA_CENTER, textColor=TEXT2)
        )
    ]]
    footer_table = Table(footer_data, colWidths=[pw])
    footer_table.setStyle(TableStyle([
        ('BACKGROUND',    (0,0),(-1,-1), colors.HexColor('#EFF6FF')),
        ('TOPPADDING',    (0,0),(-1,-1), 5),
        ('BOTTOMPADDING', (0,0),(-1,-1), 5),
        ('LEFTPADDING',   (0,0),(-1,-1), 8),
        ('RIGHTPADDING',  (0,0),(-1,-1), 8),
        ('LINEABOVE',     (0,0),(-1,0),  1.5, G_BLUE),
    ]))
    story.append(footer_table)

    def bg(canvas, doc):
        canvas.saveState()
        canvas.setFillColor(BG)
        canvas.rect(0, 0, W, H, fill=1, stroke=0)
        canvas.restoreState()

    doc.build(story, onFirstPage=bg, onLaterPages=bg)
    print('✅  PDF ready:', path)

build_pdf('aion_ai_showcase.pdf')
