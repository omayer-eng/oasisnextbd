#!/usr/bin/env python3
"""Generate assets/docs/venguard-fact-sheet.pdf (English) from src/site.json.
Run after changing claims, price or certifications:  python3 src/make_factsheet.py"""
import json, pathlib
from reportlab.lib.pagesizes import A4
from reportlab.lib.colors import HexColor
from reportlab.pdfgen import canvas

SRC = pathlib.Path(__file__).resolve().parent
SITE = json.loads((SRC / "site.json").read_text(encoding="utf-8"))
OUT = SRC.parent / "assets/docs/venguard-fact-sheet.pdf"
NAVY, TEAL, DEEP, SLATE, INK, MIST = (HexColor(c) for c in ("#0B2A4A", "#12B5A6", "#0A7F76", "#5B6B7A", "#0A1622", "#EAF2F6"))
c = SITE["claims"]

def claim(ok, confirmed, designed):
    return confirmed if ok else designed + " (testing in progress)"

W, H = A4
pdf = canvas.Canvas(str(OUT), pagesize=A4)
pdf.setTitle("VenGuard fact sheet")
pdf.setFillColor(NAVY); pdf.rect(0, H - 120, W, 120, stroke=0, fill=1)
pdf.setFillColor(HexColor("#FFFFFF")); pdf.setFont("Helvetica-Bold", 28); pdf.drawString(48, H - 70, "VenGuard")
pdf.setFont("Helvetica", 13); pdf.drawString(48, H - 95, "Safety that acts.  Fact sheet, October 2026")
pdf.setStrokeColor(TEAL); pdf.setLineWidth(2.5)
p = pdf.beginPath(); p.moveTo(300, H - 80); p.curveTo(360, H - 80, 380, H - 50, 440, H - 60); p.curveTo(500, H - 70, 520, H - 45, W - 48, H - 55); pdf.drawPath(p)

y = H - 165
def heading(t):
    global y
    pdf.setFillColor(NAVY); pdf.setFont("Helvetica-Bold", 14); pdf.drawString(48, y, t); y -= 22
def line(t, bullet=True):
    global y
    pdf.setFillColor(INK); pdf.setFont("Helvetica", 11)
    words, cur = t.split(), ""
    first = True
    for w in words:
        if pdf.stringWidth(cur + " " + w, "Helvetica", 11) > W - 120:
            pdf.drawString(66 if not (bullet and first) else 48, y, ("•  " if bullet and first else "") + cur.strip()); y -= 16; cur = ""; first = False
        cur += " " + w
    pdf.drawString(66 if not (bullet and first) else 48, y, ("•  " if bullet and first else "") + cur.strip()); y -= 20

heading("What it is")
line("An automatic gas shut-off kit for LPG kitchens in Bangladesh: a gas detector, an automatic valve and batteries. When it confirms a leak, it closes the gas by itself, even with nobody home.", False)
y -= 6
heading("Key facts")
line(claim(c["no_power_needed_confirmed"], "Works without mains power (battery operated).", "Designed to work without mains power (battery operated)"))
line(claim(c["no_internet_needed_confirmed"], "Works without internet; all protection happens in the device.", "Designed to work without internet; all protection happens in the device"))
line(claim(c["closes_under_1s_confirmed"], "Closes the valve in under 1 second after a confirmed leak.", "Designed to close the valve in under 1 second after a confirmed leak"))
line("A 7-second confirmation check avoids false alarms from brief cooking smells.")
line("Manual reset in about 10 seconds; gas never turns back on by itself.")
line("No change to gas pipes and no special tools needed to install.")
y -= 6
heading("Pricing")
line(f"Core Safety: one-time purchase, never paywalled. Pre-order deposit BDT {SITE['preorder']['deposit_bdt']}, fully refundable.")
line(f"Connected (optional): BDT {SITE['preorder']['connected_plan_bdt_per_year']} per year for remote close, alerts and a landlord dashboard.")
y -= 6
heading("Status")
certs = ", ".join(SITE["certifications_granted"]) or "none granted yet; certification pathway in progress (BUET, BSTI)"
line("Working prototype built. Safety and reliability testing under way. Pre-orders open.")
line("Certifications: " + certs + ".")
y -= 6
heading("Who it is for")
line("Homes, restaurants, landlords and building developers. Agro (poultry) and Marine versions are planned.")
y -= 6
heading("Contact")
k = SITE["contact"]
line(f"WhatsApp / phone: {k['phone_display']}    Email: {k['email']}", False)
line(SITE["base_url"], False)

pdf.setFillColor(SLATE); pdf.setFont("Helvetica", 8.5)
pdf.drawString(48, 36, "We state only what testing supports. Claims marked 'designed to' are being tested. Certification marks are shown only once granted.")
pdf.save()
print("Wrote", OUT)
