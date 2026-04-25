// ═══════════════════════════════════════════════════════════════
// SINELEC OS v2.0 - BACKEND COMPLET
// ═══════════════════════════════════════════════════════════════
// Date: 20 Avril 2026
// Description: API complète + Cron jobs + Veille tarifaire
// ═══════════════════════════════════════════════════════════════

const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const { createClient } = require('@supabase/supabase-js');
const Anthropic = require('@anthropic-ai/sdk');


// Charger config
const CONFIG = require('./config-v2.js');

// ═══════════════════════════════════════════════════════════════
// INITIALISATION
// ═══════════════════════════════════════════════════════════════

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(__dirname));

// Clients
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

const BREVO_API_KEY = process.env.BREVO_API_KEY;
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// ═══════════════════════════════════════════════════════════════
// HEALTHCHECK
// ═══════════════════════════════════════════════════════════════

app.get('/', (req, res) => res.send('✅ SINELEC OS v2.0 API OK'));
app.get('/health', (req, res) => res.json({ 
  status: 'ok', 
  service: 'SINELEC OS v2.0',
  version: CONFIG.meta.version,
  features: Object.entries(CONFIG.features)
    .filter(([k, v]) => v === true)
    .map(([k]) => k)
}));

// ═══════════════════════════════════════════════════════════════
// HELPER: LOGS SYSTÈME
// ═══════════════════════════════════════════════════════════════

async function logSystem(type, message, data = null, success = true, error = null) {
  try {
    await supabase.from('logs_system').insert({
      type,
      message,
      data,
      success,
      error_details: error ? error.toString() : null
    });
    
    if (CONFIG.dev.debug_mode) {
      console.log(`[${type}] ${message}`, data);
    }
  } catch (err) {
    console.error('Erreur log:', err);
  }
}

// ═══════════════════════════════════════════════════════════════
// HELPER: ENVOI EMAIL BREVO
// ═══════════════════════════════════════════════════════════════

async function envoyerEmail(to, subject, htmlContent, attachment = null) {
  if (CONFIG.dev.skip_email) {
    console.log('📧 [DEV] Email skippé:', to, subject);
    return { skipped: true };
  }

  console.log('📧 Tentative envoi email à:', to);
  console.log('📧 Sujet:', subject);
  
  const payload = {
    sender: { 
      name: CONFIG.email.sender_name, 
      email: CONFIG.email.sender_email 
    },
    to: [{ email: to }],
    subject,
    htmlContent,
  };

  if (attachment) {
    payload.attachment = [{
      content: attachment.content,
      name: attachment.name,
    }];
  }

  try {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'api-key': BREVO_API_KEY,
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error('❌ Erreur Brevo:', err);
      await logSystem('email', `Échec envoi à ${to}`, { error: err }, false, err);
      throw new Error(`Brevo error: ${err}`);
    }

    const result = await res.json();
    console.log('✅ Email envoyé avec succès !', result);
    await logSystem('email', `Email envoyé à ${to}`, { subject, messageId: result.messageId }, true);
    return result;
  } catch (error) {
    console.error('❌ Erreur lors de l\'envoi email:', error);
    await logSystem('email', `Erreur envoi à ${to}`, { error: error.message }, false, error);
    throw error;
  }
}

// ═══════════════════════════════════════════════════════════════
// HELPER: INCRÉMENTER COMPTEUR
// ═══════════════════════════════════════════════════════════════

async function incrementerCompteur(type) {
  const { data, error } = await supabase
    .from('compteurs')
    .select('valeur')
    .eq('type', type)
    .single();

  if (error || !data) {
    await supabase.from('compteurs').insert({ type, valeur: 1 });
    return 1;
  }

  const nouvelle_valeur = data.valeur + 1;
  await supabase
    .from('compteurs')
    .update({ valeur: nouvelle_valeur })
    .eq('type', type);

  return nouvelle_valeur;
}

// ═══════════════════════════════════════════════════════════════
// HELPER: CHARGER GRILLE TARIFAIRE
// ═══════════════════════════════════════════════════════════════

async function chargerGrilleTarifaire() {
  const { data, error } = await supabase
    .from('grille_tarifaire')
    .select('*')
    .eq('actif', true)
    .order('categorie, nom');

  if (error) {
    console.error('Erreur chargement grille:', error);
    return null;
  }

  // Grouper par catégorie
  const grille = {};
  data.forEach(item => {
    if (!grille[item.categorie]) {
      grille[item.categorie] = [];
    }
    grille[item.categorie].push({
      code: item.code,
      nom: item.nom,
      prix: item.prix_ht,
      unite: item.unite
    });
  });

  return grille;
}

// ═══════════════════════════════════════════════════════════════
// API: GÉNÉRATION DEVIS/FACTURE
// ═══════════════════════════════════════════════════════════════

app.post('/api/generer', async (req, res) => {
  if (!CONFIG.features.devis_factures) {
    return res.status(403).json({ error: 'Feature désactivée' });
  }

  try {
    const { type, client, email, telephone, adresse, complement, codePostal, ville, prenom, siret, tvaNum, description, prestations } = req.body;

    // Nettoyer le nom (supprimer espaces entre lettres si espacé)
    const clientClean = String(client || '').replace(/\s+/g, ' ').trim();
    const prenomClean = String(prenom || '').replace(/\s+/g, ' ').trim();
    const startTime = Date.now();

    const compteur = await incrementerCompteur(type);
    const annee = new Date().getFullYear();
    const mois = String(new Date().getMonth() + 1).padStart(2, '0');
    const num = type === 'devis'
      ? `OS-${annee}${mois}-${String(compteur).padStart(3, '0')}`
      : `${annee}${mois}-${String(compteur).padStart(3, '0')}`;

    const total_ht = prestations.reduce((sum, p) => sum + (p.prix * p.quantite), 0);

    const { error: dbError } = await supabase.from('historique').insert({
      num, type, client, email, telephone, adresse, prestations, total_ht,
      statut: 'envoyé',
      date_envoi: new Date().toISOString(),
      source: 'app',
      temps_generation: Math.round((Date.now() - startTime) / 1000)
    });

    if (dbError) throw dbError;

    if (CONFIG.features.email_auto && email) {
      console.log('📧 Préparation email pour:', email);

      const typeLabel = type === 'devis' ? 'Devis' : 'Facture';
      const typeLabelUpper = type === 'devis' ? 'DEVIS' : 'FACTURE';
      const subject = `${typeLabel} SINELEC ${num}`;
      const htmlEmail = type === 'devis' ? CONFIG.email.template_devis : CONFIG.email.template_facture;
      const dateStr = new Date().toLocaleDateString('fr-FR');
      const dateValide = new Date(Date.now() + 30*24*60*60*1000).toLocaleDateString('fr-FR');

      const detailsPath = path.join(__dirname, `_details_${num}.json`);
      const pyPath = path.join(__dirname, `_devis_${num}.py`);
      const pdfPath = path.join(__dirname, `${num}.pdf`);

      // Générer descriptions pro avec Claude
      let detailsData = prestations.map(p => ({
        designation: p.nom,
        qte: p.quantite,
        prixUnit: p.prix,
        total: p.prix * p.quantite,
        details: []
      }));

      // Générer descriptions pro avec Claude
      try {
        const promptDesc = 'Tu es expert électricien SINELEC Paris. Pour chaque prestation ci-dessous, génère UNE description courte (max 12 mots) qui détaille ce qui est inclus et rassure le client. Réponds UNIQUEMENT en JSON valide: [{"nom": "...", "desc": "..."}]\n\nPrestations:\n' + prestations.map(p => p.nom).join('\n');
        const descResp = await anthropic.messages.create({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 800,
          messages: [{ role: 'user', content: promptDesc }]
        });
        const descText = descResp.content[0].text;
        const jsonMatch = descText.match(/\[.*\]/s);
        if (jsonMatch) {
          const descs = JSON.parse(jsonMatch[0]);
          detailsData = detailsData.map((d, i) => ({
            ...d,
            details: descs[i]?.desc ? [descs[i].desc] : []
          }));
        }
      } catch(e) {
        console.log('⚠️ Descriptions auto skippées:', e.message);
      }

      try {
        const promptDesc = `Tu es expert électricien SINELEC Paris. Pour chaque prestation, génère UNE description courte (max 12 mots) qui justifie le prix et rassure le client. Réponds UNIQUEMENT en JSON: [{"nom": "...", "desc": "..."}]

Prestations:
${prestations.map(p => p.nom).join('\n')}`;
        const descResp = await anthropic.messages.create({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 500,
          messages: [{ role: 'user', content: promptDesc }]
        });
        const descText = descResp.content[0].text;
        const jsonMatch = descText.match(/\[.*\]/s);
        if (jsonMatch) {
          const descs = JSON.parse(jsonMatch[0]);
          detailsData = detailsData.map((d, i) => ({
            ...d,
            details: descs[i]?.desc ? [descs[i].desc] : []
          }));
        }
      } catch(e) {
        console.log('⚠️ Descriptions auto skippées:', e.message);
      }

      fs.writeFileSync(detailsPath, JSON.stringify(detailsData));

      const clientEsc = String(client || '').replace(/'/g, ' ');
    // client contient déjà prénom+nom fusionnés par getClientComplet
    const clientNomComplet = clientEsc;
    const clientComplement = String(complement || '').replace(/'/g, ' ').trim();
    const clientTel = String(telephone || '').replace(/'/g, ' ').trim();
      const adresseEsc = String(adresse || '').replace(/'/g, ' ');
      // Nettoyer adresse GPS
      const adresseRaw = String(adresse || '').replace(/'/g, ' ').trim();
      const adresseParts = adresseRaw.split(',').map(s => s.trim()).filter(Boolean);
      // Rue = rejoindre numéro + nom si séparés
      const clientRue = adresseParts.length >= 2 && adresseParts[0].match(/^\d+$/)
        ? adresseParts[0] + ' ' + adresseParts[1]
        : adresseParts[0] || '';
      const cpMatch = adresseRaw.match(/\b(\d{5})\b/);
      const cpFromAdresse = cpMatch ? cpMatch[1] : '';
      const clientCP = String(codePostal || '').trim() || cpFromAdresse;
      const villeManuelle = String(ville || '').trim();
      const villeGPS = adresseParts.find(p =>
        p.length > 2 && p.length < 30 &&
        !p.match(/^\d{5}/) &&
        !p.toLowerCase().includes('france') &&
        !p.toLowerCase().includes('ile-de') &&
        !p.toLowerCase().includes('metropolitaine') &&
        !p.toLowerCase().includes('arrondissement') &&
        !p.toLowerCase().includes('quartier')
      ) || '';
      const clientVille = [clientCP, villeManuelle || villeGPS].filter(Boolean).join(' ');
      const clientCPVille = clientVille;

      const descObjet = (description || 'Travaux d\'electricite generale').replace(/'/g, ' ');
      const py = `# -*- coding: utf-8 -*-
import json, base64, io, sys
from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.units import cm
from reportlab.platypus import *
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_RIGHT
from reportlab.pdfgen import canvas as pdfcanvas
from reportlab.lib.utils import ImageReader
from reportlab.platypus.flowables import HRFlowable

W, H = A4

# Palette bleu marine + or
MARINE       = colors.HexColor('#1B2A4A')
MARINE_LIGHT = colors.HexColor('#243660')
OR           = colors.HexColor('#C9A84C')
OR_PALE      = colors.HexColor('#FBF7EC')
OR_FONCE     = colors.HexColor('#A07830')
BLANC        = colors.white
CREME        = colors.HexColor('#FDFCF9')
GRIS_TEXTE   = colors.HexColor('#3A3A3A')
GRIS_SOFT    = colors.HexColor('#777777')
GRIS_LIGNE   = colors.HexColor('#E0DDD6')
GRIS_BG      = colors.HexColor('#F5F4F0')

def p(txt, sz=9, font='Helvetica', color=GRIS_TEXTE, align=TA_LEFT, sb=0, sa=2, leading=None):
    if leading is None: leading = sz * 1.35
    return Paragraph(str(txt), ParagraphStyle('s', fontName=font, fontSize=sz,
        textColor=color, alignment=align, spaceBefore=sb, spaceAfter=sa,
        leading=leading, wordWrap='CJK'))

data = json.loads(open(sys.argv[1], encoding='utf-8').read())
totalHT = sum(l['total'] for l in data)
logo_bytes = base64.b64decode(open('/app/logo_b64.txt').read().strip())

class SC(pdfcanvas.Canvas):
    def __init__(self, fn, **kw):
        pdfcanvas.Canvas.__init__(self, fn, **kw)
        self._pg = 0
        self.saveState()
        self._draw_page()
    def showPage(self):
        self._draw_footer()
        pdfcanvas.Canvas.showPage(self)
        self._pg += 1
    def save(self):
        pdfcanvas.Canvas.save(self)

    def _draw_page(self):
        self.saveState()
        # Fond crème
        self.setFillColor(CREME)
        self.rect(0, 0, W, H, fill=1, stroke=0)
        # Bande marine gauche épaisse
        self.setFillColor(MARINE)
        self.rect(0, 0, 0.7*cm, H, fill=1, stroke=0)
        # Liseré or sur la bande marine
        self.setFillColor(OR)
        self.rect(0.7*cm, 0, 0.08*cm, H, fill=1, stroke=0)
        if self._pg == 0:
            self._draw_header()
        else:
            self._draw_header_small()
        self.restoreState()

    def _draw_header(self):
        # Header marine pleine largeur
        self.setFillColor(MARINE)
        self.rect(0.78*cm, H-5.2*cm, W-0.78*cm, 5.2*cm, fill=1, stroke=0)
        # Liseré or bas header
        self.setFillColor(OR)
        self.rect(0.78*cm, H-5.2*cm, W-0.78*cm, 0.1*cm, fill=1, stroke=0)
        # Logo
        logo_img = io.BytesIO(logo_bytes)
        self.drawImage(ImageReader(logo_img), 1.3*cm, H-4.6*cm,
            width=3.0*cm, height=3.0*cm, preserveAspectRatio=True, mask='auto')
        # Infos société
        self.setFont('Helvetica-Bold', 9)
        self.setFillColor(colors.white)
        self.drawString(1.0*cm, H-4.5*cm, '128 Rue La Boetie, 75008 Paris')
        self.setFont('Helvetica', 8.5)
        self.setFillColor(colors.HexColor('#BFC8D6'))
        self.drawString(1.0*cm, H-4.75*cm, 'Tel : 07 87 38 86 22  |  sinelec.paris@gmail.com')
        self.drawString(1.0*cm, H-5.0*cm, 'SIRET : 91015824500019')
        # DEVIS / FACTURE
        self.setFont('Helvetica-Bold', 44)
        self.setFillColor(BLANC)
        self.drawRightString(W-1.2*cm, H-2.2*cm, '${typeLabelUpper}')
        # Liseré or sous le titre
        self.setStrokeColor(OR)
        self.setLineWidth(1.5)
        self.line(10*cm, H-2.65*cm, W-1.2*cm, H-2.65*cm)
        # Badge numéro
        self.setFillColor(OR)
        self.roundRect(W-6.5*cm, H-3.55*cm, 5.3*cm, 0.65*cm, 0.15*cm, fill=1, stroke=0)
        self.setFont('Helvetica-Bold', 9)
        self.setFillColor(MARINE)
        self.drawCentredString(W-3.85*cm, H-3.22*cm, 'N\\u00b0 ${num}')
        # Date
        self.setFont('Helvetica', 8)
        self.setFillColor(colors.HexColor('#BFC8D6'))
        self.drawRightString(W-1.2*cm, H-3.9*cm, 'Date : ${dateStr}   |   Valable jusqu\\u2019au : ${dateValide}')

    def _draw_header_small(self):
        self.setFillColor(MARINE)
        self.rect(0.78*cm, H-1.5*cm, W-0.78*cm, 1.5*cm, fill=1, stroke=0)
        self.setFillColor(OR)
        self.rect(0.78*cm, H-1.5*cm, W-0.78*cm, 0.08*cm, fill=1, stroke=0)
        self.setFont('Helvetica-Bold', 10)
        self.setFillColor(BLANC)
        self.drawString(1.4*cm, H-1.0*cm, 'SINELEC')
        self.setFont('Helvetica', 8)
        self.setFillColor(OR)
        self.drawRightString(W-1.2*cm, H-1.0*cm, '${typeLabelUpper} N\\u00b0 ${num}')

    def _draw_footer(self):
        self.saveState()
        self.setFillColor(MARINE)
        self.rect(0, 0, W, 1.0*cm, fill=1, stroke=0)
        self.setFillColor(OR)
        self.rect(0, 1.0*cm, W, 0.08*cm, fill=1, stroke=0)
        self.setFont('Helvetica', 6.5)
        self.setFillColor(colors.HexColor('#8899BB'))
        self.drawCentredString(W/2, 0.5*cm,
            'SINELEC EI  \\u2022  128 Rue La Boetie, 75008 Paris  \\u2022  SIRET : 91015824500019  \\u2022  TVA non applicable art. 293B CGI  \\u2022  Garantie decennale ORUS')
        self.setFont('Helvetica-Bold', 7)
        self.setFillColor(OR)
        self.drawRightString(W-1.2*cm, 0.28*cm, '${num}')
        self.restoreState()

doc = SimpleDocTemplate(sys.argv[2], pagesize=A4,
    leftMargin=1.2*cm, rightMargin=1.0*cm,
    topMargin=5.6*cm, bottomMargin=1.6*cm)

story = []

# ── OBJET + CLIENT ────────────────────────────────────────
objet_b = Table([
    [p('OBJET DES TRAVAUX', 7.5, 'Helvetica-Bold', OR, sa=4)],
    [p('${descObjet}', 10, 'Helvetica-Bold', MARINE)],
    [p('Conformes NF C 15-100  \u2022  Garantie decennale ORUS', 7.5, color=GRIS_SOFT)],
], colWidths=[8.2*cm])
objet_b.setStyle(TableStyle([
    ('TOPPADDING', (0,0), (-1,-1), 3),
    ('BOTTOMPADDING', (0,0), (-1,-1), 3),
    ('LEFTPADDING', (0,0), (-1,-1), 0),
    ('LINEABOVE', (0,0), (0,0), 2.5, MARINE),
    ('TOPPADDING', (0,0), (0,0), 10),
]))

client_rows = [
    [p('CLIENT', 7, 'Helvetica-Bold', OR, sa=4)],
    [p('${clientNomComplet}', 10, 'Helvetica-Bold', MARINE)],
]
if '${clientRue}': client_rows.append([p('${clientRue}', 8.5, color=GRIS_TEXTE)])
if '${clientComplement}': client_rows.append([p('${clientComplement}', 8.5, color=GRIS_TEXTE)])
if '${clientCPVille}': client_rows.append([p('${clientCPVille}', 8.5, color=GRIS_TEXTE)])
if '${clientTel}': client_rows.append([p('Tel : ${clientTel}', 8.5, color=GRIS_SOFT)])
client_b = Table(client_rows, colWidths=[9.0*cm])
client_b.setStyle(TableStyle([
    ('TOPPADDING', (0,0), (-1,-1), 3),
    ('BOTTOMPADDING', (0,0), (-1,-1), 3),
    ('LEFTPADDING', (0,0), (-1,-1), 14),
    ('RIGHTPADDING', (0,0), (-1,-1), 14),
    ('BACKGROUND', (0,0), (-1,-1), OR_PALE),
    ('BOX', (0,0), (-1,-1), 1, OR),
    ('LINEBEFORE', (0,0), (0,-1), 4, MARINE),
    ('TOPPADDING', (0,0), (0,0), 10),
    ('BOTTOMPADDING', (0,-1), (-1,-1), 10),
]))

story.append(Table([[objet_b, client_b]], colWidths=[8.7*cm, 9.5*cm],
    style=TableStyle([
        ('VALIGN', (0,0), (-1,-1), 'TOP'),
        ('TOPPADDING', (0,0), (-1,-1), 0),
        ('BOTTOMPADDING', (0,0), (-1,-1), 0),
        ('LEFTPADDING', (0,0), (-1,-1), 0),
        ('RIGHTPADDING', (0,0), (-1,-1), 0),
    ])))
story.append(Spacer(1, 0.6*cm))

# ── TABLEAU ───────────────────────────────────────────────
cw = [0.7*cm, 9.5*cm, 1.5*cm, 0.9*cm, 2.4*cm, 3.2*cm]
rows = [[
    p('#', 7.5, 'Helvetica-Bold', BLANC, TA_CENTER),
    p('DESIGNATION / DETAIL', 7.5, 'Helvetica-Bold', BLANC),
    p('QTE', 7.5, 'Helvetica-Bold', BLANC, TA_CENTER),
    p('U.', 7.5, 'Helvetica-Bold', BLANC, TA_CENTER),
    p('PRIX U. HT', 7.5, 'Helvetica-Bold', BLANC, TA_RIGHT),
    p('TOTAL HT', 7.5, 'Helvetica-Bold', BLANC, TA_RIGHT),
]]
for i, l in enumerate(data):
    q = int(l['qte']) if l['qte'] == int(l['qte']) else l['qte']
    rows.append([
        p(str(i+1), 9, color=OR, align=TA_CENTER),
        p('<b>' + l['designation'] + '</b>', 9, color=MARINE),
        p(str(q), 9, align=TA_CENTER),
        p('u.', 9, align=TA_CENTER, color=GRIS_SOFT),
        p('%.2f \\u20ac' % l['prixUnit'], 9, align=TA_RIGHT),
        p('<b>%.2f \\u20ac</b>' % l['total'], 9, 'Helvetica-Bold', MARINE, TA_RIGHT),
    ])
    for det in l.get('details', []):
        rows.append(['', p('   \\u2022 ' + det, 7.5, color=GRIS_SOFT), '', '', '', ''])

t = Table(rows, colWidths=cw)
ts = [
    ('BACKGROUND', (0,0), (-1,0), MARINE),
    ('LINEBELOW', (0,0), (-1,0), 2.5, OR),
    ('VALIGN', (0,0), (-1,-1), 'TOP'),
    ('TOPPADDING', (0,0), (-1,-1), 6),
    ('BOTTOMPADDING', (0,0), (-1,-1), 6),
    ('LEFTPADDING', (0,0), (-1,-1), 7),
    ('RIGHTPADDING', (0,0), (-1,-1), 7),
    ('BOX', (0,0), (-1,-1), 0.3, GRIS_LIGNE),
]
row_idx = 1; bg = True
for l in data:
    nb = 1 + len(l.get('details', []))
    c = BLANC if bg else GRIS_BG
    ts.append(('BACKGROUND', (0, row_idx), (-1, row_idx+nb-1), c))
    ts.append(('LINEBELOW', (0, row_idx+nb-1), (-1, row_idx+nb-1), 0.3, GRIS_LIGNE))
    row_idx += nb; bg = not bg
t.setStyle(TableStyle(ts))
story.append(t)
story.append(Spacer(1, 0.15*cm))

# ── TOTAUX ────────────────────────────────────────────────
tt = Table([
    ['', p('Total HT', 9, color=GRIS_SOFT, align=TA_RIGHT),
     p('%.2f \\u20ac' % totalHT, 9, 'Helvetica-Bold', GRIS_TEXTE, TA_RIGHT)],
    ['', p('TVA', 9, color=GRIS_SOFT, align=TA_RIGHT),
     p('Non applicable (art. 293B)', 8, color=GRIS_SOFT, align=TA_RIGHT)],
], colWidths=[9.0*cm, 4.5*cm, 4.7*cm])
tt.setStyle(TableStyle([
    ('LINEABOVE', (1,0), (-1,0), 0.5, GRIS_LIGNE),
    ('TOPPADDING', (0,0), (-1,-1), 5),
    ('BOTTOMPADDING', (0,0), (-1,-1), 5),
    ('LEFTPADDING', (0,0), (-1,-1), 6),
    ('RIGHTPADDING', (0,0), (-1,-1), 6),
]))
story.append(tt)
story.append(Spacer(1, 0.12*cm))

# ── NET A PAYER ───────────────────────────────────────────
net = Table([[
    p('NET \\u00c0 PAYER', 13, 'Helvetica-Bold', BLANC),
    p('%.2f \\u20ac' % totalHT, 16, 'Helvetica-Bold', OR, TA_RIGHT),
]], colWidths=[9.0*cm, 9.2*cm])
net.setStyle(TableStyle([
    ('BACKGROUND', (0,0), (-1,-1), MARINE),
    ('TOPPADDING', (0,0), (-1,-1), 10),
    ('BOTTOMPADDING', (0,0), (-1,-1), 10),
    ('LEFTPADDING', (0,0), (-1,-1), 14),
    ('RIGHTPADDING', (0,0), (-1,-1), 14),
    ('LINEBELOW', (0,0), (-1,-1), 3, OR),
    ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
]))
story.append(net)
story.append(Spacer(1, 0.35*cm))

# ── CONDITIONS ────────────────────────────────────────────
story.append(HRFlowable(width='100%', thickness=0.3, color=GRIS_LIGNE, spaceAfter=8))
story.append(p('CONDITIONS', 8, 'Helvetica-Bold', MARINE, sa=6))
cond = Table([
    [p('Acompte 40% a la signature', 9, color=GRIS_TEXTE),
     p('%.2f \\u20ac' % (totalHT*0.4), 9, 'Helvetica-Bold', OR_FONCE, TA_RIGHT)],
    [p('Solde a la fin des travaux', 9, color=GRIS_TEXTE),
     p('%.2f \\u20ac' % (totalHT*0.6), 9, align=TA_RIGHT)],
    [p('Validite 30 jours  \\u2022  Virement bancaire, especes, carte bancaire', 8, color=GRIS_SOFT), ''],
], colWidths=[14.2*cm, 4.0*cm])
cond.setStyle(TableStyle([
    ('LINEBELOW', (0,0), (-1,1), 0.3, GRIS_LIGNE),
    ('TOPPADDING', (0,0), (-1,-1), 5),
    ('BOTTOMPADDING', (0,0), (-1,-1), 5),
    ('LEFTPADDING', (0,0), (-1,-1), 0),
    ('RIGHTPADDING', (0,0), (-1,-1), 0),
    ('SPAN', (0,2), (1,2)),
]))
story.append(cond)
story.append(Spacer(1, 0.15*cm))

# ── IBAN ──────────────────────────────────────────────────
iban = Table([[
    p('IBAN', 7, 'Helvetica-Bold', GRIS_SOFT),
    p('FR76 1695 8000 0174 2540 5920 931', 9, 'Helvetica-Bold', MARINE),
    p('BIC', 7, 'Helvetica-Bold', GRIS_SOFT, TA_RIGHT),
    p('QNTOFRP1XXX', 9, 'Helvetica-Bold', MARINE, TA_RIGHT),
]], colWidths=[1.5*cm, 9.5*cm, 1.8*cm, 5.4*cm])
iban.setStyle(TableStyle([
    ('BACKGROUND', (0,0), (-1,-1), OR_PALE),
    ('BOX', (0,0), (-1,-1), 0.5, OR),
    ('LINEBEFORE', (0,0), (0,-1), 4, MARINE),
    ('TOPPADDING', (0,0), (-1,-1), 9),
    ('BOTTOMPADDING', (0,0), (-1,-1), 9),
    ('LEFTPADDING', (0,0), (-1,-1), 10),
    ('RIGHTPADDING', (0,0), (-1,-1), 10),
    ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
]))
story.append(iban)

doc.build(story, canvasmaker=lambda fn, **kw: SC(fn, **kw))
print('PDF_OK')
`;

      fs.writeFileSync(pyPath, py, 'utf8');

      try {
        execSync(`python3 ${pyPath} ${detailsPath} ${pdfPath}`, { cwd: __dirname, stdio: 'inherit' });
      } catch(pyErr) {
        console.error('❌ Python error:', pyErr.message);
        throw new Error('PDF generation failed');
      }

      const pdfBuffer = fs.readFileSync(pdfPath);
      const pdfB64 = pdfBuffer.toString('base64');
      console.log('📄 PDF size:', pdfB64.length, 'chars');

      await envoyerEmail(
        email, subject,
        htmlEmail.replace('{num}', num),
        { content: pdfB64, name: `${num}.pdf` }
      );

      try { fs.unlinkSync(pyPath); } catch(e) {}
      try { fs.unlinkSync(detailsPath); } catch(e) {}
      try { fs.unlinkSync(pdfPath); } catch(e) {}
    }

    await logSystem('generer', `${type} ${num} créé`, { client, total_ht }, true);
    res.json({ success: true, num, total_ht });

  } catch (error) {
    console.error('Erreur génération:', error);
    await logSystem('generer', 'Erreur génération', { error: error.message }, false, error);
    res.status(500).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// API: CHATBOT CLAUDE (parsing chantier)
// ═══════════════════════════════════════════════════════════════

app.post('/api/chat', async (req, res) => {
  if (!CONFIG.features.chatbot_claude) {
    return res.status(403).json({ error: 'Feature désactivée' });
  }

  try {
    const { message } = req.body;

    const grille = await chargerGrilleTarifaire();
    if (!grille) throw new Error('Impossible de charger la grille tarifaire');

    const prompt = `Tu es un assistant pour SINELEC Paris, électricien. Le client décrit son chantier. Analyse et génère un panier.

GRILLE TARIFAIRE:
${JSON.stringify(grille, null, 2)}

MESSAGE CLIENT: "${message}"

RÉPONDS EN JSON:
{
  "prestations": [
    { "code": "prise", "nom": "Prise électrique", "quantite": 2, "prix": 90 }
  ],
  "explication": "J'ai détecté..."
}`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      messages: [{ role: 'user', content: prompt }]
    });

    const text = response.content[0].text;
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    const result = jsonMatch ? JSON.parse(jsonMatch[0]) : { prestations: [], explication: text };

    await logSystem('chatbot', 'Parsing chantier réussi', { message, result }, true);

    res.json(result);
  } catch (error) {
    console.error('Erreur chatbot:', error);
    await logSystem('chatbot', 'Erreur parsing', { error: error.message }, false, error);
    res.status(500).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// API: SIGNATURE CLIENT
// ═══════════════════════════════════════════════════════════════

app.post('/api/signature', async (req, res) => {
  if (!CONFIG.features.signature_client) {
    return res.status(403).json({ error: 'Feature désactivée' });
  }

  try {
    const { num, signature } = req.body;

    // Sauvegarder signature
    await supabase.from('signatures').insert({ num, signature });

    // Mettre à jour devis
    await supabase.from('historique')
      .update({ 
        signature, 
        statut: 'signé',
        date_signature: new Date().toISOString()
      })
      .eq('num', num);

    await logSystem('signature', `Devis ${num} signé`, { num }, true);

    res.json({ success: true });
  } catch (error) {
    console.error('Erreur signature:', error);
    await logSystem('signature', 'Erreur signature', { error: error.message }, false, error);
    res.status(500).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// API: HISTORIQUE
// ═══════════════════════════════════════════════════════════════

app.get('/api/historique', async (req, res) => {
  if (!CONFIG.features.historique) {
    return res.status(403).json({ error: 'Feature désactivée' });
  }

  try {
    const { type } = req.query;
    
    let query = supabase.from('historique').select('*').order('created_at', { ascending: false });
    
    if (type && type !== 'tous') {
      query = query.eq('type', type);
    }

    const { data, error } = await query;
    if (error) throw error;

    res.json(data || []);
  } catch (error) {
    console.error('Erreur historique:', error);
    res.status(500).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// API: CLIENTS (agrégés)
// ═══════════════════════════════════════════════════════════════

app.get('/api/clients', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('clients')
      .select('*')
      .order('ca_total', { ascending: false });

    if (error) throw error;
    res.json(data || []);
  } catch (error) {
    console.error('Erreur clients:', error);
    res.status(500).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// API: RAPPORT INTERVENTION
// ═══════════════════════════════════════════════════════════════

app.post('/api/rapport', async (req, res) => {
  if (!CONFIG.features.rapports_intervention) {
    return res.status(403).json({ error: 'Feature désactivée' });
  }

  try {
    const { client, adresse, chantier, photo_avant, photo_apres, signature } = req.body;

    // Générer numéro rapport
    const compteur = await incrementerCompteur('rapport');
    const num = `R-${new Date().getFullYear()}-${String(compteur).padStart(3, '0')}`;

    // Claude génère description travaux
    const prompt = `Rédige une description professionnelle des travaux pour ce rapport d'intervention:
Chantier: ${chantier}
Client: ${client}
Adresse: ${adresse}

Décris les travaux réalisés de manière claire et professionnelle (2-3 phrases max).`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 200,
      messages: [{ role: 'user', content: prompt }]
    });

    const travaux = response.content[0].text;

    // Sauvegarder
    await supabase.from('rapports').insert({
      num,
      client,
      adresse,
      travaux,
      photo_avant,
      photo_apres,
      signature
    });

    await logSystem('rapport', `Rapport ${num} créé`, { client }, true);

    res.json({ success: true, num, travaux });
  } catch (error) {
    console.error('Erreur rapport:', error);
    await logSystem('rapport', 'Erreur création', { error: error.message }, false, error);
    res.status(500).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// API: GRILLE TARIFAIRE
// ═══════════════════════════════════════════════════════════════

app.get('/api/grille', async (req, res) => {
  try {
    const grille = await chargerGrilleTarifaire();
    res.json(grille || {});
  } catch (error) {
    console.error('Erreur grille:', error);
    res.status(500).json({ error: error.message });
  }
});


// ═══════════════════════════════════════════════════════════════
// API: TÉLÉCHARGER PDF PAR NUMÉRO
// ═══════════════════════════════════════════════════════════════
app.get('/api/pdf/:num', async (req, res) => {
  try {
    const { num } = req.params;

    // Récupérer le devis depuis Supabase
    const { data, error } = await supabase
      .from('historique')
      .select('*')
      .eq('num', num)
      .single();

    if (error || !data) {
      return res.status(404).json({ error: 'Document non trouvé' });
    }

    const { type, client, adresse, prestations, total_ht } = data;
    const typeLabelUpper = type === 'devis' ? 'DEVIS' : 'FACTURE';
    const dateStr = new Date(data.date_envoi || data.created_at).toLocaleDateString('fr-FR');
    const dateValide = new Date(new Date(data.date_envoi || data.created_at).getTime() + 30*24*60*60*1000).toLocaleDateString('fr-FR');

    const detailsPath = path.join(__dirname, `_dl_details_${num}.json`);
    const pyPath = path.join(__dirname, `_dl_devis_${num}.py`);
    const pdfPath = path.join(__dirname, `_dl_${num}.pdf`);

    const detailsData = (prestations || []).map(p => ({
      designation: p.nom || p.designation,
      qte: p.quantite || p.qte || 1,
      prixUnit: p.prix || p.prixUnit || 0,
      total: (p.prix || p.prixUnit || 0) * (p.quantite || p.qte || 1),
      details: []
    }));

    fs.writeFileSync(detailsPath, JSON.stringify(detailsData));

    const clientEsc = String(client || '').replace(/'/g, ' ');
    // client contient déjà prénom+nom fusionnés par getClientComplet
    const clientNomComplet = clientEsc;
    const clientComplement = String(complement || '').replace(/'/g, ' ').trim();
    const clientTel = String(telephone || '').replace(/'/g, ' ').trim();
    const adresseEsc = String(adresse || '').replace(/'/g, ' ');
    const clientParts = (adresse || '').split(',');
    const clientRue = String(clientParts[0] || '').trim().replace(/'/g, ' ');
    const clientVille = clientParts.slice(1).join(',').trim().replace(/'/g, ' ');

    // Utiliser le même script Python que pour la génération
    const py = `# -*- coding: utf-8 -*-
import json, base64, io, sys
from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.units import cm
from reportlab.platypus import *
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_RIGHT
from reportlab.pdfgen import canvas as pdfcanvas
from reportlab.lib.utils import ImageReader
from reportlab.platypus.flowables import HRFlowable

W, H = A4
MARINE=colors.HexColor('#1B2A4A'); OR=colors.HexColor('#C9A84C')
OR_PALE=colors.HexColor('#FBF7EC'); OR_FONCE=colors.HexColor('#A07830')
BLANC=colors.white; CREME=colors.HexColor('#FDFCF9')
GRIS_TEXTE=colors.HexColor('#3A3A3A'); GRIS_SOFT=colors.HexColor('#777777')
GRIS_LIGNE=colors.HexColor('#E0DDD6'); GRIS_BG=colors.HexColor('#F5F4F0')

def p(txt,sz=9,font='Helvetica',color=GRIS_TEXTE,align=TA_LEFT,sb=0,sa=2,leading=None):
    if leading is None: leading=sz*1.35
    return Paragraph(str(txt),ParagraphStyle('s',fontName=font,fontSize=sz,
        textColor=color,alignment=align,spaceBefore=sb,spaceAfter=sa,leading=leading,wordWrap='CJK'))

data=json.loads(open(sys.argv[1],encoding='utf-8').read())
totalHT=sum(l['total'] for l in data)
logo_bytes=base64.b64decode(open('/app/logo_b64.txt').read().strip())

class SC(pdfcanvas.Canvas):
    def __init__(self,fn,**kw):
        pdfcanvas.Canvas.__init__(self,fn,**kw); self._pg=0
        self.saveState(); self._draw_page()
    def showPage(self):
        self._draw_footer(); pdfcanvas.Canvas.showPage(self)
        self._pg+=1; self.saveState(); self._draw_page()
    def save(self):
        self._draw_footer(); pdfcanvas.Canvas.save(self)
    def _draw_page(self):
        self.saveState()
        self.setFillColor(CREME); self.rect(0,0,W,H,fill=1,stroke=0)
        self.setFillColor(MARINE); self.rect(0,0,0.7*cm,H,fill=1,stroke=0)
        self.setFillColor(OR); self.rect(0.7*cm,0,0.08*cm,H,fill=1,stroke=0)
        if self._pg==0: self._draw_header()
        self.restoreState()
    def _draw_header(self):
        self.setFillColor(MARINE); self.rect(0.78*cm,H-5.2*cm,W-0.78*cm,5.2*cm,fill=1,stroke=0)
        self.setFillColor(OR); self.rect(0.78*cm,H-5.2*cm,W-0.78*cm,0.1*cm,fill=1,stroke=0)
        logo_img=io.BytesIO(logo_bytes)
        self.drawImage(ImageReader(logo_img),1.3*cm,H-4.6*cm,width=3.0*cm,height=3.0*cm,preserveAspectRatio=True,mask='auto')
        self.setFont('Helvetica',7.5); self.setFillColor(colors.HexColor('#BFC8D6'))
        self.drawString(1.3*cm,H-4.85*cm,'128 Rue La Boetie, 75008 Paris')
        self.drawString(1.3*cm,H-5.1*cm,'07 87 38 86 22  |  sinelec.paris@gmail.com  |  SIRET : 91015824500019')
        self.setFont('Helvetica-Bold',44); self.setFillColor(BLANC)
        self.drawRightString(W-1.2*cm,H-2.2*cm,'${typeLabelUpper}')
        self.setStrokeColor(OR); self.setLineWidth(1.5)
        self.line(10*cm,H-2.65*cm,W-1.2*cm,H-2.65*cm)
        self.setFillColor(OR); self.roundRect(W-6.5*cm,H-3.55*cm,5.3*cm,0.65*cm,0.15*cm,fill=1,stroke=0)
        self.setFont('Helvetica-Bold',9); self.setFillColor(MARINE)
        self.drawCentredString(W-3.85*cm,H-3.22*cm,'N ${num}')
        self.setFont('Helvetica',8); self.setFillColor(colors.HexColor('#BFC8D6'))
        self.drawRightString(W-1.2*cm,H-3.9*cm,'Date : ${dateStr}   |   Valable jusqu\u2019au : ${dateValide}')
    def _draw_footer(self):
        self.saveState()
        self.setFillColor(MARINE); self.rect(0,0,W,1.0*cm,fill=1,stroke=0)
        self.setFillColor(OR); self.rect(0,1.0*cm,W,0.08*cm,fill=1,stroke=0)
        self.setFont('Helvetica',6.5); self.setFillColor(colors.HexColor('#8899BB'))
        self.drawCentredString(W/2,0.5*cm,'SINELEC EI \u2022 128 Rue La Boetie, 75008 Paris \u2022 SIRET : 91015824500019 \u2022 TVA non applicable art. 293B CGI \u2022 Garantie decennale ORUS')
        self.setFont('Helvetica-Bold',7); self.setFillColor(OR)
        self.drawRightString(W-1.2*cm,0.28*cm,'${num}')
        self.restoreState()

doc=SimpleDocTemplate(sys.argv[2],pagesize=A4,leftMargin=1.2*cm,rightMargin=1.0*cm,topMargin=5.6*cm,bottomMargin=1.6*cm)
story=[]

client_b=Table([[p('CLIENT',7,'Helvetica-Bold',OR,sa=4)],[p('${clientEsc}',10,'Helvetica-Bold',MARINE)],[p('${clientRue}',8.5,color=GRIS_TEXTE)],[p('${clientVille}',8.5,color=GRIS_TEXTE)]],colWidths=[18.2*cm])
client_b.setStyle(TableStyle([('TOPPADDING',(0,0),(-1,-1),3),('BOTTOMPADDING',(0,0),(-1,-1),3),('LEFTPADDING',(0,0),(-1,-1),14),('RIGHTPADDING',(0,0),(-1,-1),14),('BACKGROUND',(0,0),(-1,-1),OR_PALE),('BOX',(0,0),(-1,-1),1,OR),('LINEBEFORE',(0,0),(0,-1),4,MARINE),('TOPPADDING',(0,0),(0,0),10),('BOTTOMPADDING',(0,-1),(-1,-1),10)]))
story.append(client_b); story.append(Spacer(1,0.5*cm))

cw=[0.7*cm,9.5*cm,1.5*cm,0.9*cm,2.4*cm,3.2*cm]
rows=[[p('#',7.5,'Helvetica-Bold',BLANC,TA_CENTER),p('DESIGNATION',7.5,'Helvetica-Bold',BLANC),p('QTE',7.5,'Helvetica-Bold',BLANC,TA_CENTER),p('U.',7.5,'Helvetica-Bold',BLANC,TA_CENTER),p('PRIX U. HT',7.5,'Helvetica-Bold',BLANC,TA_RIGHT),p('TOTAL HT',7.5,'Helvetica-Bold',BLANC,TA_RIGHT)]]
for i,l in enumerate(data):
    q=int(l['qte']) if l['qte']==int(l['qte']) else l['qte']
    rows.append([p(str(i+1),9,color=OR,align=TA_CENTER),p('<b>'+l['designation']+'</b>',9,color=MARINE),p(str(q),9,align=TA_CENTER),p('u.',9,align=TA_CENTER,color=GRIS_SOFT),p('%.2f \u20ac'%l['prixUnit'],9,align=TA_RIGHT),p('<b>%.2f \u20ac</b>'%l['total'],9,'Helvetica-Bold',MARINE,TA_RIGHT)])
t=Table(rows,colWidths=cw)
ts=[('BACKGROUND',(0,0),(-1,0),MARINE),('LINEBELOW',(0,0),(-1,0),2.5,OR),('VALIGN',(0,0),(-1,-1),'TOP'),('TOPPADDING',(0,0),(-1,-1),6),('BOTTOMPADDING',(0,0),(-1,-1),6),('LEFTPADDING',(0,0),(-1,-1),7),('RIGHTPADDING',(0,0),(-1,-1),7),('BOX',(0,0),(-1,-1),0.3,GRIS_LIGNE)]
for i in range(len(data)):
    bg=BLANC if i%2==0 else GRIS_BG
    ts.append(('BACKGROUND',(0,i+1),(-1,i+1),bg))
    ts.append(('LINEBELOW',(0,i+1),(-1,i+1),0.3,GRIS_LIGNE))
t.setStyle(TableStyle(ts)); story.append(t); story.append(Spacer(1,0.15*cm))

tt=Table([['',p('Total HT',9,color=GRIS_SOFT,align=TA_RIGHT),p('%.2f \u20ac'%totalHT,9,'Helvetica-Bold',GRIS_TEXTE,TA_RIGHT)],['',p('TVA',9,color=GRIS_SOFT,align=TA_RIGHT),p('Non applicable (art. 293B)',8,color=GRIS_SOFT,align=TA_RIGHT)]],colWidths=[9.0*cm,4.5*cm,4.7*cm])
tt.setStyle(TableStyle([('LINEABOVE',(1,0),(-1,0),0.5,GRIS_LIGNE),('TOPPADDING',(0,0),(-1,-1),5),('BOTTOMPADDING',(0,0),(-1,-1),5),('LEFTPADDING',(0,0),(-1,-1),6),('RIGHTPADDING',(0,0),(-1,-1),6)]))
story.append(tt); story.append(Spacer(1,0.12*cm))

net=Table([[p('NET A PAYER',12,'Helvetica-Bold',BLANC),p('%.2f \u20ac'%totalHT,16,'Helvetica-Bold',OR,TA_RIGHT)]],colWidths=[9.0*cm,9.2*cm])
net.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,-1),MARINE),('TOPPADDING',(0,0),(-1,-1),10),('BOTTOMPADDING',(0,0),(-1,-1),10),('LEFTPADDING',(0,0),(-1,-1),14),('RIGHTPADDING',(0,0),(-1,-1),14),('LINEBELOW',(0,0),(-1,-1),3,OR),('VALIGN',(0,0),(-1,-1),'MIDDLE')]))
story.append(net); story.append(Spacer(1,0.3*cm))

iban=Table([[p('IBAN',7,'Helvetica-Bold',GRIS_SOFT),p('FR76 1695 8000 0174 2540 5920 931',9,'Helvetica-Bold',MARINE),p('BIC',7,'Helvetica-Bold',GRIS_SOFT,TA_RIGHT),p('QNTOFRP1XXX',9,'Helvetica-Bold',MARINE,TA_RIGHT)]],colWidths=[1.5*cm,9.5*cm,1.8*cm,5.4*cm])
iban.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,-1),OR_PALE),('BOX',(0,0),(-1,-1),0.5,OR),('LINEBEFORE',(0,0),(0,-1),4,MARINE),('TOPPADDING',(0,0),(-1,-1),9),('BOTTOMPADDING',(0,0),(-1,-1),9),('LEFTPADDING',(0,0),(-1,-1),10),('RIGHTPADDING',(0,0),(-1,-1),10),('VALIGN',(0,0),(-1,-1),'MIDDLE')]))
story.append(iban)

doc.build(story,canvasmaker=lambda fn,**kw: SC(fn,**kw))
print('PDF_OK')
`;

    fs.writeFileSync(pyPath, py, 'utf8');

    try {
      execSync(`python3 ${pyPath} ${detailsPath} ${pdfPath}`, { cwd: __dirname, stdio: 'inherit' });
    } catch(pyErr) {
      throw new Error('PDF generation failed');
    }

    const pdfBuffer = fs.readFileSync(pdfPath);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${num}.pdf"`);
    res.send(pdfBuffer);

    try { fs.unlinkSync(pyPath); } catch(e) {}
    try { fs.unlinkSync(detailsPath); } catch(e) {}
    try { fs.unlinkSync(pdfPath); } catch(e) {}

  } catch (error) {
    console.error('Erreur PDF download:', error);
    res.status(500).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// CRON: VEILLE TARIFAIRE AUTOMATIQUE
// ═══════════════════════════════════════════════════════════════

async function veilTarifaire() {
  if (!CONFIG.features.veille_tarifaire || !CONFIG.veille.enabled) {
    console.log('⏭️ Veille tarifaire désactivée');
    return;
  }

  console.log('🔍 Démarrage veille tarifaire...');
  
  try {
    // Charger toutes les prestations
    const { data: prestations, error } = await supabase
      .from('grille_tarifaire')
      .select('*')
      .eq('actif', true)
      .eq('ajustement_auto', true);

    if (error) throw error;

    const ajustements = [];

    for (const prestation of prestations) {
      try {
        // Claude analyse le marché pour cette prestation
        const prompt = `Analyse le marché Île-de-France pour cette prestation électrique:

PRESTATION: ${prestation.nom}
PRIX ACTUEL SINELEC: ${prestation.prix_ht}€ HT

SOURCES À CONSULTER:
${CONFIG.veille.sources.join(', ')}

RÉPONDS EN JSON:
{
  "prix_min": 80,
  "prix_max": 120,
  "prix_moyen": 95,
  "recommandation": 90,
  "sources": ["source1.fr", "source2.fr"],
  "explication": "Le marché IDF se situe entre..."
}

Recommande un prix COMPÉTITIF (stratégie: ${CONFIG.veille.strategie}).`;

        const response = await anthropic.messages.create({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 500,
          messages: [{ role: 'user', content: prompt }],
          tools: [{ type: 'web_search_20250305', name: 'web_search' }]
        });

        const text = response.content.find(c => c.type === 'text')?.text || '';
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        
        if (!jsonMatch) continue;

        const analyse = JSON.parse(jsonMatch[0]);
        
        // Calculer ajustement
        const ecart_pct = ((analyse.recommandation - prestation.prix_ht) / prestation.prix_ht) * 100;
        
        // Appliquer seuil validation
        const auto_apply = Math.abs(ecart_pct) < CONFIG.veille.seuil_validation;

        if (auto_apply && CONFIG.veille.ajustement_auto) {
          // Mettre à jour automatiquement
          await supabase.from('grille_tarifaire')
            .update({
              prix_ht: analyse.recommandation,
              marche_min: analyse.prix_min,
              marche_max: analyse.prix_max,
              marche_moyen: analyse.prix_moyen,
              derniere_analyse: new Date().toISOString(),
              sources_analyse: analyse.sources
            })
            .eq('code', prestation.code);

          // Historique
          await supabase.from('historique_prix').insert({
            prestation_code: prestation.code,
            prix_ht: analyse.recommandation,
            marche_min: analyse.prix_min,
            marche_max: analyse.prix_max,
            raison_changement: 'Analyse marché automatique',
            changed_by: 'system'
          });

          ajustements.push({
            prestation: prestation.nom,
            ancien: prestation.prix_ht,
            nouveau: analyse.recommandation,
            ecart_pct: ecart_pct.toFixed(1),
            auto: true
          });
        } else {
          ajustements.push({
            prestation: prestation.nom,
            ancien: prestation.prix_ht,
            recommandation: analyse.recommandation,
            ecart_pct: ecart_pct.toFixed(1),
            auto: false,
            raison: 'Nécessite validation (écart > ' + CONFIG.veille.seuil_validation + '%)'
          });
        }

        // Rate limiting
        await new Promise(resolve => setTimeout(resolve, 2000));

      } catch (err) {
        console.error(`Erreur analyse ${prestation.nom}:`, err);
      }
    }

    // Email rapport si activé
    if (CONFIG.veille.email_rapport && ajustements.length > 0) {
      const html = `
        <h2>📊 Rapport Veille Tarifaire</h2>
        <p>Date: ${new Date().toLocaleDateString('fr-FR')}</p>
        <h3>Ajustements effectués automatiquement:</h3>
        <ul>
          ${ajustements.filter(a => a.auto).map(a => 
            `<li><strong>${a.prestation}</strong>: ${a.ancien}€ → ${a.nouveau}€ (${a.ecart_pct > 0 ? '+' : ''}${a.ecart_pct}%)</li>`
          ).join('')}
        </ul>
        <h3>Ajustements nécessitant validation:</h3>
        <ul>
          ${ajustements.filter(a => !a.auto).map(a => 
            `<li><strong>${a.prestation}</strong>: ${a.ancien}€ → ${a.recommandation}€ (${a.ecart_pct > 0 ? '+' : ''}${a.ecart_pct}%) - ${a.raison}</li>`
          ).join('')}
        </ul>
      `;

      await envoyerEmail(
        CONFIG.veille.destinataire,
        '📊 Rapport Veille Tarifaire SINELEC',
        html
      );
    }

    await logSystem('veille', 'Veille tarifaire terminée', { nb_ajustements: ajustements.length }, true);
    console.log('✅ Veille tarifaire terminée:', ajustements.length, 'ajustements');

  } catch (error) {
    console.error('❌ Erreur veille tarifaire:', error);
    await logSystem('veille', 'Erreur veille', { error: error.message }, false, error);
  }
}

// Cron veille tarifaire (selon config)
if (CONFIG.veille.enabled) {
  const cronExpression = CONFIG.veille.frequence === 'quotidien'
    ? `0 ${CONFIG.veille.heure.split(':')[0]} * * *`
    : `0 ${CONFIG.veille.heure.split(':')[0]} * * ${CONFIG.veille.jour_semaine}`;

  cron.schedule(cronExpression, veilTarifaire);
  console.log(`📅 Veille tarifaire programmée: ${CONFIG.veille.frequence} à ${CONFIG.veille.heure}`);
}

// ═══════════════════════════════════════════════════════════════
// CRON: RELANCES AUTOMATIQUES
// ═══════════════════════════════════════════════════════════════

async function relancesAuto() {
  if (!CONFIG.features.relances_auto || !CONFIG.relances.enabled) {
    console.log('⏭️ Relances auto désactivées');
    return;
  }

  console.log('📧 Démarrage relances automatiques...');

  try {
    // Chercher devis non signés
    const { data: devis, error } = await supabase
      .from('historique')
      .select('*')
      .eq('type', 'devis')
      .eq('statut', 'envoyé')
      .lt('nb_relances', CONFIG.relances.nb_relances_max);

    if (error) throw error;

    const maintenant = new Date();
    let nb_relances = 0;

    for (const d of devis) {
      const date_envoi = new Date(d.date_envoi);
      const date_derniere_relance = d.date_derniere_relance ? new Date(d.date_derniere_relance) : null;
      
      const heures_depuis_envoi = (maintenant - date_envoi) / (1000 * 60 * 60);
      const heures_depuis_relance = date_derniere_relance 
        ? (maintenant - date_derniere_relance) / (1000 * 60 * 60)
        : Infinity;

      let doit_relancer = false;

      if (d.nb_relances === 0 && heures_depuis_envoi >= CONFIG.relances.delai_premiere_relance) {
        doit_relancer = true;
      } else if (d.nb_relances === 1 && heures_depuis_relance >= CONFIG.relances.delai_deuxieme_relance) {
        doit_relancer = true;
      }

      if (doit_relancer && d.email) {
        const template = d.nb_relances === 0 ? CONFIG.relances.template_1 : CONFIG.relances.template_2;
        const message = template.replace('{num}', d.num);

        await envoyerEmail(
          d.email,
          `Relance - Devis SINELEC ${d.num}`,
          `<p>${message}</p>`
        );

        await supabase.from('historique')
          .update({
            nb_relances: d.nb_relances + 1,
            date_derniere_relance: maintenant.toISOString(),
            statut: 'relancé'
          })
          .eq('num', d.num);

        nb_relances++;
      }
    }

    await logSystem('relances', 'Relances terminées', { nb_relances }, true);
    console.log(`✅ ${nb_relances} relance(s) envoyée(s)`);

  } catch (error) {
    console.error('❌ Erreur relances:', error);
    await logSystem('relances', 'Erreur relances', { error: error.message }, false, error);
  }
}

// Cron relances (quotidien)
if (CONFIG.relances.enabled) {
  cron.schedule('0 10 * * *', relancesAuto); // Tous les jours à 10h
  console.log('📅 Relances auto programmées: quotidien à 10h');
}

// ═══════════════════════════════════════════════════════════════
// ENDPOINT MANUEL: LANCER VEILLE MAINTENANT
// ═══════════════════════════════════════════════════════════════

app.post('/api/veille/lancer', async (req, res) => {
  if (!CONFIG.features.veille_tarifaire) {
    return res.status(403).json({ error: 'Feature désactivée' });
  }

  try {
    await veilTarifaire();
    res.json({ success: true, message: 'Veille tarifaire lancée' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// ENDPOINT MANUEL: LANCER RELANCES MAINTENANT
// ═══════════════════════════════════════════════════════════════

app.post('/api/relances/lancer', async (req, res) => {
  if (!CONFIG.features.relances_auto) {
    return res.status(403).json({ error: 'Feature désactivée' });
  }

  try {
    await relancesAuto();
    res.json({ success: true, message: 'Relances lancées' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// DÉMARRAGE SERVEUR
// ═══════════════════════════════════════════════════════════════

app.listen(PORT, () => {
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  ⚡ SINELEC OS v' + CONFIG.meta.version + ' - Serveur démarré !');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  📍 URL: http://localhost:' + PORT);
  console.log('  🔧 Mode: ' + (CONFIG.dev.debug_mode ? 'DEBUG' : 'PRODUCTION'));
  console.log('');
  console.log('  ✅ Features actives:');
  Object.entries(CONFIG.features)
    .filter(([k, v]) => v === true)
    .forEach(([k]) => console.log('     • ' + k));
  console.log('');
  console.log('  🤖 Crons programmés:');
  if (CONFIG.veille.enabled) {
    console.log('     • Veille tarifaire: ' + CONFIG.veille.frequence + ' à ' + CONFIG.veille.heure);
  }
  if (CONFIG.relances.enabled) {
    console.log('     • Relances auto: quotidien à 10h');
  }
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');
});
