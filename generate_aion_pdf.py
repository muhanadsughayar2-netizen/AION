from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.units import mm
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, HRFlowable
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_RIGHT
from reportlab.platypus import Flowable

W, H = A4

# ── Colour palette ──────────────────────────────────────────────────────────
DARK       = colors.HexColor('#0d0f14')
CARD       = colors.HexColor('#161a24')
ACCENT     = colors.HexColor('#5b8dee')
ACCENT2    = colors.HexColor('#a78bfa')
TEXT_MAIN  = colors.HexColor('#e8eaf0')
TEXT_SUB   = colors.HexColor('#8b92a8')
WHITE      = colors.white
GREEN      = colors.HexColor('#34d399')
ORANGE     = colors.HexColor('#fb923c')

# ── Styles ───────────────────────────────────────────────────────────────────
def S(name, **kw):
    return ParagraphStyle(name, **kw)

hero_title  = S('HeroTitle',  fontSize=26, leading=32, textColor=WHITE,      alignment=TA_CENTER, fontName='Helvetica-Bold')
hero_sub    = S('HeroSub',    fontSize=10, leading=14, textColor=TEXT_SUB,    alignment=TA_CENTER, fontName='Helvetica')
section_hd  = S('SecHd',     fontSize=9,  leading=11, textColor=ACCENT,      alignment=TA_LEFT,   fontName='Helvetica-Bold', spaceBefore=4)
body        = S('Body',       fontSize=8,  leading=11, textColor=TEXT_MAIN,   alignment=TA_LEFT,   fontName='Helvetica')
body_sub    = S('BodySub',    fontSize=7.5,leading=10, textColor=TEXT_SUB,    alignment=TA_LEFT,   fontName='Helvetica')
badge_style = S('Badge',      fontSize=7,  leading=9,  textColor=WHITE,       alignment=TA_CENTER, fontName='Helvetica-Bold')
cta_style   = S('CTA',        fontSize=8,  leading=11, textColor=TEXT_SUB,    alignment=TA_CENTER, fontName='Helvetica')
cta_bold    = S('CTABold',    fontSize=9,  leading=12, textColor=ACCENT,      alignment=TA_CENTER, fontName='Helvetica-Bold')
tag_style   = S('Tag',        fontSize=7,  leading=9,  textColor=ACCENT2,     alignment=TA_LEFT,   fontName='Helvetica-Bold')

# ── Custom coloured rectangle flowable ──────────────────────────────────────
class ColorRect(Flowable):
    def __init__(self, w, h, fill, radius=3):
        super().__init__()
        self.width, self.height, self.fill, self.radius = w, h, fill, radius
    def draw(self):
        self.canv.setFillColor(self.fill)
        self.canv.roundRect(0, 0, self.width, self.height, self.radius, fill=1, stroke=0)

class HeroBlock(Flowable):
    def __init__(self, page_w):
        super().__init__()
        self.width, self.height = page_w, 64*mm
    def draw(self):
        c = self.canv
        # Background
        c.setFillColor(DARK)
        c.rect(0, 0, self.width, self.height, fill=1, stroke=0)
        # Accent strip
        c.setFillColor(ACCENT)
        c.rect(0, self.height-2, self.width, 2, fill=1, stroke=0)
        # Subtle gradient effect via lighter rect
        c.setFillColorRGB(0.35, 0.55, 0.93, alpha=0.06)
        c.ellipse(-10*mm, self.height*0.3, self.width*0.6, self.height*1.2, fill=1, stroke=0)
        # Emoji + Title
        c.setFillColor(WHITE)
        c.setFont('Helvetica-Bold', 28)
        c.drawCentredString(self.width/2, self.height - 22*mm, '📸  Aion AI')
        c.setFillColor(TEXT_SUB)
        c.setFont('Helvetica', 9.5)
        c.drawCentredString(self.width/2, self.height - 30*mm,
            'AI-Powered Chrome Extension  ·  Browser Automation  ·  Multi-Modal Intelligence')
        # Pills
        pills = [' Free ', ' Chrome MV3 ', ' Gemini 2.5 Pro ', ' CDP Automation ', ' 55 Languages ']
        pill_w = 24*mm
        total = len(pills)*pill_w + (len(pills)-1)*3*mm
        x = (self.width - total)/2
        y = self.height - 44*mm
        for p in pills:
            c.setFillColor(CARD)
            c.roundRect(x, y, pill_w, 6*mm, 2, fill=1, stroke=0)
            c.setFillColor(ACCENT)
            c.setFont('Helvetica-Bold', 6.5)
            c.drawCentredString(x + pill_w/2, y + 1.8*mm, p)
            x += pill_w + 3*mm
        # Tagline
        c.setFillColor(TEXT_SUB)
        c.setFont('Helvetica', 8)
        c.drawCentredString(self.width/2, self.height - 56*mm,
            'Built by Joseph Khaled  ·  Available for Custom AI Solutions')

def build_pdf(path):
    doc = SimpleDocTemplate(path, pagesize=A4,
        leftMargin=12*mm, rightMargin=12*mm, topMargin=0, bottomMargin=8*mm)

    pw = W - 24*mm   # usable width
    story = []

    # ── HERO ─────────────────────────────────────────────────────────────────
    story.append(HeroBlock(W))
    story.append(Spacer(1, 4*mm))

    # ── FEATURE GRID (2 columns) ─────────────────────────────────────────────
    def feat(icon, title, lines):
        txt  = f'<font color="#5b8dee"><b>{icon}  {title}</b></font><br/>'
        txt += '<br/>'.join(f'<font color="#8b92a8" size="7">• {l}</font>' for l in lines)
        return Paragraph(txt, body)

    features = [
        feat('🤖', 'AI Autopilot Agent', [
            '20+ CDP-powered browser tools',
            'Click, type, drag, autofill, scroll',
            'Smart 4-step fallback click chain',
            'Stops after 3 consecutive failures',
        ]),
        feat('🔬', 'Chrome DevTools Protocol', [
            'Trusted mouse events (isTrusted:true)',
            'DOM search incl. shadow roots',
            'Real drag-and-drop events',
            'Network response interception',
        ]),
        feat('🧠', 'Gemini Multi-Modal AI', [
            'Gemini 2.5 Pro / 2.5 Flash / 2.0 Flash',
            'Vision: reads any page / document',
            'Image Studio, Song Studio, Video Studio',
            'Veo video generation + multi-clip stitching',
        ]),
        feat('📄', 'Document Intelligence', [
            'exportPDF: any page → PDF in 1 call',
            'snapshotPage: deep DOM structure read',
            'readNetworkResponse: raw API JSON',
            'writeChunk: unlimited-length documents',
        ]),
        feat('🔐', 'Storage & Auth Awareness', [
            'readStorage: localStorage / sessionStorage',
            'Cookie inspection & auth state check',
            'Google OAuth sign-in built-in',
            'Whop.com subscription management',
        ]),
        feat('🌍', 'Global & Enterprise Ready', [
            '55-language landing page (pre-rendered)',
            'White-label multi-tenant institutions',
            'Flask backend + PostgreSQL',
            'Role-based access, per-member expiry',
        ]),
    ]

    col = pw/2 - 3*mm
    pad = 4*mm
    cell_style = TableStyle([
        ('BACKGROUND', (0,0), (-1,-1), CARD),
        ('ROUNDEDCORNERS', [4]),
        ('LEFTPADDING',  (0,0), (-1,-1), pad),
        ('RIGHTPADDING', (0,0), (-1,-1), pad),
        ('TOPPADDING',   (0,0), (-1,-1), pad),
        ('BOTTOMPADDING',(0,0), (-1,-1), pad),
        ('VALIGN',       (0,0), (-1,-1), 'TOP'),
        ('ROWBACKGROUNDS',(0,0),(-1,-1),[CARD]),
    ])

    rows = [[features[i], features[i+1]] for i in range(0, len(features), 2)]
    tbl = Table(rows, colWidths=[col, col], spaceBefore=0, spaceAfter=0,
                hAlign='CENTER', vAlign='TOP')
    tbl.setStyle(cell_style)
    # Add spacing between cells
    tbl._argH = [None]*len(rows)
    story.append(tbl)
    story.append(Spacer(1, 4*mm))

    # ── TECH STACK STRIP ────────────────────────────────────────────────────
    tech_items = [
        ('Chrome MV3', ACCENT),
        ('Gemini API', ACCENT2),
        ('CDP', GREEN),
        ('Flask', ORANGE),
        ('PostgreSQL', ACCENT),
        ('Google OAuth', ACCENT2),
        ('Whop Payments', GREEN),
        ('Service Workers', ORANGE),
        ('55 Languages', ACCENT),
        ('Veo Video AI', ACCENT2),
    ]
    badges = []
    for label, col_c in tech_items:
        badges.append(Paragraph(f'<font color="white"><b>{label}</b></font>', badge_style))
    badge_w = pw / len(tech_items)
    badge_table = Table([badges], colWidths=[badge_w]*len(tech_items))
    badge_table.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,-1), CARD),
        ('TOPPADDING',    (0,0),(-1,-1), 3),
        ('BOTTOMPADDING', (0,0),(-1,-1), 3),
        ('LEFTPADDING',   (0,0),(-1,-1), 2),
        ('RIGHTPADDING',  (0,0),(-1,-1), 2),
        ('ALIGN',         (0,0),(-1,-1), 'CENTER'),
        ('VALIGN',        (0,0),(-1,-1), 'MIDDLE'),
    ]))
    story.append(badge_table)
    story.append(Spacer(1, 3*mm))

    # ── AGENT TOOLS MINI TABLE ───────────────────────────────────────────────
    story.append(Paragraph('⚡  Agent Tool Arsenal  —  20+ CDP-Powered Actions', section_hd))
    story.append(Spacer(1, 1*mm))
    tools = [
        'click', 'doubleClick', 'type', 'pressKey', 'hover', 'select',
        'drag', 'scroll', 'navigate', 'waitForElement', 'readText',
        'autofill', 'snapshotPage', 'exportPDF', 'findElement',
        'setMobileMode', 'readNetworkResponse', 'readStorage',
        'writeChunk', 'screenshot', 'getPageContext',
    ]
    per_row = 7
    tool_rows = []
    for i in range(0, len(tools), per_row):
        row = tools[i:i+per_row]
        while len(row) < per_row:
            row.append('')
        tool_rows.append([Paragraph(f'<font color="#5b8dee" size="7"><b>{t}</b></font>' if t else '', body) for t in row])
    tool_table = Table(tool_rows, colWidths=[pw/per_row]*per_row)
    tool_table.setStyle(TableStyle([
        ('BACKGROUND',    (0,0),(-1,-1), CARD),
        ('TOPPADDING',    (0,0),(-1,-1), 3),
        ('BOTTOMPADDING', (0,0),(-1,-1), 3),
        ('LEFTPADDING',   (0,0),(-1,-1), 4),
        ('RIGHTPADDING',  (0,0),(-1,-1), 2),
        ('GRID',          (0,0),(-1,-1), 0.3, colors.HexColor('#1e2332')),
    ]))
    story.append(tool_table)
    story.append(Spacer(1, 4*mm))

    # ── CTA FOOTER ───────────────────────────────────────────────────────────
    footer_data = [[
        Paragraph('🚀  <b><font color="#5b8dee">Available for hire</font></b><br/>'
                  '<font color="#8b92a8" size="7">Custom AI workflow automation · Chrome extensions · '
                  'Business process AI · Gemini integrations</font>', body),
        Paragraph('<b><font color="#5b8dee">Joseph Khaled</font></b><br/>'
                  '<font color="#8b92a8" size="7">AI Developer & Automation Engineer<br/>'
                  'joseph@example.com</font>', body),
    ]]
    footer_table = Table(footer_data, colWidths=[pw*0.65, pw*0.35])
    footer_table.setStyle(TableStyle([
        ('BACKGROUND',    (0,0),(-1,-1), CARD),
        ('TOPPADDING',    (0,0),(-1,-1), 5),
        ('BOTTOMPADDING', (0,0),(-1,-1), 5),
        ('LEFTPADDING',   (0,0),(-1,-1), 6),
        ('RIGHTPADDING',  (0,0),(-1,-1), 6),
        ('VALIGN',        (0,0),(-1,-1), 'MIDDLE'),
        ('LINEABOVE',     (0,0),(-1,0),  1, ACCENT),
    ]))
    story.append(footer_table)

    # ── Page background ──────────────────────────────────────────────────────
    def bg(canvas, doc):
        canvas.saveState()
        canvas.setFillColor(DARK)
        canvas.rect(0, 0, W, H, fill=1, stroke=0)
        canvas.restoreState()

    doc.build(story, onFirstPage=bg, onLaterPages=bg)
    print('PDF generated:', path)

build_pdf('aion_ai_showcase.pdf')
