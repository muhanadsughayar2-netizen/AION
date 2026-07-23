from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.units import mm
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_LEFT, TA_CENTER
from reportlab.platypus import Flowable
import math

W, H = A4

# ── Palette ──────────────────────────────────────────────────────────────────
G_BLUE   = colors.HexColor('#4285F4')
G_RED    = colors.HexColor('#EA4335')
G_YELLOW = colors.HexColor('#FBBC05')
G_GREEN  = colors.HexColor('#34A853')
PURPLE   = colors.HexColor('#7C3AED')
TEAL     = colors.HexColor('#0EA5E9')
PINK     = colors.HexColor('#EC4899')
ORANGE   = colors.HexColor('#F97316')
INDIGO   = colors.HexColor('#818CF8')
DARK     = colors.HexColor('#0F1117')
CARD     = colors.HexColor('#1A1D27')
CARD2    = colors.HexColor('#13161F')
BORDER   = colors.HexColor('#2A2D3A')
TEXT_W   = colors.HexColor('#F1F5F9')
TEXT_DIM = colors.HexColor('#94A3B8')
TEXT_MUT = colors.HexColor('#475569')
WHITE    = colors.white

HEX = {
    G_BLUE:'4285F4', G_RED:'EA4335', G_YELLOW:'FBBC05', G_GREEN:'34A853',
    PURPLE:'7C3AED', TEAL:'0EA5E9', PINK:'EC4899', ORANGE:'F97316',
    INDIGO:'818CF8',
}

def h(c): return HEX.get(c,'4285F4')

# ── Styles ───────────────────────────────────────────────────────────────────
def sty(name,**kw): return ParagraphStyle(name,**kw)
s_h1   = sty('h1', fontSize=26,leading=32,textColor=WHITE,       fontName='Helvetica-Bold',alignment=TA_CENTER)
s_sub  = sty('sub',fontSize=9, leading=12,textColor=TEXT_DIM,    fontName='Helvetica',     alignment=TA_CENTER)
s_sec  = sty('sec',fontSize=9, leading=12,textColor=TEXT_W,      fontName='Helvetica-Bold',alignment=TA_LEFT)
s_body = sty('bod',fontSize=7.5,leading=11,textColor=TEXT_DIM,   fontName='Helvetica',     alignment=TA_LEFT)
s_tag  = sty('tag',fontSize=6.5,leading=8,textColor=WHITE,       fontName='Helvetica-Bold',alignment=TA_CENTER)
s_foot = sty('ft', fontSize=7.5,leading=10,textColor=TEXT_DIM,   fontName='Helvetica',     alignment=TA_CENTER)
s_cta  = sty('ct', fontSize=9,  leading=12,textColor=G_BLUE,     fontName='Helvetica-Bold',alignment=TA_CENTER)

# ── Draw the AION spiral logo (4-arc swirl matching the screenshot) ──────────
class AionLogo(Flowable):
    def __init__(self, size=14*mm):
        super().__init__()
        self.size = size
        self.width = self.height = size

    def draw(self):
        c = self.canv
        cx = self.size / 2
        cy = self.size / 2
        r  = self.size * 0.42
        arc_colors = [G_BLUE, G_RED, G_YELLOW, G_GREEN]
        # Draw 4 thick arcs, each 90°, offset by 90°
        for i, ac in enumerate(arc_colors):
            c.setStrokeColor(ac)
            c.setLineWidth(self.size * 0.14)
            start = 90 * i
            c.arc(cx - r, cy - r, cx + r, cy + r,
                  startAng=start, extent=80)
        # Inner white circle
        c.setFillColor(CARD)
        c.setStrokeColor(CARD)
        c.circle(cx, cy, r * 0.35, fill=1, stroke=0)

# ── Hero block ────────────────────────────────────────────────────────────────
class HeroBlock(Flowable):
    def __init__(self, pw):
        super().__init__()
        self.width  = pw
        self.height = 58*mm

    def draw(self):
        c = self.canv
        pw = self.width
        h_  = self.height

        # Background
        c.setFillColor(DARK)
        c.rect(0, 0, pw, h_, fill=1, stroke=0)

        # Top gradient strip
        steps = 20
        for i in range(steps):
            t = i/steps
            # Blue to purple gradient top band
            r_v = 0.259 + t*0.227
            g_v = 0.522 - t*0.336
            b_v = 0.957 - t*0.108
            c.setFillColorRGB(r_v, g_v, b_v, alpha=0.18)
            yy = h_ - (h_*0.35/steps)*(i+1)
            c.rect(0, yy, pw, h_*0.35/steps+1, fill=1, stroke=0)

        # Decorative subtle glow circles
        for (gx, gy, gr, ga, gc) in [
            (pw*0.12, h_*0.75, 20*mm, 0.06, G_BLUE),
            (pw*0.88, h_*0.30, 16*mm, 0.05, PURPLE),
            (pw*0.50, h_*0.10, 22*mm, 0.04, G_GREEN),
        ]:
            c.setFillColor(gc)
            c.circle(gx, gy, gr, fill=1, stroke=0)

        # Logo spiral arcs
        lx = pw/2 - 8*mm
        ly = h_ - 18*mm
        lr = 7*mm
        arc_col = [G_BLUE, G_RED, G_YELLOW, G_GREEN]
        c.setLineWidth(lr*0.30)
        for i, ac in enumerate(arc_col):
            c.setStrokeColor(ac)
            start = 90*i
            c.arc(lx-lr, ly-lr, lx+lr, ly+lr, startAng=start, extent=80)

        # AION text
        c.setFillColor(WHITE)
        c.setFont('Helvetica-Bold', 22)
        c.drawString(pw/2 + 1*mm, ly - 2*mm, 'AION')

        # "POWERED BY GOOGLE AI STUDIO"
        c.setFont('Helvetica', 6.5)
        px = pw/2 + 1*mm
        py_txt = ly - 7.5*mm
        label = 'POWERED BY '
        c.setFillColor(TEXT_DIM)
        c.drawString(px, py_txt, label)
        lw = c.stringWidth(label, 'Helvetica', 6.5)
        for word, col_c in [('GOOGLE ', G_RED),('AI ', G_BLUE),('STUDIO', G_GREEN)]:
            c.setFillColor(col_c)
            c.setFont('Helvetica-Bold', 6.5)
            c.drawString(px + lw, py_txt, word)
            lw += c.stringWidth(word, 'Helvetica-Bold', 6.5)

        # Tagline
        c.setFillColor(TEXT_DIM)
        c.setFont('Helvetica', 8.5)
        c.drawCentredString(pw/2, h_ - 28*mm,
            'Run Gemini, Veo & Lyria directly with your free API key')

        # Badge row
        badges = [
            ('Zero Subscriptions', G_GREEN),
            ('100% Private', G_BLUE),
            ('Free API Key', PURPLE),
            ('No Middleman', G_RED),
        ]
        bw, bh = 28*mm, 5.5*mm
        total = len(badges)*bw + (len(badges)-1)*3*mm
        bx = pw/2 - total/2
        by = h_ - 39*mm
        for label2, bc in badges:
            c.setFillColor(bc)
            c.roundRect(bx, by, bw, bh, 2, fill=1, stroke=0)
            c.setFillColor(WHITE)
            c.setFont('Helvetica-Bold', 6.5)
            c.drawCentredString(bx + bw/2, by + 1.6*mm, label2)
            bx += bw + 3*mm

        # Name line
        c.setFillColor(TEXT_DIM)
        c.setFont('Helvetica', 7.5)
        c.drawCentredString(pw/2, h_ - 50*mm,
            'Built by  Muhanad Sughayar  \u00b7  AI Developer & Automation Engineer  \u00b7  Available for Custom AI Projects')

# ── Card helper ───────────────────────────────────────────────────────────────
def card(icon, title, bullets, accent_hex):
    lines = [f'<font color="#64748B" size="7">\u2022 {b}</font>' for b in bullets]
    txt = (f'<font color="#{accent_hex}"><b>{icon}  {title}</b></font><br/>'
           + '<br/>'.join(lines))
    return Paragraph(txt, s_body)

def card_table(rows_data, col_widths, border_colors):
    t = Table(rows_data, colWidths=col_widths)
    ts = [
        ('TOPPADDING',    (0,0),(-1,-1), 6),
        ('BOTTOMPADDING', (0,0),(-1,-1), 6),
        ('LEFTPADDING',   (0,0),(-1,-1), 6),
        ('RIGHTPADDING',  (0,0),(-1,-1), 5),
        ('VALIGN',        (0,0),(-1,-1), 'TOP'),
        ('BACKGROUND',    (0,0),(-1,-1), CARD),
    ]
    for col_i, bc in enumerate(border_colors):
        ts.append(('LINEBELOW', (col_i,0),(col_i,0), 1.5, colors.HexColor('#'+bc)))
    t.setStyle(TableStyle(ts))
    return t

def section_label(icon, title, col='4285F4'):
    return Paragraph(f'<font color="#{col}"><b>{icon}  {title}</b></font>', s_sec)

def build_pdf(path):
    doc = SimpleDocTemplate(path, pagesize=A4,
        leftMargin=11*mm, rightMargin=11*mm, topMargin=0, bottomMargin=6*mm)
    pw = W - 22*mm
    story = []

    # ── HERO ─────────────────────────────────────────────────────────────────
    story.append(HeroBlock(pw))
    story.append(Spacer(1, 4*mm))

    # ── SNAP & BUILD ROW ──────────────────────────────────────────────────────
    story.append(section_label('📸', 'SNAP & BUILD SYSTEM  —  Your Superpower', '4285F4'))
    story.append(Spacer(1, 1.5*mm))

    c3 = pw/3 - 1.5*mm
    snap_row = [[
        card('🎯', 'Snap Vision', [
            'Snip any part of your screen instantly',
            'Analyze bugs, docs, layouts in seconds',
            'Answers, translations, or fixes on the spot',
            'Batch-upload to ChatGPT, Claude, Grok',
            'Full page & region capture modes',
        ], '4285F4'),
        card('🏗️', 'Live App Builder', [
            'Describe any tool in plain English',
            'AI writes the code & launches it live',
            'Build websites, games, calculators',
            'Real interactive code, one-click publish',
            'Live preview inside your browser',
        ], '34A853'),
        card('⚙️', 'Quick Actions', [
            'Build  \u2014 generate a working app',
            'Research  \u2014 deep web research',
            'Search  \u2014 smart search results',
            'Read  \u2014 summarise any page',
            'Code  \u2014 write & debug code',
        ], 'F97316'),
    ]]
    story.append(card_table(snap_row, [c3]*3, ['4285F4','34A853','F97316']))
    story.append(Spacer(1, 3*mm))

    # ── AI STUDIOS ROW ────────────────────────────────────────────────────────
    story.append(section_label('🎨', 'THE CREATIVE SUITE  —  4 Professional AI Studios', 'EC4899'))
    story.append(Spacer(1, 1.5*mm))

    c4 = pw/4 - 1.5*mm
    studio_row = [[
        card('🎬', 'Veo 3.1 Video Studio', [
            'Text-to-cinematic video generation',
            'High-quality sound auto-synced',
            'Multi-clip storyboard editor',
            '16:9 / 9:16 / 1:1 aspect ratios',
            'AI director expands your brief',
        ], 'EA4335'),
        card('🎙️', 'Broadcast Studio', [
            'Any file or image → AI podcast',
            'Multi-voice talk show format',
            'Hosts: Zephyr, Kore, Fenrir',
            'Studio-quality audio output',
            'Custom scripts & formats',
        ], 'FBBC05'),
        card('🍌', 'Nano Banana Images', [
            'Photorealistic image generation',
            'Edit, upscale, create precision',
            'Professional studio quality',
            'Multiple styles in seconds',
            'Gemini Imagen models',
        ], 'F97316'),
        card('🎵', 'Lyria Music Studio', [
            'Compose studio-grade music',
            'Describe the "vibe" → full track',
            'Background music & soundscapes',
            "Google's Lyria model direct",
            'Unlimited creative generation',
        ], '34A853'),
    ]]
    story.append(card_table(studio_row, [c4]*4, ['EA4335','FBBC05','F97316','34A853']))
    story.append(Spacer(1, 3*mm))

    # ── AUTOPILOT AGENT ───────────────────────────────────────────────────────
    story.append(section_label('🤖', 'AUTOPILOT AGENT  —  21 CDP Browser Automation Tools', '7C3AED'))
    story.append(Spacer(1, 1.5*mm))

    tools = [
        ('click','Trusted CDP click'), ('type','Smart text input'), ('autofill','Forms in 1 call'),
        ('drag','Real CDP drag/drop'), ('navigate','URL navigation'), ('pressKey','Key combos Ctrl+S'),
        ('hover','Reveal menus'), ('select','HTML dropdowns'), ('waitForElement','Async waits'),
        ('readText','Extract exact text'), ('snapshotPage','Deep DOM snapshot'), ('exportPDF','Any page → PDF'),
        ('findElement','Shadow DOM search'), ('setMobileMode','iPhone viewport'), ('readNetworkResponse','Intercept API JSON'),
        ('readStorage','localStorage + cookies'), ('writeChunk','Build long documents'), ('doubleClick','True dbl-click'),
        ('scroll','Page scrolling'), ('screenshot','Visual context'), ('getPageContext','Full page state'),
    ]
    per_row = 7
    tool_rows = []
    for i in range(0, len(tools), per_row):
        chunk = tools[i:i+per_row]
        while len(chunk) < per_row: chunk.append(('',''))
        cells = []
        for name, desc in chunk:
            if name:
                cells.append(Paragraph(
                    f'<font color="#818CF8"><b>{name}</b></font><br/>'
                    f'<font color="#475569" size="5.5">{desc}</font>', s_body))
            else:
                cells.append(Paragraph('', s_body))
        tool_rows.append(cells)

    tool_t = Table(tool_rows, colWidths=[pw/per_row]*per_row)
    tool_t.setStyle(TableStyle([
        ('BACKGROUND',    (0,0),(-1,-1), CARD2),
        ('TOPPADDING',    (0,0),(-1,-1), 4),
        ('BOTTOMPADDING', (0,0),(-1,-1), 4),
        ('LEFTPADDING',   (0,0),(-1,-1), 4),
        ('RIGHTPADDING',  (0,0),(-1,-1), 3),
        ('GRID',          (0,0),(-1,-1), 0.4, BORDER),
        ('VALIGN',        (0,0),(-1,-1), 'TOP'),
    ]))
    story.append(tool_t)
    story.append(Spacer(1, 3*mm))

    # ── PRIVACY + MODELS ROW ─────────────────────────────────────────────────
    c2a = pw * 0.38
    c2b = pw * 0.62 - 2*mm
    priv_model_row = [[
        card('🔐', 'Privacy First', [
            'API key stays in YOUR browser',
            'We never see your data',
            'Direct connection to Google',
            'No accounts, no middleman',
            '$300 Google Cloud free credits',
            'Zero subscriptions needed',
        ], '34A853'),
        card('⚡', 'Google AI Models Integrated', [
            'Gemini 2.5 Pro  \u2014  reasoning & code',
            'Gemini 3 Flash (Preview)  \u2014  speed',
            'Gemini 2.5 Flash  \u2014  balanced',
            'Veo 3.1  \u2014  cinematic video generation',
            'Lyria  \u2014  studio music & audio',
            'Nano Banana (Imagen)  \u2014  photorealistic images',
        ], '4285F4'),
    ]]
    story.append(card_table(priv_model_row, [c2a, c2b], ['34A853','4285F4']))
    story.append(Spacer(1, 3*mm))

    # ── TECH STACK STRIP ─────────────────────────────────────────────────────
    story.append(section_label('⚙️', 'TECHNOLOGY STACK', 'FBBC05'))
    story.append(Spacer(1, 1.5*mm))

    tech = [
        ('Chrome MV3',       '#4285F4'), ('Gemini 2.5 Pro',    '#7C3AED'),
        ('Gemini 3 Flash',   '#818CF8'), ('Google Veo 3.1',    '#EA4335'),
        ('Lyria Audio AI',   '#34A853'), ('Nano Banana Img',   '#F97316'),
        ('CDP Debugger',     '#0EA5E9'), ('Flask + PostgreSQL','#10B981'),
        ('Google OAuth',     '#EA4335'), ('Service Workers',   '#4285F4'),
        ('Canvas+MediaRec',  '#7C3AED'), ('EBML WebM Parser',  '#FBBC05'),
    ]
    per_row_t = 6
    badge_rows = []
    bg_map = []
    for i in range(0, len(tech), per_row_t):
        chunk = tech[i:i+per_row_t]
        row = [Paragraph(f'<font color="white"><b>{label}</b></font>', s_tag) for label, _ in chunk]
        badge_rows.append(row)
        bg_map.append([colors.HexColor(c_) for _, c_ in chunk])

    bw2 = pw / per_row_t
    b_table = Table(badge_rows, colWidths=[bw2]*per_row_t)
    ts2 = [
        ('TOPPADDING',    (0,0),(-1,-1), 4),
        ('BOTTOMPADDING', (0,0),(-1,-1), 4),
        ('LEFTPADDING',   (0,0),(-1,-1), 2),
        ('RIGHTPADDING',  (0,0),(-1,-1), 2),
        ('ALIGN',         (0,0),(-1,-1), 'CENTER'),
        ('VALIGN',        (0,0),(-1,-1), 'MIDDLE'),
        ('GRID',          (0,0),(-1,-1), 1, DARK),
    ]
    for ri, row_cols in enumerate(bg_map):
        for ci, bg_c in enumerate(row_cols):
            ts2.append(('BACKGROUND', (ci,ri),(ci,ri), bg_c))
    b_table.setStyle(TableStyle(ts2))
    story.append(b_table)
    story.append(Spacer(1, 3*mm))

    # ── FOOTER ────────────────────────────────────────────────────────────────
    footer_t = Table([[
        Paragraph(
            '<b><font color="#4285F4" size="9">Muhanad Sughayar</font></b>  '
            '<font color="#64748B" size="7.5">\u00b7  AI Developer & Automation Engineer  '
            '\u00b7  Custom AI Workflows  \u00b7  Browser Automation  '
            '\u00b7  Business Process AI  \u00b7  Available for Projects</font>',
            sty('ftx', fontSize=8, leading=11, fontName='Helvetica',
                alignment=TA_CENTER, textColor=colors.HexColor('#94A3B8')))
    ]], colWidths=[pw])
    footer_t.setStyle(TableStyle([
        ('BACKGROUND',    (0,0),(-1,-1), CARD),
        ('TOPPADDING',    (0,0),(-1,-1), 6),
        ('BOTTOMPADDING', (0,0),(-1,-1), 6),
        ('LEFTPADDING',   (0,0),(-1,-1), 8),
        ('RIGHTPADDING',  (0,0),(-1,-1), 8),
        ('LINEABOVE',     (0,0),(-1,0),  2, G_BLUE),
    ]))
    story.append(footer_t)

    def bg(canvas, _doc):
        canvas.saveState()
        canvas.setFillColor(DARK)
        canvas.rect(0, 0, W, H, fill=1, stroke=0)
        canvas.restoreState()

    doc.build(story, onFirstPage=bg, onLaterPages=bg)
    print('PDF ready:', path)

build_pdf('aion_ai_showcase.pdf')
