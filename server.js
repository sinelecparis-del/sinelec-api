// ═══════════════════════════════════════════════════════════════
// SINELEC OS v2.0 - BACKEND COMPLET - VERSION PROPRE
// ═══════════════════════════════════════════════════════════════

const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const { createClient } = require('@supabase/supabase-js');
const Anthropic = require('@anthropic-ai/sdk');
const crypto = require('crypto');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const CONFIG = require('./config-v2.js');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(__dirname));

// ═══════════════════════════════════════════════════
// AUTH
// ═══════════════════════════════════════════════════

const APP_PASSWORD = process.env.APP_PASSWORD || 'sinelec2026';
const JWT_SECRET   = process.env.JWT_SECRET   || crypto.randomBytes(32).toString('hex');
const TOKEN_EXPIRY = 7 * 24 * 60 * 60 * 1000;

function genererToken() {
  const payload = JSON.stringify({ ts: Date.now(), exp: Date.now() + TOKEN_EXPIRY });
  const b64 = Buffer.from(payload).toString('base64');
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(b64).digest('hex');
  return `${b64}.${sig}`;
}

function verifierToken(token) {
  if (!token) return false;
  try {
    const [b64, sig] = token.split('.');
    const expectedSig = crypto.createHmac('sha256', JWT_SECRET).update(b64).digest('hex');
    if (sig !== expectedSig) return false;
    const { exp } = JSON.parse(Buffer.from(b64, 'base64').toString());
    return Date.now() < exp;
  } catch(e) { return false; }
}

function authMiddleware(req, res, next) {
  const publicRoutes = ['/', '/health', '/api/login', '/signer/', '/paiement-confirme/', '/api/signature', '/api/auth/check'];
  if (publicRoutes.some(r => req.path.startsWith(r))) return next();
  const token = req.headers['authorization']?.replace('Bearer ', '') || req.query.token;
  if (!verifierToken(token)) return res.status(401).json({ error: 'Non autorisé', code: 'UNAUTHORIZED' });
  next();
}

app.use(authMiddleware);

app.post('/api/login', (req, res) => {
  const inputPwd = String(req.body.password || '').trim();
  const validPwd = String(APP_PASSWORD).trim();
  if (inputPwd !== validPwd) return res.status(401).json({ error: 'Mot de passe incorrect' });
  res.json({ success: true, token: genererToken(), expiresIn: TOKEN_EXPIRY });
});

app.get('/api/auth/check', (req, res) => {
  const token = req.headers['authorization']?.replace('Bearer ', '');
  res.json({ valid: verifierToken(token) });
});

// ═══════════════════════════════════════════════════
// CLIENTS
// ═══════════════════════════════════════════════════

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const anthropic = new Anthropic({ apiKey: (process.env.ANTHROPIC_API_KEY || '').trim() });
const BREVO_API_KEY = process.env.BREVO_API_KEY;
const SUMUP_API_KEY = process.env.SUMUP_API_KEY;

// ═══════════════════════════════════════════════════
// HEALTHCHECK
// ═══════════════════════════════════════════════════

app.get('/', (req, res) => res.send('OK SINELEC OS v2.0'));
app.get('/health', (req, res) => res.json({ status: 'ok', service: 'SINELEC OS v2.0' }));

// ═══════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════

async function logSystem(type, message, data = null, success = true, error = null) {
  try {
    await supabase.from('logs_system').insert({ type, message, data, success, error_details: error ? String(error) : null });
  } catch(e) {}
}

async function envoyerEmail(to, subject, htmlContent, attachment = null) {
  if (CONFIG.dev.skip_email) { console.log('Email skippé:', to); return { skipped: true }; }
  const payload = {
    sender: { name: CONFIG.email.sender_name, email: CONFIG.email.sender_email },
    to: [{ email: to }], subject, htmlContent, trackOpens: 0, trackClicks: 0,
  };
  if (attachment) payload.attachment = [{ content: attachment.content, name: attachment.name }];
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'accept': 'application/json', 'api-key': BREVO_API_KEY, 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) { const err = await res.text(); throw new Error('Brevo: ' + err); }
  return await res.json();
}

async function envoyerSMS(to, message) {
  if (!to || String(to).length < 8) return;
  let num = String(to).replace(/[\s\-\.]/g, '');
  if (num.startsWith('0')) num = '+33' + num.substring(1);
  if (!num.startsWith('+')) num = '+33' + num;
  try {
    const res = await fetch('https://api.brevo.com/v3/transactionalSMS/sms', {
      method: 'POST',
      headers: { 'accept': 'application/json', 'api-key': BREVO_API_KEY, 'content-type': 'application/json' },
      body: JSON.stringify({ sender: 'SINELEC', recipient: num, content: message, type: 'transactional' }),
    });
    if (!res.ok) console.error('SMS error:', await res.text());
    else console.log('SMS envoyé à', num);
  } catch(e) { console.error('SMS error:', e.message); }
}

async function incrementerCompteur(type) {
  const { data, error } = await supabase.from('compteurs').select('valeur').eq('type', type).single();
  if (error || !data) { await supabase.from('compteurs').insert({ type, valeur: 1 }); return 1; }
  const val = data.valeur + 1;
  await supabase.from('compteurs').update({ valeur: val }).eq('type', type);
  return val;
}

async function chargerGrilleTarifaire() {
  const { data, error } = await supabase.from('grille_tarifaire').select('*').eq('actif', true).order('categorie, nom');
  if (error) return null;
  const grille = {};
  data.forEach(item => {
    if (!grille[item.categorie]) grille[item.categorie] = [];
    grille[item.categorie].push({ code: item.code, nom: item.nom, prix: item.prix_ht });
  });
  return grille;
}

// ═══════════════════════════════════════════════════
// API: GÉNÉRATION DEVIS/FACTURE
// ═══════════════════════════════════════════════════

app.post('/api/generer', async (req, res) => {
  if (!CONFIG.features.devis_factures) return res.status(403).json({ error: 'Feature désactivée' });
  try {
    const { type, client, email, telephone, adresse, complement, codePostal, ville, prenom, description, prestations, partenaire, part_diahe, part_partenaire, nom_partenaire } = req.body;
    const compteur = await incrementerCompteur(type);
    const annee = new Date().getFullYear();
    const mois = String(new Date().getMonth() + 1).padStart(2, '0');
    const num = type === 'devis' ? `OS-${annee}${mois}-${String(compteur).padStart(3, '0')}` : `${annee}${mois}-${String(compteur).padStart(3, '0')}`;
    const total_ht = prestations.reduce((sum, p) => sum + (p.prix * p.quantite), 0);

    // Calcul parts partenaire
    const isPartenaire = !!partenaire;
    const pdiahe = isPartenaire ? (part_diahe || 60) : 100;
    const ppartenaire = isPartenaire ? (part_partenaire || 40) : 0;

    await supabase.from('historique').insert({
      num, type, client, email, telephone, adresse, prestations, total_ht,
      statut: 'envoye', date_envoi: new Date().toISOString(), source: 'app',
      partenaire: isPartenaire,
      part_diahe: pdiahe,
      part_partenaire: ppartenaire,
      nom_partenaire: isPartenaire ? (nom_partenaire || 'Alopronto') : null
    });

    if (CONFIG.features.email_auto && email) {
      const typeLabelUpper = type === 'devis' ? 'DEVIS' : 'FACTURE';
      const dateStr = new Date().toLocaleDateString('fr-FR');
      const dateValide = new Date(Date.now() + 30*24*60*60*1000).toLocaleDateString('fr-FR');
      const detailsPath = path.join(__dirname, `_details_${num}.json`);
      const pyPath = path.join(__dirname, `_devis_${num}.py`);
      const pdfPath = path.join(__dirname, `${num}.pdf`);

      const detailsData = prestations.map(p => ({ designation: p.nom, qte: p.quantite, prixUnit: p.prix, total: p.prix * p.quantite, details: p.desc ? [p.desc] : [] }));
      fs.writeFileSync(detailsPath, JSON.stringify(detailsData));

      const clientEsc = String(client || '').replace(/'/g, ' ');
      const clientComplement = String(complement || '').replace(/'/g, ' ').trim();
      const clientTel = String(telephone || '').trim();
      const adresseRaw = String(adresse || '').replace(/'/g, ' ').trim();
      const adresseParts = adresseRaw.split(',').map(s => s.trim()).filter(Boolean);
      const clientRue = adresseParts.length >= 2 && adresseParts[0].match(/^\d+$/) ? adresseParts[0] + ' ' + adresseParts[1] : adresseParts[0] || '';
      const cpMatch = adresseRaw.match(/\b(\d{5})\b/);
      const clientCP = String(codePostal || '').trim() || (cpMatch ? cpMatch[1] : '');
      const villeManuelle = String(ville || '').trim();
      const villeGPS = adresseParts.find(p => p.length > 2 && p.length < 30 && !p.match(/^\d{5}/) && !p.toLowerCase().includes('france')) || '';
      const clientCPVille = [clientCP, villeManuelle || villeGPS].filter(Boolean).join(' ');
      const descObjet = String(description || 'Travaux d electricite generale').trim().replace(/'/g, ' ');

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
W,H=A4
MARINE=colors.HexColor('#1B2A4A'); OR=colors.HexColor('#C9A84C')
OR_PALE=colors.HexColor('#FBF7EC'); OR_FONCE=colors.HexColor('#A07830')
BLANC=colors.white; CREME=colors.HexColor('#FDFCF9')
GRIS_TEXTE=colors.HexColor('#3A3A3A'); GRIS_SOFT=colors.HexColor('#777777')
GRIS_LIGNE=colors.HexColor('#E0DDD6'); GRIS_BG=colors.HexColor('#F5F4F0')
def p(txt,sz=9,font='Helvetica',color=GRIS_TEXTE,align=TA_LEFT,sb=0,sa=2,leading=None):
    if leading is None: leading=sz*1.35
    return Paragraph(str(txt),ParagraphStyle('s',fontName=font,fontSize=sz,textColor=color,alignment=align,spaceBefore=sb,spaceAfter=sa,leading=leading,wordWrap='CJK'))
data=json.loads(open(sys.argv[1],encoding='utf-8').read())
totalHT=sum(l['total'] for l in data)
logo_bytes=base64.b64decode(open('/app/logo_b64.txt').read().strip())
class SC(pdfcanvas.Canvas):
    def __init__(self,fn,**kw):
        pdfcanvas.Canvas.__init__(self,fn,**kw); self._pg=0; self.saveState(); self._draw_page()
    def showPage(self):
        self._draw_footer(); pdfcanvas.Canvas.showPage(self); self._pg+=1
    def save(self):
        pdfcanvas.Canvas.save(self)
    def _draw_page(self):
        self.saveState()
        self.setFillColor(CREME); self.rect(0,0,W,H,fill=1,stroke=0)
        self.setFillColor(MARINE); self.rect(0,0,0.7*cm,H,fill=1,stroke=0)
        self.setFillColor(OR); self.rect(0.7*cm,0,0.08*cm,H,fill=1,stroke=0)
        if self._pg==0: self._draw_header()
        else: self._draw_header_small()
        self.restoreState()
    def _draw_header(self):
        self.setFillColor(MARINE); self.rect(0.78*cm,H-5.4*cm,W-0.78*cm,5.4*cm,fill=1,stroke=0)
        self.setFillColor(OR); self.rect(0.78*cm,H-5.4*cm,W-0.78*cm,0.12*cm,fill=1,stroke=0)
        self.drawImage(ImageReader(io.BytesIO(logo_bytes)),0.9*cm,H-5.05*cm,width=4.2*cm,height=4.2*cm,preserveAspectRatio=True,mask='auto')
        self.setFont('Helvetica-Bold',15); self.setFillColor(colors.white); self.drawString(5.9*cm,H-1.7*cm,'SINELEC PARIS')
        self.setFont('Helvetica-Bold',9); self.setFillColor(colors.white); self.drawString(5.9*cm,H-2.5*cm,'128 Rue La Boetie, 75008 Paris')
        self.setFont('Helvetica',8.5); self.setFillColor(colors.HexColor('#BFC8D6'))
        self.drawString(5.9*cm,H-3.0*cm,'Tel : 07 87 38 86 22'); self.drawString(5.9*cm,H-3.4*cm,'sinelec.paris@gmail.com')
        self.setFillColor(colors.HexColor('#243660')); self.roundRect(5.9*cm,H-4.15*cm,5.5*cm,0.55*cm,0.1*cm,fill=1,stroke=0)
        self.setFont('Helvetica-Bold',8); self.setFillColor(OR); self.drawString(6.1*cm,H-3.88*cm,'SIRET : 91015824500019')
        self.setFont('Helvetica-Bold',40); self.setFillColor(BLANC); self.drawRightString(W-1.2*cm,H-2.2*cm,'${typeLabelUpper}')
        self.setStrokeColor(OR); self.setLineWidth(1.5); self.line(13*cm,H-2.65*cm,W-1.2*cm,H-2.65*cm)
        self.setFillColor(OR); self.roundRect(W-6.5*cm,H-3.55*cm,5.3*cm,0.65*cm,0.15*cm,fill=1,stroke=0)
        self.setFont('Helvetica-Bold',9); self.setFillColor(MARINE); self.drawCentredString(W-3.85*cm,H-3.22*cm,'N\\u00b0 ${num}')
        self.setFont('Helvetica',8); self.setFillColor(colors.HexColor('#BFC8D6')); self.drawRightString(W-1.2*cm,H-3.9*cm,'Date : ${dateStr}   |   Valable : ${dateValide}')
    def _draw_header_small(self):
        self.setFillColor(MARINE); self.rect(0.78*cm,H-1.5*cm,W-0.78*cm,1.5*cm,fill=1,stroke=0)
        self.setFillColor(OR); self.rect(0.78*cm,H-1.5*cm,W-0.78*cm,0.08*cm,fill=1,stroke=0)
        self.setFont('Helvetica-Bold',10); self.setFillColor(BLANC); self.drawString(1.4*cm,H-1.0*cm,'SINELEC')
        self.setFont('Helvetica',8); self.setFillColor(OR); self.drawRightString(W-1.2*cm,H-1.0*cm,'${typeLabelUpper} N\\u00b0 ${num}')
    def _draw_footer(self):
        self.saveState()
        self.setFillColor(MARINE); self.rect(0,0,W,1.0*cm,fill=1,stroke=0)
        self.setFillColor(OR); self.rect(0,1.0*cm,W,0.08*cm,fill=1,stroke=0)
        self.setFont('Helvetica',6.5); self.setFillColor(colors.HexColor('#8899BB'))
        self.drawCentredString(W/2,0.5*cm,'SINELEC EI  \\u2022  128 Rue La Boetie, 75008 Paris  \\u2022  SIRET : 91015824500019  \\u2022  TVA non applicable art. 293B CGI')
        self.setFont('Helvetica-Bold',7); self.setFillColor(OR); self.drawRightString(W-1.2*cm,0.28*cm,'${num}')
        self.restoreState()
doc=SimpleDocTemplate(sys.argv[2],pagesize=A4,leftMargin=1.2*cm,rightMargin=1.0*cm,topMargin=5.6*cm,bottomMargin=1.6*cm)
story=[]
objet_b=Table([[p('OBJET DES TRAVAUX',7.5,'Helvetica-Bold',OR,sa=4)],[p('${descObjet}',10,'Helvetica-Bold',MARINE)],[p('Conformes NF C 15-100  \\u2022  Garantie decennale ORUS',7.5,color=GRIS_SOFT)]],colWidths=[8.2*cm])
objet_b.setStyle(TableStyle([('TOPPADDING',(0,0),(-1,-1),3),('BOTTOMPADDING',(0,0),(-1,-1),3),('LEFTPADDING',(0,0),(-1,-1),0),('LINEABOVE',(0,0),(0,0),2.5,MARINE),('TOPPADDING',(0,0),(0,0),10)]))
client_rows=[[p('CLIENT',7,'Helvetica-Bold',OR,sa=4)],[p('${clientEsc}',10,'Helvetica-Bold',MARINE)]]
if '${clientRue}': client_rows.append([p('${clientRue}',8.5,color=GRIS_TEXTE)])
if '${clientComplement}': client_rows.append([p('${clientComplement}',8.5,color=GRIS_TEXTE)])
if '${clientCPVille}': client_rows.append([p('${clientCPVille}',8.5,color=GRIS_TEXTE)])
if '${clientTel}': client_rows.append([p('Tel : ${clientTel}',8.5,color=GRIS_SOFT)])
client_b=Table(client_rows,colWidths=[9.0*cm])
client_b.setStyle(TableStyle([('TOPPADDING',(0,0),(-1,-1),3),('BOTTOMPADDING',(0,0),(-1,-1),3),('LEFTPADDING',(0,0),(-1,-1),14),('RIGHTPADDING',(0,0),(-1,-1),14),('BACKGROUND',(0,0),(-1,-1),OR_PALE),('BOX',(0,0),(-1,-1),1,OR),('LINEBEFORE',(0,0),(0,-1),4,MARINE),('TOPPADDING',(0,0),(0,0),10),('BOTTOMPADDING',(0,-1),(-1,-1),10)]))
story.append(Table([[objet_b,client_b]],colWidths=[8.7*cm,9.5*cm],style=TableStyle([('VALIGN',(0,0),(-1,-1),'TOP'),('TOPPADDING',(0,0),(-1,-1),0),('BOTTOMPADDING',(0,0),(-1,-1),0),('LEFTPADDING',(0,0),(-1,-1),0),('RIGHTPADDING',(0,0),(-1,-1),0)])))
story.append(Spacer(1,0.6*cm))
cw=[0.7*cm,9.5*cm,1.5*cm,0.9*cm,2.4*cm,3.2*cm]
rows=[[p('#',7.5,'Helvetica-Bold',BLANC,TA_CENTER),p('DESIGNATION',7.5,'Helvetica-Bold',BLANC),p('QTE',7.5,'Helvetica-Bold',BLANC,TA_CENTER),p('U.',7.5,'Helvetica-Bold',BLANC,TA_CENTER),p('PRIX U. HT',7.5,'Helvetica-Bold',BLANC,TA_RIGHT),p('TOTAL HT',7.5,'Helvetica-Bold',BLANC,TA_RIGHT)]]
for i,l in enumerate(data):
    q=int(l['qte']) if l['qte']==int(l['qte']) else l['qte']
    rows.append([p(str(i+1),9,color=OR,align=TA_CENTER),p('<b>'+l['designation']+'</b>',9,color=MARINE),p(str(q),9,align=TA_CENTER),p('u.',9,align=TA_CENTER,color=GRIS_SOFT),p('%.2f \\u20ac'%l['prixUnit'],9,align=TA_RIGHT),p('<b>%.2f \\u20ac</b>'%l['total'],9,'Helvetica-Bold',MARINE,TA_RIGHT)])
    for det in l.get('details',[]):
        rows.append(['',p('   - '+det,7.5,'Helvetica-Oblique',color=GRIS_SOFT),'','','',''])
t=Table(rows,colWidths=cw)
ts=[('BACKGROUND',(0,0),(-1,0),MARINE),('LINEBELOW',(0,0),(-1,0),2.5,OR),('VALIGN',(0,0),(-1,-1),'TOP'),('TOPPADDING',(0,0),(-1,-1),6),('BOTTOMPADDING',(0,0),(-1,-1),6),('LEFTPADDING',(0,0),(-1,-1),7),('RIGHTPADDING',(0,0),(-1,-1),7),('BOX',(0,0),(-1,-1),0.3,GRIS_LIGNE)]
row_idx=1; bg=True
for l in data:
    nb=1+len(l.get('details',[])); c=BLANC if bg else GRIS_BG
    ts.append(('BACKGROUND',(0,row_idx),(-1,row_idx+nb-1),c)); ts.append(('LINEBELOW',(0,row_idx+nb-1),(-1,row_idx+nb-1),0.3,GRIS_LIGNE))
    row_idx+=nb; bg=not bg
t.setStyle(TableStyle(ts)); story.append(t); story.append(Spacer(1,0.15*cm))
tt=Table([['',p('Total HT',9,color=GRIS_SOFT,align=TA_RIGHT),p('%.2f \\u20ac'%totalHT,9,'Helvetica-Bold',GRIS_TEXTE,TA_RIGHT)],['',p('TVA',9,color=GRIS_SOFT,align=TA_RIGHT),p('Non applicable (art. 293B)',8,color=GRIS_SOFT,align=TA_RIGHT)]],colWidths=[9.0*cm,4.5*cm,4.7*cm])
tt.setStyle(TableStyle([('LINEABOVE',(1,0),(-1,0),0.5,GRIS_LIGNE),('TOPPADDING',(0,0),(-1,-1),5),('BOTTOMPADDING',(0,0),(-1,-1),5),('LEFTPADDING',(0,0),(-1,-1),6),('RIGHTPADDING',(0,0),(-1,-1),6)]))
story.append(tt); story.append(Spacer(1,0.12*cm))
net=Table([[p('NET \\u00c0 PAYER',13,'Helvetica-Bold',BLANC),p('%.2f \\u20ac'%totalHT,16,'Helvetica-Bold',OR,TA_RIGHT)]],colWidths=[9.0*cm,9.2*cm])
net.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,-1),MARINE),('TOPPADDING',(0,0),(-1,-1),10),('BOTTOMPADDING',(0,0),(-1,-1),10),('LEFTPADDING',(0,0),(-1,-1),14),('RIGHTPADDING',(0,0),(-1,-1),14),('LINEBELOW',(0,0),(-1,-1),3,OR),('VALIGN',(0,0),(-1,-1),'MIDDLE')]))
story.append(net); story.append(Spacer(1,0.35*cm))
story.append(HRFlowable(width='100%',thickness=0.3,color=GRIS_LIGNE,spaceAfter=8))
story.append(p('CONDITIONS',8,'Helvetica-Bold',MARINE,sa=6))
cond=Table([[p('Acompte 40% a la signature',9,color=GRIS_TEXTE),p('%.2f \\u20ac'%(totalHT*0.4),9,'Helvetica-Bold',OR_FONCE,TA_RIGHT)],[p('Solde a la fin des travaux',9,color=GRIS_TEXTE),p('%.2f \\u20ac'%(totalHT*0.6),9,align=TA_RIGHT)],[p('Validite 30 jours  \\u2022  Virement, especes, CB',8,color=GRIS_SOFT),'']],colWidths=[14.2*cm,4.0*cm])
cond.setStyle(TableStyle([('LINEBELOW',(0,0),(-1,1),0.3,GRIS_LIGNE),('TOPPADDING',(0,0),(-1,-1),5),('BOTTOMPADDING',(0,0),(-1,-1),5),('LEFTPADDING',(0,0),(-1,-1),0),('RIGHTPADDING',(0,0),(-1,-1),0),('SPAN',(0,2),(1,2))]))
story.append(cond); story.append(Spacer(1,0.15*cm))
iban=Table([[p('IBAN',7,'Helvetica-Bold',GRIS_SOFT),p('FR76 1695 8000 0174 2540 5920 931',9,'Helvetica-Bold',MARINE),p('BIC',7,'Helvetica-Bold',GRIS_SOFT,TA_RIGHT),p('QNTOFRP1XXX',9,'Helvetica-Bold',MARINE,TA_RIGHT)]],colWidths=[1.5*cm,9.5*cm,1.8*cm,5.4*cm])
iban.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,-1),OR_PALE),('BOX',(0,0),(-1,-1),0.5,OR),('LINEBEFORE',(0,0),(0,-1),4,MARINE),('TOPPADDING',(0,0),(-1,-1),9),('BOTTOMPADDING',(0,0),(-1,-1),9),('LEFTPADDING',(0,0),(-1,-1),10),('RIGHTPADDING',(0,0),(-1,-1),10),('VALIGN',(0,0),(-1,-1),'MIDDLE')]))
story.append(iban)
doc.build(story,canvasmaker=lambda fn,**kw: SC(fn,**kw))
print('PDF_OK')
`;
      fs.writeFileSync(pyPath, py, 'utf8');
      try {
        execSync(`python3 ${pyPath} ${detailsPath} ${pdfPath}`, { cwd: __dirname, stdio: 'inherit' });
      } catch(pyErr) { throw new Error('PDF generation failed: ' + pyErr.message); }

      const pdfB64 = fs.readFileSync(pdfPath).toString('base64');
      const appUrl = process.env.APP_URL || 'https://sinelec-api-production.up.railway.app';
      const lienSig = `${appUrl}/signer/${num}`;
      const htmlFinal = (type === 'devis' ? CONFIG.email.template_devis : CONFIG.email.template_facture).replace(/\{num\}/g, num).replace(/\{lien_signature\}/g, lienSig);
      await envoyerEmail(email, `${type === 'devis' ? 'Devis' : 'Facture'} SINELEC ${num}`, htmlFinal, { content: pdfB64, name: `${num}.pdf` });
      try { await envoyerEmail('sinelec.paris@gmail.com', `${type === 'devis' ? '📋 DEVIS' : '💶 FACTURE'} ${num} — ${client} — ${parseFloat(total_ht).toFixed(0)}€`, `<p>Client: ${client} | Montant: ${parseFloat(total_ht).toFixed(2)}€</p>`, { content: pdfB64, name: `${num}.pdf` }); } catch(e) {}
      try { fs.unlinkSync(pyPath); } catch(e) {}
      try { fs.unlinkSync(detailsPath); } catch(e) {}
      try { fs.unlinkSync(pdfPath); } catch(e) {}
    }

    // ⚠️ Pas de SMS avis Google ici — envoyé uniquement au moment du paiement

    res.json({ success: true, num, total_ht });
  } catch(error) {
    console.error('Erreur génération:', error);
    res.status(500).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════════════
// API: CHATBOT
// ═══════════════════════════════════════════════════

app.post('/api/chat', async (req, res) => {
  if (!CONFIG.features.chatbot_claude) return res.status(403).json({ error: 'Feature désactivée' });
  try {
    const { message } = req.body;
    const grille = await chargerGrilleTarifaire();
    const grilleResume = Object.entries(grille || {}).map(([cat, items]) => `${cat}: ${items.map(i => `${i.nom} (${i.prix}€)`).join(', ')}`).join('\n');
    const prompt = `Tu es l'assistant SINELEC Paris. Chantier: "${message}"\nGRILLE:\n${grilleResume}\nRéponds UNIQUEMENT en JSON: {"prestations":[{"nom":"...","quantite":1,"prix":90,"desc":"..."}],"total":0,"explication":"...","hors_grille":[]}`;
    const response = await anthropic.messages.create({ model: 'claude-sonnet-4-20250514', max_tokens: 2000, tools: [{ type: 'web_search_20250305', name: 'web_search' }], messages: [{ role: 'user', content: prompt }] });
    let text = '';
    for (const block of response.content) { if (block.type === 'text') text += block.text; }
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    let result = jsonMatch ? JSON.parse(jsonMatch[0]) : { prestations: [], explication: text, total: 0 };
    if (!result.total && result.prestations) result.total = result.prestations.reduce((s, p) => s + (p.prix * p.quantite), 0);
    res.json(result);
  } catch(error) {
    res.status(500).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════════════
// API: SIGNATURE
// ═══════════════════════════════════════════════════

app.get('/signer/:num', async (req, res) => {
  const { num } = req.params;
  const { data: devis, error } = await supabase.from('historique').select('*').eq('num', num).single();
  if (error || !devis) return res.status(404).send('<html><body><h2>Document introuvable</h2></body></html>');
  if (devis.statut === 'signe' || devis.statut === 'signé') return res.send('<html><body style="text-align:center;padding:40px;"><h2>Devis déjà signé ✅</h2><p>SINELEC Paris</p></body></html>');

  const montant = parseFloat(devis.total_ht || 0).toFixed(2);
  const prestationsHtml = (devis.prestations || []).map(p => `<tr><td style="padding:10px;">${p.nom||''}</td><td style="text-align:center;">${p.quantite||1}</td><td style="text-align:right;color:#C9A84C;">${parseFloat(p.prix||0).toFixed(2)} €</td></tr>`).join('');

  res.send(`<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"><title>Signer ${num}</title>
<style>*{box-sizing:border-box;margin:0;padding:0;}body{font-family:-apple-system,sans-serif;background:#f5f7fa;}.container{max-width:600px;margin:0 auto;padding:16px;}.header{background:linear-gradient(135deg,#1B2A4A,#243660);border-radius:20px;padding:24px;text-align:center;margin-bottom:16px;}.card{background:white;border-radius:16px;padding:20px;margin-bottom:14px;box-shadow:0 2px 16px rgba(0,0,0,0.06);}.label{font-size:11px;font-weight:800;color:#C9A84C;text-transform:uppercase;letter-spacing:1px;margin-bottom:12px;}.total{background:#1B2A4A;border-radius:12px;padding:16px 20px;display:flex;justify-content:space-between;align-items:center;margin-top:12px;}.canvas-wrap{border:2px dashed #ddd;border-radius:12px;background:#fafafa;position:relative;overflow:hidden;cursor:crosshair;}.btn-sign{width:100%;background:linear-gradient(135deg,#1B2A4A,#243660);color:white;border:none;border-radius:16px;padding:18px;font-size:16px;font-weight:800;cursor:pointer;margin-top:8px;}.btn-sign:disabled{opacity:0.4;}.btn-clear{background:none;border:1px solid #ddd;border-radius:8px;padding:8px 16px;font-size:12px;color:#888;cursor:pointer;margin-top:8px;}.success{display:none;text-align:center;padding:40px;}</style></head>
<body><div class="container">
  <div class="header"><h1 style="color:white;font-size:22px;font-weight:900;">⚡ SINELEC Paris</h1><p style="color:rgba(255,255,255,0.7);font-size:13px;margin-top:6px;">Signature électronique — N° ${num}</p></div>
  <div id="main-content">
    <div class="card"><div class="label">📋 Récapitulatif</div>
      <p style="font-size:15px;font-weight:700;color:#1B2A4A;">${devis.client||''}</p>
      <p style="font-size:12px;color:#888;margin-bottom:12px;">${devis.adresse||''}</p>
      <table style="width:100%;border-collapse:collapse;"><thead><tr style="background:#f8f9fa;"><th style="padding:10px;text-align:left;">Prestation</th><th style="text-align:center;">Qté</th><th style="text-align:right;">Prix HT</th></tr></thead><tbody>${prestationsHtml}</tbody></table>
      <div class="total"><span style="color:white;font-weight:700;">NET À PAYER</span><span style="color:#C9A84C;font-size:22px;font-weight:900;">${montant} €</span></div>
    </div>
    <div class="card"><div class="label">✅ Conditions</div>
      <p style="font-size:13px;color:#555;">✅ CGV SINELEC Paris — Montant: <strong style="color:#C9A84C;">${montant} €</strong> HT — Acompte: <strong style="color:#C9A84C;">${(parseFloat(montant)*0.4).toFixed(2)} €</strong></p>
    </div>
    <div class="card"><div class="label">✍️ Votre signature</div>
      <div class="canvas-wrap" id="canvas-wrap"><canvas id="sig-canvas" height="180" style="display:block;width:100%;touch-action:none;"></canvas><div id="canvas-placeholder" style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);color:#ccc;font-size:13px;pointer-events:none;">Signez ici</div></div>
      <button class="btn-clear" onclick="clearCanvas()">🗑️ Effacer</button>
    </div>
    <button class="btn-sign" id="btn-sign" disabled onclick="soumettre()">✍️ Signer et valider</button>
    <p style="font-size:11px;color:#aaa;text-align:center;margin-top:12px;padding-bottom:24px;">Signature électronique légalement valide</p>
  </div>
  <div class="success" id="success-block"><div style="font-size:72px;">✅</div><h2 style="color:#1B2A4A;margin:16px 0;">Signé !</h2><p style="color:#555;">Merci <strong>${devis.client||''}</strong> !<br><br><span style="color:#C9A84C;font-weight:700;">SINELEC Paris — 07 87 38 86 22</span></p></div>
</div>
<script>
let hasDrawn=false,isDrawing=false,canvas,ctx;
function initCanvas(){
  canvas=document.getElementById('sig-canvas');
  const wrap=document.getElementById('canvas-wrap');
  const dpr=window.devicePixelRatio||1; const w=wrap.getBoundingClientRect().width||320;
  canvas.width=w*dpr; canvas.height=180*dpr; canvas.style.width=w+'px'; canvas.style.height='180px';
  ctx=canvas.getContext('2d'); ctx.scale(dpr,dpr); ctx.strokeStyle='#1B2A4A'; ctx.lineWidth=2.5; ctx.lineCap='round'; ctx.lineJoin='round';
  canvas.addEventListener('mousedown',e=>{e.preventDefault();startDraw(e.offsetX,e.offsetY);});
  canvas.addEventListener('mousemove',e=>{e.preventDefault();if(isDrawing)draw(e.offsetX,e.offsetY);});
  canvas.addEventListener('mouseup',()=>stopDraw());
  canvas.addEventListener('touchstart',e=>{e.preventDefault();const t=e.touches[0];const r=canvas.getBoundingClientRect();startDraw(t.clientX-r.left,t.clientY-r.top);},{passive:false});
  canvas.addEventListener('touchmove',e=>{e.preventDefault();if(!isDrawing)return;const t=e.touches[0];const r=canvas.getBoundingClientRect();draw(t.clientX-r.left,t.clientY-r.top);},{passive:false});
  canvas.addEventListener('touchend',e=>{e.preventDefault();stopDraw();},{passive:false});
}
function startDraw(x,y){isDrawing=true;ctx.beginPath();ctx.moveTo(x,y);document.getElementById('canvas-placeholder').style.display='none';}
function draw(x,y){ctx.lineTo(x,y);ctx.stroke();ctx.beginPath();ctx.moveTo(x,y);hasDrawn=true;document.getElementById('btn-sign').disabled=false;}
function stopDraw(){isDrawing=false;}
function clearCanvas(){if(ctx){const dpr=window.devicePixelRatio||1;ctx.clearRect(0,0,canvas.width/dpr,canvas.height/dpr);}hasDrawn=false;document.getElementById('canvas-placeholder').style.display='block';document.getElementById('btn-sign').disabled=true;}
async function soumettre(){
  const btn=document.getElementById('btn-sign');btn.disabled=true;btn.textContent='⏳ Envoi...';
  try{
    const res=await fetch('/api/signature',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({num:'${num}',signature:canvas.toDataURL('image/png'),cgv_acceptees:true})});
    const data=await res.json();
    if(data.success){document.getElementById('main-content').style.display='none';document.getElementById('success-block').style.display='block';}
    else{btn.disabled=false;btn.textContent='✍️ Signer';alert('Erreur: '+(data.error||'Réessayez'));}
  }catch(e){btn.disabled=false;btn.textContent='✍️ Signer';alert('Erreur réseau.');}
}
setTimeout(initCanvas,300);
</script></body></html>`);
});

app.post('/api/signature', async (req, res) => {
  if (!CONFIG.features.signature_client) return res.status(403).json({ error: 'Feature désactivée' });
  try {
    const { num, signature, cgv_acceptees } = req.body;
    const now = new Date();
    const ipClient = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || 'N/A';
    const { data: devisData } = await supabase.from('historique').select('*').eq('num', num).single();
    if (!devisData) return res.status(404).json({ error: 'Devis introuvable' });

    await supabase.from('signatures').insert({ num, signature, cgv_acceptees: cgv_acceptees || false, date_signature: now.toISOString(), ip_client: ipClient });
    await supabase.from('historique').update({ signature, statut: 'signe', date_signature: now.toISOString(), cgv_acceptees: cgv_acceptees || false }).eq('num', num);

    const montant = parseFloat(devisData.total_ht || 0);
    const htmlConfirm = `<html><body style="font-family:Arial;padding:20px;"><h2>✅ Devis ${num} signé</h2><p>Client: ${devisData.client||''} — Montant: ${montant.toFixed(2)} € — Acompte: ${(montant*0.4).toFixed(2)} €</p><p>IP: ${ipClient} — Date: ${now.toLocaleDateString('fr-FR')}</p></body></html>`;
    if (devisData.email) { try { await envoyerEmail(devisData.email, `✅ Votre devis SINELEC ${num} signé`, htmlConfirm); } catch(e) {} }
    try { await envoyerEmail('sinelec.paris@gmail.com', `🔔 SIGNÉ — ${num} — ${devisData.client||''} — ${montant.toFixed(0)}€`, htmlConfirm); } catch(e) {}

    res.json({ success: true });
  } catch(error) {
    res.status(500).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════════════
// API: HISTORIQUE + OBAT
// ═══════════════════════════════════════════════════

app.get('/api/historique', async (req, res) => {
  if (!CONFIG.features.historique) return res.status(403).json({ error: 'Feature désactivée' });
  try {
    const { type } = req.query;
    let query = supabase.from('historique').select('*').order('created_at', { ascending: false });
    if (type && type !== 'tous') query = query.eq('type', type);
    const { data: histo, error } = await query;
    if (error) throw error;

    let obatFormate = [];
    if (!type || type === 'tous' || type === 'facture') {
      const { data: obat } = await supabase.from('factures_obat').select('*').eq('statut', 'Payée');
      obatFormate = (obat || []).map(f => ({ type: 'facture', client: f.client, total_ht: f.montant, statut: 'paye', created_at: f.date_facture + 'T00:00:00.000Z', num: f.reference, prestations: [{ nom: f.chantier, prix: f.montant, quantite: 1 }], source: 'obat' }));
    }

    const tout = [...(histo || []), ...obatFormate].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    res.json(tout);
  } catch(error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/historique/:num', async (req, res) => {
  try {
    const { error } = await supabase.from('historique').delete().eq('num', req.params.num);
    if (error) throw error;
    res.json({ success: true });
  } catch(error) { res.status(500).json({ error: error.message }); }
});

app.patch('/api/historique/:num/statut', async (req, res) => {
  try {
    const updates = {};
    if (req.body.statut !== undefined) updates.statut = req.body.statut;
    if (req.body.date_intervention !== undefined) {
      updates.date_intervention = req.body.date_intervention || null;
    }
    if (Object.keys(updates).length > 0) {
      await supabase.from('historique').update(updates).eq('num', req.params.num);
    }
    res.json({ success: true });
  } catch(error) { res.status(500).json({ error: error.message }); }
});

// ═══════════════════════════════════════════════════
// API: CA COMPLET
// ═══════════════════════════════════════════════════

app.get('/api/ca-complet', async (req, res) => {
  try {
    const { data: histo } = await supabase.from('historique').select('*').order('created_at', { ascending: false });
    const { data: obat } = await supabase.from('factures_obat').select('*').eq('statut', 'Payée');
    const obatFormate = (obat || []).map(f => ({
      type: 'facture', client: f.client, total_ht: f.montant,
      montant_diahe: f.montant, // Obat = 100% Diahe
      statut: 'paye', created_at: f.date_facture + 'T00:00:00.000Z',
      num: f.reference, prestations: [{ nom: f.chantier, prix: f.montant, quantite: 1 }], source: 'obat'
    }));
    // Enrichir chaque doc avec montant_diahe
    const histoEnrichi = (histo || []).map(h => {
      const pdiahe = h.part_diahe || 100;
      const montant_diahe = parseFloat(h.total_ht || 0) * pdiahe / 100;
      return { ...h, montant_diahe };
    });
    res.json([...histoEnrichi, ...obatFormate]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Vérifier si un devis a été signé (polling depuis l'app)
app.get('/api/historique/:num/check-signature', authMiddleware, async (req, res) => {
  try {
    const { data } = await supabase.from('historique').select('statut, signature, date_signature').eq('num', req.params.num).single();
    if (!data) return res.status(404).json({ error: 'Non trouvé' });
    res.json({ statut: data.statut, signe: data.statut === 'signe', date_signature: data.date_signature });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════
// API: CHARGES (MODULE RENTABILITÉ)
// ═══════════════════════════════════════════════════

// Lister charges d'un mois
app.get('/api/charges', authMiddleware, async (req, res) => {
  try {
    const { mois } = req.query;
    let query = supabase.from('charges').select('*').order('date', { ascending: false });
    if (mois) query = query.eq('mois', mois);
    const { data, error } = await query;
    if (error) throw error;
    res.json(data || []);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Ajouter une charge
app.post('/api/charges', authMiddleware, async (req, res) => {
  try {
    const { date, categorie, montant, note } = req.body;
    if (!categorie || !montant) return res.status(400).json({ error: 'Champs manquants' });
    const dateCharge = date || new Date().toISOString().split('T')[0];
    const mois = dateCharge.substring(0, 7); // YYYY-MM
    const { data, error } = await supabase.from('charges').insert({ date: dateCharge, mois, categorie, montant: parseFloat(montant), note: note || null }).select().single();
    if (error) throw error;
    res.json({ success: true, charge: data });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Supprimer une charge
app.delete('/api/charges/:id', authMiddleware, async (req, res) => {
  try {
    await supabase.from('charges').delete().eq('id', req.params.id);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Dashboard rentabilité d'un mois
app.get('/api/rentabilite/:mois', authMiddleware, async (req, res) => {
  try {
    const { mois } = req.params; // YYYY-MM

    // CA du mois (part Diahe uniquement)
    const { data: factures } = await supabase.from('historique')
      .select('total_ht, part_diahe, statut')
      .like('created_at', `${mois}%`)
      .eq('type', 'facture');

    const { data: obat } = await supabase.from('factures_obat')
      .select('montant')
      .like('date_facture', `${mois}%`)
      .eq('statut', 'Payée');

    const caFactures = (factures || [])
      .filter(f => ['paye','payé','payée'].includes((f.statut||'').toLowerCase()))
      .reduce((s, f) => s + parseFloat(f.total_ht || 0) * (f.part_diahe || 100) / 100, 0);
    const caObat = (obat || []).reduce((s, f) => s + parseFloat(f.montant || 0), 0);
    const ca_total = caFactures + caObat;

    // Charges du mois
    const { data: charges } = await supabase.from('charges').select('*').eq('mois', mois);
    const charges_total = (charges || []).reduce((s, c) => s + parseFloat(c.montant || 0), 0);

    // Par catégorie
    const par_categorie = {};
    (charges || []).forEach(c => {
      par_categorie[c.categorie] = (par_categorie[c.categorie] || 0) + parseFloat(c.montant || 0);
    });

    // Estimation URSSAF si pas saisie (~22% du CA pour AE)
    const urssaf_estimee = !(par_categorie['urssaf']) ? Math.round(ca_total * 0.22) : 0;

    const benefice_net = ca_total - charges_total;
    const taux_marge = ca_total > 0 ? Math.round((benefice_net / ca_total) * 100) : 0;

    res.json({
      mois, ca_total: Math.round(ca_total), charges_total: Math.round(charges_total),
      benefice_net: Math.round(benefice_net), taux_marge,
      urssaf_estimee, par_categorie, charges: charges || []
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════
// API: CLIENTS
// ═══════════════════════════════════════════════════

app.get('/api/clients', async (req, res) => {
  try {
    const { data, error } = await supabase.from('clients').select('*').order('nom', { ascending: true });
    if (error) throw error;
    const clientsAvecCA = await Promise.all((data || []).map(async (client) => {
      const { data: factures } = await supabase.from('factures_obat').select('montant').ilike('client', `%${client.nom}%`).eq('statut', 'Payée');
      const ca_total = (factures || []).reduce((s, f) => s + parseFloat(f.montant || 0), 0);
      return { ...client, ca_total, nb_interventions: (factures || []).length };
    }));
    res.json(clientsAvecCA);
  } catch(error) { res.status(500).json({ error: error.message }); }
});

// ═══════════════════════════════════════════════════
// API: VOCAL IA
// ═══════════════════════════════════════════════════

app.post('/api/vocal', async (req, res) => {
  const { texte } = req.body;
  if (!texte) return res.status(400).json({ error: 'Texte manquant' });
  try {
    const response = await anthropic.messages.create({ model: 'claude-haiku-4-5-20251001', max_tokens: 200, messages: [{ role: 'user', content: `Tu es l'assistant SINELEC Paris. Client: "${texte}"\nRéponds en JSON: {"reponse":"...","prix":"...","upsell":"...","negocie":"..."}` }] });
    const result = JSON.parse(response.content[0].text.trim().replace(/```json|```/g, '').trim());
    res.json({ success: true, ...result });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════
// API: DPE
// ═══════════════════════════════════════════════════

app.post('/api/dpe', async (req, res) => {
  try {
    const { pdf_text, image_base64, image_type, images_base64 } = req.body;
    if (!pdf_text && !image_base64 && !(images_base64 && images_base64.length)) return res.status(400).json({ error: 'Fichier manquant' });

    const promptBase = `Tu es un expert électricien. Analyse ce DPE et identifie UNIQUEMENT les travaux électriques. Réponds UNIQUEMENT en JSON valide:\n{"logement":{"surface":65,"classe":"F","annee_construction":1975,"chauffage_electrique":"...","eau_chaude_electrique":"...","vmc":"...","tableau":"...","daaf":"..."},"resume":"...","recommandations":[{"id":"...","titre":"...","description":"...","priorite":"haute","prestations":[{"nom":"...","prix":450,"quantite":1}]}]}`;

    let messageContent;
    if (images_base64 && images_base64.length > 1) {
      messageContent = [...images_base64.slice(0, 10).map(img => ({ type: 'image', source: { type: 'base64', media_type: img.type || 'image/jpeg', data: img.base64 } })), { type: 'text', text: promptBase }];
    } else if (image_base64 || (images_base64 && images_base64[0])) {
      const img = image_base64 ? { base64: image_base64, type: image_type } : images_base64[0];
      messageContent = [{ type: 'image', source: { type: 'base64', media_type: img.type || 'image/jpeg', data: img.base64 } }, { type: 'text', text: promptBase }];
    } else {
      messageContent = promptBase + '\n\nDPE:\n' + pdf_text.substring(0, 20000);
    }

    const response = await anthropic.messages.create({ model: 'claude-sonnet-4-20250514', max_tokens: 4096, messages: [{ role: 'user', content: messageContent }] });
    const result = JSON.parse(response.content[0].text.trim().replace(/```json|```/g, '').trim());
    result.recommandations = (result.recommandations || []).map(r => ({ ...r, total: (r.prestations || []).reduce((s, p) => s + p.prix * (p.quantite || 1), 0) }));
    result.total_general = result.recommandations.reduce((s, r) => s + r.total, 0);
    res.json({ success: true, ...result });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════
// API: RAPPORT
// ═══════════════════════════════════════════════════

app.post('/api/rapport', async (req, res) => {
  if (!CONFIG.features.rapports_intervention) return res.status(403).json({ error: 'Feature désactivée' });
  try {
    const { client, adresse, chantier } = req.body;
    const compteur = await incrementerCompteur('rapport');
    const num = `R-${new Date().getFullYear()}-${String(compteur).padStart(3, '0')}`;
    const response = await anthropic.messages.create({ model: 'claude-sonnet-4-20250514', max_tokens: 200, messages: [{ role: 'user', content: `Décris professionnellement ces travaux (2-3 phrases):\n${chantier}\nClient: ${client}` }] });
    const travaux = response.content[0].text;
    await supabase.from('rapports').insert({ num, client, adresse, travaux });
    res.json({ success: true, num, travaux });
  } catch(error) { res.status(500).json({ error: error.message }); }
});

// ═══════════════════════════════════════════════════
// API: AGENDA
// ═══════════════════════════════════════════════════

app.get('/api/agenda', async (req, res) => {
  try {
    const { data, error } = await supabase.from('agenda').select('*').order('date_intervention', { ascending: true }).order('heure', { ascending: true });
    if (error) throw error;
    res.json(data || []);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/agenda', async (req, res) => {
  try {
    const { prenom, nom, client, telephone, adresse, date_intervention, heure, type_intervention, notes, sms_rappel, statut } = req.body;
    const { data, error } = await supabase.from('agenda').insert({ prenom, nom, client: client || `${prenom} ${nom}`, telephone, adresse, date_intervention, heure, type_intervention, notes, sms_rappel: sms_rappel !== false, statut: statut || 'planifié', sms_veille_envoye: false, sms_matin_envoye: false }).select().single();
    if (error) throw error;
    res.json({ success: true, id: data.id });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/agenda/:id', async (req, res) => {
  try {
    const { prenom, nom, client, telephone, adresse, date_intervention, heure, type_intervention, notes, sms_rappel } = req.body;
    const { error } = await supabase.from('agenda').update({ prenom, nom, client: client || `${prenom} ${nom}`, telephone, adresse, date_intervention, heure, type_intervention, notes, sms_rappel: sms_rappel !== false, sms_veille_envoye: false, sms_matin_envoye: false }).eq('id', req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/agenda/:id/statut', async (req, res) => {
  try {
    const { error } = await supabase.from('agenda').update({ statut: req.body.statut }).eq('id', req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/agenda/:id', async (req, res) => {
  try {
    const { error } = await supabase.from('agenda').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/agenda/materiel/:type', (req, res) => {
  const MATERIEL = { 'Dépannage': ['Multimètre', 'Pince ampèremétrique', 'Testeur de prise', 'Tournevis isolés', 'Wago lot 50', 'Disjoncteurs 10/16/20A', 'Câble 1.5+2.5mm²', 'Lampe frontale'], 'Tableau': ['Coffret 1 rangée', 'Disjoncteurs assortis', 'Différentiel 30mA type A', 'Câble 2.5mm²', 'Tournevis isolés', 'Multimètre'], 'VMC': ['Caisson VMC', 'Gaine flexible', 'Bouches extraction', 'Câble 1.5mm²', 'Perceuse + forets'], 'Installation': ['Câble 2.5mm² (20m)', 'Câble 1.5mm² (10m)', 'Goulotte 40x16', 'Prises 2P+T', 'Interrupteurs', 'Boîtes encastrement', 'Wago lot 100'], 'Autre': ['Multimètre', 'Tournevis isolés', 'Câbles assortis', 'Wago', 'Lampe frontale'] };
  const type = decodeURIComponent(req.params.type);
  res.json({ type, materiel: MATERIEL[type] || MATERIEL['Autre'] });
});

// ═══════════════════════════════════════════════════
// API: GRILLE
// ═══════════════════════════════════════════════════

app.get('/api/grille', async (req, res) => {
  try {
    const { data, error } = await supabase.from('grille_tarifaire').select('code, nom, prix_ht').eq('actif', true);
    if (error) throw error;
    res.json(data || []);
  } catch(error) { res.status(500).json({ error: error.message }); }
});

app.get('/api/grille/grouped', async (req, res) => {
  try {
    res.json(await chargerGrilleTarifaire() || {});
  } catch(error) { res.status(500).json({ error: error.message }); }
});

// ═══════════════════════════════════════════════════
// API: PDF DOWNLOAD
// ═══════════════════════════════════════════════════

app.get('/api/pdf/:num', async (req, res) => {
  try {
    const { num } = req.params;
    const { data, error } = await supabase.from('historique').select('*').eq('num', num).single();
    if (error || !data) return res.status(404).json({ error: 'Document non trouvé' });

    const docType = data.type || (num.startsWith('OS-') ? 'devis' : 'facture');
    const docStatut = data.statut || '';
    const typeLabelUpper = docType === 'devis' ? 'DEVIS' : (docStatut === 'paye' || docStatut === 'payé' ? 'FACTURE ACQUITTEE' : 'FACTURE');
    const dateStr = new Date(data.date_envoi || data.created_at).toLocaleDateString('fr-FR');
    const dateValide = new Date(new Date(data.date_envoi || data.created_at).getTime() + 30*24*60*60*1000).toLocaleDateString('fr-FR');

    const detailsPath = path.join(__dirname, `_dl_details_${num}.json`);
    const pyPath = path.join(__dirname, `_dl_${num}.py`);
    const pdfPath = path.join(__dirname, `_dl_${num}.pdf`);
    const detailsData = (data.prestations || []).map(p => ({ designation: p.nom || p.designation, qte: p.quantite || 1, prixUnit: p.prix || 0, total: (p.prix || 0) * (p.quantite || 1), details: p.desc ? [p.desc] : [] }));
    fs.writeFileSync(detailsPath, JSON.stringify(detailsData));

    const clientEsc = String(data.client || '').replace(/'/g, ' ');
    const clientParts = (data.adresse || '').split(',');
    const clientRue = String(clientParts[0] || '').trim().replace(/'/g, ' ');
    const clientVille = clientParts.slice(1).join(',').trim().replace(/'/g, ' ');

    const py = `# -*- coding: utf-8 -*-
import json, base64, io, sys
from reportlab.lib.pagesizes import A4; from reportlab.lib import colors; from reportlab.lib.units import cm
from reportlab.platypus import *; from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_RIGHT; from reportlab.pdfgen import canvas as pdfcanvas
from reportlab.lib.utils import ImageReader
W,H=A4; MARINE=colors.HexColor('#1B2A4A'); OR=colors.HexColor('#C9A84C')
OR_PALE=colors.HexColor('#FBF7EC'); BLANC=colors.white; CREME=colors.HexColor('#FDFCF9')
GRIS_TEXTE=colors.HexColor('#3A3A3A'); GRIS_SOFT=colors.HexColor('#777777')
GRIS_LIGNE=colors.HexColor('#E0DDD6'); GRIS_BG=colors.HexColor('#F5F4F0')
def p(txt,sz=9,font='Helvetica',color=GRIS_TEXTE,align=TA_LEFT,sb=0,sa=2,leading=None):
    if leading is None: leading=sz*1.35
    return Paragraph(str(txt),ParagraphStyle('s',fontName=font,fontSize=sz,textColor=color,alignment=align,spaceBefore=sb,spaceAfter=sa,leading=leading,wordWrap='CJK'))
data=json.loads(open(sys.argv[1],encoding='utf-8').read()); totalHT=sum(l['total'] for l in data)
logo_bytes=base64.b64decode(open('/app/logo_b64.txt').read().strip())
class SC(pdfcanvas.Canvas):
    def __init__(self,fn,**kw): pdfcanvas.Canvas.__init__(self,fn,**kw); self._pg=0; self.saveState(); self._draw_page()
    def showPage(self): self._draw_footer(); pdfcanvas.Canvas.showPage(self); self._pg+=1
    def save(self): self._draw_footer(); pdfcanvas.Canvas.save(self)
    def _draw_page(self):
        self.saveState(); self.setFillColor(CREME); self.rect(0,0,W,H,fill=1,stroke=0)
        self.setFillColor(MARINE); self.rect(0,0,0.7*cm,H,fill=1,stroke=0)
        self.setFillColor(OR); self.rect(0.7*cm,0,0.08*cm,H,fill=1,stroke=0); self._draw_header(); self.restoreState()
    def _draw_header(self):
        self.setFillColor(MARINE); self.rect(0.78*cm,H-5.2*cm,W-0.78*cm,5.2*cm,fill=1,stroke=0)
        self.setFillColor(OR); self.rect(0.78*cm,H-5.2*cm,W-0.78*cm,0.1*cm,fill=1,stroke=0)
        self.drawImage(ImageReader(io.BytesIO(logo_bytes)),1.3*cm,H-4.6*cm,width=3.0*cm,height=3.0*cm,preserveAspectRatio=True,mask='auto')
        self.setFont('Helvetica',7.5); self.setFillColor(colors.HexColor('#BFC8D6'))
        self.drawString(1.3*cm,H-4.85*cm,'128 Rue La Boetie, 75008 Paris'); self.drawString(1.3*cm,H-5.1*cm,'07 87 38 86 22  |  sinelec.paris@gmail.com  |  SIRET : 91015824500019')
        self.setFont('Helvetica-Bold',44); self.setFillColor(BLANC); self.drawRightString(W-1.2*cm,H-2.2*cm,'${typeLabelUpper}')
        self.setStrokeColor(OR); self.setLineWidth(1.5); self.line(10*cm,H-2.65*cm,W-1.2*cm,H-2.65*cm)
        self.setFillColor(OR); self.roundRect(W-6.5*cm,H-3.55*cm,5.3*cm,0.65*cm,0.15*cm,fill=1,stroke=0)
        self.setFont('Helvetica-Bold',9); self.setFillColor(MARINE); self.drawCentredString(W-3.85*cm,H-3.22*cm,'N ${num}')
        self.setFont('Helvetica',8); self.setFillColor(colors.HexColor('#BFC8D6')); self.drawRightString(W-1.2*cm,H-3.9*cm,'Date : ${dateStr}  |  Valable : ${dateValide}')
    def _draw_footer(self):
        self.saveState(); self.setFillColor(MARINE); self.rect(0,0,W,1.0*cm,fill=1,stroke=0)
        self.setFillColor(OR); self.rect(0,1.0*cm,W,0.08*cm,fill=1,stroke=0)
        self.setFont('Helvetica',6.5); self.setFillColor(colors.HexColor('#8899BB'))
        self.drawCentredString(W/2,0.5*cm,'SINELEC EI \\u2022 128 Rue La Boetie 75008 Paris \\u2022 SIRET : 91015824500019 \\u2022 TVA non applicable art. 293B CGI')
        self.setFont('Helvetica-Bold',7); self.setFillColor(OR); self.drawRightString(W-1.2*cm,0.28*cm,'${num}'); self.restoreState()
doc=SimpleDocTemplate(sys.argv[2],pagesize=A4,leftMargin=1.2*cm,rightMargin=1.0*cm,topMargin=5.6*cm,bottomMargin=1.6*cm); story=[]
client_b=Table([[p('CLIENT',7,'Helvetica-Bold',OR,sa=4)],[p('${clientEsc}',10,'Helvetica-Bold',MARINE)],[p('${clientRue}',8.5,color=GRIS_TEXTE)],[p('${clientVille}',8.5,color=GRIS_TEXTE)]],colWidths=[18.2*cm])
client_b.setStyle(TableStyle([('TOPPADDING',(0,0),(-1,-1),3),('BOTTOMPADDING',(0,0),(-1,-1),3),('LEFTPADDING',(0,0),(-1,-1),14),('RIGHTPADDING',(0,0),(-1,-1),14),('BACKGROUND',(0,0),(-1,-1),OR_PALE),('BOX',(0,0),(-1,-1),1,OR),('LINEBEFORE',(0,0),(0,-1),4,MARINE),('TOPPADDING',(0,0),(0,0),10),('BOTTOMPADDING',(0,-1),(-1,-1),10)]))
story.append(client_b); story.append(Spacer(1,0.5*cm))
cw=[0.7*cm,9.5*cm,1.5*cm,0.9*cm,2.4*cm,3.2*cm]
rows=[[p('#',7.5,'Helvetica-Bold',BLANC,TA_CENTER),p('DESIGNATION',7.5,'Helvetica-Bold',BLANC),p('QTE',7.5,'Helvetica-Bold',BLANC,TA_CENTER),p('U.',7.5,'Helvetica-Bold',BLANC,TA_CENTER),p('PRIX U. HT',7.5,'Helvetica-Bold',BLANC,TA_RIGHT),p('TOTAL HT',7.5,'Helvetica-Bold',BLANC,TA_RIGHT)]]
for i,l in enumerate(data):
    q=int(l['qte']) if l['qte']==int(l['qte']) else l['qte']
    rows.append([p(str(i+1),9,color=OR,align=TA_CENTER),p('<b>'+l['designation']+'</b>',9,color=MARINE),p(str(q),9,align=TA_CENTER),p('u.',9,align=TA_CENTER,color=GRIS_SOFT),p('%.2f \\u20ac'%l['prixUnit'],9,align=TA_RIGHT),p('<b>%.2f \\u20ac</b>'%l['total'],9,'Helvetica-Bold',MARINE,TA_RIGHT)])
t=Table(rows,colWidths=cw); ts=[('BACKGROUND',(0,0),(-1,0),MARINE),('LINEBELOW',(0,0),(-1,0),2.5,OR),('VALIGN',(0,0),(-1,-1),'TOP'),('TOPPADDING',(0,0),(-1,-1),6),('BOTTOMPADDING',(0,0),(-1,-1),6),('LEFTPADDING',(0,0),(-1,-1),7),('RIGHTPADDING',(0,0),(-1,-1),7),('BOX',(0,0),(-1,-1),0.3,GRIS_LIGNE)]
for i in range(len(data)):
    bg=BLANC if i%2==0 else GRIS_BG; ts.extend([('BACKGROUND',(0,i+1),(-1,i+1),bg),('LINEBELOW',(0,i+1),(-1,i+1),0.3,GRIS_LIGNE)])
t.setStyle(TableStyle(ts)); story.append(t); story.append(Spacer(1,0.15*cm))
tt=Table([['',p('Total HT',9,color=GRIS_SOFT,align=TA_RIGHT),p('%.2f \\u20ac'%totalHT,9,'Helvetica-Bold',GRIS_TEXTE,TA_RIGHT)],['',p('TVA',9,color=GRIS_SOFT,align=TA_RIGHT),p('Non applicable (art. 293B)',8,color=GRIS_SOFT,align=TA_RIGHT)]],colWidths=[9.0*cm,4.5*cm,4.7*cm])
tt.setStyle(TableStyle([('LINEABOVE',(1,0),(-1,0),0.5,GRIS_LIGNE),('TOPPADDING',(0,0),(-1,-1),5),('BOTTOMPADDING',(0,0),(-1,-1),5),('LEFTPADDING',(0,0),(-1,-1),6),('RIGHTPADDING',(0,0),(-1,-1),6)])); story.append(tt); story.append(Spacer(1,0.12*cm))
net=Table([[p('NET A PAYER',12,'Helvetica-Bold',BLANC),p('%.2f \\u20ac'%totalHT,16,'Helvetica-Bold',OR,TA_RIGHT)]],colWidths=[9.0*cm,9.2*cm])
net.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,-1),MARINE),('TOPPADDING',(0,0),(-1,-1),10),('BOTTOMPADDING',(0,0),(-1,-1),10),('LEFTPADDING',(0,0),(-1,-1),14),('RIGHTPADDING',(0,0),(-1,-1),14),('LINEBELOW',(0,0),(-1,-1),3,OR),('VALIGN',(0,0),(-1,-1),'MIDDLE')])); story.append(net)
doc.build(story,canvasmaker=lambda fn,**kw: SC(fn,**kw)); print('PDF_OK')
`;
    fs.writeFileSync(pyPath, py, 'utf8');
    try { execSync(`python3 ${pyPath} ${detailsPath} ${pdfPath}`, { cwd: __dirname, stdio: 'inherit' }); } catch(e) { throw new Error('PDF failed'); }
    const pdfBuffer = fs.readFileSync(pdfPath);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${num}.pdf"`);
    res.send(pdfBuffer);
    try { fs.unlinkSync(pyPath); } catch(e) {}
    try { fs.unlinkSync(detailsPath); } catch(e) {}
    try { fs.unlinkSync(pdfPath); } catch(e) {}
  } catch(error) { res.status(500).json({ error: error.message }); }
});

// ═══════════════════════════════════════════════════
// API: SUMUP
// ═══════════════════════════════════════════════════

app.post('/api/sumup/lien/:num', async (req, res) => {
  try {
    const { num } = req.params;
    const { data, error } = await supabase.from('historique').select('*').eq('num', num).single();
    if (error || !data) return res.status(404).json({ error: 'Document non trouvé' });
    const montant = parseFloat(data.total_ht || 0);
    if (montant <= 0) return res.status(400).json({ error: 'Montant invalide' });

    const appUrl = process.env.APP_URL || 'https://sinelec-api-production.up.railway.app';
    const checkoutRes = await fetch('https://api.sumup.com/v0.1/checkouts', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${SUMUP_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ checkout_reference: `SINELEC-${num}-${Date.now()}`, amount: montant, currency: 'EUR', description: `SINELEC ${num}`, pay_to_email: process.env.SUMUP_EMAIL || 'sinelec.paris@gmail.com', redirect_url: `${appUrl}/paiement-confirme/${num}`, hosted_checkout: { enabled: true } }),
    });
    if (!checkoutRes.ok) { const err = await checkoutRes.text(); return res.status(500).json({ error: 'SumUp: ' + err }); }
    const checkout = await checkoutRes.json();
    const lienPaiement = checkout.hosted_checkout_url || checkout.checkout_url || `https://pay.sumup.com/b2c/checkout/${checkout.id}`;
    await supabase.from('historique').update({ lien_paiement: lienPaiement, checkout_id: checkout.id }).eq('num', num);

    const prenomClient = (data.client || 'client').split(' ')[0];
    const modeEnvoi = req.query.envoi || 'les2';
    if ((modeEnvoi === 'email' || modeEnvoi === 'les2') && data.email) {
      try { await envoyerEmail(data.email, `💳 Paiement SINELEC ${num} — ${montant.toFixed(2)} €`, `<html><body style="font-family:Arial;padding:20px;"><h2>⚡ SINELEC Paris</h2><p>Bonjour ${prenomClient},</p><p>Facture <strong>${num}</strong> — <strong>${montant.toFixed(2)} €</strong></p><p><a href="${lienPaiement}" style="background:#C9A84C;color:white;padding:14px 28px;border-radius:10px;text-decoration:none;font-weight:800;display:inline-block;margin-top:12px;">💳 Payer maintenant</a></p></body></html>`); } catch(e) {}
    }
    if ((modeEnvoi === 'sms' || modeEnvoi === 'les2') && data.telephone) {
      try { await envoyerSMS(data.telephone, `Bonjour ${prenomClient} 😊 Lien paiement sécurisé ${montant.toFixed(0)}EUR : ${lienPaiement} SINELEC Paris ⚡`); } catch(e) {}
    }
    res.json({ success: true, lien: lienPaiement, checkout_id: checkout.id, montant, num });
  } catch(error) { res.status(500).json({ error: error.message }); }
});

app.get('/paiement-confirme/:num', async (req, res) => {
  const { num } = req.params;
  try {
    await supabase.from('historique').update({ statut: 'paye', date_paiement: new Date().toISOString() }).eq('num', num);
    const { data: factureData } = await supabase.from('historique').select('*').eq('num', num).single();
    if (factureData?.email) {
      setImmediate(async () => {
        try {
          const montant = parseFloat(factureData.total_ht || 0);
          const prenomClient = (factureData.client || 'client').split(' ')[0];
          const html = `<html><body style="font-family:Arial;padding:20px;"><h2 style="color:#16a34a;">✅ Paiement reçu — Merci !</h2><p>Bonjour <b>${prenomClient}</b>, votre paiement de ${montant.toFixed(2)} € a bien été reçu.</p></body></html>`;
          await envoyerEmail(factureData.email, `✅ Facture SINELEC ${num} — Paiement reçu`, html);
          await envoyerEmail('sinelec.paris@gmail.com', `💰 PAIEMENT RECU — ${num} — ${factureData.client||''} — ${montant.toFixed(0)}€`, html);
          // SMS confirmation + avis Google en 1 seul message
          if (factureData.telephone) {
            await envoyerSMS(factureData.telephone, `Merci ${prenomClient} ! Paiement ${montant.toFixed(0)}€ reçu ✅ Un avis Google nous aiderait beaucoup : https://g.page/r/CSw-MABnFUAYEAE/review — SINELEC Paris ⚡`);
          }
        } catch(e) {}
      });
    }
  } catch(e) {}
  res.send(`<html><body style="text-align:center;padding:40px;font-family:Arial;"><div style="max-width:500px;margin:40px auto;background:white;border-radius:20px;padding:40px;box-shadow:0 4px 20px rgba(0,0,0,0.1);"><div style="font-size:64px;">✅</div><h2 style="color:#1B2A4A;">Paiement confirmé !</h2><p style="color:#555;">Référence : <strong style="color:#C9A84C;">${num}</strong></p><p style="color:#aaa;margin-top:20px;">SINELEC Paris — 07 87 38 86 22</p></div></body></html>`);
});

app.post('/api/marquer-paye', async (req, res) => {
  const { num, mode_paiement } = req.body;
  if (!num) return res.status(400).json({ error: 'Numéro manquant' });
  try {
    const modeLabel = mode_paiement === 'terminal' ? 'CB Terminal SumUp' : mode_paiement === 'virement' ? 'Virement bancaire' : 'Espèces';
    await supabase.from('historique').update({ statut: 'paye', date_paiement: new Date().toISOString(), mode_paiement: modeLabel }).eq('num', num);
    const { data: factureData } = await supabase.from('historique').select('*').eq('num', num).single();
    if (!factureData) return res.status(404).json({ error: 'Facture non trouvée' });
    res.json({ success: true, message: `Paiement ${modeLabel} enregistré` });
    setImmediate(async () => {
      try {
        const montant = parseFloat(factureData.total_ht || 0);
        const prenomClient = (factureData.client || 'client').split(' ')[0];
        const html = `<html><body style="font-family:Arial;padding:20px;"><h2 style="color:#16a34a;">✅ Paiement reçu — ${modeLabel}</h2><p>Bonjour <b>${prenomClient}</b>, facture ${num} réglée — ${montant.toFixed(2)} €.</p></body></html>`;
        if (factureData.email) await envoyerEmail(factureData.email, `✅ Facture SINELEC ${num} — Paiement reçu`, html);
        await envoyerEmail('sinelec.paris@gmail.com', `💰 PAIEMENT ${modeLabel.toUpperCase()} — ${num} — ${factureData.client||''} — ${montant.toFixed(0)}€`, html);
        // SMS confirmation paiement + avis Google en 1 seul message
        if (factureData.telephone) {
          await envoyerSMS(factureData.telephone, `Merci ${prenomClient} ! Paiement ${montant.toFixed(0)}€ reçu ✅ Un avis Google nous aiderait beaucoup : https://g.page/r/CSw-MABnFUAYEAE/review — SINELEC Paris ⚡`);
        }
      } catch(e) {}
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════
// MONITORING
// ═══════════════════════════════════════════════════

const serviceStatus = {
  brevo_email: { status: 'unknown', lastCheck: null, lastError: null, uptime: 0, checks: 0 },
  brevo_sms:   { status: 'unknown', lastCheck: null, lastError: null, uptime: 0, checks: 0 },
  sumup:       { status: 'unknown', lastCheck: null, lastError: null, uptime: 0, checks: 0 },
  supabase:    { status: 'unknown', lastCheck: null, lastError: null, uptime: 0, checks: 0 },
  claude_api:  { status: 'unknown', lastCheck: null, lastError: null, uptime: 0, checks: 0 },
  pdf_python:  { status: 'unknown', lastCheck: null, lastError: null, uptime: 0, checks: 0 },
};

async function mettreAJourStatut(service, ok, erreur = null) {
  const s = serviceStatus[service]; if (!s) return;
  s.status = ok ? 'ok' : 'error'; s.lastCheck = new Date().toISOString(); s.lastError = ok ? null : String(erreur || 'Erreur'); s.checks++; if (ok) s.uptime++;
  try { await supabase.from('monitoring').upsert({ service, status: s.status, last_check: s.lastCheck, last_error: s.lastError, uptime_pct: Math.round((s.uptime / s.checks) * 100) }, { onConflict: 'service' }); } catch(e) {}
}

async function verifierSante() {
  const erreurs = [];
  try { const { error } = await supabase.from('compteurs').select('valeur').limit(1); if (error) throw error; await mettreAJourStatut('supabase', true); } catch(e) { await mettreAJourStatut('supabase', false, e.message); erreurs.push('supabase'); }
  try { const r = await fetch('https://api.brevo.com/v3/account', { headers: { 'api-key': BREVO_API_KEY } }); if (!r.ok) throw new Error('HTTP ' + r.status); await mettreAJourStatut('brevo_email', true); await mettreAJourStatut('brevo_sms', true); } catch(e) { await mettreAJourStatut('brevo_email', false, e.message); await mettreAJourStatut('brevo_sms', false, e.message); erreurs.push('brevo'); }
  try { if (SUMUP_API_KEY) { const r = await fetch('https://api.sumup.com/v0.1/me', { headers: { 'Authorization': `Bearer ${SUMUP_API_KEY}` } }); if (!r.ok && r.status !== 404) throw new Error('HTTP ' + r.status); await mettreAJourStatut('sumup', true); } } catch(e) { await mettreAJourStatut('sumup', false, e.message); erreurs.push('sumup'); }
  try { if (!process.env.ANTHROPIC_API_KEY) throw new Error('Clé manquante'); await mettreAJourStatut('claude_api', true); } catch(e) { await mettreAJourStatut('claude_api', false, e.message); erreurs.push('claude_api'); }
  try { execSync('python3 -c "import reportlab"', { timeout: 5000 }); await mettreAJourStatut('pdf_python', true); } catch(e) { await mettreAJourStatut('pdf_python', false, e.message); erreurs.push('pdf_python'); }
  return { ok: erreurs.length === 0, erreurs, status: serviceStatus };
}

app.get('/api/sante', async (req, res) => {
  try {
    const { data } = await supabase.from('monitoring').select('*');
    const result = {};
    for (const [service, status] of Object.entries(serviceStatus)) {
      const db = (data || []).find(r => r.service === service);
      result[service] = { ...status, uptime_pct: db?.uptime_pct || null };
    }
    res.json({ global: Object.values(result).every(s => s.status === 'ok' || s.status === 'unknown') ? 'ok' : 'degraded', services: result });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/sante/verifier', async (req, res) => {
  try { res.json(await verifierSante()); } catch(e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════
// VEILLE + RELANCES
// ═══════════════════════════════════════════════════

app.post('/api/veille/lancer', async (req, res) => {
  if (!CONFIG.features.veille_tarifaire) return res.status(403).json({ error: 'Feature désactivée' });
  res.json({ success: true, message: 'Veille tarifaire lancée' });
});

app.post('/api/relances/lancer', async (req, res) => {
  if (!CONFIG.features.relances_auto) return res.status(403).json({ error: 'Feature désactivée' });
  res.json({ success: true, message: 'Relances lancées' });
});

// ═══════════════════════════════════════════════════
// RAPPORT HEBDOMADAIRE
// ═══════════════════════════════════════════════════

async function rapportHebdomadaire() {
  try {
    const maintenant = new Date(); const lundiDernier = new Date(maintenant); lundiDernier.setDate(maintenant.getDate() - 7);
    const { data: docs } = await supabase.from('historique').select('*').gte('created_at', lundiDernier.toISOString());
    const factures = (docs || []).filter(d => d.type === 'facture');
    const devis = (docs || []).filter(d => d.type === 'devis');
    const caSemaine = factures.reduce((s, f) => s + parseFloat(f.total_ht || 0), 0);
    const { data: tousDevis } = await supabase.from('historique').select('*').eq('type', 'devis').in('statut', ['envoyé', 'envoye']);
    const devisARelancer = (tousDevis || []).filter(d => (new Date() - new Date(d.created_at)) / 3600000 > 48);
    const semaine = `${lundiDernier.toLocaleDateString('fr-FR')} → ${maintenant.toLocaleDateString('fr-FR')}`;
    const html = `<html><body style="font-family:Arial;padding:20px;"><h2>📊 Rapport hebdomadaire SINELEC — ${semaine}</h2><p>CA facturé : <strong>${caSemaine.toFixed(2)} €</strong> (${factures.length} factures)</p><p>Devis envoyés : ${devis.length}</p><p>À relancer (+48h) : <strong style="color:#ef4444;">${devisARelancer.length}</strong></p><p><a href="https://sinelec-api-production.up.railway.app/app.html">📱 SINELEC OS</a></p></body></html>`;
    await envoyerEmail('sinelec.paris@gmail.com', `📊 Rapport SINELEC — CA: ${caSemaine.toFixed(0)}€ — ${devisARelancer.length} à relancer`, html);
  } catch(e) { console.error('Rapport hebdo:', e.message); }
}

app.post('/api/rapport-hebdo/tester', async (req, res) => {
  try { await rapportHebdomadaire(); res.json({ success: true }); } catch(e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════
// CRONS
// ═══════════════════════════════════════════════════

// SMS veille 18h
cron.schedule('0 18 * * *', async () => {
  try {
    const demain = new Date(); demain.setDate(demain.getDate() + 1);
    const demainStr = demain.toISOString().split('T')[0];
    const { data } = await supabase.from('agenda').select('*').eq('date_intervention', demainStr).eq('sms_rappel', true).eq('sms_veille_envoye', false).neq('statut', 'annulé');
    for (const iv of (data || [])) {
      if (!iv.telephone) continue;
      const prenom = iv.prenom || (iv.client||'').split(' ')[0];
      const dateLabel = demain.toLocaleDateString('fr-FR', { weekday:'long', day:'numeric', month:'long' });
      await envoyerSMS(iv.telephone, `Bonjour ${prenom} ! Rappel intervention SINELEC demain ${dateLabel} à ${iv.heure}. Tel: 07 87 38 86 22 ⚡`);
      await supabase.from('agenda').update({ sms_veille_envoye: true }).eq('id', iv.id);
    }
  } catch(e) { console.error('SMS veille:', e.message); }
});

// SMS matin 8h45
cron.schedule('45 8 * * *', async () => {
  try {
    const aujourdhui = new Date().toISOString().split('T')[0];
    const { data } = await supabase.from('agenda').select('*').eq('date_intervention', aujourdhui).eq('sms_rappel', true).eq('sms_matin_envoye', false).neq('statut', 'annulé');
    for (const iv of (data || [])) {
      if (!iv.telephone) continue;
      const prenom = iv.prenom || (iv.client||'').split(' ')[0];
      await envoyerSMS(iv.telephone, `Bonjour ${prenom} 😊 Intervention SINELEC confirmée aujourd'hui à ${iv.heure}. Tel: 07 87 38 86 22 ⚡`);
      await supabase.from('agenda').update({ sms_matin_envoye: true }).eq('id', iv.id);
    }
  } catch(e) { console.error('SMS matin:', e.message); }
});

// Récap matin 7h
cron.schedule('0 7 * * *', async () => {
  try {
    const aujourdhui = new Date().toISOString().split('T')[0];
    const dateLabel = new Date().toLocaleDateString('fr-FR', { weekday:'long', day:'numeric', month:'long', year:'numeric' });
    const { data: liste } = await supabase.from('agenda').select('*').eq('date_intervention', aujourdhui).neq('statut', 'annulé').order('heure', { ascending: true });
    if (!liste || liste.length === 0) return;
    const rows = liste.map(iv => `<tr><td style="padding:8px;color:#C9A84C;font-weight:700;">${iv.heure}</td><td style="padding:8px;">${iv.client}</td><td style="padding:8px;color:#555;">${iv.adresse||'—'}</td><td style="padding:8px;">${iv.type_intervention}</td></tr>`).join('');
    const html = `<html><body style="font-family:Arial;padding:20px;"><h2>☀️ Bonjour Diahe ! — ${dateLabel}</h2><p><strong>${liste.length}</strong> intervention(s)</p><table border="1" cellpadding="8" style="border-collapse:collapse;width:100%;"><tr style="background:#f8f9fa;"><th>Heure</th><th>Client</th><th>Adresse</th><th>Type</th></tr>${rows}</table></body></html>`;
    await envoyerEmail('sinelec.paris@gmail.com', `☀️ ${liste.length} intervention(s) aujourd'hui — SINELEC`, html);
  } catch(e) { console.error('Récap matin:', e.message); }
});

// Rapport hebdo lundi 8h
cron.schedule('0 8 * * 1', rapportHebdomadaire);

// Health check toutes les heures
cron.schedule('0 * * * *', verifierSante);

// Health check démarrage (2min)
setTimeout(() => { verifierSante().catch(() => {}); }, 120000);

// ═══════════════════════════════════════════════════
// DÉMARRAGE
// ═══════════════════════════════════════════════════

const server = app.listen(PORT, () => {
  console.log(`⚡ SINELEC OS v${CONFIG.meta.version} — Port ${PORT}`);
});

server.timeout = 300000;
server.keepAliveTimeout = 300000;
